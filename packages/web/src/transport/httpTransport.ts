import type { DevToolsTelemetryEvent, GrimoireGraph } from '@wha/core';
import type { DevtoolsInstallStatus, ITransport } from './transport.js';

export class HttpTransport implements ITransport {
  public async getDevtoolsInstallStatus(): Promise<DevtoolsInstallStatus> {
    const response = await fetch('/api/devtools/install');
    if (!response.ok) throw new Error(`Could not read DevTools setup: HTTP ${response.status}`);
    return response.json();
  }
  public async installDevtools(): Promise<DevtoolsInstallStatus> {
    return this.changeDevtools('POST');
  }
  public async upgradeDevtools(): Promise<DevtoolsInstallStatus> {
    return this.changeDevtools('PUT');
  }
  public async removeDevtools(): Promise<DevtoolsInstallStatus> {
    return this.changeDevtools('DELETE');
  }
  private async changeDevtools(method: 'POST' | 'PUT' | 'DELETE'): Promise<DevtoolsInstallStatus> {
    const response = await fetch('/api/devtools/install', { method });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `DevTools setup failed: HTTP ${response.status}`);
    return payload;
  }
  public async measureBuild(): Promise<{ measured: number }> {
    const response = await fetch('/api/build-measure', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Build failed: HTTP ${response.status}`);
    return payload;
  }
  public async getGraph(): Promise<GrimoireGraph> {
    const res = await fetch('/api/graph');
    if (!res.ok) {
      throw new Error(`Failed to fetch grimoire graph: HTTP ${res.status}`);
    }
    return (await res.json()) as GrimoireGraph;
  }

  public subscribeEvents(onReload: () => void, onTelemetry?: (event: DevToolsTelemetryEvent | DevToolsTelemetryEvent[]) => void): () => void {
    try {
      const sse = new EventSource('/api/events');
      sse.onmessage = (e) => {
        if (e.data === 'reload') {
          onReload();
        }
      };
      sse.addEventListener('telemetry', (e) => {
        try { onTelemetry?.(JSON.parse((e as MessageEvent).data) as DevToolsTelemetryEvent); } catch { /* Ignore malformed event. */ }
      });
      sse.addEventListener('telemetry-batch', (e) => {
        try { onTelemetry?.(JSON.parse((e as MessageEvent).data) as DevToolsTelemetryEvent[]); } catch { /* Ignore malformed batch. */ }
      });
      return () => {
        sse.close();
      };
    } catch {
      return () => {};
    }
  }

  public openFileInEditor(filePath: string, line = 1): void {
    const vscodeUrl = `vscode://file/${filePath}:${line}`;
    window.open(vscodeUrl, '_blank');
  }
}
