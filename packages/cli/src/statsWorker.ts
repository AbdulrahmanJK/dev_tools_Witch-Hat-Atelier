import { parentPort, workerData } from 'node:worker_threads';
import { importWebpackStats } from './webpackStats.js';

try {
  parentPort?.postMessage({ measurements: [...importWebpackStats(workerData.targetDir, workerData.relativeFile)] });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
