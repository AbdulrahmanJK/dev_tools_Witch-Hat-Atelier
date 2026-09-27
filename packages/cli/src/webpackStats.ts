import fs from 'node:fs';
import path from 'node:path';
import type { DependencySeal } from '@wha/core';

export type LibraryMeasurement = NonNullable<DependencySeal['build']>;
export interface WebpackCompilationChoice { id: string; name: string; target: string; }
export class WebpackCompilationSelectionError extends Error {
  constructor(public readonly compilations: WebpackCompilationChoice[]) {
    super('Stats содержит несколько компиляций. Выберите браузерную компиляцию и повторите импорт.');
  }
}

function packageName(identifier: string): string | null {
  const normalized = identifier.replace(/\\/g, '/').split('?')[0] || '';
  const match = normalized.match(/(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
  return match?.[1] || null;
}

export function importWebpackStats(targetDir: string, relativeFile: string, compilationId?: string): Map<string, LibraryMeasurement> {
  if (!relativeFile || path.isAbsolute(relativeFile) || relativeFile.split(/[\\/]/).includes('..')) {
    throw new Error('Укажите относительный путь к stats.json внутри проекта.');
  }
  const file = path.resolve(targetDir, relativeFile);
  const realRoot = fs.realpathSync(targetDir);
  const realFile = fs.realpathSync(file);
  if (!realFile.startsWith(realRoot + path.sep) || !fs.statSync(realFile).isFile()) {
    throw new Error('Файл stats должен находиться внутри выбранного проекта.');
  }
  const size = fs.statSync(realFile).size;
  if (size > 120 * 1024 * 1024) throw new Error('Файл stats больше 120 МБ. Создайте stats с сокращённым набором полей.');
  const stats = JSON.parse(fs.readFileSync(realFile, 'utf8')) as Record<string, any>;
  const outputs: Array<{ output: Record<string, any>; choice: WebpackCompilationChoice }> = [];
  const collect = (output: Record<string, any>, prefix: string): void => {
    const children = Array.isArray(output.children) ? output.children : [];
    if (!children.length || (output.modules?.length && output.chunks?.length && output.assets?.length)) {
      const target = Array.isArray(output.target) ? output.target.join(', ') : String(output.target || 'unknown');
      outputs.push({ output, choice: { id: prefix || '0', name: String(output.name || output.outputPath || `Compilation ${prefix || '0'}`), target } });
    }
    children.forEach((child: Record<string, any>, index: number) => collect(child, prefix ? `${prefix}.${index}` : String(index)));
  };
  collect(stats, '');
  const chosen = compilationId == null || compilationId === '' ? (() => {
    if (outputs.length === 1) return outputs[0];
    const browser = outputs.filter(({ choice }) => /\b(?:web|webworker|browser|electron-renderer)\b/i.test(choice.target));
    return browser.length === 1 ? browser[0] : undefined;
  })() : outputs.find(({ choice }) => choice.id === compilationId);
  if (!chosen) {
    if (compilationId) throw new Error(`Компиляция ${compilationId} не найдена в stats.`);
    throw new WebpackCompilationSelectionError(outputs.map(({ choice }) => choice));
  }
  const measuredAt = Date.now();
  const result = new Map<string, LibraryMeasurement>();

  for (const output of [chosen.output]) {
    const assets = new Map<string, number>();
    for (const asset of output.assets || []) if (typeof asset.name === 'string' && Number.isFinite(asset.size)) assets.set(asset.name, asset.size);
    const entryChunkIds = new Set<string>();
    for (const entry of Object.values(output.entrypoints || {}) as any[]) for (const id of entry?.chunks || []) entryChunkIds.add(String(id));
    const chunks = new Map<string, { name: string; bytes: number; initial: boolean }>();
    for (const chunk of output.chunks || []) {
      const files = (chunk.files || []).filter((name: string) => /\.m?js(?:$|\?)/.test(name));
      const name = files.join(', ') || String(chunk.id);
      const bytes = files.reduce((sum: number, filename: string) => sum + (assets.get(filename) || 0), 0);
      chunks.set(String(chunk.id), { name, bytes, initial: Boolean(chunk.initial || entryChunkIds.has(String(chunk.id))) });
    }
    const byChunk = new Map<string, Map<string, number>>();
    const totalByChunk = new Map<string, number>();
    const visit = (modules: any[], inheritedChunks: unknown[] = []) => {
      for (const module of modules || []) {
        const moduleChunks = Array.isArray(module.chunks) && module.chunks.length ? module.chunks : inheritedChunks;
        if (Array.isArray(module.modules) && module.modules.length) { visit(module.modules, moduleChunks); continue; }
        const name = packageName(String(module.identifier || module.name || ''));
        const moduleSize = Number(module.size) || 0;
        for (const chunkId of moduleChunks) {
          const key = String(chunkId);
          if (!chunks.has(key)) continue;
          totalByChunk.set(key, (totalByChunk.get(key) || 0) + moduleSize);
          if (!name) continue;
          const libraries = byChunk.get(key) || new Map<string, number>();
          libraries.set(name, (libraries.get(name) || 0) + moduleSize);
          byChunk.set(key, libraries);
        }
      }
    };
    visit(output.modules || []);
    for (const [id, libraries] of byChunk) {
      const chunk = chunks.get(id)!;
      const totalModules = totalByChunk.get(id) || 0;
      // Webpack stats module.size is parsed source, while asset.size includes bundler
      // overhead. Allocate at most the emitted JS size and label it an estimate.
      for (const [name, renderedBytes] of libraries) {
        const previous = result.get(name) || { renderedBytes: 0, emittedBytesEstimate: 0, initial: false, chunks: [], measuredAt, source: 'webpack-stats' as const };
        previous.renderedBytes += renderedBytes;
        previous.emittedBytesEstimate = (previous.emittedBytesEstimate || 0)
          + (totalModules && chunk.bytes ? chunk.bytes * renderedBytes / totalModules : renderedBytes);
        previous.initial ||= chunk.initial;
        if (!previous.chunks.includes(chunk.name)) previous.chunks.push(chunk.name);
        result.set(name, previous);
      }
    }
  }
  if (!result.size) throw new Error('В Webpack stats нет модулей библиотек с привязкой к чанкам. Нужны поля modules, chunks и assets.');
  for (const measurement of result.values()) measurement.configuration = `${relativeFile}#${chosen.choice.id}`;
  return result;
}
