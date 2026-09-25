import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { GrimoireGraph, RawGraphData, SealNode } from '@wha/core';

const VERSION = 3;
const MAX_CACHE_BYTES = 100 * 1024 * 1024;
type NodePosition = Pick<SealNode, 'id' | 'x' | 'y' | 'realisticLayout' | 'consumers' | 'reuseCount' | 'isSharedHub'>;
type LayoutSnapshot = Pick<GrimoireGraph, 'clusters' | 'bounds'> & {
  nodes: NodePosition[];
  dependencies: Array<{ name: string; x: number; y: number; radius: number }>;
};
function cacheFile(root: string): string {
  const key = createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), 'grimoire-layout-cache', `${key}.json`);
}

export function layoutFingerprint(graph: RawGraphData): string {
  const hash = createHash('sha256');
  hash.update(`layout:${VERSION}\n`);
  for (const node of graph.nodes) {
    const { devTools: _devTools, ...metrics } = node.metrics;
    hash.update(JSON.stringify({ id: node.id, name: node.name, file: node.file, cluster: node.cluster,
      loc: node.loc, kind: node.kind, metrics, internalCircuit: node.internalCircuit, hooks: node.hooks,
      children: node.children }));
  }
  for (const edge of graph.edges) hash.update(JSON.stringify(edge));
  for (const cluster of graph.clusters) hash.update(JSON.stringify(cluster));
  for (const dependency of graph.dependencies || []) hash.update(JSON.stringify({ name: dependency.name, radius: dependency.radius }));
  return hash.digest('hex');
}

export function readLayoutCache(root: string, fingerprint: string, graph: RawGraphData): GrimoireGraph | null {
  try {
    const file = cacheFile(root);
    if (fs.statSync(file).size > MAX_CACHE_BYTES) return null;
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; fingerprint: string; layout: LayoutSnapshot };
    if (cached.version !== VERSION || cached.fingerprint !== fingerprint || !Array.isArray(cached.layout?.nodes)
      || !Array.isArray(cached.layout?.clusters) || !Array.isArray(cached.layout?.dependencies)) return null;
    if (cached.layout.nodes.length !== graph.nodes.length || cached.layout.dependencies.length !== (graph.dependencies || []).length) return null;
    const rawNodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const nodes = cached.layout.nodes.map((position) => {
      const node = rawNodes.get(position.id);
      return node ? { ...node, ...position } : null;
    });
    if (nodes.some((node) => !node)) return null;
    const dependencies = (graph.dependencies || []).map((dependency, index) => {
      const position = cached.layout.dependencies[index];
      return position?.name === dependency.name ? { ...dependency, x: position.x, y: position.y } : null;
    });
    if (dependencies.some((dependency) => !dependency)) return null;
    return { nodes: nodes as SealNode[], edges: graph.edges, clusters: cached.layout.clusters,
      dependencies: dependencies as NonNullable<GrimoireGraph['dependencies']>, bounds: cached.layout.bounds,
      stats: graph.stats, diagnostics: graph.diagnostics };
  } catch { return null; }
}

export function writeLayoutCache(root: string, fingerprint: string, layout: GrimoireGraph): void {
  try {
    const file = cacheFile(root);
    const snapshot: LayoutSnapshot = {
      nodes: layout.nodes.map((node) => ({ id: node.id, x: node.x, y: node.y,
        realisticLayout: node.realisticLayout, consumers: node.consumers, reuseCount: node.reuseCount,
        isSharedHub: node.isSharedHub })),
      clusters: layout.clusters, bounds: layout.bounds,
      dependencies: (layout.dependencies || []).map(({ name, x, y, radius }) => ({ name, x, y, radius })),
    };
    const content = JSON.stringify({ version: VERSION, fingerprint, layout: snapshot });
    if (Buffer.byteLength(content) > MAX_CACHE_BYTES) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* Layout cache is optional. */ }
}
