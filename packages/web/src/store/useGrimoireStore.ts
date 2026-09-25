import type { DependencySeal, DevToolsTelemetryEvent, DiagnosticFilter, GrimoireGraph, SealNode } from '@wha/core';
import { create } from 'zustand';
import type { Locale } from '../i18n.js';
import { buildSnapshot, matchTelemetry, MAX_SAVED_SESSIONS, MAX_SESSION_EVENTS, persistBuildSnapshots, persistSessions, projectKey, readBuildSnapshots, readSavedSessions, validSession, type BuildSnapshot, type EventMatch, type RecordedEvent, type RecordingSession } from '../devtools/session.js';

const canonicalName = (name: string) => name.replace(/[^a-z0-9]/gi, '').toLowerCase();
const isHotNode = (node: SealNode) => Boolean(node.telemetry?.isOverheating || ['overcharged', 'fissure'].includes(node.metrics?.devTools?.overloadState || ''));
const findingIndexes = new WeakMap<GrimoireGraph, Map<string, string[]>>();
function findingIndex(graph: GrimoireGraph | null): Map<string, string[]> {
  if (!graph) return new Map();
  const cached = findingIndexes.get(graph);
  if (cached) return cached;
  const index = new Map<string, string[]>();
  for (const node of graph.nodes) for (const finding of node.metrics.devTools?.findings || []) {
    if (!finding.childName || !finding.propName) continue;
    const key = `${canonicalName(finding.childName)}:${finding.propName}`;
    const ids = index.get(key) || [];
    ids.push(node.id);
    index.set(key, ids);
  }
  findingIndexes.set(graph, index);
  return index;
}
export interface GrimoireState {
  locale: Locale;
  toggleLocale: () => void;
  graph: GrimoireGraph | null;
  nodes: SealNode[];
  nodeMap: Map<string, SealNode>;
  hotNodeCount: number;
  browserLongTasks: { count: number; totalDurationMs: number };
  unmatchedRuntime: { renders: number; domUpdates: number };
  recentRenders: Array<DevToolsTelemetryEvent & { mappedNodeId?: string }>;
  coverage: { received: number; matched: number; inferred: number; ambiguous: number; unmatched: number };
  runtimeConnections: Record<string, DevToolsTelemetryEvent>;
  currentSession: RecordingSession | null;
  savedSessions: RecordingSession[];
  recording: boolean;
  buildSnapshots: BuildSnapshot[];
  runtimeResolutions: Record<string, string>;
  locatorResult: { event: DevToolsTelemetryEvent; match: EventMatch } | null;
  selectedNodeId: string | null;
  selectedDependencyId: string | null;
  hoveredNodeId: string | null;
  lineageNodes: string[];
  activeFilter: string;
  realisticMode: boolean;
  lightweightMode: boolean;
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
  recordTelemetryBatch: (events: DevToolsTelemetryEvent[]) => Array<{ event: DevToolsTelemetryEvent; nodeId: string }>;
  startRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
  importSession: (value: unknown) => boolean;
  resolveRuntime: (runtimeId: string, nodeId: string | null) => void;
  resolveRecordedEvent: (eventId: string, nodeId: string | null) => void;
  saveBuildSnapshot: (graph: GrimoireGraph) => void;
  selectNode: (nodeId: string | null) => void;
  selectDependency: (dependencyId: string | null) => void;
  hoverNode: (nodeId: string | null, clientX?: number, clientY?: number) => void;
  hoverDependency: (dependencyId: string | null, clientX?: number, clientY?: number) => void;
  setFilter: (filter: string) => void;
  setDiagnosticFilter: (diagFilter: DiagnosticFilter) => void;
  toggleRealistic: () => void;
  toggleLightweight: () => void;
  toggleDevTools: () => void;
  setSearchQuery: (query: string) => void;
  setDrawerOpen: (open: boolean) => void;
  setZoomPercent: (pct: number) => void;
}

export const useGrimoireStore = create<GrimoireState>((set, get) => ({
  locale: (() => {
    try { const saved = localStorage.getItem('grimoire-locale'); if (saved === 'ru' || saved === 'en') return saved; } catch { /* No storage. */ }
    return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
  })(),
  toggleLocale: () => set((state) => {
    const locale = state.locale === 'ru' ? 'en' : 'ru';
    try { localStorage.setItem('grimoire-locale', locale); } catch { /* No storage. */ }
    return { locale };
  }),
  graph: null,
  nodes: [],
  nodeMap: new Map(),
  hotNodeCount: 0,
  browserLongTasks: { count: 0, totalDurationMs: 0 },
  unmatchedRuntime: { renders: 0, domUpdates: 0 },
  recentRenders: [],
  coverage: { received: 0, matched: 0, inferred: 0, ambiguous: 0, unmatched: 0 },
  runtimeConnections: {},
  currentSession: null,
  savedSessions: [],
  recording: false,
  buildSnapshots: [],
  runtimeResolutions: {},
  locatorResult: null,
  selectedNodeId: null,
  selectedDependencyId: null,
  hoveredNodeId: null,
  lineageNodes: [],
  activeFilter: 'all',
  realisticMode: false,
  lightweightMode: (() => { try { return localStorage.getItem('grimoire-lightweight-map') === 'true'; } catch { return false; } })(),
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
    const changedProject = !current.graph || projectKey(current.graph) !== projectKey(graph);
    const nodes = (graph.nodes || []).map((node) => {
      const previous = changedProject ? undefined : current.nodeMap.get(node.id);
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
      graph: mergedGraph, nodes, nodeMap, hotNodeCount: nodes.filter(isHotNode).length,
      ...(changedProject ? { currentSession: null, savedSessions: readSavedSessions(projectKey(graph)), buildSnapshots: readBuildSnapshots(projectKey(graph)), recording: false,
        runtimeResolutions: {}, runtimeConnections: {}, locatorResult: null, coverage: { received: 0, matched: 0, inferred: 0, ambiguous: 0, unmatched: 0 } } : {}),
      selectedNodeId: !changedProject && current.selectedNodeId && nodeMap.has(current.selectedNodeId) ? current.selectedNodeId : null,
      selectedDependencyId: !changedProject && current.selectedDependencyId && graph.dependencies?.some((seal) => seal.id === current.selectedDependencyId) ? current.selectedDependencyId : null,
    });

  },

  recordTelemetry: (event) => get().recordTelemetryBatch([event])[0]?.nodeId || null,
  recordTelemetryBatch: (events) => {
    if (!events.length) return [];
    const mapped: Array<{ event: DevToolsTelemetryEvent; nodeId: string }> = [];
    set((state) => {
      let changed = false;
      let nodeMap = state.nodeMap;
      let hotNodeCount = state.hotNodeCount;
      let coverage = state.coverage;
      let browserLongTasks = state.browserLongTasks;
      let unmatchedRuntime = state.unmatchedRuntime;
      let runtimeConnections = state.runtimeConnections;
      let locatorResult = state.locatorResult;
      const recent: GrimoireState['recentRenders'] = [];
      const sessionEvents = state.recording && state.currentSession ? [...state.currentSession.events] : null;
      let dropped = state.currentSession?.dropped || 0;
      const putNode = (node: SealNode) => {
        const previous = nodeMap.get(node.id);
        hotNodeCount += Number(isHotNode(node)) - Number(previous ? isHotNode(previous) : false);
        if (nodeMap === state.nodeMap) nodeMap = new Map(nodeMap);
        nodeMap.set(node.id, node);
      };

      for (const event of events) {
        if (event.type === 'HELLO') {
          if (event.pageId) { runtimeConnections = { ...runtimeConnections, [event.pageId]: event }; changed = true; }
          continue;
        }
        const match = event.type === 'RENDER' || event.type === 'DOM_UPDATE' || event.type === 'LOCATE'
          ? matchTelemetry(state.graph, event, state.runtimeResolutions)
          : { status: 'unmatched', candidates: [], explanation: 'not-a-component' } as EventMatch;

        if (event.type === 'RENDER') {
          coverage = { ...coverage, received: coverage.received + 1,
            matched: coverage.matched + Number(match.status === 'exact'), inferred: coverage.inferred + Number(match.status === 'inferred'),
            ambiguous: coverage.ambiguous + Number(match.status === 'ambiguous'), unmatched: coverage.unmatched + Number(match.status === 'unmatched') };
          changed = true;
        }
        if (sessionEvents) {
          if (sessionEvents.length < MAX_SESSION_EVENTS) sessionEvents.push({ id: crypto.randomUUID(), event, match });
          else dropped++;
          changed = true;
        }
        if (event.type === 'LOCATE') { locatorResult = { event, match }; changed = true; }
        if (event.type === 'LONG_TASK') {
          browserLongTasks = { count: browserLongTasks.count + 1, totalDurationMs: browserLongTasks.totalDurationMs + event.durationMs };
          changed = true;
          continue;
        }
        if (event.type !== 'RENDER' && event.type !== 'DOM_UPDATE' && event.type !== 'LOCATE') continue;
        const node = match.nodeId ? nodeMap.get(match.nodeId) : undefined;
        if (!node) {
          if (event.type === 'RENDER') { unmatchedRuntime = { ...unmatchedRuntime, renders: unmatchedRuntime.renders + 1 }; recent.push(event); changed = true; }
          else if (event.type === 'DOM_UPDATE') { unmatchedRuntime = { ...unmatchedRuntime, domUpdates: unmatchedRuntime.domUpdates + 1 }; changed = true; }
          continue;
        }
        mapped.push({ event, nodeId: node.id });
        if (event.type === 'LOCATE') continue;

        const old = node.telemetry;
        const isRender = event.type === 'RENDER';
        const phase = event.changeReasons?.[0];
        const isUpdate = isRender && (phase === 'update' || phase === 'nested-update');
        const isMount = isRender && phase === 'mount';
        const count = (old?.renderCount || 0) + Number(isRender);
        const updateCount = (old?.updateCount || 0) + Number(isUpdate);
        const mountCount = (old?.mountCount || 0) + Number(isMount);
        const domUpdateCount = (old?.domUpdateCount || 0) + Number(event.type === 'DOM_UPDATE');
        const average = isRender ? ((old?.avgRenderDurationMs || 0) * (count - 1) + event.durationMs) / count : old?.avgRenderDurationMs || 0;
        const updateAverage = isUpdate ? ((old?.avgUpdateDurationMs || 0) * (updateCount - 1) + event.durationMs) / updateCount : old?.avgUpdateDurationMs || 0;
        putNode({ ...node, telemetry: {
          renderCount: count, updateCount, mountCount, lastRenderTime: event.timestamp, domUpdateCount,
          avgRenderDurationMs: average, avgUpdateDurationMs: updateAverage, source: event.source,
          lastReasons: event.changeReasons || [], hierarchyPath: event.hierarchyPath, parentComponentName: event.parentComponentName,
          isOverheating: isUpdate ? updateCount >= 5 && updateAverage > 16 : old?.isOverheating,
        } });
        changed = true;
        if (isRender) recent.push({ ...event, mappedNodeId: node.id });

        if (!isRender || (event.source !== 'adapter' && event.source !== 'fiber')) continue;
        const changedIdentityProps = new Set((event.changeReasons || [])
          .filter((reason) => /^prop:[^:]+:identity$/.test(reason)).map((reason) => reason.split(':')[1]!));
        if (!changedIdentityProps.size) continue;
        const candidateIds = new Set<string>();
        const index = findingIndex(state.graph);
        for (const prop of changedIdentityProps) for (const id of index.get(`${canonicalName(event.componentName)}:${prop}`) || []) candidateIds.add(id);
        for (const id of candidateIds) {
          const item = nodeMap.get(id);
          if (!item) continue;
          const devTools = item.metrics.devTools;
          if (item.id === node.id || !devTools?.findings?.length) continue;
          const findings = devTools.findings.map((finding) => {
            if (finding.framework !== 'react' || !finding.propName || !finding.childName ||
                !changedIdentityProps.has(finding.propName) || canonicalName(finding.childName) !== canonicalName(event.componentName)) return finding;
            return { ...finding, evidence: 'runtime' as const, observedCount: (finding.observedCount || 0) + 1, lastObservedDurationMs: event.durationMs };
          });
          if (findings.some((finding, index) => finding !== devTools.findings?.[index])) {
            putNode({ ...item, metrics: { ...item.metrics, devTools: { ...devTools, findings } } });
          }
        }
      }
      if (!changed) return state;
      return {
        coverage, browserLongTasks, unmatchedRuntime, runtimeConnections, locatorResult,
        currentSession: sessionEvents && state.currentSession ? { ...state.currentSession, events: sessionEvents, dropped } : state.currentSession,
        recentRenders: recent.length ? [...recent.reverse(), ...state.recentRenders].slice(0, 40) : state.recentRenders,
        ...(nodeMap !== state.nodeMap ? { nodeMap, nodes: state.nodes.map((node) => nodeMap.get(node.id) || node),
          hotNodeCount } : {}),
      };
    });
    return mapped;
  },

  startRecording: () => {
    const key = projectKey(get().graph);
    set({ recording: true, currentSession: { version: 1, id: crypto.randomUUID(), projectKey: key,
      name: new Date().toLocaleString(), startedAt: Date.now(), dropped: 0, events: [] } });
  },
  stopRecording: () => {
    const current = get().currentSession;
    if (!current || !get().recording) return;
    const finished = { ...current, stoppedAt: Date.now() };
    const savedSessions = [finished, ...get().savedSessions.filter((session) => session.id !== finished.id)].slice(0, MAX_SAVED_SESSIONS);
    persistSessions(finished.projectKey, savedSessions);
    set({ recording: false, currentSession: finished, savedSessions });
  },
  clearRecording: () => set({ recording: false, currentSession: null }),
  importSession: (value) => {
    const key = projectKey(get().graph);
    if (!validSession(value, key)) return false;
    const savedSessions = [value, ...get().savedSessions.filter((session) => session.id !== value.id)].slice(0, MAX_SAVED_SESSIONS);
    persistSessions(key, savedSessions);
    set({ savedSessions });
    return true;
  },
  resolveRuntime: (runtimeId, nodeId) => {
    const graph = get().graph;
    if (!graph || (nodeId && !graph.nodes.some((node) => node.id === nodeId))) return;
    const runtimeResolutions = { ...get().runtimeResolutions };
    if (nodeId) runtimeResolutions[runtimeId] = nodeId;
    else delete runtimeResolutions[runtimeId];
    const remap = (entry: RecordedEvent): RecordedEvent => entry.event.runtimeId && `${entry.event.pageId || 'page'}:${entry.event.runtimeId}` === runtimeId
      ? { ...entry, match: matchTelemetry(graph, entry.event, runtimeResolutions) } : entry;
    const currentSession = get().currentSession;
    const savedSessions = get().savedSessions.map((session) => ({ ...session, events: session.events.map(remap) }));
    persistSessions(projectKey(graph), savedSessions);
    set({ runtimeResolutions, savedSessions, currentSession: currentSession ? { ...currentSession, events: currentSession.events.map(remap) } : null });
  },
  resolveRecordedEvent: (eventId, nodeId) => {
    if (nodeId && !get().nodeMap.has(nodeId)) return;
    const remap = (entry: RecordedEvent): RecordedEvent => entry.id === eventId
      ? { ...entry, match: nodeId ? { status: 'exact', nodeId, candidates: [nodeId], explanation: 'manual' }
        : matchTelemetry(get().graph, entry.event, get().runtimeResolutions) } : entry;
    const currentSession = get().currentSession;
    const savedSessions = get().savedSessions.map((session) => ({ ...session, events: session.events.map(remap) }));
    persistSessions(projectKey(get().graph), savedSessions);
    set({ savedSessions, currentSession: currentSession ? { ...currentSession, events: currentSession.events.map(remap) } : null });
  },
  saveBuildSnapshot: (graph) => {
    const snapshot = buildSnapshot(graph);
    if (!Object.keys(snapshot.packages).length || get().buildSnapshots.some((item) => item.measuredAt === snapshot.measuredAt)) return;
    const buildSnapshots = [snapshot, ...get().buildSnapshots].slice(0, 5);
    persistBuildSnapshots(snapshot.projectKey, buildSnapshots);
    set({ buildSnapshots });
  },

  selectNode: (nodeId) => {
    if (!nodeId) {
      set({
        selectedNodeId: null,
        selectedDependencyId: null,
        isDrawerOpen: false,
        lineageNodes: [],
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

    if (rootNode && rootNode.id !== targetNode.id && graph) {
      // Find shortest path from root to targetNode via BFS
      const queue: Array<{ id: string; path: string[] }> = [
        { id: rootNode.id, path: [rootNode.id] },
      ];
      const visited = new Set<string>([rootNode.id]);
      let foundPath: { path: string[] } | null = null;

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
            queue.push({
              id: edge.target,
              path: [...curr.path, edge.target],
            });
          }
        }
      }

      if (foundPath) {
        lineageNodes.push(...foundPath.path);
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
    });
  },

  selectDependency: (dependencyId) => set({
    selectedDependencyId: dependencyId,
    selectedNodeId: null,
    isDrawerOpen: Boolean(dependencyId),
    lineageNodes: [],
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
  toggleRealistic: () => set((s) => ({ realisticMode: !s.realisticMode, devToolsMode: false })),
  toggleLightweight: () => set((s) => {
    const lightweightMode = !s.lightweightMode;
    try { localStorage.setItem('grimoire-lightweight-map', String(lightweightMode)); } catch { /* No storage. */ }
    return { lightweightMode };
  }),
  toggleDevTools: () =>
    set((s) => ({
      devToolsMode: !s.devToolsMode,
      realisticMode: false,
      diagnosticFilter: 'all',
    })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setDrawerOpen: (isDrawerOpen) => set({ isDrawerOpen }),
  setZoomPercent: (zoomPercent) => set({ zoomPercent }),
}));
