import type { DependencySeal, DevToolsTelemetryEvent, DiagnosticFilter, GrimoireGraph, SealNode } from '@wha/core';
import { create } from 'zustand';

const canonicalName = (name: string) => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
const normalizedSourceFile = (value?: string): string | undefined => {
  if (!value) return undefined;
  try { if (/^https?:/.test(value)) value = decodeURIComponent(new URL(value).pathname); }
  catch { /* Keep the original source path. */ }
  return value.split(/[?#]/)[0]?.replace(/\\/g, '/');
};

export interface GrimoireState {
  graph: GrimoireGraph | null;
  nodes: SealNode[];
  nodeMap: Map<string, SealNode>;
  browserLongTasks: { count: number; totalDurationMs: number };
  unmatchedRuntime: { renders: number; domUpdates: number };
  recentRenders: Array<DevToolsTelemetryEvent & { mappedNodeId?: string }>;
  selectedNodeId: string | null;
  selectedDependencyId: string | null;
  hoveredNodeId: string | null;
  lineageNodes: string[];
  lineageEdges: string[];
  activeFilter: string;
  unifiedMode: boolean;
  realisticMode: boolean;
  devToolsMode: boolean;
  diagnosticFilter: DiagnosticFilter;
  searchQuery: string;
  isDrawerOpen: boolean;
  zoomPercent: number;
  tooltip: {
    visible: boolean;
    x: number;
    y: number;
    node: SealNode | null;
    dependency: DependencySeal | null;
  };

  // Actions
  setGraph: (graph: GrimoireGraph) => void;
  recordTelemetry: (event: DevToolsTelemetryEvent) => string | null;
  selectNode: (nodeId: string | null) => void;
  selectDependency: (dependencyId: string | null) => void;
  hoverNode: (nodeId: string | null, clientX?: number, clientY?: number) => void;
  hoverDependency: (dependencyId: string | null, clientX?: number, clientY?: number) => void;
  setFilter: (filter: string) => void;
  setDiagnosticFilter: (diagFilter: DiagnosticFilter) => void;
  toggleUnified: () => void;
  toggleRealistic: () => void;
  toggleDevTools: () => void;
  setSearchQuery: (query: string) => void;
  setDrawerOpen: (open: boolean) => void;
  setZoomPercent: (pct: number) => void;
}

export const useGrimoireStore = create<GrimoireState>((set, get) => ({
  graph: null,
  nodes: [],
  nodeMap: new Map(),
  browserLongTasks: { count: 0, totalDurationMs: 0 },
  unmatchedRuntime: { renders: 0, domUpdates: 0 },
  recentRenders: [],
  selectedNodeId: null,
  selectedDependencyId: null,
  hoveredNodeId: null,
  lineageNodes: [],
  lineageEdges: [],
  activeFilter: 'all',
  unifiedMode: false,
  realisticMode: false,
  devToolsMode: false,
  diagnosticFilter: 'all',
  searchQuery: '',
  isDrawerOpen: false,
  zoomPercent: 45,
  tooltip: {
    visible: false,
    x: 0,
    y: 0,
    node: null,
    dependency: null,
  },

  setGraph: (graph) => {
    const current = get();
    const nodes = (graph.nodes || []).map((node) => {
      const previous = current.nodeMap.get(node.id);
      const priorFindings = new Map(previous?.metrics.devTools?.findings?.map((finding) => [finding.id, finding]) || []);
      const devTools = node.metrics.devTools;
      return {
        ...node,
        telemetry: previous?.telemetry || node.telemetry,
        metrics: devTools ? { ...node.metrics, devTools: {
          ...devTools,
          findings: devTools.findings?.map((finding) => {
            const old = priorFindings.get(finding.id);
            return old?.observedCount ? { ...finding, evidence: 'runtime' as const, observedCount: old.observedCount, lastObservedDurationMs: old.lastObservedDurationMs } : finding;
          }),
        } } : node.metrics,
      };
    });
    const mergedGraph = { ...graph, nodes };
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    set({
      graph: mergedGraph, nodes, nodeMap,
      selectedNodeId: current.selectedNodeId && nodeMap.has(current.selectedNodeId) ? current.selectedNodeId : null,
      selectedDependencyId: current.selectedDependencyId && graph.dependencies?.some((seal) => seal.id === current.selectedDependencyId) ? current.selectedDependencyId : null,
    });

    // Select Root node automatically on initial load
    const rootNode = nodes.find(
      (n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root'))
    );
    if (rootNode && !current.graph && !current.selectedNodeId && !current.selectedDependencyId) {
      get().selectNode(rootNode.id);
    }
  },

  recordTelemetry: (event) => {
    if (event.type === 'LONG_TASK') {
      const old = get().browserLongTasks;
      set({ browserLongTasks: { count: old.count + 1, totalDurationMs: old.totalDurationMs + event.durationMs } });
      return null;
    }
    const { nodes } = get();
    const normalizedFile = normalizedSourceFile(event.file);
    let matches = event.nodeId
      ? nodes.filter((node) => node.id === event.nodeId)
      : nodes.filter((node) => canonicalName(node.name) === canonicalName(event.componentName) && (!normalizedFile || normalizedFile.endsWith(node.file.replace(/\\/g, '/'))));
    if (!event.nodeId && matches.length === 0 && normalizedFile) {
      matches = nodes.filter((node) => node.kind === 'component' && normalizedFile.endsWith(node.file.replace(/\\/g, '/')));
    }
    if (matches.length !== 1) {
      const previous = get().unmatchedRuntime;
      if (event.type === 'RENDER') set({ unmatchedRuntime: { ...previous, renders: previous.renders + 1 }, recentRenders: [event, ...get().recentRenders].slice(0, 40) });
      else if (event.type === 'DOM_UPDATE') set({ unmatchedRuntime: { ...previous, domUpdates: previous.domUpdates + 1 } });
      return null;
    }
    const node = matches[0]!;
    const old = node.telemetry;
    const isRender = event.type === 'RENDER';
    const phase = event.changeReasons?.[0];
    const isUpdate = isRender && (phase === 'update' || phase === 'nested-update');
    const isMount = isRender && phase === 'mount';
    const count = (old?.renderCount || 0) + (isRender ? 1 : 0);
    const updateCount = (old?.updateCount || 0) + (isUpdate ? 1 : 0);
    const mountCount = (old?.mountCount || 0) + (isMount ? 1 : 0);
    const domUpdateCount = (old?.domUpdateCount || 0) + (event.type === 'DOM_UPDATE' ? 1 : 0);
    const average = isRender ? ((old?.avgRenderDurationMs || 0) * (count - 1) + event.durationMs) / count : old?.avgRenderDurationMs || 0;
    const updateAverage = isUpdate ? ((old?.avgUpdateDurationMs || 0) * (updateCount - 1) + event.durationMs) / updateCount : old?.avgUpdateDurationMs || 0;
    const updated = { ...node, telemetry: {
      renderCount: count, updateCount, mountCount, lastRenderTime: event.timestamp,
      domUpdateCount,
      avgRenderDurationMs: average, avgUpdateDurationMs: updateAverage,
      source: event.source,
      lastReasons: event.changeReasons || [],
      hierarchyPath: event.hierarchyPath,
      parentComponentName: event.parentComponentName,
      isOverheating: isUpdate ? updateCount >= 5 && updateAverage > 16 : old?.isOverheating,
    } };
    const changedIdentityProps = new Set((event.changeReasons || [])
      .filter((reason) => /^prop:[^:]+:identity$/.test(reason))
      .map((reason) => reason.split(':')[1]!));
    const nextNodes = nodes.map((item) => {
      if (item.id === node.id) return updated;
      const devTools = item.metrics.devTools;
      if (!isRender || (event.source !== 'adapter' && event.source !== 'fiber') || !changedIdentityProps.size || !devTools?.findings?.length) return item;
      const findings = devTools.findings.map((finding) => {
        if (finding.framework !== 'react' || !finding.propName || !finding.childName ||
            !changedIdentityProps.has(finding.propName) || canonicalName(finding.childName) !== canonicalName(event.componentName)) return finding;
        return { ...finding, evidence: 'runtime' as const, observedCount: (finding.observedCount || 0) + 1, lastObservedDurationMs: event.durationMs };
      });
      return findings.every((finding, index) => finding === devTools.findings?.[index])
        ? item
        : { ...item, metrics: { ...item.metrics, devTools: { ...devTools, findings } } };
    });
    set({ nodes: nextNodes, nodeMap: new Map(nextNodes.map((item) => [item.id, item])),
      recentRenders: isRender ? [{ ...event, mappedNodeId: node.id }, ...get().recentRenders].slice(0, 40) : get().recentRenders });
    return node.id;
  },

  selectNode: (nodeId) => {
    if (!nodeId) {
      set({
        selectedNodeId: null,
        selectedDependencyId: null,
        isDrawerOpen: false,
        lineageNodes: [],
        lineageEdges: [],
      });
      return;
    }

    const { nodes, graph } = get();
    const nodeMap = get().nodeMap;
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode) return;

    // Calculate Ancestral Lineage path from Root (App) to targetNode
    const rootNode = nodes.find(
      (n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root'))
    );

    const lineageNodes: string[] = [];
    const lineageEdges: string[] = [];

    if (rootNode && rootNode.id !== targetNode.id && graph) {
      // Find shortest path from root to targetNode via BFS
      const queue: Array<{ id: string; path: string[]; edgePath: string[] }> = [
        { id: rootNode.id, path: [rootNode.id], edgePath: [] },
      ];
      const visited = new Set<string>([rootNode.id]);
      let foundPath: { path: string[]; edgePath: string[] } | null = null;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr.id === targetNode.id) {
          foundPath = curr;
          break;
        }

        const outgoing = graph.edges.filter(
          (e) => e.source === curr.id && (e.type === 'render' || e.type === 'import')
        );

        for (const edge of outgoing) {
          if (!visited.has(edge.target)) {
            visited.add(edge.target);
            const edgeKey = `${edge.source}->${edge.target}`;
            queue.push({
              id: edge.target,
              path: [...curr.path, edge.target],
              edgePath: [...curr.edgePath, edgeKey],
            });
          }
        }
      }

      if (foundPath) {
        lineageNodes.push(...foundPath.path);
        lineageEdges.push(...foundPath.edgePath);
      } else {
        lineageNodes.push(targetNode.id);
      }
    } else {
      lineageNodes.push(targetNode.id);
    }

    set({
      selectedNodeId: nodeId,
      selectedDependencyId: null,
      isDrawerOpen: true,
      lineageNodes,
      lineageEdges,
    });
  },

  selectDependency: (dependencyId) => set({
    selectedDependencyId: dependencyId,
    selectedNodeId: null,
    isDrawerOpen: Boolean(dependencyId),
    lineageNodes: [],
    lineageEdges: [],
  }),

  hoverNode: (nodeId, clientX, clientY) => {
    if (!nodeId) {
      set({
        hoveredNodeId: null,
        tooltip: { visible: false, x: 0, y: 0, node: null, dependency: null },
      });
      return;
    }

    const node = get().nodeMap.get(nodeId) || null;
    set({
      hoveredNodeId: nodeId,
      tooltip: {
        visible: !!node,
        x: clientX || 0,
        y: clientY || 0,
        node,
        dependency: null,
      },
    });
  },

  hoverDependency: (dependencyId, clientX, clientY) => {
    const dependency = get().graph?.dependencies?.find((item) => item.id === dependencyId) || null;
    set({
      hoveredNodeId: null,
      tooltip: { visible: Boolean(dependency), x: clientX || 0, y: clientY || 0, node: null, dependency },
    });
  },

  setFilter: (activeFilter) => set({ activeFilter }),
  setDiagnosticFilter: (diagnosticFilter) => set({ diagnosticFilter }),
  toggleUnified: () => set((s) => ({ unifiedMode: !s.unifiedMode, devToolsMode: false })),
  toggleRealistic: () => set((s) => ({ realisticMode: !s.realisticMode, devToolsMode: false })),
  toggleDevTools: () =>
    set((s) => ({
      devToolsMode: !s.devToolsMode,
      unifiedMode: false,
      realisticMode: false,
      diagnosticFilter: 'all',
    })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setDrawerOpen: (isDrawerOpen) => set({ isDrawerOpen }),
  setZoomPercent: (zoomPercent) => set({ zoomPercent }),
}));
