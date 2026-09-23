import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import type { DependencySeal } from '../types/index.js';
import type { DetectedEntities } from './detector.js';
import type { AliasResolver } from './aliasResolver.js';

export function packageNameFromImport(source: string): string | null {
  if (builtinModules.includes(source) || builtinModules.includes(source.replace(/^node:/, ''))) return null;
  if (!source || source.startsWith('.') || source.startsWith('/') || source.startsWith('node:') || source.startsWith('#') || source.startsWith('@/') || source.startsWith('~/') || source.includes(':')) return null;
  if (source.startsWith('@')) {
    const parts = source.split('/');
    return parts.length >= 2 ? parts.slice(0, 2).join('/') : null;
  }
  return source.split('/')[0] || null;
}

export function collectDependencySeals(
  root: string,
  files: Map<string, { entities: DetectedEntities }>,
  fileToNodeIds: Map<string, string[]>,
  resolver: AliasResolver
): DependencySeal[] {
  const manifests = new Map<string, Record<string, string>>();
  const seals = new Map<string, DependencySeal>();
  const dependenciesFor = (filePath: string): Record<string, string> => {
    let directory = path.dirname(filePath);
    const declared: Record<string, string> = {};
    while (directory === root || directory.startsWith(root + path.sep)) {
      const manifest = path.join(directory, 'package.json');
      if (fs.existsSync(manifest)) {
        let dependencies = manifests.get(manifest);
        if (!dependencies) {
          try {
            const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
            dependencies = { ...parsed.peerDependencies, ...parsed.devDependencies, ...parsed.dependencies } as Record<string, string>;
            manifests.set(manifest, dependencies);
          } catch { dependencies = {}; }
        }
        if (dependencies) for (const [name, version] of Object.entries(dependencies)) {
          if (!(name in declared)) declared[name] = version;
        }
      }
      if (directory === root) break;
      directory = path.dirname(directory);
    }
    return declared;
  };

  for (const [filePath, data] of files) {
    const declared = dependenciesFor(filePath);
    for (const item of data.entities.imports) {
      const resolved = resolver.resolve(item.source, filePath);
      if (resolved && files.has(resolved)) continue;
      const name = packageNameFromImport(item.source);
      if (!name || name.startsWith('@types/')) continue;
      let seal = seals.get(name);
      if (!seal) {
        seal = {
          id: 'dependency:' + name,
          name,
          version: declared[name] || null,
          direct: Boolean(declared[name]),
          importerNodeIds: [],
          importCount: 0,
          dynamicImportCount: 0,
          sourceRisk: 'unknown',
          x: 0, y: 0, radius: 28,
        };
        seals.set(name, seal);
      }
      seal.importCount++;
      if (item.dynamic) seal.dynamicImportCount++;
      for (const nodeId of fileToNodeIds.get(filePath) || []) {
        if (!seal.importerNodeIds.includes(nodeId)) seal.importerNodeIds.push(nodeId);
      }
      if (!seal.version && declared[name]) seal.version = declared[name];
      if (declared[name]) seal.direct = true;
    }
  }
  for (const seal of seals.values()) {
    const count = seal.importerNodeIds.length;
    seal.sourceRisk = count >= 12 ? 'high' : count >= 4 ? 'medium' : 'low';
    seal.radius = Math.min(44, 24 + Math.sqrt(count) * 5);
  }
  return [...seals.values()].sort((a, b) => b.importerNodeIds.length - a.importerNodeIds.length || a.name.localeCompare(b.name));
}
