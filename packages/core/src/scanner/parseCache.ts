import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DetectedEntities } from './detector.js';
import type { StaticFileAnalysis } from './staticLanguages.js';

export interface CachedParse {
  mtimeMs: number;
  size: number;
  loc: number;
  entities: DetectedEntities;
  error: string | null;
  mode: 'complete' | 'partial' | 'unreadable';
  staticAnalysis?: StaticFileAnalysis;
}

const CACHE_VERSION = 2;
const MAX_BYTES = 80 * 1024 * 1024;
function cachePath(projectRoot: string): string {
  const key = createHash('sha256').update(fs.realpathSync(projectRoot)).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), 'grimoire-parse-cache', `${key}.json`);
}

export function readParseCache(projectRoot: string): Record<string, CachedParse> {
  try {
    const file = cachePath(projectRoot);
    if (fs.statSync(file).size > MAX_BYTES) return {};
    const cache = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; entries: Record<string, CachedParse> };
    return cache.version === CACHE_VERSION && cache.entries && typeof cache.entries === 'object' ? cache.entries : {};
  } catch { return {}; }
}

export function writeParseCache(projectRoot: string, entries: Record<string, CachedParse>): void {
  try {
    const file = cachePath(projectRoot);
    const content = JSON.stringify({ version: CACHE_VERSION, entries });
    if (Buffer.byteLength(content) > MAX_BYTES) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* Cache failure must never stop a scan. */ }
}
