import { parentPort, workerData } from 'node:worker_threads';
import { importWebpackStats, WebpackCompilationSelectionError } from './webpackStats.js';

try {
  parentPort?.postMessage({ measurements: [...importWebpackStats(workerData.targetDir, workerData.relativeFile, workerData.compilationId)] });
} catch (error) {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error),
    compilations: error instanceof WebpackCompilationSelectionError ? error.compilations : undefined });
}
