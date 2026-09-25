import fs from 'node:fs';
import path from 'node:path';
import type { ArchitectureViolation, CircularLoop, DiagnosticsSummary, RawGraphData, SealEdge, SealNode } from '../types/index.js';
import { AliasResolver } from './aliasResolver.js';
import { parseFileToAst } from './astParser.js';
import { detectFileEntities, detectPartialFileEntities, type DetectedEntities } from './detector.js';
import { calculateComponentMetrics, calculateNonComponentMetrics } from './metrics.js';
import { detectVueFileEntities } from './vueDetector.js';
import { FrameworkDetector } from './frameworkDetector.js';
import { collectDependencySeals } from './dependencyScanner.js';
import { scanStaticSource, staticLanguageForExtension, type StaticFileAnalysis, type StaticSymbol } from './staticLanguages.js';
import { readParseCache, writeParseCache, type CachedParse } from './parseCache.js';

// Graph identifiers and browser-facing file names use one separator on every OS.
export const portablePath = (value: string): string => value.replace(/\\/g, '/');

export interface GraphBuildProgress {
  phase: 'discovering' | 'parsing' | 'nodes' | 'edges' | 'diagnostics' | 'dependencies' | 'layout' | 'layout-clusters' | 'layout-finalizing' | 'transferring';
  completed?: number;
  total?: number;
  file?: string;
  warning?: string;
}

export class GraphBuilder {
  private projectRoot: string;
  private resolver: AliasResolver;
  private frameworkDetector: FrameworkDetector;

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.resolver = new AliasResolver(this.projectRoot);
    this.frameworkDetector = new FrameworkDetector(this.projectRoot);
  }

  public buildGraph(onProgress?: (progress: GraphBuildProgress) => void): RawGraphData {
    onProgress?.({ phase: 'discovering' });
    const files = this.collectSourceFiles(this.projectRoot, (count, currentDir) => {
      onProgress?.({ phase: 'discovering', completed: count, file: portablePath(path.relative(this.projectRoot, currentDir)) });
    });
    const previousCache = readParseCache(this.projectRoot);
    const nextCache: Record<string, CachedParse> = {};
    onProgress?.({ phase: 'parsing', completed: 0, total: files.length });
    const fileDataMap = new Map<
      string,
      {
        filePath: string;
        relPath: string;
        loc: number;
        entities: DetectedEntities;
        error: string | null;
        staticAnalysis?: StaticFileAnalysis;
      }
    >();
    const nodes: SealNode[] = [];
    const fileToNodeIds = new Map<string, string[]>();
    let locTotal = 0;
    let parseWarnings = 0;
    const parseCoverage = { complete: 0, partial: 0, unreadable: 0, warnings: 0, cached: 0 };

    // 1. Parse each file
    for (const [index, filePath] of files.entries()) {
      const relPath = portablePath(path.relative(this.projectRoot, filePath));
      const ext = path.extname(filePath).toLowerCase();

      let entities: DetectedEntities;
      let error: string | null = null;
      let loc = 0;
      let staticAnalysis: StaticFileAnalysis | undefined;
      let mode: CachedParse['mode'] = 'complete';

      const stat = fs.statSync(filePath);
      const cached = previousCache[relPath];
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size
        && Array.isArray(cached.entities?.imports) && Array.isArray(cached.entities?.components)
        && ['complete', 'partial', 'unreadable'].includes(cached.mode)) {
        ({ entities, error, loc, staticAnalysis, mode } = cached);
        parseCoverage.cached++;
      } else {

        const staticLanguage = staticLanguageForExtension(ext);
        if (staticLanguage) {
          const content = fs.readFileSync(filePath, 'utf8');
          loc = content.split('\n').length;
          staticAnalysis = scanStaticSource(content, staticLanguage);
          entities = detectFileEntities(null, '', filePath);
        } else if (ext === '.vue') {
          const content = fs.readFileSync(filePath, 'utf8');
          loc = content.split('\n').length;
          entities = detectVueFileEntities(content, filePath);
        } else {
          const parseRes = parseFileToAst(filePath);
          error = parseRes.error;
          loc = parseRes.code.split('\n').length;
          try {
            entities = parseRes.ast ? detectFileEntities(parseRes.ast, parseRes.code, filePath)
              : detectPartialFileEntities(parseRes.code, filePath);
            mode = !parseRes.ast && !parseRes.code ? 'unreadable' : parseRes.mode === 'complete' ? 'complete' : 'partial';
          } catch (detectError) {
            entities = detectPartialFileEntities(parseRes.code, filePath);
            error = `${error ? `${error}; ` : ''}${detectError instanceof Error ? detectError.message : String(detectError)}`;
            mode = 'partial';
          }
        }
      }

      parseCoverage[mode]++;
      nextCache[relPath] = { mtimeMs: stat.mtimeMs, size: stat.size, loc, entities, error, mode, staticAnalysis };

      locTotal += loc;
      fileDataMap.set(filePath, {
        filePath,
        relPath,
        loc,
        entities,
        error,
        staticAnalysis,
      });
      if (error) {
        parseWarnings++;
        parseCoverage.warnings++;
        if (parseWarnings <= 20) onProgress?.({ phase: 'parsing', completed: index + 1, total: files.length, file: relPath, warning: `${relPath}: ${error}` });
      }
      else if ((index + 1) % 50 === 0 || index + 1 === files.length) onProgress?.({ phase: 'parsing', completed: index + 1, total: files.length, file: relPath });
    }
    writeParseCache(this.projectRoot, nextCache);
    if (parseWarnings > 20) onProgress?.({ phase: 'parsing', completed: files.length, total: files.length, warning: `${parseWarnings - 20} more parse warnings omitted from log.` });

    // 2. Create Nodes
    onProgress?.({ phase: 'nodes', completed: 0, total: files.length });
    let nodeFiles = 0;
    for (const [filePath, data] of fileDataMap.entries()) {
      nodeFiles++;
      if (nodeFiles % 100 === 0 || nodeFiles === files.length) onProgress?.({ phase: 'nodes', completed: nodeFiles, total: files.length, file: data.relPath });
      const { relPath, loc, entities } = data;
      const cluster = this.determineCluster(relPath);
      const nodeIdsForThisFile: string[] = [];
      const ext = path.extname(filePath).toLowerCase();
      if (data.staticAnalysis) {
        const analysis = data.staticAnalysis;
        const topLevel = analysis.symbols.filter((symbol) => !symbol.container && ['class', 'interface', 'struct', 'record', 'enum', 'object', 'function'].includes(symbol.kind));
        const selected = topLevel.length ? topLevel : [{ name: path.basename(filePath, ext), kind: 'module', line: 1, endLine: loc } as StaticSymbol];
        for (const symbol of selected) {
          const id = `${relPath}#${symbol.name}@${symbol.line}`;
          const members = symbol.kind === 'module' ? analysis.symbols : analysis.symbols.filter((entry) => entry === symbol || entry.container === symbol.name);
          const node = this.createStaticNode(id, relPath, cluster, loc, symbol, members, analysis);
          nodes.push(node);
          nodeIdsForThisFile.push(id);
        }
        fileToNodeIds.set(filePath, nodeIdsForThisFile);
        continue;
      }
      const detection = this.frameworkDetector.detect(filePath, entities);
      const framework = detection.framework;

      if (entities.components && entities.components.length > 0) {
        entities.components.forEach((comp) => {
          const id = `${relPath}#${comp.name}`;
          const metrics = calculateComponentMetrics(comp, {
            filePath,
            antiPatterns: entities.antiPatterns,
            loc,
            codeInventory: comp.codeInventory,
            imports: entities.imports,
            framework,
          });

          const node: SealNode = {
            id,
            name: comp.name,
            file: relPath,
            sourceLine: comp.startLine || 1,
            kind: 'component',
            language: ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript',
            framework,
            frameworkVersion: detection.version,
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
        let category: NonNullable<SealNode['moduleCategory']> = 'utils';
        if (relPath.includes('api')) category = 'api';
        else if (relPath.includes('redux')) category = 'redux';
        else if (relPath.includes('constants') || relPath.includes('mock')) category = 'constants';
        else if (entities.hooksDefined && entities.hooksDefined.length > 0) category = 'hook';

        const id = relPath;
        const metrics = calculateNonComponentMetrics(
          { loc, filePath, imports: entities.imports },
          category
        );

        const node: SealNode = {
          id,
          name: baseName,
          file: relPath,
          kind: 'module',
          moduleCategory: category,
          language: ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript',
          framework,
          frameworkVersion: detection.version,
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
    onProgress?.({ phase: 'edges', completed: 0, total: files.length });
    const edges: SealEdge[] = [];
    const edgeSet = new Set<string>();
    const architectureViolations: ArchitectureViolation[] = [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const canonicalName = (name: string) => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const nodesByName = new Map<string, SealNode[]>();
    for (const node of nodes) {
      const key = canonicalName(node.name);
      nodesByName.set(key, [...(nodesByName.get(key) || []), node]);
    }

    let linkedFiles = 0;
    for (const [filePath, data] of fileDataMap.entries()) {
      linkedFiles++;
      if (linkedFiles % 100 === 0 || linkedFiles === files.length) onProgress?.({ phase: 'edges', completed: linkedFiles, total: files.length, file: data.relPath });
      const sourceNodeIds = fileToNodeIds.get(filePath) || [];
      if (sourceNodeIds.length === 0) continue;
      const primarySourceId = sourceNodeIds[0];
      if (!primarySourceId) continue;
      const importedChildren = new Map<string, string[]>();

      for (const imp of data.entities.imports) {
        const resolvedPath = this.resolver.resolve(imp.source, filePath);
        if (resolvedPath && fileToNodeIds.has(resolvedPath)) {
          const targetNodeIds = fileToNodeIds.get(resolvedPath) || [];
          const targetCluster = this.determineCluster(portablePath(path.relative(this.projectRoot, resolvedPath)));
          const pactViolation = this.determineCluster(data.relPath).startsWith('Atelier:') && targetCluster.startsWith('Province:');
          if (pactViolation && targetNodeIds[0]) {
            const violation: ArchitectureViolation = {
              id: `pact:${primarySourceId}:${resolvedPath}:${imp.line || 1}`,
              rule: 'atelier-imports-province', severity: 'high',
              sourceNodeId: primarySourceId, targetNodeId: targetNodeIds[0],
              file: filePath, line: imp.line || 1,
              message: `Atelier component imports Province page ${path.basename(resolvedPath)}. Move shared code into a neutral module or reverse this dependency.`,
            };
            architectureViolations.push(violation);
            const sourceNode = nodeById.get(primarySourceId);
            if (sourceNode) (sourceNode.architectureViolationIds ||= []).push(violation.id);
          }
          for (const specifier of imp.specifiers) {
            const name = canonicalName(specifier.local);
            importedChildren.set(name, targetNodeIds);
          }
          for (const targetId of targetNodeIds) {
            if (primarySourceId !== targetId) {
              const edgeKey = `${primarySourceId}->${targetId}`;
              if (!edgeSet.has(edgeKey)) {
                edgeSet.add(edgeKey);
                edges.push({
                  source: primarySourceId,
                  target: targetId,
                  type: 'import',
                  isArchitectureViolation: pactViolation,
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
        const sourceNode = nodeById.get(sourceId);
        if (sourceNode && sourceNode.children) {
          for (const childName of sourceNode.children) {
            const canonical = canonicalName(childName.split('.')[0]!);
            const imported = importedChildren.get(canonical) || [];
            const importedNodes = imported.map((id) => nodeById.get(id)).filter((node): node is SealNode => Boolean(node));
            const globalMatches = nodesByName.get(canonical) || [];
            const matchedChildNode = importedNodes.find((node) => canonicalName(node.name) === canonical)
              || (importedNodes.length === 1 ? importedNodes[0] : undefined)
              || (globalMatches.length === 1 ? globalMatches[0] : undefined);
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

    // Only connect Java/Kotlin imports when the fully qualified name matches a unique local symbol.
    const staticByQualifiedName = new Map<string, SealNode[]>();
    for (const node of nodes) {
      if (node.analysisMode !== 'static' || !node.sourceNamespace) continue;
      const qualifiedName = `${node.sourceNamespace}.${node.name}`;
      staticByQualifiedName.set(qualifiedName, [...(staticByQualifiedName.get(qualifiedName) || []), node]);
    }
    for (const [filePath, data] of fileDataMap) {
      if (!data.staticAnalysis || !['java', 'kotlin'].includes(data.staticAnalysis.language)) continue;
      const sourceIds = fileToNodeIds.get(filePath) || [];
      for (const imported of data.staticAnalysis.imports) {
        const targets = staticByQualifiedName.get(imported) || [];
        if (targets.length !== 1) continue;
        for (const sourceId of sourceIds) {
          const targetId = targets[0]!.id;
          const edgeKey = `${sourceId}->${targetId}`;
          if (sourceId === targetId || edgeSet.has(edgeKey)) continue;
          edgeSet.add(edgeKey);
          edges.push({ source: sourceId, target: targetId, type: 'import', _key1: edgeKey, _key2: `${targetId}->${sourceId}` });
        }
      }
    }

    // 4. Summarize Archipelagos (Clusters)
    onProgress?.({ phase: 'diagnostics' });
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

    // 5. Detect Circular Dependencies (Ouroboros Loops)
    const cycles = this.detectCircularDependencies(nodes, edges);

    // 6. Detect Dead Code & Orphan Modules
    const orphanInfo = this.detectDeadCodeAndOrphans(nodes, edges);

    const diagnostics: DiagnosticsSummary = {
      totalCircularLoops: cycles.length,
      totalOrphans: orphanInfo.orphanNodeIds.length,
      orphanLOC: orphanInfo.orphanLOC,
      totalOvercharged: nodes.filter(
        (n) =>
          n.metrics.devTools?.overloadState === 'overcharged' ||
          n.metrics.devTools?.overloadState === 'fissure'
      ).length,
      cycles,
      orphanNodeIds: orphanInfo.orphanNodeIds,
      totalArchitectureViolations: architectureViolations.length,
      architectureViolations,
    };

    onProgress?.({ phase: 'dependencies' });
    return {
      nodes,
      edges,
      clusters,
      dependencies: collectDependencySeals(this.projectRoot, fileDataMap, fileToNodeIds, this.resolver),
      diagnostics,
      stats: {
        totalFiles: files.length,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        totalClusters: clusters.length,
        locTotal,
        parseCoverage,
      },
    };
  }

  /**
   * Detect elementary circular dependency cycles via DFS path backtracking
   */
  public detectCircularDependencies(nodes: SealNode[], edges: SealEdge[]): CircularLoop[] {
    const adj = new Map<string, string[]>();
    nodes.forEach((n) => adj.set(n.id, []));
    edges.forEach((e) => {
      if (adj.has(e.source) && adj.has(e.target) && e.source !== e.target) {
        adj.get(e.source)!.push(e.target);
      }
    });

    const cycles: CircularLoop[] = [];
    const visited = new Set<string>();
    const onStack = new Set<string>();
    const pathStack: string[] = [];
    const seenSignatures = new Set<string>();
    const nodeNameMap = new Map(nodes.map((n) => [n.id, n.name]));

    const dfs = (u: string) => {
      visited.add(u);
      onStack.add(u);
      pathStack.push(u);

      const neighbors = adj.get(u) || [];
      for (const v of neighbors) {
        if (onStack.has(v)) {
          const idx = pathStack.indexOf(v);
          if (idx !== -1) {
            const cNodes = pathStack.slice(idx);
            if (cNodes.length >= 2) {
              const minItem = cNodes.reduce((min, cur) => (cur < min ? cur : min), cNodes[0]!);
              const minIdx = cNodes.indexOf(minItem);
              const normalized = [...cNodes.slice(minIdx), ...cNodes.slice(0, minIdx)];
              const sig = normalized.join('->');

              if (!seenSignatures.has(sig)) {
                seenSignatures.add(sig);
                const edgeKeys: string[] = [];
                for (let i = 0; i < cNodes.length; i++) {
                  const from = cNodes[i]!;
                  const to = cNodes[(i + 1) % cNodes.length]!;
                  edgeKeys.push(`${from}->${to}`);
                }

                cycles.push({
                  id: `cycle-${cycles.length + 1}`,
                  nodeIds: cNodes,
                  names: cNodes.map((id) => nodeNameMap.get(id) || id),
                  edgeKeys,
                  length: cNodes.length,
                });
              }
            }
          }
        } else if (!visited.has(v)) {
          dfs(v);
        }
      }

      pathStack.pop();
      onStack.delete(u);
    };

    nodes.forEach((n) => {
      if (!visited.has(n.id)) {
        dfs(n.id);
      }
    });

    // Tag nodes participating in circular loops
    for (const cycle of cycles) {
      for (const nodeId of cycle.nodeIds) {
        const node = nodes.find((n) => n.id === nodeId);
        if (node) {
          node.isCircular = true;
          node.circularLoopId = cycle.id;
          node.circularPath = cycle.names;
        }
      }
    }

    // Tag edges participating in circular loops
    const cycleEdgeKeys = new Set(cycles.flatMap((c) => c.edgeKeys));
    edges.forEach((e) => {
      if (cycleEdgeKeys.has(e._key1 || '') || cycleEdgeKeys.has(`${e.source}->${e.target}`)) {
        e.isCircular = true;
      }
    });

    return cycles;
  }

  /**
   * Knip-style orphan & dead code detection: modules with 0 incoming dependencies
   */
  public detectDeadCodeAndOrphans(
    nodes: SealNode[],
    edges: SealEdge[]
  ): { orphanNodeIds: string[]; orphanLOC: number } {
    const incomingCount = new Map<string, number>();
    nodes.forEach((n) => incomingCount.set(n.id, 0));
    edges.forEach((e) => {
      incomingCount.set(e.target, (incomingCount.get(e.target) || 0) + 1);
    });

    const orphanNodeIds: string[] = [];
    let orphanLOC = 0;

    nodes.forEach((n) => {
      if (n.analysisMode === 'static') return;
      const lowerName = n.name.toLowerCase();
      const isEntryPoint =
        n.cluster?.includes('Core') ||
        ['app', 'index', 'main', 'routes', 'router'].includes(lowerName) ||
        n.file.toLowerCase().includes('routes');

      const inCount = incomingCount.get(n.id) || 0;
      if (!isEntryPoint && inCount === 0) {
        n.isOrphan = true;
        orphanNodeIds.push(n.id);
        orphanLOC += n.loc || n.metrics.loc || 0;
      }
    });

    return { orphanNodeIds, orphanLOC };
  }

  private createStaticNode(
    id: string, relPath: string, cluster: string, fileLoc: number,
    symbol: StaticSymbol, members: StaticSymbol[], analysis: StaticFileAnalysis
  ): SealNode {
    const isClass = ['class', 'interface', 'struct', 'record', 'enum', 'object'].includes(symbol.kind);
    const loc = symbol.kind === 'module' ? fileLoc : Math.max(1, symbol.endLine - symbol.line + 1);
    const metrics = calculateNonComponentMetrics({ loc, filePath: relPath, imports: analysis.imports.map((source) => ({ source })) }, symbol.kind);
    const methodCount = members.filter((entry) => entry.kind === 'method' || entry.kind === 'function').length;
    const fieldCount = members.filter((entry) => entry.kind === 'field' || entry.kind === 'property').length;
    metrics.geometry = isClass ? 'faceted-strengthen' : 'circle';
    metrics.isClass = isClass;
    metrics.element = isClass ? 'Earth' : symbol.kind === 'function' ? 'Fire' : 'Arcane';
    metrics.radialSigns = [];
    if (methodCount) metrics.radialSigns.push({ type: 'column', size: 14, loc: methodCount, label: `${methodCount} methods / functions` });
    if (fieldCount) metrics.radialSigns.push({ type: 'focus', size: 14, loc: fieldCount, label: `${fieldCount} fields / properties` });
    const constructs = symbol.kind === 'module' ? { loops: 0, branches: 0, awaits: 0 } : symbol.constructs;
    if (constructs?.loops) metrics.radialSigns.push({ type: 'repetition', size: 14, loc: constructs.loops, label: `${constructs.loops} loops` });
    if (constructs?.branches) metrics.radialSigns.push({ type: 'convergence', size: 14, loc: constructs.branches, label: `${constructs.branches} branches` });
    if (constructs?.awaits) metrics.radialSigns.push({ type: 'bolt', size: 14, loc: constructs.awaits, label: `${constructs.awaits} await` });
    if (analysis.imports.length && symbol.kind === 'module') metrics.radialSigns.push({ type: 'collection', size: 13, loc: analysis.imports.length, label: `${analysis.imports.length} imports` });
    if (members.some((entry) => entry.modifiers?.some((modifier) => modifier === 'async' || modifier === 'suspend')) || symbol.modifiers?.some((modifier) => modifier === 'async' || modifier === 'suspend')) {
      metrics.radialSigns.push({ type: 'bolt', size: 13, loc: 1, label: 'async / suspend' });
    }
    metrics.keystones = isClass ? ['Strengthen'] : ['Column'];
    metrics.keystoneDetails = [];
    metrics.grade = isClass ? 'Class Seal' : symbol.kind === 'function' ? 'Function Seal' : 'Module Seal';
    metrics.stabilityNote = `${analysis.language.toUpperCase()} ${symbol.kind}. Static source map; runtime profiling unavailable.`;
    metrics.devTools = undefined;
    return {
      id, name: symbol.name, file: relPath,
      kind: isClass ? 'class' : symbol.kind === 'function' ? 'function' : 'module',
      language: analysis.language, framework: 'none', cluster, loc, hooks: [], children: [], metrics,
      sourceLine: symbol.line, sourceSymbols: members, sourceNamespace: analysis.namespace, sourceImports: analysis.imports,
      sourceAbsolutePath: path.join(this.projectRoot, relPath),
      analysisMode: 'static', x: 0, y: 0,
    };
  }

  public determineCluster(relPath: string): string {
    const parts = portablePath(relPath).split('/');
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

  public collectSourceFiles(dir: string, onProgress?: (count: number, currentDir: string) => void): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const ignored = new Set(['node_modules', 'build', 'dist', '.git', '.idea', '.dsh', '.grimoire', '.yarn', '.next', '.nuxt', '.output', '.cache', '.turbo', 'coverage', 'storybook-static']);
    const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.go', '.java', '.kt', '.kts', '.cs']);
    let visitedDirectories = 0;
    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name)) walk(fullPath);
        } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
          if (!entry.name.includes('.test.') && !entry.name.includes('.spec.') && entry.name !== 'setupTests.js') results.push(fullPath);
        }
      }
      visitedDirectories++;
      if (visitedDirectories % 50 === 0) onProgress?.(results.length, currentDir);
    };
    walk(dir);
    onProgress?.(results.length, dir);
    return results;
  }
}
