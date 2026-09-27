import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { discoverWorkspaceDirectories } from './workspaceDiscovery.js';

interface ResolutionContext {
  directory: string;
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  viteAliases: Map<string, string>;
}

export class AliasResolver {
  private readonly projectRoot: string;
  private readonly workspacePackages = new Map<string, { directory: string; source?: string }>();
  private readonly workspaceDirectories: string[];
  private readonly contextCache = new Map<string, ResolutionContext>();
  private readonly configByDirectory = new Map<string, string | null>();
  private readonly extensions = ['.jsx', '.js', '.tsx', '.ts', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.json'];

  constructor(projectRoot: string) {
    this.projectRoot = path.resolve(projectRoot);
    this.workspaceDirectories = discoverWorkspaceDirectories(this.projectRoot)
      .sort((left, right) => right.length - left.length);
    for (const directory of this.workspaceDirectories) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: string; source?: string };
        if (typeof manifest.name === 'string' && manifest.name) {
          this.workspacePackages.set(manifest.name, { directory, source: manifest.source });
        }
      } catch { /* Missing manifests do not declare source aliases. */ }
    }
  }

  private insideRoot(file: string): boolean {
    return file === this.projectRoot || file.startsWith(this.projectRoot + path.sep);
  }

  private scopeFor(file: string): string {
    return this.workspaceDirectories.find((directory) => file === directory || file.startsWith(directory + path.sep))
      || this.projectRoot;
  }

  private workspaceFor(specifier: string): { name: string; directory: string; source?: string } | null {
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
    const workspace = this.workspacePackages.get(name);
    return workspace ? { name, ...workspace } : null;
  }

  private nearestConfig(file: string): string | null {
    let directory = path.dirname(file);
    const checked: string[] = [];
    let found: string | null = null;
    while (this.insideRoot(directory)) {
      if (this.configByDirectory.has(directory)) {
        found = this.configByDirectory.get(directory)!;
        break;
      }
      checked.push(directory);
      for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const candidate = path.join(directory, name);
        if (fs.existsSync(candidate)) { found = candidate; break; }
      }
      if (found || directory === this.projectRoot) break;
      directory = path.dirname(directory);
    }
    for (const item of checked) this.configByDirectory.set(item, found);
    return found;
  }

  private loadViteAliases(directory: string): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const name of ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs']) {
      try {
        const content = fs.readFileSync(path.join(directory, name), 'utf8');
        const block = content.match(/alias\s*:\s*\{([^}]+)\}/s)?.[1];
        if (!block) continue;
        const expression = /['"]?([a-zA-Z0-9_\-@]+)['"]?\s*:\s*(?:path\.resolve\([^,]+,\s*['"]([^'"]+)['"]\)|['"]([^'"]+)['"])/g;
        for (const match of block.matchAll(expression)) {
          const key = match[1];
          const target = match[2] || match[3];
          if (key && target) aliases.set(key, path.resolve(directory, target));
        }
      } catch { /* Vite config is optional. */ }
    }
    return aliases;
  }

  private contextFor(file: string): ResolutionContext {
    const config = this.nearestConfig(file);
    const scope = this.scopeFor(file);
    const key = `${config || ''}\0${scope}`;
    const cached = this.contextCache.get(key);
    if (cached) return cached;
    let options: ts.CompilerOptions = {};
    if (config) {
      const read = ts.readConfigFile(config, ts.sys.readFile);
      if (!read.error) {
        // Resolve extends without enumerating all source files in a large project.
        const parsed = ts.parseJsonConfigFileContent(read.config, {
          useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
          readDirectory: () => [],
          fileExists: ts.sys.fileExists,
          readFile: ts.sys.readFile,
        }, path.dirname(config), undefined, config);
        options = parsed.options;
      }
    }
    const context: ResolutionContext = {
      directory: scope,
      options,
      cache: ts.createModuleResolutionCache(scope, (fileName) => ts.sys.useCaseSensitiveFileNames ? fileName : fileName.toLowerCase(), options),
      viteAliases: this.loadViteAliases(scope),
    };
    this.contextCache.set(key, context);
    return context;
  }

  private resolveConfiguredAlias(specifier: string, context: ResolutionContext): string | null {
    const paths: Record<string, string[]> = context.options.paths || {};
    const base = typeof context.options.pathsBasePath === 'string'
      ? context.options.pathsBasePath : context.options.baseUrl || context.directory;
    const matches: { key: string; target: string }[] = [];
    for (const [key, targets] of Object.entries(paths)) {
      const star = key.indexOf('*');
      const prefix = star < 0 ? key : key.slice(0, star);
      const suffix = star < 0 ? '' : key.slice(star + 1);
      if (star < 0 ? specifier !== key : !specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      const captured = star < 0 ? '' : specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const target of targets) matches.push({ key, target: path.resolve(base, target.replace('*', captured)) });
    }
    matches.sort((left, right) => right.key.length - left.key.length);
    for (const match of matches) {
      const found = this.findExistingFile(match.target);
      if (found && this.insideRoot(found)) return found;
    }
    return null;
  }

  public isProjectImport(specifier: string, currentFilePath: string): boolean {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) return true;
    if (specifier.startsWith('@/') || specifier.startsWith('~/')) return true;
    if (this.workspaceFor(specifier)) return true;
    const context = this.contextFor(path.resolve(currentFilePath));
    if ([...context.viteAliases.keys()].some((key) => specifier === key || specifier.startsWith(key + '/'))) return true;
    return Object.keys(context.options.paths || {}).some((key) => {
      const star = key.indexOf('*');
      return star < 0 ? specifier === key
        : specifier.startsWith(key.slice(0, star)) && specifier.endsWith(key.slice(star + 1));
    });
  }

  public resolve(importPath: string, currentFilePath: string): string | null {
    if (!importPath || typeof importPath !== 'string') return null;
    const file = path.resolve(currentFilePath);
    if (!this.insideRoot(file)) return null;
    if (importPath.startsWith('.')) {
      const target = path.resolve(path.dirname(file), importPath);
      return this.insideRoot(target) ? this.findExistingFile(target) : null;
    }

    // Workspace source is preferred when exports point at an unscanned build artifact.
    const workspace = this.workspaceFor(importPath);
    if (workspace) {
      const name = workspace.name;
      const subPath = importPath === name ? '' : importPath.slice(name.length + 1);
      const candidates = subPath
        ? [path.join(workspace.directory, 'src', subPath), path.join(workspace.directory, subPath)]
        : [path.join(workspace.directory, 'src', 'index'), path.join(workspace.directory, 'src', 'main'),
          workspace.source ? path.resolve(workspace.directory, workspace.source) : '', path.join(workspace.directory, 'index')];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const found = this.findExistingFile(candidate);
        if (found) return found;
      }
    }

    const context = this.contextFor(file);
    const alias = this.resolveConfiguredAlias(importPath, context);
    if (alias) return alias;
    for (const [key, target] of [...context.viteAliases].sort((left, right) => right[0].length - left[0].length)) {
      if (importPath === key || importPath.startsWith(key + '/')) {
        const found = this.findExistingFile(path.join(target, importPath.slice(key.length)));
        if (found && this.insideRoot(found)) return found;
      }
    }
    if (importPath.startsWith('@/')) {
      const found = this.findExistingFile(path.join(context.directory, 'src', importPath.slice(2)));
      if (found && this.insideRoot(found)) return found;
    }
    const resolved = ts.resolveModuleName(importPath, file, context.options, ts.sys, context.cache).resolvedModule?.resolvedFileName;
    if (resolved && this.insideRoot(resolved) && !resolved.split(path.sep).includes('node_modules')) {
      return this.findExistingFile(resolved);
    }
    for (const base of [context.options.baseUrl, path.join(context.directory, 'src')]) {
      if (!base) continue;
      const found = this.findExistingFile(path.resolve(base, importPath));
      if (found && this.insideRoot(found)) return found;
    }
    return null;
  }

  public findExistingFile(basePath: string): string | null {
    if (fs.existsSync(basePath)) {
      const stat = fs.statSync(basePath);
      if (stat.isFile()) return basePath;
      if (stat.isDirectory()) {
        for (const ext of this.extensions) {
          const indexFile = path.join(basePath, 'index' + ext);
          if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) return indexFile;
        }
      }
    }
    const extension = path.extname(basePath).toLowerCase();
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
      const stem = basePath.slice(0, -extension.length);
      const sourceExtensions = extension === '.jsx' ? ['.tsx', '.ts']
        : extension === '.mjs' ? ['.mts', '.ts']
          : extension === '.cjs' ? ['.cts', '.ts'] : ['.ts', '.tsx', '.jsx'];
      for (const sourceExtension of sourceExtensions) {
        const candidate = stem + sourceExtension;
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      }
    }
    for (const ext of this.extensions) {
      const candidate = basePath + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    for (const ext of this.extensions) {
      const candidate = path.join(basePath, 'index' + ext);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }
}
