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

const CACHE_VERSION = 5;
const CACHE_SHARDS = 64;
function cacheDirectory(projectRoot: string): string {
  const key = createHash('sha256').update(fs.realpathSync(projectRoot)).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), 'grimoire-parse-cache', `${key}-v${CACHE_VERSION}`);
}

function shardFor(relativePath: string): number {
  let hash = 2166136261;
  for (let index = 0; index < relativePath.length; index++) {
    hash ^= relativePath.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % CACHE_SHARDS;
}

export function readParseCache(projectRoot: string): Record<string, CachedParse> {
  const entries: Record<string, CachedParse> = {};
  try {
    const directory = cacheDirectory(projectRoot);
    for (let shard = 0; shard < CACHE_SHARDS; shard++) {
      try {
        const cache = JSON.parse(fs.readFileSync(path.join(directory, `${shard}.json`), 'utf8')) as {
          version: number; entries: Record<string, CachedParse>;
        };
        if (cache.version === CACHE_VERSION && cache.entries && typeof cache.entries === 'object') {
          Object.assign(entries, cache.entries);
        }
      } catch { /* One missing or damaged shard does not invalidate the others. */ }
    }
  } catch { /* No cache is available for this project. */ }
  return entries;
}

export function writeParseCache(projectRoot: string, entries: Record<string, CachedParse>): void {
  try {
    const directory = cacheDirectory(projectRoot);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const shards = Array.from({ length: CACHE_SHARDS }, () => ({} as Record<string, CachedParse>));
    for (const [relativePath, entry] of Object.entries(entries)) {
      shards[shardFor(relativePath)]![relativePath] = entry;
    }
    for (let shard = 0; shard < CACHE_SHARDS; shard++) {
      try {
        const file = path.join(directory, `${shard}.json`);
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ version: CACHE_VERSION, entries: shards[shard] }), { mode: 0o600 });
        fs.renameSync(temporary, file);
      } catch { /* Other shards are still useful on the next scan. */ }
    }
  } catch { /* Cache failure must never stop a scan. */ }
}
