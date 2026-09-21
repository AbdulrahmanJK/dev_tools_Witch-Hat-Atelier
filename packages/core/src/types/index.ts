export type SealElement = 'Fire' | 'Water' | 'Earth' | 'Wind' | 'Light' | 'Arcane';

export type SealGeometry = 'circle' | 'faceted-strengthen';

export interface RadialSign {
  type: string;
  size: number;
  loc: number;
  label: string;
}

export interface KeystoneDetail {
  name: string;
  hook: string;
  detail: string;
}

export interface SealMetrics {
  radius: number;
  element: SealElement;
  keystones: string[];
  keystoneDetails: KeystoneDetail[];
  radialSigns: RadialSign[];
  geometry: SealGeometry;
  isClass: boolean;
  grade: string;
  stabilityNote: string;
  isForbidden: boolean;
  loc: number;
  hookCount: number;
  childCount: number;
}

export interface SubSeal {
  id: string;
  type: 'core' | 'state' | 'effects' | 'handler' | 'child';
  name: string;
  element?: SealElement;
  keystone?: string;
  angle: number;
  distRatio: number;
  radiusRatio: number;
  count?: number;
  loc?: number;
  details?: string[];
  dx?: number;
  dy?: number;
  radius?: number;
}

export interface InternalCircuit {
  stateVariables: Array<{ name: string; setter: string; line?: number }>;
  effects: Array<{ line?: number; deps: string[] }>;
  handlers: Array<{ name: string; loc: number; line?: number }>;
  subSeals?: SubSeal[];
  conduits?: Array<{ from: string; to: string }>;
  realisticRadius?: number;
}

export interface SealNode {
  id: string;
  name: string;
  file: string;
  kind: 'component' | 'module' | 'class' | 'function' | 'hub';
  language?: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | string;
  framework?: 'react' | 'vue' | 'svelte' | 'none';
  cluster?: string;
  loc?: number;
  hooks: Array<{ name: string; detail?: string; line?: number; loc?: number }>;
  children: string[];
  metrics: SealMetrics;
  internalCircuit?: InternalCircuit;
  realisticLayout?: {
    realisticRadius: number;
    subSeals: SubSeal[];
    conduits: Array<{ from: string; to: string }>;
  };
  consumers?: string[];
  reuseCount?: number;
  isSharedHub?: boolean;
  domainSector?: 'FORGE' | 'SHELL' | 'COMMERCE' | 'OPERATIONS' | 'GOVERNANCE';
  x: number;
  y: number;
  unifiedX?: number;
  unifiedY?: number;
  unifiedR?: number;
  telemetry?: {
    renderCount: number;
    lastRenderTime: number;
    avgRenderDurationMs: number;
    isOverheating?: boolean;
  };
}

export interface RawGraphData {
  nodes: SealNode[];
  edges: SealEdge[];
  clusters: Array<{ name: string; nodeIds: string[]; count: number }>;
  stats: GrimoireGraph['stats'];
}

export interface SealEdge {
  source: string;
  target: string;
  type: 'render' | 'import' | 'hook' | 'action' | 'data';
  count?: number;
  _key1?: string;
  _key2?: string;
}

export interface ArchipelagoCluster {
  id: string;
  name: string;
  files: string[];
  nodeIds: string[];
  x: number;
  y: number;
  radius: number;
}

export interface MandalaSector {
  id: string;
  name: string;
  label: string;
  element: SealElement;
  angleStart: number;
  angleEnd: number;
  color: string;
}

export interface GrimoireGraph {
  nodes: SealNode[];
  edges: SealEdge[];
  clusters: ArchipelagoCluster[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  unifiedLayout?: {
    rootRadius: number;
    mandalaSectors: MandalaSector[];
  };
  stats: {
    totalNodes: number;
    totalEdges: number;
    totalClusters: number;
    totalFiles: number;
    locTotal: number;
  };
}

export interface DevToolsTelemetryEvent {
  type: 'RENDER' | 'STATE_MUTATION' | 'EFFECT_TRIGGER';
  componentName: string;
  nodeId?: string;
  timestamp: number;
  durationMs: number;
  changeReasons?: string[];
}
