import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import { ClusterLayout, GraphBuilder, type DependencySeal, type GraphBuildProgress } from '@wha/core';
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
  const measurementGroups = workerData.buildMeasurementsByApp as Array<[string, Array<[string, NonNullable<DependencySeal['build']>]>]>;
  const activeBuildAppId = String(workerData.activeBuildAppId || '');
  const seals = graph.dependencies || [];
  const byName = new Map(seals.map((seal) => [seal.name, seal]));
  for (const [appId, measurements] of measurementGroups) {
    for (const [name, measurement] of measurements) {
      let seal = byName.get(name);
      if (!seal) {
        seal = { id: `dependency:${name}`, name, version: null, direct: false, importerNodeIds: [], importCount: 0, dynamicImportCount: 0, sourceRisk: 'unknown', x: 0, y: 0, radius: 24 };
        seals.push(seal);
        byName.set(name, seal);
      }
      const value = { ...measurement, appId };
      (seal.buildsByApp ||= {})[appId] = value;
      if (appId === activeBuildAppId) seal.build = value;
      seal.radius = Math.max(seal.radius, Math.min(62, 24 + Math.sqrt((measurement.emittedBytesEstimate || 0) / 1024) * 3.2));
    }
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
  result.activeBuildAppId = activeBuildAppId;
  send({ type: 'complete', graph: result });
} catch (error) {
  send({ type: 'error', error: error instanceof Error ? error.stack || error.message : String(error) });
}
