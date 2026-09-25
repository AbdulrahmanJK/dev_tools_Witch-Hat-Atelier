import type { DevToolsTelemetryEvent, GrimoireGraph } from '@wha/core';
import type { DevtoolsInstallStatus, ITransport, ScanStatus, WebpackBuildStatus } from './transport.js';

export class HttpTransport implements ITransport {
  private projectRoot: string | null = null;

  private inferProjectRoot(graph: GrimoireGraph): string | null {
    const rootFrom = (absolute: string | undefined, relative: string): string | null => {
      if (!absolute) return null;
      const full = absolute.replace(/\\/g, '/');
      const suffix = `/${relative.replace(/\\/g, '/').replace(/^\/+/, '')}`;
      return (/^([A-Za-z]:\/|\/)/.test(full) && full.endsWith(suffix)) ? full.slice(0, -suffix.length) : null;
    };
    for (const node of graph.nodes) {
      const root = rootFrom(node.sourceAbsolutePath, node.file)
        || node.metrics?.devTools?.findings?.map((finding) => rootFrom(finding.file, node.file)).find(Boolean);
      if (root) return root;
    }
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    for (const violation of graph.diagnostics?.architectureViolations || []) {
      const node = nodesById.get(violation.sourceNodeId);
      if (node) {
        const root = rootFrom(violation.file, node.file);
        if (root) return root;
      }
    }
    return null;
  }
  public async getScanStatus(): Promise<ScanStatus> {
    const response = await fetch('/api/scan/status', { cache: 'no-store' });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Scan status endpoint unavailable');
    if (!response.ok) throw new Error(`Scan status: HTTP ${response.status}`);
    return response.json();
  }
  public async retryScan(): Promise<ScanStatus> {
    const response = await fetch('/api/scan/retry', { method: 'POST' });
    if (!response.ok) throw new Error(`Retry failed: HTTP ${response.status}`);
    return response.json();
  }
  public async cancelScan(): Promise<ScanStatus> {
    const response = await fetch('/api/scan/cancel', { method: 'POST' });
    if (!response.ok) throw new Error(`Cancel failed: HTTP ${response.status}`);
    return response.json();
  }
  public async setWatchPath(relativePath: string | null): Promise<{ path: string | null }> {
    const response = await fetch('/api/scan/watch', relativePath === null ? { method: 'DELETE' } : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: relativePath }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Watcher setup failed: HTTP ${response.status}`);
    return payload;
  }
  public async getWebpackBuildStatus(): Promise<WebpackBuildStatus> {
    const response = await fetch('/api/webpack-build', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Webpack build status: HTTP ${response.status}`);
    return response.json();
  }
  public async startWebpackBuild(appId: string, script: string, statsPath: string): Promise<WebpackBuildStatus> {
    const response = await fetch('/api/webpack-build', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: appId, script, path: statsPath }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Webpack build failed: HTTP ${response.status}`);
    return payload;
  }
  public async stopWebpackBuild(): Promise<WebpackBuildStatus> {
    const response = await fetch('/api/webpack-build', { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Webpack build stop failed: HTTP ${response.status}`);
    return payload;
  }
  public async getDevtoolsInstallStatus(appId = '.'): Promise<DevtoolsInstallStatus> {
    const response = await fetch(`/api/devtools/install?${new URLSearchParams({ app: appId })}`);
    if (!response.ok) throw new Error(`Could not read DevTools setup: HTTP ${response.status}`);
    return response.json();
  }
  public async getWebpackInstallStatus(appId: string, entry = '', script = ''): Promise<DevtoolsInstallStatus & { preview?: string | null }> {
    const query = new URLSearchParams({ app: appId, entry, script });
    const response = await fetch(`/api/devtools/webpack?${query}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Webpack setup: HTTP ${response.status}`);
    return payload;
  }
  public async installWebpackDevtools(appId: string, entry: string, script: string): Promise<DevtoolsInstallStatus> {
    const response = await fetch(`/api/devtools/webpack?${new URLSearchParams({ app: appId })}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entry, script }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Webpack setup failed: HTTP ${response.status}`);
    return payload;
  }
  public async removeWebpackDevtools(appId: string): Promise<DevtoolsInstallStatus> {
    const response = await fetch(`/api/devtools/webpack?${new URLSearchParams({ app: appId })}`, { method: 'DELETE' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Webpack removal failed: HTTP ${response.status}`);
    return payload;
  }
  public async refreshWebpackDevtools(appId: string): Promise<DevtoolsInstallStatus> {
    const response = await fetch(`/api/devtools/webpack?${new URLSearchParams({ app: appId })}`, { method: 'PATCH' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Webpack refresh failed: HTTP ${response.status}`);
    return payload;
  }
  public async installDevtools(appId = '.'): Promise<DevtoolsInstallStatus> {
    return this.changeDevtools('POST', appId);
  }
  public async upgradeDevtools(appId = '.'): Promise<DevtoolsInstallStatus> {
    return this.changeDevtools('PUT', appId);
  }
  public async refreshDevtools(appId = '.'): Promise<DevtoolsInstallStatus> {
    return this.changeDevtools('PATCH', appId);
  }
  public async removeDevtools(appId = '.'): Promise<DevtoolsInstallStatus> {
    return this.changeDevtools('DELETE', appId);
  }
  private async changeDevtools(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', appId: string): Promise<DevtoolsInstallStatus> {
    const response = await fetch(`/api/devtools/install?${new URLSearchParams({ app: appId })}`, { method });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `DevTools setup failed: HTTP ${response.status}`);
    return payload;
  }
  public async startElementLocator(): Promise<{ locate: boolean; expiresAt: number }> {
    const response = await fetch('/api/runtime/control', { method: 'POST' });
    if (!response.ok) throw new Error(`Cannot start element locator: HTTP ${response.status}`);
    return response.json();
  }
  public async stopElementLocator(): Promise<void> {
    await fetch('/api/runtime/control', { method: 'DELETE' });
  }
  public async measureBuild(appId = '.'): Promise<{ measured: number }> {
    const response = await fetch(`/api/build-measure?${new URLSearchParams({ app: appId })}`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Build failed: HTTP ${response.status}`);
    return payload;
  }
  public async importWebpackStats(relativePath: string): Promise<{ measured: number }> {
    const response = await fetch('/api/webpack-stats', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relativePath }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Stats import failed: HTTP ${response.status}`);
    return payload;
  }
  public async getGraph(): Promise<GrimoireGraph> {
    const res = await fetch('/api/graph');
    if (!res.ok) {
      throw new Error(`Failed to fetch grimoire graph: HTTP ${res.status}`);
    }
    const graph = (await res.json()) as GrimoireGraph;
    this.projectRoot = graph.projectRoot || this.inferProjectRoot(graph);
    return graph;
  }

  public subscribeEvents(onReload: () => void, onTelemetry?: (event: DevToolsTelemetryEvent | DevToolsTelemetryEvent[]) => void, onScanStatus?: (status: ScanStatus) => void): () => void {
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
      sse.addEventListener('scan-status', (e) => {
        try { onScanStatus?.(JSON.parse((e as MessageEvent).data) as ScanStatus); } catch { /* Ignore malformed status. */ }
      });
      return () => {
        sse.close();
      };
    } catch {
      return () => {};
    }
  }

  public openFileInEditor(filePath: string, line = 1): void {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const isAbsolute = normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath);
    const relativePath = normalizedPath.replace(/^\.\//, '');
    if (!isAbsolute && (relativePath.split('/').includes('..') || !this.projectRoot)) {
      window.alert('Не удалось определить путь проекта. Перезапустите Grimoire и обновите страницу.\nProject path is unavailable. Restart Grimoire and reload the page.');
      return;
    }
    const absolutePath = isAbsolute ? normalizedPath : `${this.projectRoot!.replace(/\\/g, '/').replace(/\/+$/, '')}/${relativePath}`;
    const uriPath = absolutePath.replace(/^\/+/, '').split('/').map((part, index) =>
      index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)
    ).join('/');
    const safeLine = Number.isFinite(line) ? Math.max(1, Math.floor(line)) : 1;
    const vscodeUrl = `vscode://file/${uriPath}:${safeLine}:1`;
    window.open(vscodeUrl, '_blank');
  }
}
