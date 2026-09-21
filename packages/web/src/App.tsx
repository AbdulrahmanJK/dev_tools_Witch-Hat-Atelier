import React, { useCallback, useEffect, useRef } from 'react';
import { Header } from './components/Header.js';
import { InspectorDrawer } from './components/InspectorDrawer.js';
import { Tooltip } from './components/Tooltip.js';
import { WhaCanvas, type WhaCanvasHandle } from './components/WhaCanvas.js';
import { useGrimoireStore } from './store/useGrimoireStore.js';
import { createDefaultTransport, MockTransport } from './transport/index.js';

export const App: React.FC = () => {
  const canvasHandleRef = useRef<WhaCanvasHandle | null>(null);
  const transportRef = useRef(createDefaultTransport());

  const setGraph = useGrimoireStore((s) => s.setGraph);

  const loadData = useCallback(async () => {
    try {
      const graph = await transportRef.current.getGraph();
      setGraph(graph);
    } catch {
      // If HTTP server is not running (e.g. pure Vite dev), fallback to mock data
      const mock = new MockTransport();
      const mockGraph = await mock.getGraph();
      setGraph(mockGraph);
    }
  }, [setGraph]);

  useEffect(() => {
    loadData();
    const unsubscribe = transportRef.current.subscribeEvents(() => {
      loadData();
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

  const handleMountCanvas = useCallback((handle: WhaCanvasHandle) => {
    canvasHandleRef.current = handle;
  }, []);

  const handleFocusNode = useCallback((id: string) => {
    canvasHandleRef.current?.focusNode(id);
  }, []);

  return (
    <div id="app-container">
      <Header onFitKingdom={handleFitKingdom} />
      <WhaCanvas onMount={handleMountCanvas} />
      <InspectorDrawer transport={transportRef.current} onFocusNode={handleFocusNode} />
      <Tooltip />
    </div>
  );
};
