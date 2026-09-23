import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import chokidar from 'chokidar';
import { ClusterLayout, GraphBuilder, type DevToolsTelemetryEvent, type GrimoireGraph } from '@wha/core';
import { devAdapterScript, quickBrowserScript } from './runtimeScripts.js';
import { getDevtoolsInstallStatus, installDevtools, removeDevtools, upgradeDevtools } from './devtoolsInstaller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find built web assets in packages/web/dist or fallback to legacy client
const WEB_DIST_DIR = path.resolve(__dirname, '../../web/dist');
const CLIENT_DIR = fs.existsSync(WEB_DIST_DIR)
  ? WEB_DIST_DIR
  : path.resolve(__dirname, '../../../client');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export class GrimoireServer {
  public targetDir: string;
  public port: number;
  private server: http.Server | null = null;
  private sseClients = new Set<ServerResponse>();
  private cachedGraph: GrimoireGraph | null = null;
  private builder: GraphBuilder;
  private layout: ClusterLayout;
  private buildMeasurements = new Map<string, { renderedBytes: number; emittedBytesEstimate: number; initial: boolean; chunks: string[]; measuredAt: number }>();
  private buildInProgress = false;

  constructor(targetDir: string, port = 4173) {
    this.targetDir = path.resolve(targetDir);
    this.port = port;
    this.builder = new GraphBuilder(this.targetDir);
    this.layout = new ClusterLayout();
  }

  public async start(): Promise<number> {
    this.refreshGraph();
    this.setupWatcher();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${this.port} is occupied, trying ${this.port + 1}...`);
          this.port++;
          this.server?.listen(this.port, '127.0.0.1');
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`\n📜 [Witch Hat Atelier] The Architectural Grimoire is manifested!`);
        console.log(`✦ Scanned Target: \x1b[36m${this.targetDir}\x1b[0m`);
        console.log(`✦ Inscription URL: \x1b[32mhttp://localhost:${this.port}\x1b[0m\n`);
        resolve(this.port);
      });
    });
  }

  public refreshGraph(): GrimoireGraph {
    console.time('✦ Scanned in');
    const rawGraph = this.builder.buildGraph();
    const seals = rawGraph.dependencies || [];
    for (const name of this.buildMeasurements.keys()) {
      if (seals.some((seal) => seal.name === name)) continue;
      seals.push({ id: `dependency:${name}`, name, version: null, direct: false, importerNodeIds: [], importCount: 0, dynamicImportCount: 0, sourceRisk: 'unknown', x: 0, y: 0, radius: 24 });
    }
    for (const seal of seals) {
      const measurement = this.buildMeasurements.get(seal.name);
      if (measurement) {
        seal.build = measurement;
        seal.radius = Math.max(seal.radius, Math.min(62, 24 + Math.sqrt(measurement.emittedBytesEstimate / 1024) * 3.2));
      }
    }
    rawGraph.dependencies = seals;
    this.cachedGraph = this.layout.computeLayout(rawGraph);
    console.timeEnd('✦ Scanned in');
    console.log(
      `✦ Inscribed ${this.cachedGraph.nodes.length} Glyphs across ${this.cachedGraph.clusters.length} Archipelagos (${this.cachedGraph.edges.length} ink threads).`
    );
    return this.cachedGraph;
  }

  private setupWatcher(): void {
    try {
      const srcDir = path.join(this.targetDir, 'src');
      const watchPath = fs.existsSync(srcDir) ? srcDir : this.targetDir;

      let debounceTimer: NodeJS.Timeout | null = null;
      const watcher = chokidar.watch(watchPath, {
        ignored: /(^|[\/\\])\..|node_modules|build|dist/,
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('all', (_event, changedPath) => {
        if (['.js', '.jsx', '.ts', '.tsx', '.vue'].some((ext) => changedPath.endsWith(ext))) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log(`\n⚡ Parchment altered: ${path.relative(this.targetDir, changedPath)}`);
            this.refreshGraph();
            this.notifyClients();
          }, 350);
        }
      });
    } catch (err: any) {
      console.warn('Watcher setup warning:', err.message);
    }
  }

  private notifyClients(): void {
    for (const client of this.sseClients) {
      client.write('data: reload\n\n');
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/devtools/install') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET') {
        res.end(JSON.stringify(getDevtoolsInstallStatus(this.targetDir)));
        return;
      }
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Same-origin local request required.' })); return;
      }
      try {
        const status = req.method === 'POST' ? installDevtools(this.targetDir, this.port)
          : req.method === 'PUT' ? upgradeDevtools(this.targetDir)
          : req.method === 'DELETE' ? removeDevtools(this.targetDir)
            : null;
        if (!status) { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
        this.refreshGraph();
        this.notifyClients();
        res.end(JSON.stringify(status));
      } catch (error) {
        res.writeHead(422);
        res.end(JSON.stringify({ error: String(error instanceof Error ? error.message : error) }));
      }
      return;
    }

    if (pathname === '/api/build-measure') {
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (req.method !== 'POST' || (origin && new URL(origin).host !== host)) {
        res.writeHead(403); res.end('Same-origin POST required'); return;
      }
      if (this.buildInProgress) { res.writeHead(409); res.end('Build already running'); return; }
      this.buildInProgress = true;
      void this.measureViteBuild().then(() => {
        this.buildInProgress = false;
        this.refreshGraph();
        this.notifyClients();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ measured: this.buildMeasurements.size }));
      }).catch((error) => {
        this.buildInProgress = false;
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      });
      return;
    }

    if (pathname === '/api/runtime/quick.js' || pathname === '/api/runtime/adapter.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(pathname.endsWith('quick.js') ? quickBrowserScript : devAdapterScript);
      return;
    }

    if (pathname === '/api/telemetry') {
      const origin = req.headers.origin;
      const allowed = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (!allowed) { res.writeHead(403); res.end('Local development origins only'); return; }
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > 65536) req.destroy();
      });
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body) as DevToolsTelemetryEvent | DevToolsTelemetryEvent[];
          const inputs = Array.isArray(incoming) ? incoming : [incoming];
          if (inputs.length === 0 || inputs.length > 50) throw new Error('Invalid telemetry batch');
          const types = ['RENDER', 'STATE_MUTATION', 'EFFECT_TRIGGER', 'DOM_UPDATE', 'LONG_TASK'];
          const events = inputs.map((input): DevToolsTelemetryEvent => {
            if (!input || !types.includes(input.type) || typeof input.componentName !== 'string' || !input.componentName || input.componentName.length > 160 || !Number.isFinite(input.durationMs)) throw new Error('Invalid telemetry event');
            return {
              type: input.type, source: input.source === 'fiber' ? 'fiber' : input.source === 'adapter' ? 'adapter' : 'browser',
              componentName: input.componentName, nodeId: typeof input.nodeId === 'string' ? input.nodeId.slice(0, 240) : undefined,
              file: typeof input.file === 'string' ? input.file.slice(0, 500) : undefined,
              parentComponentName: typeof input.parentComponentName === 'string' ? input.parentComponentName.slice(0, 160) : undefined,
              hierarchyPath: Array.isArray(input.hierarchyPath) ? input.hierarchyPath.slice(0, 12).map((name) => String(name).slice(0, 160)) : undefined,
              commitId: Number.isFinite(input.commitId) ? input.commitId : undefined,
              timestamp: Number.isFinite(input.timestamp) ? input.timestamp : Date.now(),
              durationMs: Math.max(0, Math.min(input.durationMs, 60000)),
              changeReasons: Array.isArray(input.changeReasons) ? input.changeReasons.slice(0, 6).map((reason) => String(reason).slice(0, 160)) : [],
            };
          });
          const payload = Array.isArray(incoming) ? `event: telemetry-batch\ndata: ${JSON.stringify(events)}\n\n` : `event: telemetry\ndata: ${JSON.stringify(events[0])}\n\n`;
          for (const client of this.sseClients) client.write(payload);
          res.writeHead(204); res.end();
        } catch { res.writeHead(400); res.end('Invalid telemetry event'); }
      });
      return;
    }

    // 1. API: Graph JSON
    if (pathname === '/api/graph') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(JSON.stringify(this.cachedGraph));
      return;
    }

    // 2. API: Server-Sent Events (Live Reload)
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('data: connected\n\n');
      this.sseClients.add(res);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 3. Static Files
    const filePath = path.join(CLIENT_DIR, pathname === '/' ? 'index.html' : pathname);

    // Security: Prevent path traversal
    if (!filePath.startsWith(CLIENT_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // Fallback to index.html for SPA client-side routing
        const indexHtml = path.join(CLIENT_DIR, 'index.html');
        fs.readFile(indexHtml, (indexErr, indexData) => {
          if (indexErr) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Grimoire parchment not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(indexData);
        });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }

  private async measureViteBuild(): Promise<void> {
    const requireFromTarget = createRequire(path.join(this.targetDir, 'package.json'));
    let vitePath: string;
    try {
      const manifestPath = requireFromTarget.resolve('vite/package.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const entry = manifest.exports?.['.']?.import || manifest.module || manifest.main;
      vitePath = entry ? path.resolve(path.dirname(manifestPath), entry) : requireFromTarget.resolve('vite');
    }
    catch { throw new Error('Vite is not installed in the target project. Build measurement currently supports Vite.'); }
    const viteModule = await import(pathToFileURL(vitePath).href);
    const vite = viteModule.build ? viteModule : viteModule.default;
    if (typeof vite.build !== 'function') throw new Error('Cannot load the target Vite build API.');
    const measurements = new Map<string, { renderedBytes: number; emittedBytesEstimate: number; initial: boolean; chunks: string[]; measuredAt: number }>();
    const measuredAt = Date.now();
    const plugin = {
      name: 'grimoire-dependency-measurement',
      generateBundle(_options: unknown, bundle: Record<string, any>) {
        const initialChunks = new Set<string>();
        const visit = (chunkName: string) => {
          if (initialChunks.has(chunkName)) return;
          initialChunks.add(chunkName);
          const chunk = bundle[chunkName];
          if (chunk?.type === 'chunk') for (const imported of chunk.imports || []) visit(imported);
        };
        for (const [chunkName, output] of Object.entries(bundle)) {
          if (output.type === 'chunk' && output.isEntry) visit(chunkName);
        }
        for (const [chunkName, output] of Object.entries(bundle)) {
          if (output.type !== 'chunk') continue;
          const modules = Object.entries(output.modules || {}) as Array<[string, { renderedLength?: number }]>;
          const totalRendered = modules.reduce((sum, [, details]) => sum + (details.renderedLength || 0), 0);
          const emittedChunkBytes = Buffer.byteLength(output.code || '', 'utf8');
          for (const [moduleId, details] of modules) {
            const normalized = moduleId.replace(/\\/g, '/');
            const match = normalized.match(/\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
            if (!match) continue;
            const name = match[1]!;
            const value = measurements.get(name) || { renderedBytes: 0, emittedBytesEstimate: 0, initial: false, chunks: [], measuredAt };
            value.renderedBytes += details.renderedLength || 0;
            value.emittedBytesEstimate += totalRendered ? emittedChunkBytes * (details.renderedLength || 0) / totalRendered : 0;
            value.initial ||= initialChunks.has(chunkName);
            if (!value.chunks.includes(chunkName)) value.chunks.push(chunkName);
            measurements.set(name, value);
          }
        }
      },
    };
    await vite.build({ root: this.targetDir, plugins: [plugin] });
    this.buildMeasurements = measurements;
  }

  public close(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
