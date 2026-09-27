import fs from 'node:fs';
import path from 'node:path';
import type { ArchitectureViolation, CircularLoop, DiagnosticsSummary, RawGraphData, SealEdge, SealNode, SourceFileRecord } from '../types/index.js';
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
const ignoredSourceDirectories = new Set(['node_modules', 'build', 'dist', '.git', '.idea', '.dsh', '.grimoire', '.yarn', '.next', '.nuxt', '.output', '.cache', '.turbo', 'coverage', 'storybook-static']);

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
    const discoveryIssues: Array<{ path: string; error: string }> = [];
    const files = this.collectSourceFiles(this.projectRoot, (count, currentDir) => {
      onProgress?.({ phase: 'discovering', completed: count, file: portablePath(path.relative(this.projectRoot, currentDir)) });
    }, (directory, reason) => {
      const issue = { path: portablePath(path.relative(this.projectRoot, directory)), error: reason };
      discoveryIssues.push(issue);
      onProgress?.({ phase: 'discovering', warning: `${issue.path}: ${reason}` });
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
        mode: CachedParse['mode'];
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

      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(filePath); }
      catch (reason) { error = reason instanceof Error ? reason.message : String(reason); mode = 'unreadable'; }
      const cached = previousCache[relPath];
      const retryDeclaration = /\.d\.[cm]?ts$/.test(filePath) && cached?.mode === 'partial';
      if (!stat) {
        entities = detectFileEntities(null, '', filePath);
      } else if (cached && !retryDeclaration && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size
        && Array.isArray(cached.entities?.imports) && Array.isArray(cached.entities?.components)
        && ['complete', 'partial', 'unreadable'].includes(cached.mode)) {
        ({ entities, error, loc, staticAnalysis, mode } = cached);
        parseCoverage.cached++;
      } else {
        try {
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
        } catch (reason) {
          entities = detectFileEntities(null, '', filePath);
          error = reason instanceof Error ? reason.message : String(reason);
          mode = 'unreadable';
        }
      }

      parseCoverage[mode]++;
      if (stat) nextCache[relPath] = { mtimeMs: stat.mtimeMs, size: stat.size, loc, entities, error, mode, staticAnalysis };

      locTotal += loc;
      fileDataMap.set(filePath, {
        filePath,
        relPath,
        loc,
        entities,
        error,
        mode,
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
            language: ['.ts', '.tsx', '.mts', '.cts'].includes(ext) ? 'typescript' : 'javascript',
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
          language: ['.ts', '.tsx', '.mts', '.cts'].includes(ext) ? 'typescript' : 'javascript',
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

    this.splitOversizedClusters(nodes);

    // 3. Build Edges
    onProgress?.({ phase: 'edges', completed: 0, total: files.length });
    const edges: SealEdge[] = [];
    const edgeSet = new Set<string>();
    const unresolvedByFile = new Map<string, SourceFileRecord['unresolvedImports']>();
    const excludedByFile = new Map<string, NonNullable<SourceFileRecord['excludedImports']>>();
    const architectureViolations: ArchitectureViolation[] = [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const canonicalName = (name: string) => name.replace(/[^a-z0-9]/gi, '').toLowerCase();

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
        const resolvedPaths = imp.glob ? this.resolveSourceGlob(imp.source, filePath, files)
          : imp.context ? this.resolveContextFiles(imp.source, imp.context, filePath, files)
            : [this.resolver.resolve(imp.source, filePath)];
        const importExtension = path.extname(imp.source.split(/[?#]/)[0]!).toLowerCase();
        const sourceCandidate = !importExtension || ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.go', '.java', '.kt', '.kts', '.cs'].includes(importExtension);
        if (!resolvedPaths.some((resolvedPath) => resolvedPath && fileToNodeIds.has(resolvedPath))
          && sourceCandidate
          && this.resolver.isProjectImport(imp.source, filePath)) {
          const candidate = resolvedPaths.find((resolvedPath): resolvedPath is string => Boolean(resolvedPath))
            || (imp.source.startsWith('.') ? path.resolve(path.dirname(filePath), imp.source.split(/[?#]/)[0]!) : '');
          const excluded = candidate && portablePath(path.relative(this.projectRoot, candidate)).split('/')
            .some((segment) => ignoredSourceDirectories.has(segment));
          const target = excluded ? excludedByFile : unresolvedByFile;
          const list = target.get(filePath) || [];
          list.push({ source: imp.source, line: imp.line || 1 });
          target.set(filePath, list);
        }
        for (const resolvedPath of resolvedPaths) {
          if (resolvedPath && fileToNodeIds.has(resolvedPath)) {
            const targetNodeIds = fileToNodeIds.get(resolvedPath) || [];
            const targetId = targetNodeIds[0];
            if (!targetId) continue;
            const targetCluster = this.determineCluster(portablePath(path.relative(this.projectRoot, resolvedPath)));
            const pactViolation = this.determineCluster(data.relPath).startsWith('Atelier:') && targetCluster.startsWith('Province:');
            if (pactViolation) {
              const violation: ArchitectureViolation = {
                id: `pact:${primarySourceId}:${resolvedPath}:${imp.line || 1}`,
                rule: 'atelier-imports-province', severity: 'high',
                sourceNodeId: primarySourceId, targetNodeId: targetId,
                file: filePath, line: imp.line || 1,
                message: `Atelier component imports Province page ${path.basename(resolvedPath)}. Move shared code into a neutral module or reverse this dependency.`,
              };
              architectureViolations.push(violation);
              const sourceNode = nodeById.get(primarySourceId);
              if (sourceNode) (sourceNode.architectureViolationIds ||= []).push(violation.id);
            }
            for (const specifier of imp.specifiers) {
              const name = canonicalName(specifier.local);
              const imported = canonicalName(specifier.imported || specifier.local);
              const exactTargets = targetNodeIds.filter((id) => canonicalName(nodeById.get(id)?.name || '') === imported);
              const candidates = specifier.isNamespace ? targetNodeIds
                : exactTargets.length ? exactTargets
                  : specifier.isDefault && targetNodeIds.length === 1 ? targetNodeIds : [];
              if (candidates.length) importedChildren.set(name, candidates);
            }
            if (primarySourceId !== targetId) {
              const edgeKey = `${primarySourceId}->${targetId}`;
              if (!edgeSet.has(`import:${edgeKey}`)) {
                edgeSet.add(`import:${edgeKey}`);
                edges.push({
                  source: primarySourceId,
                  target: targetId,
                  type: 'import',
                  sourceFile: data.relPath,
                  targetFile: portablePath(path.relative(this.projectRoot, resolvedPath)),
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
            const [baseName, memberName] = childName.split('.');
            const canonical = canonicalName(baseName || '');
            const imported = importedChildren.get(canonical) || [];
            const importedNodes = imported.map((id) => nodeById.get(id)).filter((node): node is SealNode => Boolean(node));
            const sameFile = sourceNodeIds.map((id) => nodeById.get(id)).find((node) => node && node.id !== sourceId && canonicalName(node.name) === canonical);
            const matchedChildNode = memberName
              ? importedNodes.find((node) => canonicalName(node.name) === canonicalName(memberName))
              : importedNodes.length === 1 ? importedNodes[0] : sameFile;
            if (matchedChildNode && matchedChildNode.id !== sourceId) {
              const edgeKey = `${sourceId}->${matchedChildNode.id}`;
              if (!edgeSet.has(`render:${edgeKey}`)) {
                edgeSet.add(`render:${edgeKey}`);
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
        const sourceId = sourceIds[0];
        const targetId = targets[0]!.id;
        if (!sourceId || sourceId === targetId) continue;
        const edgeKey = `${sourceId}->${targetId}`;
        if (edgeSet.has(`import:${edgeKey}`)) continue;
        edgeSet.add(`import:${edgeKey}`);
        edges.push({ source: sourceId, target: targetId, type: 'import',
          sourceFile: portablePath(path.relative(this.projectRoot, filePath)), targetFile: nodeById.get(targetId)?.file,
          _key1: edgeKey, _key2: `${targetId}->${sourceId}` });
      }
    }

    const sourceFiles: SourceFileRecord[] = [...fileDataMap.values()].map((data) => ({
      path: data.relPath,
      nodeIds: fileToNodeIds.get(data.filePath) || [],
      parseMode: data.mode,
      ...(data.error ? { parseError: data.error } : {}),
      unresolvedImports: unresolvedByFile.get(data.filePath) || [],
      excludedImports: excludedByFile.get(data.filePath) || [],
    }));

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
      files: sourceFiles,
      clusters,
      dependencies: collectDependencySeals(this.projectRoot, fileDataMap, fileToNodeIds, this.resolver),
      diagnostics,
      stats: {
        totalFiles: files.length,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        totalClusters: clusters.length,
        locTotal,
        unresolvedImportCount: sourceFiles.reduce((count, file) => count + file.unresolvedImports.length, 0),
        excludedImportCount: sourceFiles.reduce((count, file) => count + (file.excludedImports?.length || 0), 0),
        discoveryIssues,
        parseCoverage,
      },
    };
  }

  private resolveSourceGlob(pattern: string, importer: string, files: string[]): string[] {
    if (!pattern.startsWith('.') && !pattern.startsWith('/')) return [];
    const source = pattern.startsWith('/') ? path.resolve(this.projectRoot, pattern.replace(/^\/+/, ''))
      : path.resolve(path.dirname(importer), pattern);
    const normalized = portablePath(source);
    let expression = '^';
    for (let index = 0; index < normalized.length; index++) {
      const character = normalized[index]!;
      if (character === '*' && normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') { expression += '(?:.*/)?'; index += 2; }
        else { expression += '.*'; index++; }
      } else if (character === '*') expression += '[^/]*';
      else if (character === '?') expression += '[^/]';
      else if (character === '{') {
        const end = normalized.indexOf('}', index + 1);
        if (end > index) {
          const variants = normalized.slice(index + 1, end).split(',').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          expression += `(?:${variants.join('|')})`;
          index = end;
        } else expression += '\\{';
      } else expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    const matcher = new RegExp(expression + '$');
    return files.filter((file) => matcher.test(portablePath(file)));
  }

  private resolveContextFiles(
    directory: string, context: { recursive: boolean; pattern?: string; flags?: string }, importer: string, files: string[]
  ): string[] {
    if (!directory.startsWith('.')) return [];
    const base = path.resolve(path.dirname(importer), directory);
    if (base !== this.projectRoot && !base.startsWith(this.projectRoot + path.sep)) return [];
    let matcher: RegExp | null = null;
    try {
      if (context.pattern && context.pattern.length <= 200) matcher = new RegExp(context.pattern, context.flags?.replace(/[gy]/g, ''));
    } catch { return []; }
    return files.filter((file) => {
      const relative = path.relative(base, file);
      if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return false;
      const key = './' + portablePath(relative);
      return (context.recursive || !key.slice(2).includes('/')) && (!matcher || matcher.test(key));
    });
  }

  /**
   * Detect elementary circular dependency cycles via DFS path backtracking
   */
  public detectCircularDependencies(nodes: SealNode[], edges: SealEdge[]): CircularLoop[] {
    const adj = new Map<string, string[]>();
    nodes.forEach((n) => adj.set(n.id, []));
    edges.forEach((e) => {
      if (e.type === 'import' && adj.has(e.source) && adj.has(e.target) && e.source !== e.target) {
        adj.get(e.source)!.push(e.target);
      }
    });

    const cycles: CircularLoop[] = [];
    const visited = new Set<string>();
    const pathStack: string[] = [];
    const stackPosition = new Map<string, number>();
    const seenSignatures = new Set<string>();
    const nodeFileMap = new Map(nodes.map((n) => [n.id, n.file]));

    nodes.forEach((n) => {
      if (visited.has(n.id)) return;
      const frames: { id: string; next: number }[] = [{ id: n.id, next: 0 }];
      visited.add(n.id);
      pathStack.push(n.id);
      stackPosition.set(n.id, 0);
      while (frames.length) {
        const frame = frames[frames.length - 1]!;
        const neighbors = adj.get(frame.id) || [];
        if (frame.next >= neighbors.length) {
          frames.pop();
          pathStack.pop();
          stackPosition.delete(frame.id);
          continue;
        }
        const target = neighbors[frame.next++]!;
        const position = stackPosition.get(target);
        if (position !== undefined) {
          const cNodes = pathStack.slice(position);
          if (cNodes.length < 2) continue;
          const minItem = cNodes.reduce((min, cur) => (cur < min ? cur : min), cNodes[0]!);
          const minIdx = cNodes.indexOf(minItem);
          const normalized = [...cNodes.slice(minIdx), ...cNodes.slice(0, minIdx)];
          const signature = normalized.join('->');
          if (seenSignatures.has(signature)) continue;
          seenSignatures.add(signature);
          const edgeKeys = cNodes.map((from, index) => `${from}->${cNodes[(index + 1) % cNodes.length]!}`);
          cycles.push({ id: `cycle-${cycles.length + 1}`, nodeIds: cNodes,
            names: cNodes.map((id) => nodeFileMap.get(id) || id), edgeKeys, length: cNodes.length });
        } else if (!visited.has(target)) {
          visited.add(target);
          stackPosition.set(target, pathStack.length);
          pathStack.push(target);
          frames.push({ id: target, next: 0 });
        }
      }
    });

    // Imports belong to files. The first seal is only an edge anchor, so every
    // seal in a cyclic file must show the file-level diagnostic.
    const nodesByFile = new Map<string, SealNode[]>();
    for (const node of nodes) {
      const siblings = nodesByFile.get(node.file) || [];
      siblings.push(node);
      nodesByFile.set(node.file, siblings);
    }
    for (const cycle of cycles) {
      for (const nodeId of cycle.nodeIds) {
        for (const node of nodesByFile.get(nodeFileMap.get(nodeId) || '') || []) {
          node.isCircular = true;
          node.circularLoopId = cycle.id;
          node.circularPath = cycle.names;
        }
      }
    }

    // Tag edges participating in circular loops
    const cycleEdgeKeys = new Set(cycles.flatMap((c) => c.edgeKeys));
    edges.forEach((e) => {
      if (e.type === 'import' && (cycleEdgeKeys.has(e._key1 || '') || cycleEdgeKeys.has(`${e.source}->${e.target}`))) {
        e.isCircular = true;
      }
    });

    return cycles;
  }

  /**
   * A zero-incoming node is only a candidate: frameworks and tools load many
   * files by convention, HTML, or package.json rather than source imports.
   */
  public detectDeadCodeAndOrphans(
    nodes: SealNode[],
    edges: SealEdge[]
  ): { orphanNodeIds: string[]; orphanLOC: number } {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incomingFiles = new Set<string>();
    for (const edge of edges) {
      if (edge.type !== 'import' && edge.type !== 'render') continue;
      const sourceFile = edge.sourceFile || nodeById.get(edge.source)?.file;
      const targetFile = edge.targetFile || nodeById.get(edge.target)?.file;
      if (sourceFile && targetFile && sourceFile !== targetFile) incomingFiles.add(targetFile);
    }

    const knownEntries = this.collectKnownEntries(nodes);
    const orphanNodeIds: string[] = [];
    const orphanFileLOC = new Map<string, number>();

    nodes.forEach((n) => {
      n.isOrphan = false;
      if (n.analysisMode === 'static') return;
      const isEntryPoint = knownEntries.has(n.file) || this.isConventionalEntry(n.file);
      if (!isEntryPoint && !incomingFiles.has(n.file)) {
        n.isOrphan = true;
        orphanNodeIds.push(n.id);
        orphanFileLOC.set(n.file, Math.max(orphanFileLOC.get(n.file) || 0, n.loc || n.metrics.loc || 0));
      }
    });

    return { orphanNodeIds, orphanLOC: [...orphanFileLOC.values()].reduce((sum, loc) => sum + loc, 0) };
  }

  private collectKnownEntries(nodes: SealNode[]): Set<string> {
    const sourceFiles = new Set(nodes.map((node) => node.file));
    const entries = new Set<string>();
    const visited = new Set<string>();
    const directories: string[] = [];
    for (const node of nodes) {
      let directory = path.dirname(path.join(this.projectRoot, node.file));
      while (directory === this.projectRoot || directory.startsWith(this.projectRoot + path.sep)) {
        if (visited.has(directory)) break;
        visited.add(directory);
        directories.push(directory);
        if (directory === this.projectRoot) break;
        directory = path.dirname(directory);
      }
    }
    const addFile = (directory: string, relative: string): void => {
      if (!relative || /^(?:[a-z]+:|#)/i.test(relative) || relative.includes('*')) return;
      const clean = relative.split(/[?#]/)[0]!.replace(/^\/+/, '');
      const resolved = path.resolve(directory, clean);
      if (resolved !== this.projectRoot && !resolved.startsWith(this.projectRoot + path.sep)) return;
      const sourceVariant = resolved.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
        .replace(`${path.sep}build${path.sep}`, `${path.sep}src${path.sep}`);
      for (const candidate of [sourceVariant, resolved]) {
        const file = this.resolver.findExistingFile(candidate);
        if (!file) continue;
        const graphPath = portablePath(path.relative(this.projectRoot, file));
        if (sourceFiles.has(graphPath)) entries.add(graphPath);
      }
    };
    const addManifestField = (directory: string, value: unknown): void => {
      if (typeof value === 'string') { addFile(directory, value); return; }
      if (Array.isArray(value)) { for (const item of value) addManifestField(directory, item); return; }
      if (value && typeof value === 'object') for (const item of Object.values(value)) addManifestField(directory, item);
    };
    for (const directory of directories) {
      const manifestPath = path.join(directory, 'package.json');
      const hasManifest = fs.existsSync(manifestPath);
      if (hasManifest) try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
        for (const field of ['source', 'main', 'module', 'browser', 'bin', 'exports']) addManifestField(directory, manifest[field]);
      } catch { /* Unreadable manifests cannot declare entry points. */ }
      if (hasManifest || directory === this.projectRoot) try {
        const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
        for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) addFile(directory, match[1]!);
      } catch { /* HTML entry is optional. */ }
    }
    return entries;
  }

  private isConventionalEntry(file: string): boolean {
    const normalized = portablePath(file).toLowerCase();
    const basename = normalized.split('/').at(-1) || '';
    if (/(^|\/)(?:__tests__|__mocks__|__fixtures__|fixtures|stories|examples|\.storybook|scripts)(\/|$)/.test(normalized)) return true;
    if (/(?:^|\/)(?:eslint|vite|vitest|webpack|next|nuxt|vue|babel|postcss|tailwind|prettier|rollup|tsup|jest|playwright|cypress|react-router|remix|craco|stylelint)\.config\.[cm]?[jt]sx?$/.test(normalized)) return true;
    if (/(?:^|\/)(?:\.eslintrc|\.babelrc|\.prettierrc)\.[cm]?[jt]s$/.test(normalized)) return true;
    if (/\.(?:stories|story|spec|test)\.[cm]?[jt]sx?$/.test(basename) || /(?:^|[.-])(?:test|spec)\.[cm]?[jt]sx?$/.test(basename) || basename.endsWith('.d.ts')) return true;
    if (/(^|\/)(?:src|client)\/(?:main|index|app|entry-client|entry-server)\.[cm]?[jt]sx?$/.test(normalized)) return true;
    if (/(^|\/)(?:app|src\/app)\/(?:[^/]+\/)*(?:page|layout|template|loading|error|global-error|not-found|default|route)\.[cm]?[jt]sx?$/.test(normalized)) return this.hasFrameworkDependency(file, ['next']);
    if (/(^|\/)(?:pages|src\/pages)\/.*\.[cm]?[jt]sx?$/.test(normalized)
      || /(?:^|\/)(?:middleware|instrumentation|instrumentation-client)\.[cm]?[jt]sx?$/.test(normalized)) {
      if (this.hasFrameworkDependency(file, ['next'])) return true;
    }
    if (/(^|\/)(?:pages|src\/pages)\/.*\.(?:vue|[cm]?[jt]sx?)$/.test(normalized)
      && this.hasFrameworkDependency(file, ['nuxt', 'unplugin-vue-router'])) return true;
    if (/(^|\/)(?:layouts|src\/layouts|plugins|src\/plugins|middleware|src\/middleware|composables|src\/composables|components|src\/components|server\/(?:api|routes|middleware))\/.*\.(?:vue|[cm]?[jt]sx?)$/.test(normalized)
      || /(?:^|\/)(?:app|error)\.vue$/.test(normalized)) return this.hasFrameworkDependency(file, ['nuxt']);
    if (/(^|\/)(?:components|src\/components)\/.*\.vue$/.test(normalized)
      && this.hasFrameworkDependency(file, ['unplugin-vue-components'])) return true;
    if (/(^|\/)app\/(?:routes\/.*|routes|root|entry\.client|entry\.server)\.[cm]?[jt]sx?$/.test(normalized)) return this.hasFrameworkDependency(file, ['@remix-run/dev', '@react-router/dev']);
    return false;
  }

  private readonly frameworkDependencyCache = new Map<string, Set<string>>();

  private hasFrameworkDependency(file: string, names: string[]): boolean {
    let directory = path.dirname(path.join(this.projectRoot, file));
    while (directory === this.projectRoot || directory.startsWith(this.projectRoot + path.sep)) {
      let dependencies = this.frameworkDependencyCache.get(directory);
      if (!dependencies) {
        dependencies = new Set<string>();
        try {
          const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
          for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) dependencies.add(name);
        } catch { /* No manifest at this level. */ }
        this.frameworkDependencyCache.set(directory, dependencies);
      }
      if (names.some((name) => dependencies.has(name))) return true;
      if (directory === this.projectRoot) break;
      directory = path.dirname(directory);
    }
    return false;
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

  private splitOversizedClusters(nodes: SealNode[]): void {
    const limit = 250;
    const groups = new Map<string, SealNode[]>();
    for (const node of nodes) {
      const key = node.cluster || '';
      const group = groups.get(key) || [];
      group.push(node);
      groups.set(key, group);
    }
    for (const [base, members] of groups) {
      if (members.length <= limit) continue;
      const parts: Array<{ label: string; nodes: SealNode[] }> = [];
      const divide = (items: SealNode[], depth: number, segments: string[]): void => {
        if (items.length <= limit) { parts.push({ label: segments.join('/') || 'root', nodes: items }); return; }
        const buckets = new Map<string, SealNode[]>();
        for (const node of items) {
          const segment = portablePath(node.file).split('/')[depth] || '(root)';
          const bucket = buckets.get(segment) || [];
          bucket.push(node);
          buckets.set(segment, bucket);
        }
        if (buckets.size === 1 && depth < 30) {
          const [segment, bucket] = [...buckets][0]!;
          if (segment !== '(root)') { divide(bucket, depth + 1, [...segments, segment]); return; }
        }
        if (buckets.size > 1) {
          const ordered = [...buckets].sort(([left], [right]) => left.localeCompare(right));
          const packSiblings = ordered.length > 200 || ordered.every(([segment]) => /\.[^.]+$/.test(segment));
          if (!packSiblings) {
            for (const [segment, bucket] of ordered) divide(bucket, depth + 1, [...segments, segment]);
            return;
          }
          let packet: SealNode[] = [];
          let packetIndex = 0;
          const flush = () => {
            if (!packet.length) return;
            parts.push({ label: `${segments.join('/') || 'root'} / group ${++packetIndex}`, nodes: packet });
            packet = [];
          };
          for (const [segment, bucket] of ordered) {
            if (bucket.length > limit) { flush(); divide(bucket, depth + 1, [...segments, segment]); continue; }
            if (packet.length + bucket.length > limit) flush();
            packet.push(...bucket);
          }
          flush();
          return;
        }
        // A single source file can define more than 250 symbols. Keep that file
        // intact instead of dropping symbols or inventing partial file groups.
        parts.push({ label: segments.join('/') || 'root', nodes: items });
      };
      divide(members, 0, []);
      parts.forEach((part, index) => {
        const clusterName = index === 0 ? base
          : base.includes('Core & Root') ? `Citadel: ${part.label}` : `${base} · ${part.label}`;
        for (const node of part.nodes) node.cluster = clusterName;
      });
    }
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

  public collectSourceFiles(
    dir: string,
    onProgress?: (count: number, currentDir: string) => void,
    onIssue?: (directory: string, error: string) => void
  ): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const extensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.go', '.java', '.kt', '.kts', '.cs']);
    let visitedDirectories = 0;
    const walk = (currentDir: string) => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(currentDir, { withFileTypes: true }); }
      catch (reason) {
        onIssue?.(currentDir, reason instanceof Error ? reason.message : String(reason));
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredSourceDirectories.has(entry.name)) walk(fullPath);
        } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
          results.push(fullPath);
        }
      }
      visitedDirectories++;
      if (visitedDirectories % 50 === 0) onProgress?.(results.length, currentDir);
    };
    walk(dir);
    onProgress?.(results.length, dir);
    return results.sort((left, right) => portablePath(left).localeCompare(portablePath(right)));
  }
}
