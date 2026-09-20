import fs from 'node:fs';
import path from 'node:path';

export class AliasResolver {
  constructor(projectRoot) {
    this.projectRoot = path.resolve(projectRoot);
    this.aliases = new Map();
    this.baseUrl = null;
    this.extensions = ['.jsx', '.js', '.tsx', '.ts', '.mjs', '.json'];
    this.init();
  }

  init() {
    this.loadJsConfig();
    this.loadViteConfig();

    // Sensible defaults if src exists
    const srcDir = path.join(this.projectRoot, 'src');
    if (fs.existsSync(srcDir)) {
      if (!this.aliases.has('@')) {
        this.aliases.set('@', srcDir);
      }
      if (!this.baseUrl) {
        this.baseUrl = srcDir;
      }
    }
  }

  loadJsConfig() {
    for (const name of ['jsconfig.json', 'tsconfig.json']) {
      const p = path.join(this.projectRoot, name);
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8');
          // Strip comments
          const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
          const config = JSON.parse(cleaned);
          const compilerOptions = config.compilerOptions || {};

          if (compilerOptions.baseUrl) {
            this.baseUrl = path.resolve(this.projectRoot, compilerOptions.baseUrl);
          }

          if (compilerOptions.paths) {
            for (const [key, targets] of Object.entries(compilerOptions.paths)) {
              if (Array.isArray(targets) && targets.length > 0) {
                const cleanKey = key.replace(/\/\*$/, '');
                const cleanTarget = targets[0].replace(/\/\*$/, '');
                const targetPath = this.baseUrl
                  ? path.resolve(this.baseUrl, cleanTarget)
                  : path.resolve(this.projectRoot, cleanTarget);
                this.aliases.set(cleanKey, targetPath);
              }
            }
          }
        } catch (err) {
          // Ignore JSON parse errors
        }
      }
    }
  }

  loadViteConfig() {
    for (const name of ['vite.config.js', 'vite.config.mjs', 'vite.config.ts']) {
      const p = path.join(this.projectRoot, name);
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8');
          // Find the alias object specifically
          const aliasBlockMatch = content.match(/alias\s*:\s*\{([^}]+)\}/s);
          if (aliasBlockMatch) {
            const aliasBlock = aliasBlockMatch[1];
            const regex = /['"]?([a-zA-Z0-9_\-@]+)['"]?\s*:\s*(?:path\.resolve\([^,]+,\s*['"]([^'"]+)['"]\)|['"]([^'"]+)['"])/g;
            let match;
            while ((match = regex.exec(aliasBlock)) !== null) {
              const aliasKey = match[1];
              const relativeTarget = match[2] || match[3];
              if (aliasKey && relativeTarget && !['react', 'react-dom', 'react-slick'].includes(aliasKey)) {
                const absTarget = path.resolve(this.projectRoot, relativeTarget);
                this.aliases.set(aliasKey, absTarget);
              }
            }
          }
        } catch (err) {
          // Ignore
        }
      }
    }
  }

  resolve(importPath, currentFilePath) {
    if (!importPath || typeof importPath !== 'string') return null;

    // 1. Relative imports
    if (importPath.startsWith('.')) {
      const dir = path.dirname(currentFilePath);
      const target = path.resolve(dir, importPath);
      return this.findExistingFile(target);
    }

    // 2. Exact or prefix alias matches (sort by key length descending to match longest first)
    const sortedAliases = Array.from(this.aliases.entries()).sort(
      (a, b) => b[0].length - a[0].length
    );

    for (const [aliasKey, targetDir] of sortedAliases) {
      if (importPath === aliasKey) {
        const found = this.findExistingFile(targetDir);
        if (found) return found;
      } else if (importPath.startsWith(aliasKey + '/')) {
        const subPath = importPath.slice(aliasKey.length + 1);
        const target = path.join(targetDir, subPath);
        const found = this.findExistingFile(target);
        if (found) return found;
      }
    }

    // 3. Check relative to baseUrl (e.g. baseUrl: "src")
    if (this.baseUrl) {
      const target = path.resolve(this.baseUrl, importPath);
      const found = this.findExistingFile(target);
      if (found) return found;
    }

    // 4. Check if it's a direct file under projectRoot/src
    const srcTarget = path.resolve(this.projectRoot, 'src', importPath);
    const srcFound = this.findExistingFile(srcTarget);
    if (srcFound) return srcFound;

    // It's likely a node_modules dependency
    return null;
  }

  findExistingFile(basePath) {
    // If exact file exists and is not a directory
    if (fs.existsSync(basePath)) {
      const stat = fs.statSync(basePath);
      if (stat.isFile()) return basePath;
      if (stat.isDirectory()) {
        for (const ext of this.extensions) {
          const indexFile = path.join(basePath, 'index' + ext);
          if (fs.existsSync(indexFile) && fs.statSync(indexFile).isFile()) {
            return indexFile;
          }
        }
      }
    }

    // Try extensions
    for (const ext of this.extensions) {
      const candidate = basePath + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    // Try index files
    for (const ext of this.extensions) {
      const candidate = path.join(basePath, 'index' + ext);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }

    return null;
  }
}
