import fs from 'node:fs';
import path from 'node:path';
import type { ProjectApplication, ProjectCapabilities } from '@wha/core';

function readManifest(directory: string): Record<string, any> | null {
  const file = path.join(directory, 'package.json');
  try {
    if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
}

function workspaceDirectories(root: string, manifest: Record<string, any>): string[] {
  const declared: unknown = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
  const patterns = new Set<string>(Array.isArray(declared) ? declared.filter((pattern): pattern is string => typeof pattern === 'string') : []);
  try {
    const workspaceYaml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    let inPackages = false;
    for (const line of workspaceYaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
      if (/^[^\s#-][^:]*:/.test(line)) inPackages = false;
      if (!inPackages) continue;
      const match = /^\s+-\s+(['"]?)([^'"#]+?)\1\s*(?:#.*)?$/.exec(line);
      if (match) patterns.add(match[2]!.trim());
    }
  } catch { /* pnpm workspaces are optional. */ }
  const result = new Set<string>([root]);
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.startsWith('!') || pattern.includes('**')) continue;
    const segments = pattern.split('/').filter(Boolean);
    let current = [root];
    for (const segment of segments) {
      const next: string[] = [];
      for (const directory of current) {
        if (segment === '*') {
          try {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
              if (entry.isDirectory() && !entry.name.startsWith('.')) next.push(path.join(directory, entry.name));
            }
          } catch { /* A workspace may not be checked out. */ }
        } else if (!segment.includes('*')) next.push(path.join(directory, segment));
      }
      current = next.slice(0, 1000);
    }
    for (const directory of current) {
      try {
        const realRoot = fs.realpathSync(root);
        const realDirectory = fs.realpathSync(directory);
        if ((realDirectory === realRoot || realDirectory.startsWith(realRoot + path.sep)) && readManifest(directory)) result.add(directory);
      } catch { /* Ignore missing or external workspace directories. */ }
    }
  }
  return [...result];
}

function entriesFor(root: string, directory: string): string[] {
  const candidates = ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
    'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
    'client/index.tsx', 'client/index.jsx', 'client/index.ts', 'client/index.js'];
  return candidates.filter((relative) => {
    const full = path.join(directory, relative);
    try { return fs.statSync(full).isFile() && !fs.lstatSync(full).isSymbolicLink(); }
    catch { return false; }
  }).map((relative) => path.relative(root, path.join(directory, relative)).replace(/\\/g, '/'));
}

export function detectProjectCapabilities(root: string): ProjectCapabilities {
  const manifest = readManifest(root) || {};
  const packageManager = typeof manifest.packageManager === 'string' ? manifest.packageManager.split('@')[0] || 'unknown'
    : fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm'
      : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn'
        : fs.existsSync(path.join(root, 'package-lock.json')) ? 'npm' : 'unknown';
  const applications: ProjectApplication[] = [];
  for (const directory of workspaceDirectories(root, manifest)) {
    const item = readManifest(directory);
    if (!item) continue;
    const dependencies = { ...item.dependencies, ...item.devDependencies };
    const scripts = item.scripts || {};
    const devScripts = Object.entries(scripts).filter(([name, command]) =>
      typeof command === 'string' && /^(dev|start|serve|watch)(:|$)/.test(name))
      .map(([name, command]) => ({ name, command: String(command) }));
    const statsScripts = Object.entries(scripts).filter(([name, command]) =>
      typeof command === 'string' && /stats/i.test(name))
      .map(([name, command]) => ({ name, command: String(command) }));
    const viteCommand = devScripts.some(({ command }) => /\bvite\b/.test(command));
    const webpackCommand = devScripts.some(({ command }) => /\bwebpack\b|\bvue-cli-service\b|\breact-scripts\b/.test(command));
    const bundler = webpackCommand && !viteCommand ? 'webpack'
      : viteCommand && !webpackCommand ? 'vite'
        : viteCommand && webpackCommand ? 'other'
          : dependencies.vite && !dependencies.webpack ? 'vite'
            : dependencies.webpack || dependencies['@vue/cli-service'] || dependencies['react-scripts'] ? 'webpack'
              : devScripts.length ? 'other' : 'unknown';
    const react = Boolean(dependencies.react || dependencies['react-dom']);
    const vue = Boolean(dependencies.vue);
    const framework = react && vue ? 'mixed' : react ? 'react' : vue ? 'vue' : 'unknown';
    if (directory !== root && !devScripts.length && bundler === 'unknown') continue;
    applications.push({ id: path.relative(root, directory).replace(/\\/g, '/') || '.', name: item.name || path.basename(directory),
      directory: path.relative(root, directory).replace(/\\/g, '/') || '.', bundler, framework, devScripts, statsScripts,
      entries: entriesFor(root, directory) });
  }
  const statsCandidates = new Set<string>();
  for (const app of applications) for (const relative of ['stats.json', 'client/stats.json', 'dist/stats.json', 'build/stats.json']) {
    const candidate = path.join(app.directory, relative).replace(/\\/g, '/');
    try { if (fs.statSync(path.join(root, candidate)).isFile()) statsCandidates.add(candidate); }
    catch { /* No existing stats file. */ }
  }
  return { packageManager: ['pnpm', 'yarn', 'npm'].includes(packageManager) ? packageManager as ProjectCapabilities['packageManager'] : 'unknown',
    applications, buildMeasurement: applications.some((app) => app.bundler === 'vite') ? 'vite'
      : applications.some((app) => app.bundler === 'webpack') ? 'webpack-stats' : 'unavailable',
    scanLanguages: ['javascript', 'typescript', 'vue', 'go', 'java', 'kotlin', 'csharp'], existingStatsFiles: [...statsCandidates] };
}
