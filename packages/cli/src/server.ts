import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { gzip } from 'node:zlib';
import { fork, spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import chokidar, { type FSWatcher } from 'chokidar';
import { ClusterLayout, type DependencySeal, type DevToolsTelemetryEvent, type GrimoireGraph, type GraphBuildProgress } from '@wha/core';
import { devAdapterScript, quickBrowserScript } from './runtimeScripts.js';
import { getDevtoolsInstallStatus, installDevtools, refreshDevtools, removeDevtools, upgradeDevtools } from './devtoolsInstaller.js';
import { detectProjectCapabilities } from './projectCapabilities.js';
import { installWebpackDevtools, previewWebpackInstall, refreshWebpackDevtools, removeWebpackDevtools, webpackInstallStatus } from './webpackInstaller.js';

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
const watchedExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.go', '.java', '.kt', '.kts', '.cs']);
const ignoredSourceDirectories = new Set(['node_modules', 'build', 'dist', '.git', '.idea', '.dsh', '.grimoire', '.yarn', '.next', '.nuxt', '.output', '.cache', '.turbo', 'coverage', 'storybook-static']);

type BuildMeasurement = { renderedBytes: number; emittedBytesEstimate: number; initial: boolean; chunks: string[]; measuredAt: number; source?: 'vite' | 'webpack-stats'; configuration?: string; appId?: string };

export class GrimoireServer {
  public targetDir: string;
  public port: number;
  private server: http.Server | null = null;
  private sseClients = new Set<ServerResponse>();
  private controlClients = new Set<ServerResponse>();
  private runtimeConnections = new Map<string, DevToolsTelemetryEvent>();
  private cachedGraph: GrimoireGraph | null = null;
  private cachedGraphJson: string | null = null;
  private cachedGraphGzip: Buffer | null = null;
  private scanWorker: Worker | null = null;
  private watcher: FSWatcher | null = null;
  private watchPath: string | null = null;
  private watchDisabled = false;
  private scanPending = false;
  private scanGeneration = 0;
  private scanStartedAt = 0;
  private scanStatus: { state: 'starting' | 'running' | 'ready' | 'error' | 'cancelled'; phase: string; completed: number | null; total: number | null; file: string | null; startedAt: number; updatedAt: number; error: string | null; coverage?: GrimoireGraph['stats']['parseCoverage']; watchPath?: string | null; logs: Array<{ time: number; level: 'info' | 'warning' | 'error'; message: string }> } = {
    state: 'starting', phase: 'starting', completed: null, total: null, file: null, startedAt: Date.now(), updatedAt: Date.now(), error: null, logs: [],
  };
  private buildMeasurementsByApp = new Map<string, Map<string, BuildMeasurement>>();
  private activeBuildAppId = '';
  private buildInProgress = false;
  private viteBuildCancel: (() => void) | null = null;
  private viteBuildTimeout: NodeJS.Timeout | null = null;
  private viteBuildStatus: { state: 'idle' | 'running' | 'ready' | 'error' | 'cancelled'; appId: string; phase: string; startedAt: number | null; endedAt: number | null; measured: number; error: string | null; logs: string[] } = {
    state: 'idle', appId: '', phase: 'idle', startedAt: null, endedAt: null, measured: 0, error: null, logs: [],
  };
  private statsWorker: Worker | null = null;
  private webpackBuildChild: ChildProcessWithoutNullStreams | null = null;
  private webpackBuildTimeout: NodeJS.Timeout | null = null;
  private webpackBuildGeneration = 0;
  private webpackBuildStatus: { state: 'idle' | 'running' | 'importing' | 'ready' | 'error' | 'cancelled'; command: string; cwd: string; statsPath: string; startedAt: number | null; endedAt: number | null; measured: number; error: string | null; logs: string[] } = {
    state: 'idle', command: '', cwd: '', statsPath: '', startedAt: null, endedAt: null, measured: 0, error: null, logs: [],
  };
  private locatorUntil = 0;
  private locatorTimer: NodeJS.Timeout | null = null;
  private allowedRuntimeOrigins = new Set<string>();

  constructor(targetDir: string, port = 4173, runtimeOrigins: string[] = []) {
    this.targetDir = path.resolve(targetDir);
    this.port = port;
    for (const origin of runtimeOrigins) {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw new Error(`Invalid runtime origin: ${origin}`);
      this.allowedRuntimeOrigins.add(url.origin);
    }
  }

  private allowsRuntimeOrigin(origin: string | undefined): boolean {
    return !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || this.allowedRuntimeOrigins.has(origin);
  }

  private applicationForStats(relativeFile: string): string {
    const absolute = path.resolve(this.targetDir, relativeFile);
    const applications = detectProjectCapabilities(this.targetDir).applications;
    const matches = applications.filter((app) => {
      const directory = path.resolve(this.targetDir, app.directory);
      return absolute === directory || absolute.startsWith(directory + path.sep);
    }).sort((left, right) => right.directory.length - left.directory.length);
    if (matches[0]?.id !== '.') return matches[0]?.id || '(unassigned)';
    return applications.length === 1 ? matches[0]?.id || '(unassigned)' : '(unassigned)';
  }

  private storeBuildMeasurements(appId: string, measurements: Array<[string, BuildMeasurement]>): void {
    this.buildMeasurementsByApp.set(appId, new Map(measurements.map(([name, value]) => [name, { ...value, appId }])));
    this.activeBuildAppId = appId;
  }

  private cacheGraphJson(): void {
    if (!this.cachedGraph) return;
    this.cachedGraphJson = JSON.stringify(this.cachedGraph);
    this.cachedGraphGzip = null;
    const serializedGraph = this.cachedGraphJson;
    if (serializedGraph.length > 1_000_000) gzip(serializedGraph, { level: 5 }, (error, compressed) => {
      if (!error && this.cachedGraphJson === serializedGraph) this.cachedGraphGzip = compressed;
    });
  }

  private refreshBuildMeasurements(): void {
    if (!this.cachedGraph || this.scanWorker) { this.refreshGraph(); return; }
    const seals: DependencySeal[] = (this.cachedGraph.dependencies || [])
      .filter((seal) => seal.importCount > 0)
      .map((seal) => ({ ...seal, build: undefined, buildsByApp: {}, radius: Math.min(44, 24 + Math.sqrt(seal.importerNodeIds.length) * 5) }));
    const byName = new Map(seals.map((seal) => [seal.name, seal]));
    for (const [appId, measurements] of this.buildMeasurementsByApp) {
      for (const [name, measurement] of measurements) {
        let seal = byName.get(name);
        if (!seal) {
          seal = { id: `dependency:${name}`, name, version: null, direct: false, importerNodeIds: [], importCount: 0, dynamicImportCount: 0, sourceRisk: 'unknown', x: 0, y: 0, radius: 24 };
          seals.push(seal);
          byName.set(name, seal);
        }
        const value = { ...measurement, appId };
        (seal.buildsByApp ||= {})[appId] = value;
        if (appId === this.activeBuildAppId) seal.build = value;
        seal.radius = Math.max(seal.radius, Math.min(62, 24 + Math.sqrt((measurement.emittedBytesEstimate || 0) / 1024) * 3.2));
      }
    }
    const layout = new ClusterLayout();
    const dependencies = layout.positionDependencies(seals, this.cachedGraph.clusters);
    this.cachedGraph = {
      ...this.cachedGraph,
      dependencies,
      activeBuildAppId: this.activeBuildAppId,
      bounds: layout.calculateOverallBounds(this.cachedGraph.nodes, this.cachedGraph.clusters, dependencies),
    };
    this.cacheGraphJson();
    this.notifyClients();
  }

  public async start(): Promise<number> {
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
        this.refreshGraph();
        resolve(this.port);
      });
    });
  }

  public refreshGraph(): void {
    if (this.scanWorker) { this.scanPending = true; return; }
    const generation = ++this.scanGeneration;
    const startedAt = Date.now();
    this.scanStartedAt = startedAt;
    this.scanStatus = { state: 'running', phase: 'starting', completed: null, total: null, file: null, startedAt, updatedAt: startedAt, error: null, watchPath: this.watcher ? this.scanStatus.watchPath : null, logs: [] };
    this.addScanLog('info', 'Сканирование запущено.');
    const worker = new Worker(new URL('./scanWorker.js', import.meta.url), { workerData: {
      targetDir: this.targetDir,
      buildMeasurementsByApp: [...this.buildMeasurementsByApp].map(([appId, values]) => [appId, [...values]]),
      activeBuildAppId: this.activeBuildAppId,
    } });
    this.scanWorker = worker;
    let finished = false;
    let lastTerminalProgress = 0;
    worker.on('message', (message: { type: string; progress?: GraphBuildProgress; graph?: GrimoireGraph; error?: string }) => {
      if (generation !== this.scanGeneration) return;
      if (message.type === 'progress' && message.progress) {
        const progress = message.progress;
        const phaseChanged = progress.phase !== this.scanStatus.phase;
        this.scanStatus = { ...this.scanStatus, phase: progress.phase, completed: progress.completed ?? null, total: progress.total ?? null, file: progress.file ?? (phaseChanged ? null : this.scanStatus.file), updatedAt: Date.now() };
        if (phaseChanged) this.addScanLog('info', `Этап: ${progress.phase}${progress.total != null ? ` (${progress.total} ${progress.phase === 'layout-clusters' ? 'архипелагов' : 'файлов'})` : ''}`);
        if (progress.warning) this.addScanLog('warning', progress.warning);
        const now = Date.now();
        if (phaseChanged || now - lastTerminalProgress > 5000) {
          const count = progress.total != null ? ` ${progress.completed || 0}/${progress.total}` : progress.completed != null ? ` ${progress.completed} files found` : '';
          console.log(`[Grimoire] ${progress.phase}${count}${progress.file ? ` · ${progress.file}` : ''}`);
          lastTerminalProgress = now;
        }
        this.notifyScanStatus();
      } else if (message.type === 'complete' && message.graph) {
        finished = true;
        this.cachedGraph = message.graph;
        this.cachedGraph.projectKey = createHash('sha256').update(this.targetDir).digest('hex').slice(0, 16);
        this.cachedGraph.projectRoot = this.targetDir;
        this.cachedGraph.capabilities = detectProjectCapabilities(this.targetDir);
        this.cachedGraph.capabilities.allowedRuntimeOrigins = [...this.allowedRuntimeOrigins];
        this.cacheGraphJson();
        this.scanStatus = { ...this.scanStatus, state: 'ready', phase: 'ready', coverage: this.cachedGraph.stats.parseCoverage, updatedAt: Date.now() };
        const coverage = this.cachedGraph.stats.parseCoverage;
        if (coverage) this.addScanLog('info', `Покрытие разбора: ${coverage.complete} полных, ${coverage.partial} частичных, ${coverage.unreadable} без чтения; предупреждений ${coverage.warnings}.`);
        if (!this.watcher) {
          if (this.watchPath) this.setupWatcher();
          else if (this.cachedGraph.stats.totalFiles > 5000) this.addScanLog('info', 'Большой проект: слежение за всем проектом отключено. Можно выбрать подпапку до 5000 файлов или обновлять карту вручную.');
          else if (!this.watchDisabled) this.setupWatcher();
        }
        const summary = `Готово: ${this.cachedGraph.nodes.length} знаков, ${this.cachedGraph.clusters.length} архипелагов, ${this.cachedGraph.edges.length} связей за ${((Date.now() - this.scanStartedAt) / 1000).toFixed(1)} с.`;
        this.addScanLog('info', summary);
        console.log(`[Grimoire] ${summary}`);
        this.notifyScanStatus();
        this.notifyClients();
      } else if (message.type === 'error') {
        finished = true;
        this.failScan(message.error || 'Неизвестная ошибка сканирования');
      }
    });
    worker.on('error', (error) => {
      if (generation !== this.scanGeneration) return;
      finished = true;
      this.failScan(error instanceof Error ? error.stack || error.message : String(error));
    });
    worker.on('exit', (code) => {
      if (this.scanWorker !== worker) return;
      this.scanWorker = null;
      if (!finished) this.failScan(`Поток сканирования завершился с кодом ${code}.`);
      if (this.scanPending) { this.scanPending = false; this.refreshGraph(); }
    });
    this.notifyScanStatus();
  }

  private addScanLog(level: 'info' | 'warning' | 'error', message: string): void {
    this.scanStatus.logs.push({ time: Date.now(), level, message });
    if (this.scanStatus.logs.length > 80) this.scanStatus.logs.shift();
    if (level === 'error') console.error(`[Grimoire] ${message}`);
    else if (level === 'warning') console.warn(`[Grimoire] ${message}`);
  }

  private failScan(message: string): void {
    this.scanStatus = { ...this.scanStatus, state: 'error', phase: 'error', error: message, updatedAt: Date.now() };
    this.addScanLog('error', message);
    this.notifyScanStatus();
  }

  private notifyScanStatus(): void {
    const payload = `event: scan-status\ndata: ${JSON.stringify(this.scanStatus)}\n\n`;
    for (const client of this.sseClients) client.write(payload);
  }

  private setupWatcher(): void {
    try {
      const watchPath = this.watchPath ? path.join(this.targetDir, this.watchPath) : this.targetDir;

      let debounceTimer: NodeJS.Timeout | null = null;
      const watcher = chokidar.watch(watchPath, {
        ignored: (candidate, stats) => {
          const relative = path.relative(this.targetDir, candidate);
          if (!relative || relative === '.') return false;
          const segments = relative.split(path.sep);
          if (segments.some((segment) => ignoredSourceDirectories.has(segment))) return true;
          return Boolean(stats?.isFile() && !watchedExtensions.has(path.extname(candidate).toLowerCase()));
        },
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('all', (_event, changedPath) => {
        if (watchedExtensions.has(path.extname(changedPath).toLowerCase())) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log(`\n⚡ Parchment altered: ${path.relative(this.targetDir, changedPath)}`);
            this.refreshGraph();
          }, 800);
        }
      });
      watcher.on('error', (error) => { this.addScanLog('warning', `File watcher: ${String(error)}`); this.notifyScanStatus(); });
      this.watcher = watcher;
      this.scanStatus.watchPath = path.relative(this.targetDir, watchPath).replace(/\\/g, '/') || '.';
      this.notifyScanStatus();
    } catch (err: any) {
      console.warn('Watcher setup warning:', err.message);
    }
  }

  private countWatchSources(directory: string): number {
    let count = 0;
    const pending = [directory];
    while (pending.length) {
      const current = pending.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory() && !ignoredSourceDirectories.has(entry.name)) pending.push(path.join(current, entry.name));
        else if (entry.isFile() && watchedExtensions.has(path.extname(entry.name).toLowerCase())) {
          count++;
          if (count > 5000) return count;
        }
      }
    }
    return count;
  }

  private configureWatch(relativePath: string | null): void {
    if (!this.cachedGraph) throw new Error('Дождитесь окончания сканирования.');
    if (relativePath) {
      if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) throw new Error('Укажите подпапку внутри проекта.');
      const directory = path.resolve(this.targetDir, relativePath);
      const realRoot = fs.realpathSync(this.targetDir);
      const realDirectory = fs.realpathSync(directory);
      if (realDirectory !== realRoot && !realDirectory.startsWith(realRoot + path.sep)) throw new Error('Подпапка находится вне проекта.');
      if (!fs.statSync(realDirectory).isDirectory()) throw new Error('Путь для слежения должен быть папкой.');
      const relative = path.relative(this.targetDir, directory).replace(/\\/g, '/') || '.';
      const fileCount = this.countWatchSources(realDirectory);
      if (fileCount > 5000) throw new Error('В выбранной папке больше 5000 исходников. Выберите папку меньшего размера.');
      this.watchPath = relative;
      this.watchDisabled = false;
    } else { this.watchPath = null; this.watchDisabled = true; }
    void this.watcher?.close();
    this.watcher = null;
    this.scanStatus.watchPath = null;
    if (relativePath) this.setupWatcher();
    this.notifyScanStatus();
  }

  private notifyClients(): void {
    for (const client of this.sseClients) {
      client.write('data: reload\n\n');
    }
  }

  private notifyControlClients(): void {
    const payload = `data: ${JSON.stringify({ locate: Date.now() < this.locatorUntil, expiresAt: this.locatorUntil })}\n\n`;
    for (const client of this.controlClients) client.write(payload);
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/api/runtime/control-stream') {
      const origin = req.headers.origin;
      if (!this.allowsRuntimeOrigin(origin)) { res.writeHead(403); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': origin || '*' });
      res.write(`data: ${JSON.stringify({ locate: Date.now() < this.locatorUntil, expiresAt: this.locatorUntil })}\n\n`);
      this.controlClients.add(res);
      req.on('close', () => this.controlClients.delete(res));
      return;
    }

    if (pathname === '/api/runtime/control') {
      const origin = req.headers.origin;
      const localOrigin = this.allowsRuntimeOrigin(origin);
      if (!localOrigin) { res.writeHead(403); res.end('Local origin required'); return; }
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method === 'POST' || req.method === 'DELETE') {
        const host = req.headers.host || '';
        if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
          res.writeHead(403); res.end('Same-origin Grimoire request required'); return;
        }
        this.locatorUntil = req.method === 'POST' ? Date.now() + 30000 : 0;
        if (this.locatorTimer) clearTimeout(this.locatorTimer);
        this.locatorTimer = req.method === 'POST' ? setTimeout(() => {
          this.locatorUntil = 0;
          this.locatorTimer = null;
          this.notifyControlClients();
        }, 30000) : null;
        this.notifyControlClients();
      } else if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ locate: Date.now() < this.locatorUntil, expiresAt: this.locatorUntil }));
      return;
    }

    if (pathname === '/api/devtools/install') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const appId = parsedUrl.searchParams.get('app') || '.';
      const viteApp = detectProjectCapabilities(this.targetDir).applications.find((app) => app.id === appId && app.bundler === 'vite');
      if (!viteApp) { res.writeHead(422); res.end(JSON.stringify({ error: 'Выберите обнаруженное Vite-приложение.' })); return; }
      const appDirectory = path.resolve(this.targetDir, viteApp.directory);
      if (req.method === 'GET') {
        const status = getDevtoolsInstallStatus(appDirectory);
        res.end(JSON.stringify({ ...status, refreshAvailable: status.refreshAvailable || Boolean(status.installed && status.port !== this.port) }));
        return;
      }
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Same-origin local request required.' })); return;
      }
      try {
        const status = req.method === 'POST' ? installDevtools(appDirectory, this.port)
          : req.method === 'PUT' ? upgradeDevtools(appDirectory)
          : req.method === 'PATCH' ? refreshDevtools(appDirectory, this.port)
          : req.method === 'DELETE' ? removeDevtools(appDirectory)
            : null;
        if (!status) { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
        this.refreshGraph();
        res.end(JSON.stringify({ ...status, refreshAvailable: status.refreshAvailable || Boolean(status.installed && status.port !== this.port) }));
      } catch (error) {
        res.writeHead(422);
        res.end(JSON.stringify({ error: String(error instanceof Error ? error.message : error) }));
      }
      return;
    }

    if (pathname === '/api/devtools/webpack') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      const appId = parsedUrl.searchParams.get('app') || '.';
      if (req.method === 'GET') {
        try {
          const status = webpackInstallStatus(this.targetDir, appId);
          const entry = parsedUrl.searchParams.get('entry') || '';
          const script = parsedUrl.searchParams.get('script') || '';
          const preview = !status.installed && entry && script ? previewWebpackInstall(this.targetDir, appId, entry, script).preview : null;
          res.end(JSON.stringify({ ...status, refreshAvailable: Boolean(status.installed && status.port !== this.port) || status.refreshAvailable, preview }));
        } catch (error) { res.writeHead(422); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
        return;
      }
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}` || !['POST', 'PATCH', 'DELETE'].includes(req.method || '')) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Same-origin local request required.' })); return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 2048) req.destroy(); });
      req.on('end', () => {
        try {
          const input = body ? JSON.parse(body) : {};
          const result = req.method === 'POST'
            ? installWebpackDevtools(this.targetDir, appId, String(input.entry || ''), String(input.script || ''), this.port)
            : req.method === 'PATCH' ? refreshWebpackDevtools(this.targetDir, appId, this.port)
              : removeWebpackDevtools(this.targetDir, appId);
          this.refreshGraph();
          res.end(JSON.stringify(result));
        } catch (error) { res.writeHead(422); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
      });
      return;
    }

    if (pathname === '/api/build-measure') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET') { res.end(JSON.stringify(this.viteBuildStatus)); return; }
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Same-origin local request required.' })); return;
      }
      if (req.method === 'DELETE') { this.viteBuildCancel?.(); res.end(JSON.stringify(this.viteBuildStatus)); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
      if (this.buildInProgress || this.statsWorker) { res.writeHead(409); res.end('Build already running'); return; }
      const appId = parsedUrl.searchParams.get('app') || '.';
      const viteApp = detectProjectCapabilities(this.targetDir).applications.find((app) => app.id === appId && app.bundler === 'vite');
      if (!viteApp) { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Выберите обнаруженное Vite-приложение.' })); return; }
      void this.measureViteBuild(path.resolve(this.targetDir, viteApp.directory), appId).then(() => {
        this.refreshBuildMeasurements();
        res.end(JSON.stringify({ measured: this.buildMeasurementsByApp.get(appId)?.size || 0 }));
      }).catch((error) => {
        res.writeHead(this.viteBuildStatus.state === 'cancelled' ? 409 : 422);
        res.end(JSON.stringify({ error: String(error?.message || error) }));
      });
      return;
    }

    if (pathname === '/api/webpack-build') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET') { res.end(JSON.stringify(this.webpackBuildStatus)); return; }
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Same-origin local request required.' })); return;
      }
      if (req.method === 'DELETE') { this.stopWebpackBuild(); res.end(JSON.stringify(this.webpackBuildStatus)); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(JSON.stringify({ error: 'Method not allowed.' })); return; }
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 2048) req.destroy(); });
      req.on('end', () => {
        try {
          const input = JSON.parse(body);
          this.startWebpackBuild(String(input.app || ''), String(input.script || ''), String(input.path || ''));
          res.writeHead(202); res.end(JSON.stringify(this.webpackBuildStatus));
        } catch (error) { res.writeHead(422); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
      });
      return;
    }

    if (pathname === '/api/webpack-stats') {
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method !== 'POST' || !/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Same-origin local POST required.' })); return;
      }
      if (this.statsWorker || this.buildInProgress) { res.writeHead(409); res.end(JSON.stringify({ error: 'Измерение уже выполняется.' })); return; }
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 2048) req.destroy(); });
      req.on('end', () => {
        let relativeFile: string;
        let compilationId: string | undefined;
        try {
          const input = JSON.parse(body);
          relativeFile = String(input.path || '');
          compilationId = typeof input.compilation === 'string' && input.compilation.length <= 30 ? input.compilation : undefined;
        }
        catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Expected JSON path.' })); return; }
        if (relativeFile.length > 1000) { res.writeHead(400); res.end(JSON.stringify({ error: 'Path is too long.' })); return; }
        const worker = new Worker(new URL('./statsWorker.js', import.meta.url), { workerData: { targetDir: this.targetDir, relativeFile, compilationId } });
        this.statsWorker = worker;
        let replied = false;
        const fail = (error: string, compilations?: Array<{ id: string; name: string; target: string }>) => {
          if (replied) return;
          replied = true;
          res.writeHead(422); res.end(JSON.stringify({ error, compilations }));
        };
        worker.on('message', (message: { measurements?: Array<[string, BuildMeasurement]>; error?: string; compilations?: Array<{ id: string; name: string; target: string }> }) => {
          if (message.error) { fail(message.error, message.compilations); return; }
          if (!message.measurements || replied) return;
          replied = true;
          const appId = this.applicationForStats(relativeFile);
          this.storeBuildMeasurements(appId, message.measurements.map(([name, value]) => [name, value]));
          this.refreshBuildMeasurements();
          res.end(JSON.stringify({ measured: message.measurements.length, appId }));
        });
        worker.on('error', (error) => fail(error instanceof Error ? error.message : String(error)));
        worker.on('exit', (code) => { if (this.statsWorker === worker) this.statsWorker = null; if (!replied) fail(`Stats worker exited with code ${code}.`); });
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
      const allowed = this.allowsRuntimeOrigin(origin);
      if (!allowed) { res.writeHead(403); res.end('Local development origins only'); return; }
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > 262144) req.destroy();
      });
      req.on('end', () => {
        try {
          const incoming = JSON.parse(body) as DevToolsTelemetryEvent | DevToolsTelemetryEvent[];
          const inputs = Array.isArray(incoming) ? incoming : [incoming];
          if (inputs.length === 0 || inputs.length > 50) throw new Error('Invalid telemetry batch');
          const types = ['RENDER', 'STATE_MUTATION', 'EFFECT_TRIGGER', 'DOM_UPDATE', 'LONG_TASK', 'INTERACTION', 'LOCATE', 'HELLO', 'LOSS'];
          const reactive = (value: unknown) => Array.isArray(value) ? value.slice(0, 24).map((entry: any) => ({
            targetId: String(entry?.targetId || '').slice(0, 80), key: String(entry?.key || '').slice(0, 80), operation: String(entry?.operation || '').slice(0, 30),
          })).filter((entry) => entry.targetId && entry.key) : undefined;
          const events = inputs.map((input): DevToolsTelemetryEvent => {
            if (!input || !types.includes(input.type) || typeof input.componentName !== 'string' || !input.componentName || input.componentName.length > 160 || !Number.isFinite(input.durationMs)) throw new Error('Invalid telemetry event');
            return {
              type: input.type, source: input.source === 'fiber' ? 'fiber' : input.source === 'adapter' ? 'adapter' : 'browser',
              framework: input.framework === 'react' || input.framework === 'vue' ? input.framework : undefined,
              componentName: input.componentName, nodeId: typeof input.nodeId === 'string' ? input.nodeId.slice(0, 240) : undefined,
              pageId: typeof input.pageId === 'string' ? input.pageId.slice(0, 80) : undefined,
              runtimeId: typeof input.runtimeId === 'string' ? input.runtimeId.slice(0, 100) : undefined,
              parentRuntimeId: typeof input.parentRuntimeId === 'string' ? input.parentRuntimeId.slice(0, 100) : undefined,
              file: typeof input.file === 'string' ? input.file.slice(0, 500) : undefined,
              parentComponentName: typeof input.parentComponentName === 'string' ? input.parentComponentName.slice(0, 160) : undefined,
              hierarchyPath: Array.isArray(input.hierarchyPath) ? input.hierarchyPath.slice(0, 12).map((name) => String(name).slice(0, 160)) : undefined,
              commitId: Number.isFinite(input.commitId) ? input.commitId : undefined,
              interactionId: Number.isFinite(input.interactionId) ? input.interactionId : undefined,
              interactionType: typeof input.interactionType === 'string' ? input.interactionType.slice(0, 40) : undefined,
              interactionTarget: typeof input.interactionTarget === 'string' ? input.interactionTarget.slice(0, 120) : undefined,
              durationKind: ['profiler-subtree', 'vue-lifecycle', 'browser-task', 'event-timing', 'unavailable'].includes(input.durationKind || '') ? input.durationKind : undefined,
              reactiveTracked: reactive(input.reactiveTracked), reactiveTriggers: reactive(input.reactiveTriggers),
              timestamp: Number.isFinite(input.timestamp) ? input.timestamp : Date.now(),
              durationMs: Math.max(0, Math.min(input.durationMs, 60000)),
              droppedCount: input.type === 'LOSS' && Number.isSafeInteger(input.droppedCount)
                ? Math.max(0, Math.min(input.droppedCount!, 1_000_000_000)) : undefined,
              changeReasons: Array.isArray(input.changeReasons) ? input.changeReasons.slice(0, 6).map((reason) => String(reason).slice(0, 160)) : [],
            };
          });
          if (events.some((event) => event.type === 'LOCATE')) {
            this.locatorUntil = 0;
            if (this.locatorTimer) clearTimeout(this.locatorTimer);
            this.locatorTimer = null;
            this.notifyControlClients();
          }
          for (const event of events) {
            if (event.type === 'HELLO' && event.pageId) this.runtimeConnections.set(event.pageId, event);
          }
          for (const [pageId, event] of this.runtimeConnections) {
            if (Date.now() - event.timestamp > 90000) this.runtimeConnections.delete(pageId);
          }
          const payload = Array.isArray(incoming) ? `event: telemetry-batch\ndata: ${JSON.stringify(events)}\n\n` : `event: telemetry\ndata: ${JSON.stringify(events[0])}\n\n`;
          for (const client of this.sseClients) client.write(payload);
          res.writeHead(204); res.end();
        } catch { res.writeHead(400); res.end('Invalid telemetry event'); }
      });
      return;
    }

    // 1. API: Graph JSON
    if (pathname === '/api/scan/status') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(this.scanStatus));
      return;
    }

    if (pathname === '/api/scan/watch') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET') { res.end(JSON.stringify({ path: this.scanStatus.watchPath || null })); return; }
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}` || !['POST', 'DELETE'].includes(req.method || '')) {
        res.writeHead(403); res.end(JSON.stringify({ error: 'Same-origin local request required.' })); return;
      }
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 1024) req.destroy(); });
      req.on('end', () => {
        try {
          const relative = req.method === 'POST' ? String(JSON.parse(body).path || '') : null;
          this.configureWatch(relative);
          res.end(JSON.stringify({ path: this.scanStatus.watchPath || null }));
        } catch (error) { res.writeHead(422); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
      });
      return;
    }

    if (pathname === '/api/scan/retry') {
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (req.method !== 'POST' || !/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
        res.writeHead(403); res.end('Same-origin local POST required'); return;
      }
      this.refreshGraph();
      res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(this.scanStatus));
      return;
    }

    if (pathname === '/api/scan/cancel') {
      const host = req.headers.host || '';
      const origin = req.headers.origin;
      if (req.method !== 'POST' || !/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host) || origin !== `http://${host}`) {
        res.writeHead(403); res.end('Same-origin local POST required'); return;
      }
      this.scanGeneration++;
      this.scanPending = false;
      void this.scanWorker?.terminate();
      this.scanWorker = null;
      this.scanStatus = { ...this.scanStatus, state: 'cancelled', phase: 'cancelled', updatedAt: Date.now() };
      this.addScanLog('info', 'Сканирование остановлено пользователем.');
      console.log('[Grimoire] Сканирование остановлено пользователем.');
      this.notifyScanStatus();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(this.scanStatus));
      return;
    }

    if (pathname === '/api/graph') {
      const compressed = this.cachedGraphGzip && /\bgzip\b/.test(req.headers['accept-encoding'] || '') ? this.cachedGraphGzip : null;
      res.writeHead(this.cachedGraph ? 200 : this.scanStatus.state === 'error' ? 500 : 202, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
        ...(compressed ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
      });
      res.end(compressed || this.cachedGraphJson || JSON.stringify({ status: this.scanStatus }));
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
      res.write(`event: scan-status\ndata: ${JSON.stringify(this.scanStatus)}\n\n`);
      for (const event of this.runtimeConnections.values()) {
        if (Date.now() - event.timestamp < 90000) res.write(`event: telemetry\ndata: ${JSON.stringify(event)}\n\n`);
      }
      this.sseClients.add(res);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 3. Static Files
    const filePath = path.join(CLIENT_DIR, pathname === '/' ? 'index.html' : pathname);

    // Security: Prevent path traversal
    const relativeStaticPath = path.relative(CLIENT_DIR, filePath);
    if (relativeStaticPath.startsWith('..' + path.sep) || relativeStaticPath === '..' || path.isAbsolute(relativeStaticPath)) {
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

  private appendWebpackBuildLog(value: string): void {
    for (const line of value.split(/\r?\n/)) if (line.trim()) {
      this.webpackBuildStatus.logs.push(line.slice(0, 500));
      if (this.webpackBuildStatus.logs.length > 100) this.webpackBuildStatus.logs.shift();
    }
  }

  private finishWebpackBuild(state: 'ready' | 'error' | 'cancelled', error: string | null = null): void {
    if (this.webpackBuildTimeout) clearTimeout(this.webpackBuildTimeout);
    this.webpackBuildTimeout = null;
    this.buildInProgress = false;
    this.webpackBuildStatus = { ...this.webpackBuildStatus, state, error, endedAt: Date.now() };
    if (error && this.webpackBuildStatus.logs.at(-1) !== error) this.appendWebpackBuildLog(error);
  }

  private stopWebpackBuild(): void {
    if (!['running', 'importing'].includes(this.webpackBuildStatus.state)) return;
    this.webpackBuildStatus = { ...this.webpackBuildStatus, state: 'cancelled', endedAt: Date.now() };
    if (this.webpackBuildChild) {
      const child = this.webpackBuildChild;
      this.killWebpackBuildChild(child, 'SIGTERM');
      setTimeout(() => { if (child.exitCode === null) this.killWebpackBuildChild(child, 'SIGKILL'); }, 5000).unref();
    } else if (this.statsWorker) void this.statsWorker.terminate();
    else this.finishWebpackBuild('cancelled');
  }

  private killWebpackBuildChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { child.kill(signal); }
  }

  private startWebpackBuild(appId: string, script: string, relativeFile: string): void {
    if (this.buildInProgress || this.statsWorker) throw new Error('Другое измерение уже выполняется.');
    const capabilities = detectProjectCapabilities(this.targetDir);
    const app = capabilities.applications.find((item) => item.id === appId && item.bundler === 'webpack');
    if (!app) throw new Error('Выберите обнаруженное Webpack-приложение.');
    const selected = app.statsScripts?.find((item) => item.name === script);
    if (!selected) throw new Error('Выберите обнаруженный stats-скрипт.');
    if (!/^[\w:-]+$/.test(script)) throw new Error('Некорректное имя stats-скрипта.');
    if (!relativeFile || relativeFile.length > 1000 || path.isAbsolute(relativeFile) || relativeFile.split(/[\\/]/).includes('..')) {
      throw new Error('Укажите относительный путь к stats.json внутри проекта.');
    }
    const output = path.resolve(this.targetDir, relativeFile);
    const realRoot = fs.realpathSync(this.targetDir);
    const realParent = fs.realpathSync(path.dirname(output));
    if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) throw new Error('Файл stats должен находиться внутри проекта.');
    let previousOutput: { mtimeMs: number; size: number } | null = null;
    try { const stat = fs.statSync(output); previousOutput = { mtimeMs: stat.mtimeMs, size: stat.size }; } catch { /* New output is expected. */ }
    const cwd = path.resolve(this.targetDir, app.directory);
    const manager = capabilities.packageManager === 'unknown' ? 'npm' : capabilities.packageManager;
    const command = `${manager} run ${script}`;
    const generation = ++this.webpackBuildGeneration;
    this.buildInProgress = true;
    this.webpackBuildStatus = { state: 'running', command, cwd: app.directory, statsPath: relativeFile,
      startedAt: Date.now(), endedAt: null, measured: 0, error: null, logs: [`Запущено: ${command}`, `Ожидаемый stats: ${relativeFile}`] };
    // npm/pnpm/yarn resolve through .cmd shims on Windows.
    const child = spawn(manager, ['run', script], { cwd, shell: process.platform === 'win32', detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
    this.webpackBuildChild = child;
    child.stdout.on('data', (chunk: Buffer) => { if (generation === this.webpackBuildGeneration) this.appendWebpackBuildLog(chunk.toString('utf8')); });
    child.stderr.on('data', (chunk: Buffer) => { if (generation === this.webpackBuildGeneration) this.appendWebpackBuildLog(chunk.toString('utf8')); });
    this.webpackBuildTimeout = setTimeout(() => {
      if (generation !== this.webpackBuildGeneration) return;
      if (this.webpackBuildStatus.state === 'running') {
        this.webpackBuildStatus.state = 'error';
        this.webpackBuildStatus.error = 'Сборка превысила лимит 15 минут.';
        this.appendWebpackBuildLog(this.webpackBuildStatus.error);
        this.killWebpackBuildChild(child, 'SIGTERM');
        setTimeout(() => { if (child.exitCode === null) this.killWebpackBuildChild(child, 'SIGKILL'); }, 5000).unref();
      }
    }, 15 * 60 * 1000);
    child.on('error', (error) => {
      if (generation !== this.webpackBuildGeneration) return;
      if (this.webpackBuildStatus.state === 'running') this.finishWebpackBuild('error', error.message);
    });
    child.on('exit', (code, signal) => {
      if (this.webpackBuildChild === child) this.webpackBuildChild = null;
      if (generation !== this.webpackBuildGeneration) return;
      if (this.webpackBuildStatus.state === 'cancelled' || this.webpackBuildStatus.state === 'error') {
        this.finishWebpackBuild(this.webpackBuildStatus.state, this.webpackBuildStatus.error);
        return;
      }
      if (this.webpackBuildStatus.state !== 'running') return;
      if (code !== 0) { this.finishWebpackBuild('error', `Stats-скрипт завершился с кодом ${code ?? signal}.`); return; }
      let currentOutput: { mtimeMs: number; size: number };
      try { const stat = fs.statSync(output); currentOutput = { mtimeMs: stat.mtimeMs, size: stat.size }; }
      catch { this.finishWebpackBuild('error', `Скрипт завершился, но файл ${relativeFile} не найден.`); return; }
      if (previousOutput && previousOutput.mtimeMs === currentOutput.mtimeMs && previousOutput.size === currentOutput.size) {
        this.finishWebpackBuild('error', `Скрипт завершился, но файл ${relativeFile} не обновился.`); return;
      }
      this.webpackBuildStatus.state = 'importing';
      this.appendWebpackBuildLog('Сборка завершена. Читаем stats.json…');
      const worker = new Worker(new URL('./statsWorker.js', import.meta.url), { workerData: { targetDir: this.targetDir, relativeFile } });
      this.statsWorker = worker;
      let finished = false;
      worker.on('message', (message: { measurements?: Array<[string, BuildMeasurement]>; error?: string }) => {
        if (generation !== this.webpackBuildGeneration) return;
        if (finished || this.webpackBuildStatus.state !== 'importing') return;
        finished = true;
        if (message.error || !message.measurements) { this.finishWebpackBuild('error', message.error || 'Не удалось прочитать Webpack stats.'); return; }
        this.storeBuildMeasurements(appId, message.measurements.map(([name, value]) => [name, { ...value, configuration: `${appId}:${script}:${value.configuration || relativeFile}` }]));
        this.webpackBuildStatus.measured = message.measurements.length;
        this.finishWebpackBuild('ready');
        this.refreshBuildMeasurements();
      });
      worker.on('error', (error) => { if (generation === this.webpackBuildGeneration && !finished && this.webpackBuildStatus.state === 'importing') this.finishWebpackBuild('error', error instanceof Error ? error.message : String(error)); });
      worker.on('exit', (exitCode) => {
        if (this.statsWorker === worker) this.statsWorker = null;
        if (generation !== this.webpackBuildGeneration) return;
        if (this.webpackBuildStatus.state === 'cancelled') { this.finishWebpackBuild('cancelled'); return; }
        if (!finished && this.webpackBuildStatus.state === 'importing') this.finishWebpackBuild('error', `Stats worker exited with code ${exitCode}.`);
      });
    });
  }

  private measureViteBuild(appDirectory: string, appId: string): Promise<void> {
    const configuration = path.relative(this.targetDir, appDirectory).replace(/\\/g, '/') || '.';
    this.buildInProgress = true;
    this.viteBuildStatus = { state: 'running', appId, phase: 'starting', startedAt: Date.now(), endedAt: null,
      measured: 0, error: null, logs: ['Starting Vite measurement in a separate process.'] };
    return new Promise((resolve, reject) => {
      let finished = false;
      let termination: { state: 'cancelled' | 'error'; message: string } | null = null;
      let completedMeasurements: Array<[string, BuildMeasurement]> | null = null;
      let child: ChildProcess;
      try {
        child = fork(fileURLToPath(new URL('./viteBuildWorker.js', import.meta.url)), [], {
          cwd: appDirectory, silent: true,
          env: { ...process.env, GRIMOIRE_VITE_APP_DIRECTORY: appDirectory, GRIMOIRE_VITE_CONFIGURATION: configuration },
        });
      } catch (error) {
        this.buildInProgress = false;
        this.viteBuildStatus = { ...this.viteBuildStatus, state: 'error', phase: 'error', endedAt: Date.now(), error: String(error) };
        reject(error);
        return;
      }
      const log = (message: string) => {
        const lines = message.trim().split(/\r?\n/).filter(Boolean).map((line) => line.slice(0, 500));
        this.viteBuildStatus.logs = [...this.viteBuildStatus.logs, ...lines].slice(-60);
      };
      const finish = (state: 'ready' | 'error' | 'cancelled', error?: string) => {
        if (finished) return;
        finished = true;
        if (this.viteBuildTimeout) clearTimeout(this.viteBuildTimeout);
        this.viteBuildTimeout = null;
        this.viteBuildCancel = null;
        this.buildInProgress = false;
        this.viteBuildStatus = { ...this.viteBuildStatus, state, phase: state, endedAt: Date.now(), error: error || null,
          measured: state === 'ready' ? this.buildMeasurementsByApp.get(appId)?.size || 0 : 0 };
        if (state === 'ready') resolve();
        else reject(new Error(error || (state === 'cancelled' ? 'Vite measurement cancelled.' : 'Vite measurement failed.')));
      };
      const stop = (reason: 'cancelled' | 'error', message: string) => {
        if (finished || termination) return;
        termination = { state: reason, message };
        log(message);
        this.viteBuildStatus = { ...this.viteBuildStatus, state: reason, phase: 'stopping', error: message };
        child.kill('SIGTERM');
        const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 5000);
        force.unref();
      };
      this.viteBuildCancel = () => stop('cancelled', 'Measurement stopped by the user.');
      this.viteBuildTimeout = setTimeout(() => stop('error', 'Vite measurement exceeded the 15 minute limit.'), 15 * 60 * 1000);
      child.stdout?.on('data', (chunk: Buffer) => log(chunk.toString('utf8')));
      child.stderr?.on('data', (chunk: Buffer) => log(chunk.toString('utf8')));
      child.on('message', (message: { type?: string; phase?: string; message?: string; error?: string; measurements?: Array<[string, BuildMeasurement]> }) => {
        if (finished || termination) return;
        if (message.type === 'progress') {
          this.viteBuildStatus.phase = message.phase || 'building';
          if (message.message) log(message.message);
        } else if (message.type === 'error') {
          if (message.error) log(message.error);
          finish('error', message.error || 'Vite measurement failed.');
        } else if (message.type === 'complete' && message.measurements) {
          completedMeasurements = message.measurements;
          this.viteBuildStatus.phase = 'finalizing';
        }
      });
      child.on('error', (error) => finish('error', error.message));
      child.on('exit', (code, signal) => {
        if (termination) finish(termination.state, termination.message);
        else if (code === 0 && completedMeasurements) {
          this.storeBuildMeasurements(appId, completedMeasurements);
          finish('ready');
        }
        else if (!finished) finish('error', `Vite measurement exited before completion (${code ?? signal}).`);
      });
    });
  }

  public close(): void {
    this.scanGeneration++;
    this.viteBuildCancel?.();
    this.stopWebpackBuild();
    this.scanWorker?.terminate();
    this.scanWorker = null;
    void this.statsWorker?.terminate();
    this.statsWorker = null;
    void this.watcher?.close();
    this.watcher = null;
    if (this.locatorTimer) clearTimeout(this.locatorTimer);
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    for (const client of this.controlClients) client.end();
    this.controlClients.clear();
    for (const client of this.sseClients) client.end();
    this.sseClients.clear();
  }
}
