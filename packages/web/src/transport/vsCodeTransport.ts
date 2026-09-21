import type { GrimoireGraph } from '@wha/core';
import type { ITransport } from './transport.js';

declare function acquireVsCodeApi(): {
  postMessage: (msg: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

export class VsCodeTransport implements ITransport {
  private vscode: ReturnType<typeof acquireVsCodeApi> | null = null;
  private pendingResolvers: Array<(graph: GrimoireGraph) => void> = [];

  constructor() {
    if (typeof acquireVsCodeApi === 'function') {
      try {
        this.vscode = acquireVsCodeApi();
      } catch {
        // May already have been acquired
      }
    }
  }

  public async getGraph(): Promise<GrimoireGraph> {
    return new Promise((resolve) => {
      this.pendingResolvers.push(resolve);
      if (this.vscode) {
        this.vscode.postMessage({ type: 'REQUEST_GRAPH' });
      }
    });
  }

  public subscribeEvents(onReload: () => void): () => void {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (!message) return;

      if (message.type === 'GRAPH_DATA' && message.graph) {
        while (this.pendingResolvers.length > 0) {
          const resolver = this.pendingResolvers.shift();
          resolver?.(message.graph);
        }
        onReload();
      }
    };

    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
    };
  }

  public openFileInEditor(filePath: string, line = 1): void {
    if (this.vscode) {
      this.vscode.postMessage({
        type: 'OPEN_FILE',
        filePath,
        line,
      });
    } else {
      window.open(`vscode://file/${filePath}:${line}`, '_blank');
    }
  }
}
