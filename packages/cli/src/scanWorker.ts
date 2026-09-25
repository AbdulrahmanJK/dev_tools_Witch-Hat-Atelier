import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { ClusterLayout, GraphBuilder, type GraphBuildProgress } from '@wha/core';
import { layoutFingerprint, readLayoutCache, writeLayoutCache } from './layoutCache.js';

const port = parentPort;
if (!port) throw new Error('Scan worker requires a parent port.');

const send = (message: unknown) => port.postMessage(message);

try {
  if (!fs.existsSync(workerData.targetDir) || !fs.statSync(workerData.targetDir).isDirectory()) {
    throw new Error(`Каталог проекта не найден: ${workerData.targetDir}`);
  }
  const builder = new GraphBuilder(workerData.targetDir as string);
  const graph = builder.buildGraph((progress: GraphBuildProgress) => send({ type: 'progress', progress }));
  const measurements = workerData.buildMeasurements as Array<[string, { renderedBytes: number; emittedBytesEstimate: number; initial: boolean; chunks: string[]; measuredAt: number }]>;
  const seals = graph.dependencies || [];
  for (const [name, measurement] of measurements) {
    let seal = seals.find((item) => item.name === name);
    if (!seal) {
      seal = { id: `dependency:${name}`, name, version: null, direct: false, importerNodeIds: [], importCount: 0, dynamicImportCount: 0, sourceRisk: 'unknown', x: 0, y: 0, radius: 24 };
      seals.push(seal);
    }
    seal.build = measurement;
    seal.radius = Math.max(seal.radius, Math.min(62, 24 + Math.sqrt(measurement.emittedBytesEstimate / 1024) * 3.2));
  }
  graph.dependencies = seals;
  send({ type: 'progress', progress: { phase: 'layout' } });
  const fingerprint = layoutFingerprint(graph);
  let result = readLayoutCache(workerData.targetDir, fingerprint, graph);
  if (result) send({ type: 'progress', progress: { phase: 'layout', file: 'cached layout' } });
  else {
    result = new ClusterLayout().computeLayout(graph, (phase, completed, total) => {
      send({ type: 'progress', progress: { phase, completed, total } });
    });
    writeLayoutCache(workerData.targetDir, fingerprint, result);
  }
  send({ type: 'progress', progress: { phase: 'transferring' } });
  send({ type: 'complete', graph: result });
} catch (error) {
  send({ type: 'error', error: error instanceof Error ? error.stack || error.message : String(error) });
}
