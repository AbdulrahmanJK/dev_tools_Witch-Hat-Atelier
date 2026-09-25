import type { DevToolsTelemetryEvent, GrimoireGraph } from '@wha/core';

export interface ITransport {
  getGraph(): Promise<GrimoireGraph>;
  subscribeEvents(onReload: () => void, onTelemetry?: (event: DevToolsTelemetryEvent | DevToolsTelemetryEvent[]) => void, onScanStatus?: (status: ScanStatus) => void): () => void;
  openFileInEditor(filePath: string, line?: number): void;
  measureBuild?(appId?: string): Promise<{ measured: number }>;
  importWebpackStats?(relativePath: string): Promise<{ measured: number }>;
  getWebpackBuildStatus?(): Promise<WebpackBuildStatus>;
  startWebpackBuild?(appId: string, script: string, statsPath: string): Promise<WebpackBuildStatus>;
  stopWebpackBuild?(): Promise<WebpackBuildStatus>;
  getDevtoolsInstallStatus?(appId?: string): Promise<DevtoolsInstallStatus>;
  installDevtools?(appId?: string): Promise<DevtoolsInstallStatus>;
  upgradeDevtools?(appId?: string): Promise<DevtoolsInstallStatus>;
  refreshDevtools?(appId?: string): Promise<DevtoolsInstallStatus>;
  removeDevtools?(appId?: string): Promise<DevtoolsInstallStatus>;
  getWebpackInstallStatus?(appId: string, entry?: string, script?: string): Promise<DevtoolsInstallStatus & { preview?: string | null }>;
  installWebpackDevtools?(appId: string, entry: string, script: string): Promise<DevtoolsInstallStatus>;
  removeWebpackDevtools?(appId: string): Promise<DevtoolsInstallStatus>;
  refreshWebpackDevtools?(appId: string): Promise<DevtoolsInstallStatus>;
  startElementLocator?(): Promise<{ locate: boolean; expiresAt: number }>;
  stopElementLocator?(): Promise<void>;
  getScanStatus?(): Promise<ScanStatus>;
  retryScan?(): Promise<ScanStatus>;
  cancelScan?(): Promise<ScanStatus>;
  setWatchPath?(relativePath: string | null): Promise<{ path: string | null }>;
}

export interface WebpackBuildStatus {
  state: 'idle' | 'running' | 'importing' | 'ready' | 'error' | 'cancelled';
  command: string;
  cwd: string;
  statsPath: string;
  startedAt: number | null;
  endedAt: number | null;
  measured: number;
  error: string | null;
  logs: string[];
}

export interface ScanStatus {
  state: 'starting' | 'running' | 'ready' | 'error' | 'cancelled';
  phase: string;
  completed: number | null;
  total: number | null;
  file: string | null;
  startedAt: number;
  updatedAt: number;
  error: string | null;
  coverage?: GrimoireGraph['stats']['parseCoverage'];
  watchPath?: string | null;
  logs: Array<{ time: number; level: 'info' | 'warning' | 'error'; message: string }>;
}

export interface DevtoolsInstallStatus {
  installed: boolean;
  framework?: 'react' | 'vue';
  entry?: string;
  command?: string;
  port?: number;
  upgradeAvailable?: boolean;
  componentTracing?: boolean;
  refreshAvailable?: boolean;
}
