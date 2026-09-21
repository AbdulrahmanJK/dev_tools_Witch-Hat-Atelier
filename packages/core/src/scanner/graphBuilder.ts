import fs from 'node:fs';
import path from 'node:path';
import type { RawGraphData, SealEdge, SealNode } from '../types/index.js';
import { AliasResolver } from './aliasResolver.js';
import { parseFileToAst } from './astParser.js';
import { detectFileEntities, type DetectedEntities } from './detector.js';
import { calculateComponentMetrics, calculateNonComponentMetrics } from './metrics.js';
import { detectVueFileEntities } from './vueDetector.js';

export class GraphBuilder {
  private projectRoot: string;
  private resolver: AliasResolver;
  private srcDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.resolver = new AliasResolver(this.projectRoot);
    this.srcDir = path.join(this.projectRoot, 'src');
    if (!fs.existsSync(this.srcDir)) {
      this.srcDir = this.projectRoot;
    }
  }

  public buildGraph(): RawGraphData {
    const files = this.collectSourceFiles(this.srcDir);
    const fileDataMap = new Map<
      string,
      {
        filePath: string;
        relPath: string;
        loc: number;
        entities: DetectedEntities;
        error: string | null;
      }
    >();
    const nodes: SealNode[] = [];
    const fileToNodeIds = new Map<string, string[]>();
    let locTotal = 0;

    // 1. Parse each file
    for (const filePath of files) {
      const relPath = path.relative(this.projectRoot, filePath);
      const ext = path.extname(filePath).toLowerCase();

      let entities: DetectedEntities;
      let error: string | null = null;
      let loc = 0;

      if (ext === '.vue') {
        const content = fs.readFileSync(filePath, 'utf8');
        loc = content.split('\n').length;
        entities = detectVueFileEntities(content, filePath);
      } else {
        const parseRes = parseFileToAst(filePath);
        error = parseRes.error;
        loc = parseRes.code.split('\n').length;
        entities = detectFileEntities(parseRes.ast, parseRes.code, filePath);
      }

      locTotal += loc;
      fileDataMap.set(filePath, {
        filePath,
        relPath,
        loc,
        entities,
        error,
      });
    }

    // 2. Create Nodes
    for (const [filePath, data] of fileDataMap.entries()) {
      const { relPath, loc, entities } = data;
      const cluster = this.determineCluster(relPath);
      const nodeIdsForThisFile: string[] = [];
      const ext = path.extname(filePath).toLowerCase();
      const framework = ext === '.vue' ? 'vue' : entities.hasJsx ? 'react' : 'none';

      if (entities.components && entities.components.length > 0) {
        entities.components.forEach((comp) => {
          const id = `${relPath}#${comp.name}`;
          const metrics = calculateComponentMetrics(comp, {
            filePath,
            antiPatterns: entities.antiPatterns,
            loc,
            codeInventory: comp.codeInventory,
          });

          const node: SealNode = {
            id,
            name: comp.name,
            file: relPath,
            kind: 'component',
            language: ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript',
            framework,
            loc: comp.loc || loc,
            hooks: comp.hooksUsed,
            children: comp.renderedChildren,
            internalCircuit: comp.internalCircuit || {
              stateVariables: [],
              effects: [],
              handlers: [],
            },
            metrics,
            cluster,
            x: 0,
            y: 0,
          };

          nodes.push(node);
          nodeIdsForThisFile.push(id);
        });
      } else {
        // Module Node (Redux, API, Utils, Constants, Hooks)
        const baseName = path.basename(filePath, path.extname(filePath));
        let category = 'utils';
        if (relPath.includes('api')) category = 'api';
        else if (relPath.includes('redux')) category = 'redux';
        else if (relPath.includes('constants') || relPath.includes('mock')) category = 'constants';
        else if (entities.hooksDefined && entities.hooksDefined.length > 0) category = 'hook';

        const id = relPath;
        const metrics = calculateNonComponentMetrics({ loc }, category);

        const node: SealNode = {
          id,
          name: baseName,
          file: relPath,
          kind: category as any,
          language: ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript',
          framework: 'none',
          hooks: [],
          children: [],
          metrics,
          cluster,
          x: 0,
          y: 0,
        };

        nodes.push(node);
        nodeIdsForThisFile.push(id);
      }

      fileToNodeIds.set(filePath, nodeIdsForThisFile);
    }

    // 3. Build Edges
    const edges: SealEdge[] = [];
    const edgeSet = new Set<string>();

    for (const [filePath, data] of fileDataMap.entries()) {
      const sourceNodeIds = fileToNodeIds.get(filePath) || [];
      if (sourceNodeIds.length === 0) continue;
      const primarySourceId = sourceNodeIds[0];
      if (!primarySourceId) continue;

      for (const imp of data.entities.imports) {
        const resolvedPath = this.resolver.resolve(imp.source, filePath);
        if (resolvedPath && fileToNodeIds.has(resolvedPath)) {
          const targetNodeIds = fileToNodeIds.get(resolvedPath) || [];
          for (const targetId of targetNodeIds) {
            if (primarySourceId !== targetId) {
              const edgeKey = `${primarySourceId}->${targetId}`;
              if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                edges.push({
                  source: primarySourceId,
                  target: targetId,
                  type: 'import',
                  _key1: edgeKey,
                  _key2: `${targetId}->${primarySourceId}`,
                });
              }
            }
          }
        }
      }

      // Check rendered children connections
      for (const sourceId of sourceNodeIds) {
        const sourceNode = nodes.find((n) => n.id === sourceId);
        if (sourceNode && sourceNode.children) {
          for (const childName of sourceNode.children) {
            const matchedChildNode = nodes.find((n) => n.name === childName);
            if (matchedChildNode && matchedChildNode.id !== sourceId) {
              const edgeKey = `${sourceId}->${matchedChildNode.id}`;
              if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                edges.push({
                  source: sourceId,
                  target: matchedChildNode.id,
                  type: 'render',
                  _key1: edgeKey,
                  _key2: `${matchedChildNode.id}->${sourceId}`,
                });
              }
            }
          }
        }
      }
    }

    // 4. Summarize Archipelagos (Clusters)
    const clusterMap = new Map<string, string[]>();
    nodes.forEach((n) => {
      const cName = n.cluster || 'Core & Root';
      if (!clusterMap.has(cName)) {
        clusterMap.set(cName, []);
      }
      clusterMap.get(cName)!.push(n.id);
    });

    const clusters = Array.from(clusterMap.entries()).map(([name, nodeIds]) => ({
      name,
      nodeIds,
      count: nodeIds.length,
    }));

    return {
      nodes,
      edges,
      clusters,
      stats: {
        totalFiles: files.length,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        totalClusters: clusters.length,
        locTotal,
      },
    };
  }

  public determineCluster(relPath: string): string {
    const parts = relPath.split(path.sep);
    const cleanParts = parts[0] === 'src' ? parts.slice(1) : parts;
    if (cleanParts.length <= 1) {
      return 'Great Citadel (Core & Root)';
    }

    const topDir = cleanParts[0];

    if (topDir === 'pages' || topDir === 'views') {
      const pageName = cleanParts[1] || 'General';
      return `Province: ${pageName}`;
    }
    if (topDir === 'components') {
      const sub = (cleanParts[1] || '').toLowerCase();
      if (['forms', 'input', 'toggle', 'inputwithprops', 'formcontainer'].includes(sub)) {
        return 'Atelier: Forms & Inputs';
      }
      if (['alert', 'confirm', 'confirmmodal', 'additemlinemodal'].includes(sub)) {
        return 'Atelier: Modals & Dialogs';
      }
      if (['menu', 'header', 'crumbs', 'buttonmenu', 'accardion'].includes(sub)) {
        return 'Atelier: Navigation & Shell';
      }
      if (
        [
          'table',
          'filters',
          'consignmentsfilternew',
          'reportsfilternew',
          'aggregatesfilternew',
        ].includes(sub)
      ) {
        return 'Atelier: Tables & Filters';
      }
      if (['clickbutton', 'buttontoggle', 'bottombuttons', 'loader'].includes(sub)) {
        return 'Atelier: Buttons & Controls';
      }
      return `Atelier: ${cleanParts[1] || 'Common UI'}`;
    }
    if (topDir === 'redux' || topDir === 'store' || topDir === 'pinia')
      return 'Veins of Power (State & Sagas)';
    if (topDir === 'api' || topDir === 'services') return 'Astral Gateways (APIs & Network)';
    if (topDir === 'utils' || topDir === 'functions') return 'Grimoires & Tomes (Utils)';
    if (topDir === 'context') return 'Mystic Spheres (Contexts)';
    if (topDir === 'constants') return 'Foundational Runes (Constants)';
    if (topDir === 'hooks' || topDir === 'composables') return 'Enchanted Keystones (Hooks)';

    return `Archipelago: ${topDir}`;
  }

  public collectSourceFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'build', 'dist', '.git', '.idea', '.dsh'].includes(entry.name)) {
          results.push(...this.collectSourceFiles(fullPath));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.js', '.jsx', '.ts', '.tsx', '.vue'].includes(ext)) {
          if (
            !entry.name.includes('.test.') &&
            !entry.name.includes('.spec.') &&
            entry.name !== 'setupTests.js'
          ) {
            results.push(fullPath);
          }
        }
      }
    }

    return results;
  }
}
