#!/usr/bin/env node

import path from 'node:path';
import { GrimoireServer } from '../dist/index.js';

const args = process.argv.slice(2);
let targetDir = process.cwd();
let port = 4173;
const runtimeOrigins = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--port' || arg === '-p') {
    port = parseInt(args[++i], 10) || 4173;
  } else if (arg === '--allow-origin') {
    const origin = args[++i];
    if (!origin) { console.error('--allow-origin requires an http(s) origin.'); process.exit(2); }
    runtimeOrigins.push(origin);
  } else if (!arg.startsWith('-')) {
    targetDir = path.resolve(arg);
  }
}

console.log(`\n🧙 Initiating Witch Hat Atelier Architectural Grimoire...`);
const server = new GrimoireServer(targetDir, port, runtimeOrigins);

server.start().catch((err) => {
  console.error('Failed to manifest Grimoire:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n✦ Closing the Grimoire...');
  server.close();
  process.exit(0);
});
