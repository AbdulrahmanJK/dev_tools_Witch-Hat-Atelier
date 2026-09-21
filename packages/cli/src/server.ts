import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { ClusterLayout, GraphBuilder, type GrimoireGraph } from '@wha/core';

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
          this.server?.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        console.log(`\n📜 [Witch Hat Atelier] The Architectural Grimoire is manifested!`);
        console.log(`✦ Scanned Target: \x1b[36m${this.targetDir}\x1b[0m`);
        console.log(`✦ Inscription URL: \x1b[32mhttp://localhost:${this.port}\x1b[0m\n`);
        resolve(this.port);
      });
    });
  }

  public refreshGraph(): void {
    console.time('✦ Scanned in');
    const rawGraph = this.builder.buildGraph();
    this.cachedGraph = this.layout.computeLayout(rawGraph);
    console.timeEnd('✦ Scanned in');
    console.log(
      `✦ Inscribed ${this.cachedGraph.nodes.length} Glyphs across ${this.cachedGraph.clusters.length} Archipelagos (${this.cachedGraph.edges.length} ink threads).`
    );
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

  public close(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
