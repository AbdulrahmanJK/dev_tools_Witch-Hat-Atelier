import fs from 'node:fs';
import path from 'node:path';
import { discoverWorkspaceDirectories, type ProjectApplication, type ProjectCapabilities } from '@wha/core';

function readManifest(directory: string): Record<string, any> | null {
  const file = path.join(directory, 'package.json');
  try {
    if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return null; }
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
  for (const directory of discoverWorkspaceDirectories(root)) {
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
