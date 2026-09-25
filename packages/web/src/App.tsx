import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header.js';
import { InspectorDrawer } from './components/InspectorDrawer.js';
import { Tooltip } from './components/Tooltip.js';
import { WhaCanvas, type WhaCanvasHandle } from './components/WhaCanvas.js';
import { ScanStatusPanel } from './components/ScanStatusPanel.js';
import { useGrimoireStore } from './store/useGrimoireStore.js';
import { createDefaultTransport, MockTransport } from './transport/index.js';
import type { DevtoolsInstallStatus, ScanStatus } from './transport/transport.js';

export const App: React.FC = () => {
  const canvasHandleRef = useRef<WhaCanvasHandle | null>(null);
  const transportRef = useRef(createDefaultTransport());
  const lastRequestedScanRef = useRef(0);
  const [serverConnected, setServerConnected] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [showScanStatus, setShowScanStatus] = useState(true);
  const graphReady = useGrimoireStore((s) => Boolean(s.graph));
  const locale = useGrimoireStore((s) => s.locale);
  const lightweightMode = useGrimoireStore((s) => s.lightweightMode);

  useEffect(() => {
    document.body.classList.toggle('lightweight-map', lightweightMode);
    return () => document.body.classList.remove('lightweight-map');
  }, [lightweightMode]);

  const setGraph = useGrimoireStore((s) => s.setGraph);

  const loadData = useCallback(async () => {
    try {
      const graph = await transportRef.current.getGraph();
      setGraph(graph);
      setShowScanStatus(false);
      if (graph.dependencies?.some((dependency) => dependency.build)) useGrimoireStore.getState().saveBuildSnapshot(graph);
      setServerConnected(Boolean(transportRef.current.measureBuild));
    } catch (error) {
      setShowScanStatus(true);
      setScanStatus((current) => current?.state === 'running' ? current : {
        state: 'error', phase: 'error', completed: null, total: null, file: null,
        startedAt: Date.now(), updatedAt: Date.now(), error: String(error instanceof Error ? error.message : error), logs: [],
      });
    }
  }, [setGraph]);

  useEffect(() => {
    if (transportRef.current.getScanStatus) {
      void transportRef.current.getScanStatus().then((status) => {
        setScanStatus(status);
        if (status.state === 'ready' && status.updatedAt > lastRequestedScanRef.current) {
          lastRequestedScanRef.current = status.updatedAt;
          void loadData();
        }
      }).catch(async (error) => {
        if (error instanceof Error && error.message === 'Scan status endpoint unavailable') {
          const mock = new MockTransport();
          setGraph(await mock.getGraph());
          setServerConnected(false);
          setShowScanStatus(false);
        } else {
          setScanStatus({ state: 'error', phase: 'error', completed: null, total: null, file: null,
            startedAt: Date.now(), updatedAt: Date.now(), error: String(error), logs: [] });
        }
      });
    } else void loadData();
    const unsubscribe = transportRef.current.subscribeEvents(() => {
      if (!transportRef.current.getScanStatus) void loadData();
    }, (payload) => {
      const store = useGrimoireStore.getState();
      const mapped = store.recordTelemetryBatch(Array.isArray(payload) ? payload : [payload]);
      for (const { event, nodeId } of mapped) {
        if (event.type === 'LOCATE') {
          store.selectNode(nodeId);
          canvasHandleRef.current?.focusNode(nodeId);
        } else canvasHandleRef.current?.showTelemetry(nodeId, event, useGrimoireStore.getState().nodeMap.get(nodeId)?.telemetry);
      }
    }, (status) => {
      setScanStatus(status);
      if (status.state === 'running' || status.state === 'error' || status.state === 'cancelled') setShowScanStatus(true);
      if (status.state === 'ready' && status.updatedAt > lastRequestedScanRef.current) {
        lastRequestedScanRef.current = status.updatedAt;
        void loadData();
      }
    });

    // Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      const store = useGrimoireStore.getState();
      if (e.key === 'Escape') {
        store.selectNode(null);
        store.setDrawerOpen(false);
      } else if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        store.toggleRealistic();
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        canvasHandleRef.current?.fitKingdom();
      } else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('node-search')?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      unsubscribe();
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [loadData, setGraph]);

  const handleRetryScan = useCallback(async () => {
    if (!transportRef.current.retryScan) return;
    try { setScanStatus(await transportRef.current.retryScan()); }
    catch (error) { setScanStatus((current) => current ? { ...current, state: 'error', error: String(error) } : null); }
  }, []);

  const handleCancelScan = useCallback(async () => {
    if (!transportRef.current.cancelScan) return;
    try { setScanStatus(await transportRef.current.cancelScan()); }
    catch (error) { setScanStatus((current) => current ? { ...current, state: 'error', error: String(error) } : null); }
  }, []);

  const handleWatchPath = useCallback(async (relativePath: string | null) => {
    if (!transportRef.current.setWatchPath) throw new Error('Folder watching requires the local Grimoire server.');
    const result = await transportRef.current.setWatchPath(relativePath);
    setScanStatus((current) => current ? { ...current, watchPath: result.path } : current);
  }, []);

  const handleFitKingdom = useCallback(() => {
    canvasHandleRef.current?.fitKingdom();
  }, []);

  const handleFitNodes = useCallback((nodeIds: string[]) => {
    canvasHandleRef.current?.fitNodes(nodeIds);
  }, []);

  const handleMountCanvas = useCallback((handle: WhaCanvasHandle) => {
    canvasHandleRef.current = handle;
  }, []);

  const handleMeasureBuild = useCallback(async (appId?: string) => {
    if (!transportRef.current.measureBuild) throw new Error('Build measurement requires the local Grimoire server.');
    return transportRef.current.measureBuild(appId);
  }, []);

  const handleImportWebpackStats = useCallback(async (relativePath: string) => {
    if (!transportRef.current.importWebpackStats) throw new Error('Webpack stats import requires the local Grimoire server.');
    return transportRef.current.importWebpackStats(relativePath);
  }, []);
  const handleGetWebpackBuildStatus = useCallback(() => transportRef.current.getWebpackBuildStatus!(), []);
  const handleStartWebpackBuild = useCallback((appId: string, script: string, statsPath: string) => transportRef.current.startWebpackBuild!(appId, script, statsPath), []);
  const handleStopWebpackBuild = useCallback(() => transportRef.current.stopWebpackBuild!(), []);

  const handleGetDevtoolsInstallStatus = useCallback(async (appId?: string): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.getDevtoolsInstallStatus) throw new Error('One-click setup requires the local Grimoire server.');
    return transportRef.current.getDevtoolsInstallStatus(appId);
  }, []);

  const handleInstallDevtools = useCallback(async (appId?: string): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.installDevtools) throw new Error('One-click setup requires the local Grimoire server.');
    return transportRef.current.installDevtools(appId);
  }, []);

  const handleRemoveDevtools = useCallback(async (appId?: string): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.removeDevtools) throw new Error('One-click setup requires the local Grimoire server.');
    return transportRef.current.removeDevtools(appId);
  }, []);

  const handleUpgradeDevtools = useCallback(async (appId?: string): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.upgradeDevtools) throw new Error('Upgrade requires the local Grimoire server.');
    return transportRef.current.upgradeDevtools(appId);
  }, []);

  const handleRefreshDevtools = useCallback(async (appId?: string): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.refreshDevtools) throw new Error('Adapter refresh requires the local Grimoire server.');
    return transportRef.current.refreshDevtools(appId);
  }, []);

  const handleGetWebpackInstallStatus = useCallback(async (appId: string, entry?: string, script?: string) => {
    if (!transportRef.current.getWebpackInstallStatus) throw new Error('Webpack setup requires the local Grimoire server.');
    return transportRef.current.getWebpackInstallStatus(appId, entry, script);
  }, []);
  const handleInstallWebpackDevtools = useCallback(async (appId: string, entry: string, script: string) => {
    if (!transportRef.current.installWebpackDevtools) throw new Error('Webpack setup requires the local Grimoire server.');
    return transportRef.current.installWebpackDevtools(appId, entry, script);
  }, []);
  const handleRemoveWebpackDevtools = useCallback(async (appId: string) => {
    if (!transportRef.current.removeWebpackDevtools) throw new Error('Webpack setup requires the local Grimoire server.');
    return transportRef.current.removeWebpackDevtools(appId);
  }, []);
  const handleRefreshWebpackDevtools = useCallback(async (appId: string) => {
    if (!transportRef.current.refreshWebpackDevtools) throw new Error('Webpack refresh requires the local Grimoire server.');
    return transportRef.current.refreshWebpackDevtools(appId);
  }, []);

  const handleStartLocator = useCallback(async () => {
    if (!transportRef.current.startElementLocator) throw new Error('Element locator requires the local Grimoire server.');
    return transportRef.current.startElementLocator();
  }, []);

  const handleFocusNode = useCallback((id: string) => {
    canvasHandleRef.current?.focusNode(id);
  }, []);

  const handleFocusDependency = useCallback((id: string) => {
    canvasHandleRef.current?.focusDependency(id);
  }, []);

  return (
    <div id="app-container">
      <Header onFitKingdom={handleFitKingdom} onFitNodes={handleFitNodes} onFocusNode={handleFocusNode} onFocusDependency={handleFocusDependency} onMeasureBuild={serverConnected ? handleMeasureBuild : undefined}
        onRefreshMap={serverConnected ? () => { void handleRetryScan(); } : undefined}
        onShowScanLog={serverConnected ? () => setShowScanStatus(true) : undefined}
        hasScanWarnings={scanStatus?.logs.some((entry) => entry.level !== 'info')}
        onGetDevtoolsInstallStatus={serverConnected ? handleGetDevtoolsInstallStatus : undefined}
        onInstallDevtools={serverConnected ? handleInstallDevtools : undefined}
        onUpgradeDevtools={serverConnected ? handleUpgradeDevtools : undefined}
        onRefreshDevtools={serverConnected ? handleRefreshDevtools : undefined}
        onRemoveDevtools={serverConnected ? handleRemoveDevtools : undefined}
        onGetWebpackInstallStatus={serverConnected ? handleGetWebpackInstallStatus : undefined}
        onInstallWebpackDevtools={serverConnected ? handleInstallWebpackDevtools : undefined}
        onRemoveWebpackDevtools={serverConnected ? handleRemoveWebpackDevtools : undefined}
        onRefreshWebpackDevtools={serverConnected ? handleRefreshWebpackDevtools : undefined} />
      {graphReady && <WhaCanvas onMount={handleMountCanvas} onMeasureBuild={serverConnected ? handleMeasureBuild : undefined} onImportWebpackStats={serverConnected ? handleImportWebpackStats : undefined}
        onGetWebpackBuildStatus={serverConnected ? handleGetWebpackBuildStatus : undefined} onStartWebpackBuild={serverConnected ? handleStartWebpackBuild : undefined}
        onStopWebpackBuild={serverConnected ? handleStopWebpackBuild : undefined} onStartLocator={serverConnected ? handleStartLocator : undefined} />}
      <InspectorDrawer transport={transportRef.current} onFocusNode={handleFocusNode} />
      <Tooltip />
      {showScanStatus && <ScanStatusPanel status={scanStatus} locale={locale} compact={graphReady} onRetry={handleRetryScan} onCancel={handleCancelScan} onWatchPath={serverConnected ? handleWatchPath : undefined} onClose={graphReady && scanStatus?.state === 'ready' ? () => setShowScanStatus(false) : undefined} />}
    </div>
  );
};
