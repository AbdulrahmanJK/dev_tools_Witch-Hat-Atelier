import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

type Measurement = {
  renderedBytes: number;
  emittedBytesEstimate: number;
  initial: boolean;
  chunks: string[];
  measuredAt: number;
  source: 'vite';
  configuration: string;
};

const appDirectory = process.env.GRIMOIRE_VITE_APP_DIRECTORY;
const configuration = process.env.GRIMOIRE_VITE_CONFIGURATION;
if (!appDirectory || !configuration) throw new Error('Missing Vite measurement target.');

function report(phase: string, message: string): void {
  process.send?.({ type: 'progress', phase, message });
}

async function main(): Promise<void> {
  report('loading', 'Loading the application Vite configuration');
  const requireFromTarget = createRequire(path.join(appDirectory!, 'package.json'));
  let vitePath: string;
  try {
    const manifestPath = requireFromTarget.resolve('vite/package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = manifest.exports?.['.']?.import || manifest.module || manifest.main;
    vitePath = entry ? path.resolve(path.dirname(manifestPath), entry) : requireFromTarget.resolve('vite');
  } catch {
    throw new Error('Vite is not installed in the selected application.');
  }
  const viteModule = await import(pathToFileURL(vitePath).href);
  const vite = viteModule.build ? viteModule : viteModule.default;
  if (typeof vite.build !== 'function') throw new Error('Cannot load the application Vite build API.');

  const measurements = new Map<string, Measurement>();
  const measuredAt = Date.now();
  const plugin = {
    name: 'grimoire-dependency-measurement',
    configResolved(config: { build: { write: boolean; emptyOutDir: boolean } }) {
      if (config.build.write !== false || config.build.emptyOutDir !== false) {
        throw new Error('The Vite configuration did not preserve the non-writing measurement mode.');
      }
    },
    generateBundle(_options: unknown, bundle: Record<string, any>) {
      report('measuring', 'Attributing emitted JavaScript chunks');
      const initialChunks = new Set<string>();
      const visit = (chunkName: string) => {
        if (initialChunks.has(chunkName)) return;
        initialChunks.add(chunkName);
        const chunk = bundle[chunkName];
        if (chunk?.type === 'chunk') for (const imported of chunk.imports || []) visit(imported);
      };
      for (const [chunkName, output] of Object.entries(bundle)) {
        if (output.type === 'chunk' && output.isEntry) visit(chunkName);
      }
      for (const [chunkName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        const modules = Object.entries(output.modules || {}) as Array<[string, { renderedLength?: number }]>;
        const totalRendered = modules.reduce((sum, [, details]) => sum + (details.renderedLength || 0), 0);
        const emittedChunkBytes = Buffer.byteLength(output.code || '', 'utf8');
        for (const [moduleId, details] of modules) {
          const normalized = moduleId.replace(/\\/g, '/');
          const match = normalized.match(/\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
          if (!match) continue;
          const name = match[1]!;
          const value: Measurement = measurements.get(name) || {
            renderedBytes: 0, emittedBytesEstimate: 0, initial: false, chunks: [], measuredAt,
            source: 'vite', configuration: configuration!,
          };
          value.renderedBytes += details.renderedLength || 0;
          value.emittedBytesEstimate += totalRendered ? emittedChunkBytes * (details.renderedLength || 0) / totalRendered : 0;
          value.initial ||= initialChunks.has(chunkName);
          if (!value.chunks.includes(chunkName)) value.chunks.push(chunkName);
          measurements.set(name, value);
        }
      }
    },
  };

  report('building', 'Building in memory; Vite output writing is disabled');
  await vite.build({
    root: appDirectory,
    plugins: [plugin],
    build: { write: false, emptyOutDir: false, copyPublicDir: false },
  });
  process.send?.({ type: 'complete', measurements: [...measurements] }, () => process.disconnect?.());
}

void main().catch((error) => {
  process.send?.({ type: 'error', error: error instanceof Error ? error.stack || error.message : String(error) }, () => process.disconnect?.());
  process.exitCode = 1;
});
