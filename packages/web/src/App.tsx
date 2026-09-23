import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header.js';
import { InspectorDrawer } from './components/InspectorDrawer.js';
import { Tooltip } from './components/Tooltip.js';
import { WhaCanvas, type WhaCanvasHandle } from './components/WhaCanvas.js';
import { useGrimoireStore } from './store/useGrimoireStore.js';
import { createDefaultTransport, MockTransport } from './transport/index.js';
import type { DevtoolsInstallStatus } from './transport/transport.js';

export const App: React.FC = () => {
  const canvasHandleRef = useRef<WhaCanvasHandle | null>(null);
  const transportRef = useRef(createDefaultTransport());
  const [serverConnected, setServerConnected] = useState(false);

  const setGraph = useGrimoireStore((s) => s.setGraph);

  const loadData = useCallback(async () => {
    try {
      const graph = await transportRef.current.getGraph();
      setGraph(graph);
      setServerConnected(Boolean(transportRef.current.measureBuild));
    } catch {
      // If HTTP server is not running (e.g. pure Vite dev), fallback to mock data
      const mock = new MockTransport();
      const mockGraph = await mock.getGraph();
      setGraph(mockGraph);
      setServerConnected(false);
    }
  }, [setGraph]);

  useEffect(() => {
    loadData();
    const unsubscribe = transportRef.current.subscribeEvents(() => {
      loadData();
    }, (payload) => {
      for (const event of Array.isArray(payload) ? payload : [payload]) {
        const id = useGrimoireStore.getState().recordTelemetry(event);
        if (id) canvasHandleRef.current?.showTelemetry(id, event, useGrimoireStore.getState().nodeMap.get(id)?.telemetry);
      }
    });

    // Keyboard Shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      const store = useGrimoireStore.getState();
      if (e.key === 'Escape') {
        store.selectNode(null);
        store.setDrawerOpen(false);
      } else if (e.key === 'u' || e.key === 'U' || e.key === 'г' || e.key === 'Г') {
        store.toggleUnified();
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
  }, [loadData]);

  const handleFitKingdom = useCallback(() => {
    canvasHandleRef.current?.fitKingdom();
  }, []);

  const handleFitNodes = useCallback((nodeIds: string[]) => {
    canvasHandleRef.current?.fitNodes(nodeIds);
  }, []);

  const handleMountCanvas = useCallback((handle: WhaCanvasHandle) => {
    canvasHandleRef.current = handle;
  }, []);

  const handleMeasureBuild = useCallback(async () => {
    if (!transportRef.current.measureBuild) throw new Error('Build measurement requires the local Grimoire server.');
    const result = await transportRef.current.measureBuild();
    await loadData();
    return result;
  }, [loadData]);

  const handleGetDevtoolsInstallStatus = useCallback(async (): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.getDevtoolsInstallStatus) throw new Error('One-click setup requires the local Grimoire server.');
    return transportRef.current.getDevtoolsInstallStatus();
  }, []);

  const handleInstallDevtools = useCallback(async (): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.installDevtools) throw new Error('One-click setup requires the local Grimoire server.');
    return transportRef.current.installDevtools();
  }, []);

  const handleRemoveDevtools = useCallback(async (): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.removeDevtools) throw new Error('One-click setup requires the local Grimoire server.');
    return transportRef.current.removeDevtools();
  }, []);

  const handleUpgradeDevtools = useCallback(async (): Promise<DevtoolsInstallStatus> => {
    if (!transportRef.current.upgradeDevtools) throw new Error('Upgrade requires the local Grimoire server.');
    return transportRef.current.upgradeDevtools();
  }, []);

  const handleFocusNode = useCallback((id: string) => {
    canvasHandleRef.current?.focusNode(id);
  }, []);

  return (
    <div id="app-container">
      <Header onFitKingdom={handleFitKingdom} onFitNodes={handleFitNodes} onMeasureBuild={serverConnected ? handleMeasureBuild : undefined}
        onGetDevtoolsInstallStatus={serverConnected ? handleGetDevtoolsInstallStatus : undefined}
        onInstallDevtools={serverConnected ? handleInstallDevtools : undefined}
        onUpgradeDevtools={serverConnected ? handleUpgradeDevtools : undefined}
        onRemoveDevtools={serverConnected ? handleRemoveDevtools : undefined} />
      <WhaCanvas onMount={handleMountCanvas} onMeasureBuild={serverConnected ? handleMeasureBuild : undefined} />
      <InspectorDrawer transport={transportRef.current} onFocusNode={handleFocusNode} />
      <Tooltip />
    </div>
  );
};
