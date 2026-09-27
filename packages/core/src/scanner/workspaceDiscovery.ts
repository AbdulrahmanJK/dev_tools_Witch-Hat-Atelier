import fs from 'node:fs';
import path from 'node:path';

const ignoredDirectories = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.pnpm', '.yarn', '.next', '.nuxt',
  '.turbo', 'dist', 'build', 'coverage', 'target',
]);

function workspacePatterns(root: string): string[] {
  const patterns: string[] = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
    };
    const declared = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
    if (Array.isArray(declared)) patterns.push(...declared.filter((item): item is string => typeof item === 'string'));
  } catch { /* A workspace manifest is optional. */ }
  try {
    const yaml = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    let inPackages = false;
    for (const line of yaml.split(/\r?\n/)) {
      if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
      if (/^[^\s#-][^:]*:/.test(line)) inPackages = false;
      if (!inPackages) continue;
      const match = /^\s+-\s+(['"]?)([^'"#]+?)\1\s*(?:#.*)?$/.exec(line);
      if (match) patterns.push(match[2]!.trim());
    }
  } catch { /* pnpm workspaces are optional. */ }
  return [...new Set(patterns.map((item) => item.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')).filter(Boolean))];
}

function globExpression(pattern: string): RegExp {
  let expression = '^';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { expression += '(?:.*/)?'; index += 2; }
      else { expression += '.*'; index++; }
    } else if (character === '*') expression += '[^/]*';
    else if (character === '?') expression += '[^/]';
    else if (character === '{') {
      const end = pattern.indexOf('}', index + 1);
      if (end > index) {
        const alternatives = pattern.slice(index + 1, end).split(',')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        expression += `(?:${alternatives.join('|')})`;
        index = end;
      } else expression += '\\{';
    } else expression += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(expression + '$');
}

/** Enumerate declared workspace packages without silently capping large monorepos. */
export function discoverWorkspaceDirectories(projectRoot: string): string[] {
  const root = path.resolve(projectRoot);
  const patterns = workspacePatterns(root);
  const positive = patterns.filter((item) => !item.startsWith('!')).map(globExpression);
  const negative = patterns.filter((item) => item.startsWith('!')).map((item) => globExpression(item.slice(1)));
  const firstSegments = patterns.filter((item) => !item.startsWith('!')).map((item) => item.split('/')[0]!);
  const restrictRoot = firstSegments.every((segment) => !/[?*{]/.test(segment));
  const rootCandidates = new Set(positive.length ? firstSegments : ['packages', 'apps', 'libs', 'modules']);
  const result = [root];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { continue; }
    if (directory !== root && entries.some((entry) => entry.name === 'package.json' && entry.isFile())) {
      const relative = path.relative(root, directory).replace(/\\/g, '/');
      const conventional = /^(?:packages|apps|libs|modules)\/[^/]+$/.test(relative);
      if ((positive.length ? positive.some((matcher) => matcher.test(relative)) : conventional)
        && !negative.some((matcher) => matcher.test(relative))) result.push(directory);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || ignoredDirectories.has(entry.name)) continue;
      if (directory === root && restrictRoot && !rootCandidates.has(entry.name)) continue;
      stack.push(path.join(directory, entry.name));
    }
  }
  return result;
}
