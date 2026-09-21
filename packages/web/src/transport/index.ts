import type { ITransport } from './transport.js';
import { HttpTransport } from './httpTransport.js';
import { VsCodeTransport } from './vsCodeTransport.js';

export * from './transport.js';
export * from './httpTransport.js';
export * from './vsCodeTransport.js';
export * from './mockTransport.js';

export function createDefaultTransport(): ITransport {
  if (typeof (window as any).acquireVsCodeApi === 'function') {
    return new VsCodeTransport();
  }
  return new HttpTransport();
}
