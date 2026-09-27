import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DetectedEntities } from './detector.js';

export interface FrameworkDetection {
  framework: 'react' | 'vue' | 'none';
  version?: string;
  confidence: 'high' | 'medium' | 'low';
}

interface PackageVersions {
  react?: string;
  vue?: string;
  directory?: string;
}

export class FrameworkDetector {
  private readonly root: string;
  private readonly manifests = new Map<string, PackageVersions>();
  private readonly contextByDirectory = new Map<string, PackageVersions>();
  private readonly installedVersions = new Map<string, string | undefined>();

  constructor(projectRoot: string) {
    this.root = path.resolve(projectRoot);
  }

  public detect(filePath: string, entities: DetectedEntities): FrameworkDetection {
    const ext = path.extname(filePath).toLowerCase();
    const versions = this.nearestManifest(filePath);
    const imports = entities.imports.map((item) => item.source);
    const importsVue = imports.some((source) => source === 'vue' || source.startsWith('vue/'));
    const importsReact = imports.some(
      (source) => source === 'react' || source.startsWith('react/') || source === 'react-dom'
    );

    if (ext === '.vue' || importsVue) {
      return { framework: 'vue', version: this.versionFor(filePath, 'vue', versions), confidence: 'high' };
    }
    if (importsReact) {
      return { framework: 'react', version: this.versionFor(filePath, 'react', versions), confidence: 'high' };
    }
    if (entities.hasJsx && versions.react && !versions.vue) {
      return { framework: 'react', version: this.versionFor(filePath, 'react', versions), confidence: 'medium' };
    }
    if (entities.hasJsx && versions.vue && !versions.react) {
      return { framework: 'vue', version: this.versionFor(filePath, 'vue', versions), confidence: 'medium' };
    }
    if (entities.hasJsx && !versions.vue) {
      return { framework: 'react', version: this.versionFor(filePath, 'react', versions), confidence: 'low' };
    }
    return { framework: 'none', confidence: 'low' };
  }

  private versionFor(filePath: string, framework: 'react' | 'vue', versions: PackageVersions): string | undefined {
    const directory = versions.directory || path.dirname(filePath);
    const key = directory + ':' + framework;
    if (this.installedVersions.has(key)) return this.installedVersions.get(key) || versions[framework];
    let version: string | undefined;
    try {
      const manifest = createRequire(path.join(directory, 'package.json')).resolve(`${framework}/package.json`);
      version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    } catch { /* A declared version remains useful without node_modules. */ }
    this.installedVersions.set(key, version);
    return version || versions[framework];
  }

  private nearestManifest(filePath: string): PackageVersions {
    let dir = path.dirname(path.resolve(filePath));
    const checked: string[] = [];
    let result: PackageVersions = {};
    while (dir === this.root || dir.startsWith(`${this.root}${path.sep}`)) {
      const saved = this.contextByDirectory.get(dir);
      if (saved) { result = saved; break; }
      checked.push(dir);
      const manifestPath = path.join(dir, 'package.json');
      if (fs.existsSync(manifestPath)) {
        const cached = this.manifests.get(manifestPath);
        if (cached) {
          if (cached.react || cached.vue) { result = { ...cached, directory: dir }; break; }
          if (dir === this.root) break;
          dir = path.dirname(dir);
          continue;
        }
        try {
          const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
          };
          const all = { ...json.peerDependencies, ...json.devDependencies, ...json.dependencies };
          const versions = { react: all.react, vue: all.vue };
          this.manifests.set(manifestPath, versions);
          if (versions.react || versions.vue) { result = { ...versions, directory: dir }; break; }
        } catch {
          // Keep searching parent manifests when a nested manifest cannot be read.
        }
      }
      if (dir === this.root) break;
      dir = path.dirname(dir);
    }
    for (const directory of checked) this.contextByDirectory.set(directory, result);
    return result;
  }
}
