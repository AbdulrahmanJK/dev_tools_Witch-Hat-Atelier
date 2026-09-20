import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { GraphBuilder } from '../scanner/graphBuilder.js';
import { ClusterLayout } from '../layout/clusterLayout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '../../client');

const MIME_TYPES = {
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
  constructor(targetDir, port = 4173) {
    this.targetDir = path.resolve(targetDir);
    this.port = port;
    this.server = null;
    this.sseClients = new Set();
    this.cachedGraph = null;
    this.builder = new GraphBuilder(this.targetDir);
    this.layout = new ClusterLayout();
  }

  async start() {
    this.refreshGraph();
    this.setupWatcher();

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${this.port} is occupied, trying ${this.port + 1}...`);
          this.port++;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        console.log(`\n📜 [Witch Hat Atelier] The Grimoire is manifested!`);
        console.log(`✦ Scanned Target: \x1b[36m${this.targetDir}\x1b[0m`);
        console.log(`✦ Inscription URL: \x1b[32mhttp://localhost:${this.port}\x1b[0m\n`);
        resolve(this.port);
      });
    });
  }

  refreshGraph() {
    console.time('✦ Scanned in');
    const rawGraph = this.builder.buildGraph();
    this.cachedGraph = this.layout.computeLayout(rawGraph);
    console.timeEnd('✦ Scanned in');
    console.log(
      `✦ Inscribed ${this.cachedGraph.nodes.length} Glyphs across ${this.cachedGraph.clusters.length} Archipelagos (${this.cachedGraph.edges.length} ink threads).`
    );
  }

  setupWatcher() {
    try {
      const srcDir = path.join(this.targetDir, 'src');
      const watchPath = fs.existsSync(srcDir) ? srcDir : this.targetDir;

      let debounceTimer = null;
      // Watch for changes
      const watcher = chokidar.watch(watchPath, {
        ignored: /(^|[\/\\])\..|node_modules|build|dist/,
        persistent: true,
        ignoreInitial: true,
      });

      watcher.on('all', (event, changedPath) => {
        if (['.js', '.jsx', '.ts', '.tsx'].some((ext) => changedPath.endsWith(ext))) {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            console.log(`\n⚡ Parchment altered: ${path.relative(this.targetDir, changedPath)}`);
            this.refreshGraph();
            this.notifyClients();
          }, 350);
        }
      });
    } catch (err) {
      console.warn('Watcher setup warning:', err.message);
    }
  }

  notifyClients() {
    for (const client of this.sseClients) {
      client.write('data: reload\n\n');
    }
  }

  handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
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
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      this.sseClients.add(res);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 3. Static Files
    let filePath = path.join(CLIENT_DIR, pathname === '/' ? 'index.html' : pathname);

    // Security: Prevent path traversal
    if (!filePath.startsWith(CLIENT_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Page not found in archives');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  }

  close() {
    if (this.server) {
      this.server.close();
    }
  }
}
