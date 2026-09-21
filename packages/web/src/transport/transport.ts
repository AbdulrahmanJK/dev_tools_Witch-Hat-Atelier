import type { GrimoireGraph } from '@wha/core';

export interface ITransport {
  getGraph(): Promise<GrimoireGraph>;
  subscribeEvents(onReload: () => void): () => void;
  openFileInEditor(filePath: string, line?: number): void;
}
