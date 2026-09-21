import React, { useCallback, useEffect, useRef } from 'react';
import { Camera, WorldRenderer } from '@wha/canvas-engine';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

export interface WhaCanvasHandle {
  focusNode: (nodeId: string) => void;
  fitKingdom: () => void;
}

interface WhaCanvasProps {
  onMount?: (handle: WhaCanvasHandle) => void;
}

export const WhaCanvas: React.FC<WhaCanvasProps> = ({ onMount }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const renderScheduledRef = useRef(false);

  const graph = useGrimoireStore((s) => s.graph);
  const selectedNodeId = useGrimoireStore((s) => s.selectedNodeId);
  const lineageNodes = useGrimoireStore((s) => s.lineageNodes);
  const lineageEdges = useGrimoireStore((s) => s.lineageEdges);
  const activeFilter = useGrimoireStore((s) => s.activeFilter);
  const unifiedMode = useGrimoireStore((s) => s.unifiedMode);
  const realisticMode = useGrimoireStore((s) => s.realisticMode);
  const zoomPercent = useGrimoireStore((s) => s.zoomPercent);

  const requestRender = useCallback(() => {
    if (renderScheduledRef.current) return;
    renderScheduledRef.current = true;

    requestAnimationFrame((time) => {
      renderScheduledRef.current = false;
      if (!rendererRef.current || !cameraRef.current) return;

      const { hasActiveAnimation } = rendererRef.current.render(time);

      const currentPct = Math.round(cameraRef.current.zoom * 100);
      const store = useGrimoireStore.getState();
      if (currentPct !== store.zoomPercent) {
        store.setZoomPercent(currentPct);
      }

      if (hasActiveAnimation) {
        requestRender();
      }
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const camera = new Camera(canvas);
    const renderer = new WorldRenderer(canvas, camera);

    cameraRef.current = camera;
    rendererRef.current = renderer;

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      camera.resize(w, h);
      requestRender();
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    camera.onUpdate = () => requestRender();

    camera.onClick = (_e, worldPos) => {
      const hit = renderer.hitTestNode(worldPos.x, worldPos.y);
      const store = useGrimoireStore.getState();
      if (hit) {
        store.selectNode(hit.id);
      } else {
        store.selectNode(null);
      }
      requestRender();
    };

    camera.onHover = (worldPos) => {
      const hit = renderer.hitTestNode(worldPos.x, worldPos.y);
      const store = useGrimoireStore.getState();
      if (hit) {
        const screenPos = camera.worldToScreen(hit.x, hit.y);
        store.hoverNode(hit.id, screenPos.x, screenPos.y);
        renderer.setHoveredNode(hit.id);
      } else {
        store.hoverNode(null);
        renderer.setHoveredNode(null);
      }
      requestRender();
    };

    if (onMount) {
      onMount({
        focusNode: (nodeId: string) => {
          const target = renderer.nodeMap.get(nodeId);
          if (target) {
            camera.focusOnNode(target, 0.9);
          }
        },
        fitKingdom: () => {
          const currentGraph = useGrimoireStore.getState().graph;
          if (currentGraph?.bounds) {
            camera.fitBounds(currentGraph.bounds);
          }
        },
      });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      camera.destroy();
    };
  }, [onMount, requestRender]);

  const hasFittedRef = useRef(false);

  // Update renderer when graph data changes
  useEffect(() => {
    if (rendererRef.current && cameraRef.current && graph) {
      rendererRef.current.setData(graph);

      if (!hasFittedRef.current) {
        hasFittedRef.current = true;
        const rootNode = graph.nodes?.find(
          (n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root'))
        );
        if (rootNode) {
          cameraRef.current.x = rootNode.x;
          cameraRef.current.y = rootNode.y;
          cameraRef.current.zoom = 0.42;
          useGrimoireStore.getState().selectNode(rootNode.id);
        } else if (graph.bounds) {
          cameraRef.current.fitBounds(graph.bounds);
        }
      }

      requestRender();
    }
  }, [graph, requestRender]);

  // Update renderer when selected node or lineage changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setSelectedNode(selectedNodeId, lineageNodes, lineageEdges);
      requestRender();
    }
  }, [selectedNodeId, lineageNodes, lineageEdges, requestRender]);

  // Update renderer when modes change
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setModes({ unifiedMode, realisticMode, activeFilter });
      requestRender();
    }
  }, [unifiedMode, realisticMode, activeFilter, requestRender]);

  const handleZoomIn = () => {
    if (cameraRef.current) {
      cameraRef.current.zoomAt(cameraRef.current.width / 2, cameraRef.current.height / 2, 1.25);
    }
  };

  const handleZoomOut = () => {
    if (cameraRef.current) {
      cameraRef.current.zoomAt(cameraRef.current.width / 2, cameraRef.current.height / 2, 0.8);
    }
  };

  return (
    <main id="viewport-container" style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas id="grimoire-canvas" ref={canvasRef} />

      {/* Canvas HUD */}
      <div className="canvas-hud">
        <button className="hud-btn" id="btn-zoom-out" onClick={handleZoomOut}>
          −
        </button>
        <span className="zoom-level-text" id="zoom-text">
          {zoomPercent}%
        </span>
        <button className="hud-btn" id="btn-zoom-in" onClick={handleZoomIn}>
          +
        </button>
      </div>
    </main>
  );
};
