export type SealElement = 'Fire' | 'Water' | 'Earth' | 'Wind' | 'Light' | 'Arcane';

export type SealGeometry = 'circle' | 'faceted-strengthen';
export type DiagnosticFilter = 'all' | 'cycles' | 'orphans' | 'hot' | 'pact';

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

export interface RerenderRisk {
  type: 'inline_callback' | 'unmemoized_calc' | 'missing_memo' | 'excessive_effects' | 'large_state';
  severity: 'low' | 'medium' | 'high';
  message: string;
  line?: number;
}

export interface DiagnosticFinding {
  id: string;
  framework: 'react' | 'vue';
  rule: string;
  severity: 'low' | 'medium' | 'high';
  confidence: 'low' | 'medium' | 'high';
  message: string;
  file: string;
  line: number;
  propName?: string;
  childName?: string;
  evidence: 'static' | 'runtime';
  observedCount?: number;
  lastObservedDurationMs?: number;
}

export interface DependencySeal {
  id: string;
  name: string;
  version: string | null;
  direct: boolean;
  importerNodeIds: string[];
  importCount: number;
  dynamicImportCount: number;
  sourceRisk: 'unknown' | 'low' | 'medium' | 'high';
  build?: {
    renderedBytes: number;
    emittedBytesEstimate?: number;
    initial: boolean;
    chunks: string[];
    measuredAt: number;
    source?: 'vite' | 'webpack-stats';
    configuration?: string;
  };
  runtime?: { selfTimeMs: number; sampleCount: number };
  x: number;
  y: number;
  radius: number;
}

export interface DevToolsDiagnostics {
  healthScore: number; // 0 - 100
  overloadState: 'harmonious' | 'warm' | 'overcharged' | 'fissure';
  rerenderRisks: RerenderRisk[];
  bundleImpact: {
    loc: number;
    importCount: number;
    rating: 'feather' | 'standard' | 'heavy' | 'colossal';
    heavyLibraries: string[];
  };
  complexity: {
    cyclomatic: number;
    stateCount: number;
    effectCount: number;
    callbackCount: number;
    rating: 'simple' | 'moderate' | 'complex' | 'labyrinth';
  };
  refactorTips: string[];
  findings?: DiagnosticFinding[];
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
  devTools?: DevToolsDiagnostics;
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
  moduleCategory?: 'utils' | 'api' | 'redux' | 'constants' | 'hook';
  language?: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | string;
  sourceLine?: number;
  sourceAbsolutePath?: string;
  sourceSymbols?: Array<{ name: string; kind: string; line: number; endLine: number; signature?: string; container?: string; modifiers?: string[]; constructs?: { loops: number; branches: number; awaits: number } }>;
  sourceNamespace?: string | null;
  sourceImports?: string[];
  analysisMode?: 'static' | 'framework';
  framework?: 'react' | 'vue' | 'svelte' | 'none';
  frameworkVersion?: string;
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
  x: number;
  y: number;
  isCircular?: boolean;
  circularLoopId?: string;
  circularPath?: string[];
  isOrphan?: boolean;
  architectureViolationIds?: string[];
  telemetry?: {
    renderCount: number;
    updateCount?: number;
    mountCount?: number;
    domUpdateCount?: number;
    lastRenderTime: number;
    avgRenderDurationMs: number;
    avgUpdateDurationMs?: number;
    source?: 'browser' | 'adapter' | 'fiber';
    lastReasons?: string[];
    hierarchyPath?: string[];
    parentComponentName?: string;
    isOverheating?: boolean;
  };
}

export interface CircularLoop {
  id: string;
  nodeIds: string[];
  edgeKeys: string[];
  length: number;
  names: string[];
}

export interface DiagnosticsSummary {
  totalCircularLoops: number;
  totalOrphans: number;
  orphanLOC: number;
  totalOvercharged: number;
  cycles: CircularLoop[];
  orphanNodeIds: string[];
  totalArchitectureViolations?: number;
  architectureViolations?: ArchitectureViolation[];
}

export interface ArchitectureViolation {
  id: string;
  rule: 'atelier-imports-province';
  severity: 'high';
  sourceNodeId: string;
  targetNodeId: string;
  file: string;
  line: number;
  message: string;
}

export interface RawGraphData {
  nodes: SealNode[];
  edges: SealEdge[];
  clusters: Array<{ name: string; nodeIds: string[]; count: number }>;
  stats: GrimoireGraph['stats'];
  diagnostics?: DiagnosticsSummary;
  dependencies?: DependencySeal[];
}

export interface SealEdge {
  source: string;
  target: string;
  type: 'render' | 'import' | 'hook' | 'action' | 'data';
  count?: number;
  _key1?: string;
  _key2?: string;
  isCircular?: boolean;
  isArchitectureViolation?: boolean;
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

export interface GrimoireGraph {
  projectKey?: string;
  projectRoot?: string;
  capabilities?: ProjectCapabilities;
  nodes: SealNode[];
  edges: SealEdge[];
  clusters: ArchipelagoCluster[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  stats: {
    totalNodes: number;
    totalEdges: number;
    totalClusters: number;
    totalFiles: number;
    locTotal: number;
    parseCoverage?: { complete: number; partial: number; unreadable: number; warnings: number; cached?: number };
  };
  diagnostics?: DiagnosticsSummary;
  dependencies?: DependencySeal[];
}

export interface ProjectApplication {
  id: string;
  name: string;
  directory: string;
  bundler: 'vite' | 'webpack' | 'other' | 'unknown';
  framework: 'react' | 'vue' | 'mixed' | 'unknown';
  devScripts: Array<{ name: string; command: string }>;
  statsScripts?: Array<{ name: string; command: string }>;
  entries: string[];
}

export interface ProjectCapabilities {
  packageManager: 'pnpm' | 'yarn' | 'npm' | 'unknown';
  applications: ProjectApplication[];
  buildMeasurement: 'vite' | 'webpack-stats' | 'unavailable';
  scanLanguages: string[];
  allowedRuntimeOrigins?: string[];
  existingStatsFiles?: string[];
}

export interface DevToolsTelemetryEvent {
  type: 'RENDER' | 'STATE_MUTATION' | 'EFFECT_TRIGGER' | 'DOM_UPDATE' | 'LONG_TASK' | 'INTERACTION' | 'LOCATE' | 'HELLO';
  source?: 'browser' | 'adapter' | 'fiber';
  framework?: 'react' | 'vue';
  componentName: string;
  pageId?: string;
  runtimeId?: string;
  parentRuntimeId?: string;
  parentComponentName?: string;
  hierarchyPath?: string[];
  commitId?: number;
  interactionId?: number;
  interactionType?: string;
  interactionTarget?: string;
  durationKind?: 'profiler-subtree' | 'vue-lifecycle' | 'browser-task' | 'event-timing' | 'unavailable';
  reactiveTracked?: Array<{ targetId: string; key: string; operation: string }>;
  reactiveTriggers?: Array<{ targetId: string; key: string; operation: string }>;
  nodeId?: string;
  file?: string;
  timestamp: number;
  durationMs: number;
  changeReasons?: string[];
}
