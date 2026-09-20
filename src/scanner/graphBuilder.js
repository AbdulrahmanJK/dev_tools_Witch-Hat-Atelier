import fs from 'node:fs';
import path from 'node:path';
import { AliasResolver } from './aliasResolver.js';
import { parseFileToAst } from './astParser.js';
import { detectFileEntities } from './detector.js';
import { calculateComponentMetrics, calculateNonComponentMetrics } from './metrics.js';

export class GraphBuilder {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot);
    this.resolver = new AliasResolver(this.projectRoot);
    this.srcDir = path.join(this.projectRoot, 'src');
    if (!fs.existsSync(this.srcDir)) {
      this.srcDir = this.projectRoot;
    }
  }

  buildGraph() {
    const files = this.collectSourceFiles(this.srcDir);
    const fileDataMap = new Map();
    const nodes = [];
    const fileToNodeIds = new Map();

    // 1. Parse each file
    for (const filePath of files) {
      const relPath = path.relative(this.projectRoot, filePath);
      const { ast, code, error } = parseFileToAst(filePath);
      const loc = code.split('\n').length;

      const entities = detectFileEntities(ast, code, filePath);
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
      const nodeIdsForThisFile = [];

      if (entities.components && entities.components.length > 0) {
        // Create a node for each component in the file
        entities.components.forEach((comp) => {
          const id = `${relPath}#${comp.name}`;
          const metrics = calculateComponentMetrics(comp, {
            filePath,
            antiPatterns: entities.antiPatterns,
            loc,
          });

          const node = {
            id,
            name: comp.name,
            file: relPath,
            absPath: filePath,
            kind: 'component',
            componentKind: comp.kind,
            loc: comp.loc || loc,
            props: comp.props,
            hooks: comp.hooksUsed,
            children: comp.renderedChildren,
            reduxDispatches: comp.reduxDispatches,
            internalCircuit: comp.internalCircuit || { stateVariables: [], effects: [], handlers: [] },
            metrics,
            cluster,
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

        const node = {
          id,
          name: baseName,
          file: relPath,
          absPath: filePath,
          kind: category,
          componentKind: 'module',
          loc,
          props: [],
          hooks: [],
          children: [],
          reduxDispatches: [],
          metrics,
          cluster,
        };

        nodes.push(node);
        nodeIdsForThisFile.push(id);
      }

      fileToNodeIds.set(filePath, nodeIdsForThisFile);
    }

    // 3. Build Edges
    const edges = [];
    const edgeSet = new Set();

    for (const [filePath, data] of fileDataMap.entries()) {
      const sourceNodeIds = fileToNodeIds.get(filePath) || [];
      if (sourceNodeIds.length === 0) continue;
      const primarySourceId = sourceNodeIds[0];

      for (const imp of data.entities.imports) {
        const resolvedPath = this.resolver.resolve(imp.source, filePath);
        if (resolvedPath && fileToNodeIds.has(resolvedPath)) {
          const targetNodeIds = fileToNodeIds.get(resolvedPath);
          for (const targetId of targetNodeIds) {
            if (primarySourceId !== targetId) {
              const edgeKey = `${primarySourceId}->${targetId}`;
              if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                edges.push({
                  source: primarySourceId,
                  target: targetId,
                  type: 'import',
                });
              }
            }
          }
        }
      }

      // Check rendered JSX children connections inside the same or other files
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
                });
              }
            }
          }
        }
      }
    }

    // 4. Summarize Archipelagos (Clusters)
    const clusterMap = new Map();
    nodes.forEach((n) => {
      if (!clusterMap.has(n.cluster)) {
        clusterMap.set(n.cluster, []);
      }
      clusterMap.get(n.cluster).push(n.id);
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
      },
    };
  }

  determineCluster(relPath) {
    const parts = relPath.split(path.sep);
    // Remove 'src' if present
    const cleanParts = parts[0] === 'src' ? parts.slice(1) : parts;
    if (cleanParts.length <= 1) {
      return 'Great Citadel (Core & Root)';
    }

    const topDir = cleanParts[0];

    if (topDir === 'pages') {
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
      if (['table', 'filters', 'consignmentsfilternew', 'reportsfilternew', 'aggregatesfilternew'].includes(sub)) {
        return 'Atelier: Tables & Filters';
      }
      if (['clickbutton', 'buttontoggle', 'bottombuttons', 'loader'].includes(sub)) {
        return 'Atelier: Buttons & Controls';
      }
      return `Atelier: ${cleanParts[1] || 'Common UI'}`;
    }
    if (topDir === 'redux') return 'Veins of Power (Redux & Sagas)';
    if (topDir === 'api') return 'Astral Gateways (APIs & Network)';
    if (topDir === 'utils' || topDir === 'functions') return 'Grimoires & Tomes (Utils)';
    if (topDir === 'context') return 'Mystic Spheres (Contexts)';
    if (topDir === 'constants') return 'Foundational Runes (Constants)';
    if (topDir === 'hooks') return 'Enchanted Keystones (Hooks)';

    return `Archipelago: ${topDir}`;
  }

  collectSourceFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'build', 'dist', '.git', '.idea'].includes(entry.name)) {
          results.push(...this.collectSourceFiles(fullPath));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
          if (!entry.name.includes('.test.') && !entry.name.includes('.spec.') && entry.name !== 'setupTests.js') {
            results.push(fullPath);
          }
        }
      }
    }

    return results;
  }
}
