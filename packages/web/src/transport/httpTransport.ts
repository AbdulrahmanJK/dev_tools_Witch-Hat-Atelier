import type { GrimoireGraph } from '@wha/core';
import type { ITransport } from './transport.js';

export class HttpTransport implements ITransport {
  public async getGraph(): Promise<GrimoireGraph> {
    const res = await fetch('/api/graph');
    if (!res.ok) {
      throw new Error(`Failed to fetch grimoire graph: HTTP ${res.status}`);
    }
    return (await res.json()) as GrimoireGraph;
  }

  public subscribeEvents(onReload: () => void): () => void {
    try {
      const sse = new EventSource('/api/events');
      sse.onmessage = (e) => {
        if (e.data === 'reload') {
          onReload();
        }
      };
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
