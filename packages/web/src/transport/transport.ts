import type { DevToolsTelemetryEvent, GrimoireGraph } from '@wha/core';

export interface ITransport {
  getGraph(): Promise<GrimoireGraph>;
  subscribeEvents(onReload: () => void, onTelemetry?: (event: DevToolsTelemetryEvent | DevToolsTelemetryEvent[]) => void): () => void;
  openFileInEditor(filePath: string, line?: number): void;
  measureBuild?(): Promise<{ measured: number }>;
  getDevtoolsInstallStatus?(): Promise<DevtoolsInstallStatus>;
  installDevtools?(): Promise<DevtoolsInstallStatus>;
  upgradeDevtools?(): Promise<DevtoolsInstallStatus>;
  removeDevtools?(): Promise<DevtoolsInstallStatus>;
}

export interface DevtoolsInstallStatus {
  installed: boolean;
  framework?: 'react' | 'vue';
  entry?: string;
  command?: string;
  port?: number;
  upgradeAvailable?: boolean;
  componentTracing?: boolean;
}
