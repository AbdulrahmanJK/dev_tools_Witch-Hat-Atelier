import type { DevToolsTelemetryEvent, GrimoireGraph, SealNode } from '@wha/core';

export type MappingStatus = 'exact' | 'inferred' | 'ambiguous' | 'unmatched';
export interface EventMatch { status: MappingStatus; nodeId?: string; candidates: string[]; explanation: string; }
export interface RecordedEvent { id: string; event: DevToolsTelemetryEvent; match: EventMatch; }
export interface RecordingSession { version: 1; id: string; projectKey: string; name: string; startedAt: number; stoppedAt?: number; dropped: number; events: RecordedEvent[]; }
export interface BuildSnapshot { id: string; projectKey: string; measuredAt: number; source?: 'vite' | 'webpack-stats'; configuration?: string; packages: Record<string, { bytes: number; initial: boolean; chunks: string[] }>; }

const canonical = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
const fileName = (value: string) => {
  try { if (/^https?:/.test(value)) value = decodeURIComponent(new URL(value).pathname); } catch { /* use given path */ }
  return value.split(/[?#]/)[0]?.replace(/\\/g, '/') || '';
};
const runtimeKey = (event: DevToolsTelemetryEvent) => event.runtimeId ? `${event.pageId || 'page'}:${event.runtimeId}` : '';

interface MatchIndex {
  byId: Map<string, SealNode>;
  byName: Map<string, SealNode[]>;
  componentsByBasename: Map<string, SealNode[]>;
  renderChildren: Map<string, Set<string>>;
}
const matchIndexes = new WeakMap<GrimoireGraph, MatchIndex>();
function indexFor(graph: GrimoireGraph): MatchIndex {
  const cached = matchIndexes.get(graph);
  if (cached) return cached;
  const index: MatchIndex = { byId: new Map(), byName: new Map(), componentsByBasename: new Map(), renderChildren: new Map() };
  for (const node of graph.nodes) {
    index.byId.set(node.id, node);
    const key = canonical(node.name);
    const sameName = index.byName.get(key) || [];
    sameName.push(node);
    index.byName.set(key, sameName);
    if (node.kind === 'component') {
      const file = fileName(node.file);
      const basename = file.split('/').pop() || '';
      const sameBasename = index.componentsByBasename.get(basename) || [];
      sameBasename.push(node);
      index.componentsByBasename.set(basename, sameBasename);
    }
  }
  for (const edge of graph.edges) if (edge.type === 'render') {
    const children = index.renderChildren.get(edge.source) || new Set<string>();
    children.add(edge.target);
    index.renderChildren.set(edge.source, children);
  }
  matchIndexes.set(graph, index);
  return index;
}

export function matchTelemetry(graph: GrimoireGraph | null, event: DevToolsTelemetryEvent, resolutions: Record<string, string>): EventMatch {
  const index = graph ? indexFor(graph) : null;
  if (event.nodeId) {
    return index?.byId.has(event.nodeId)
      ? { status: 'exact', nodeId: event.nodeId, candidates: [event.nodeId], explanation: 'node-id' }
      : { status: 'unmatched', candidates: [], explanation: 'unknown-node-id' };
  }
  const override = resolutions[runtimeKey(event)];
  if (override && index?.byId.has(override)) return { status: 'exact', nodeId: override, candidates: [override], explanation: 'manual' };
  const name = canonical(event.componentName);
  const nameMatches = name ? index?.byName.get(name) || [] : [];
  const source = event.file ? fileName(event.file) : '';
  if (source) {
    const fileMatches = nameMatches.filter((node) => source.endsWith(fileName(node.file)));
    if (fileMatches.length === 1) return { status: 'exact', nodeId: fileMatches[0]!.id, candidates: [fileMatches[0]!.id], explanation: 'file-and-name' };
    if (fileMatches.length > 1) return { status: 'ambiguous', candidates: fileMatches.map((node) => node.id), explanation: 'same-file-and-name' };
  }
  if (nameMatches.length === 1) return { status: 'inferred', nodeId: nameMatches[0]!.id, candidates: [nameMatches[0]!.id], explanation: 'unique-name' };
  if (nameMatches.length > 1) {
    const parent = event.parentComponentName || event.hierarchyPath?.at(-2);
    if (parent && graph) {
      const parents = index?.byName.get(canonical(parent)) || [];
      const childIds = new Set(parents.flatMap((node) => [...(index?.renderChildren.get(node.id) || [])]));
      const narrowed = nameMatches.filter((node) => childIds.has(node.id));
      if (narrowed.length === 1) return { status: 'inferred', nodeId: narrowed[0]!.id, candidates: [narrowed[0]!.id], explanation: 'parent-path' };
    }
    return { status: 'ambiguous', candidates: nameMatches.map((node) => node.id), explanation: 'duplicate-name' };
  }
  if (source) {
    const basename = source.split('/').pop() || '';
    const fileMatches = (index?.componentsByBasename.get(basename) || []).filter((node) => source.endsWith(fileName(node.file)));
    if (fileMatches.length === 1) return { status: 'inferred', nodeId: fileMatches[0]!.id, candidates: [fileMatches[0]!.id], explanation: 'file-only' };
  }
  return { status: 'unmatched', candidates: [], explanation: source ? 'unknown-file-and-name' : 'unknown-name' };
}

export function projectKey(graph: GrimoireGraph | null): string { return graph?.projectKey || 'preview'; }
export const MAX_SESSION_EVENTS = 1500;
export const MAX_SAVED_SESSIONS = 5;
export function readSavedSessions(key: string): RecordingSession[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`grimoire-sessions:${key}`) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is RecordingSession => validSession(item, key)).slice(0, MAX_SAVED_SESSIONS) : [];
  } catch { return []; }
}
export function persistSessions(key: string, sessions: RecordingSession[]): void {
  try { localStorage.setItem(`grimoire-sessions:${key}`, JSON.stringify(sessions.slice(0, MAX_SAVED_SESSIONS))); } catch { /* browser storage unavailable */ }
}
export function validSession(input: unknown, key: string): input is RecordingSession {
  if (!input || typeof input !== 'object') return false;
  const value = input as RecordingSession;
  return value.version === 1 && value.projectKey === key && typeof value.id === 'string' && typeof value.name === 'string'
    && Number.isFinite(value.startedAt) && Array.isArray(value.events) && value.events.length <= MAX_SESSION_EVENTS
    && value.events.every((item) => item && typeof item.id === 'string' && item.event && typeof item.event.componentName === 'string'
      && typeof item.event.type === 'string' && Number.isFinite(item.event.timestamp) && Number.isFinite(item.event.durationMs)
      && item.match && ['exact', 'inferred', 'ambiguous', 'unmatched'].includes(item.match.status)
      && Array.isArray(item.match.candidates) && item.match.candidates.length <= 50);
}
export function readBuildSnapshots(key: string): BuildSnapshot[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(`grimoire-builds:${key}`) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is BuildSnapshot => item?.projectKey === key && item?.packages && typeof item.packages === 'object').slice(0, 5) : [];
  } catch { return []; }
}
export function persistBuildSnapshots(key: string, snapshots: BuildSnapshot[]): void {
  try { localStorage.setItem(`grimoire-builds:${key}`, JSON.stringify(snapshots.slice(0, 5))); } catch { /* browser storage unavailable */ }
}
export function buildSnapshot(graph: GrimoireGraph): BuildSnapshot {
  const packages: BuildSnapshot['packages'] = {};
  for (const dependency of graph.dependencies || []) {
    if (!dependency.build) continue;
    packages[dependency.name] = { bytes: dependency.build.emittedBytesEstimate || 0, initial: dependency.build.initial, chunks: dependency.build.chunks };
  }
  const measuredAt = graph.dependencies?.find((dependency) => dependency.build)?.build?.measuredAt || Date.now();
  const source = graph.dependencies?.find((dependency) => dependency.build?.source)?.build?.source;
  const configuration = graph.dependencies?.find((dependency) => dependency.build?.configuration)?.build?.configuration;
  return { id: crypto.randomUUID(), projectKey: projectKey(graph), measuredAt, source, configuration, packages };
}
export function matchedNode(entry: RecordedEvent, nodes: SealNode[]): SealNode | undefined {
  return nodes.find((node) => node.id === entry.match.nodeId);
}
