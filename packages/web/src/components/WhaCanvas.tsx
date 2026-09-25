import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { DevToolsTelemetryEvent, SealNode } from '@wha/core';
import { Camera, WorldRenderer, VFXEngine } from '@wha/canvas-engine';
import { useGrimoireStore } from '../store/useGrimoireStore.js';
import { translate } from '../i18n.js';
import { DevtoolsOverview } from './DevtoolsOverview.js';
import type { WebpackBuildStatus } from '../transport/transport.js';
import { DevtoolsWorkbench } from './DevtoolsWorkbench.js';

export interface WhaCanvasHandle {
  focusNode: (nodeId: string) => void;
  focusDependency: (dependencyId: string) => void;
  fitKingdom: () => void;
  fitNodes: (nodeIds: string[]) => void;
  showTelemetry: (nodeId: string, event: DevToolsTelemetryEvent, telemetry?: SealNode['telemetry']) => void;
}

interface WhaCanvasProps {
  onMount?: (handle: WhaCanvasHandle) => void;
  onMeasureBuild?: (appId?: string) => Promise<{ measured: number }>;
  onImportWebpackStats?: (relativePath: string) => Promise<{ measured: number }>;
  onGetWebpackBuildStatus?: () => Promise<WebpackBuildStatus>;
  onStartWebpackBuild?: (appId: string, script: string, statsPath: string) => Promise<WebpackBuildStatus>;
  onStopWebpackBuild?: () => Promise<WebpackBuildStatus>;
  onStartLocator?: () => Promise<{ locate: boolean; expiresAt: number }>;
}

export const WhaCanvas: React.FC<WhaCanvasProps> = ({ onMount, onMeasureBuild, onImportWebpackStats, onGetWebpackBuildStatus, onStartWebpackBuild, onStopWebpackBuild, onStartLocator }) => {
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [overlapPicker, setOverlapPicker] = useState<{ x: number; y: number; nodes: SealNode[] } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const vfxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const vfxEngineRef = useRef<VFXEngine | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const hoveredDependencyIdRef = useRef<string | null>(null);
  const renderScheduledRef = useRef(false);
  const fullRenderRequiredRef = useRef(false);
  const renderFrameRef = useRef<number | null>(null);
  const animationTimerRef = useRef<number | null>(null);

  const graph = useGrimoireStore((s) => s.graph);
  const selectedNodeId = useGrimoireStore((s) => s.selectedNodeId);
  const selectedDependencyId = useGrimoireStore((s) => s.selectedDependencyId);
  const lineageNodes = useGrimoireStore((s) => s.lineageNodes);
  const activeFilter = useGrimoireStore((s) => s.activeFilter);
  const realisticMode = useGrimoireStore((s) => s.realisticMode);
  const lightweightMode = useGrimoireStore((s) => s.lightweightMode);
  const devToolsMode = useGrimoireStore((s) => s.devToolsMode);
  const diagnosticFilter = useGrimoireStore((s) => s.diagnosticFilter);
  const zoomPercent = useGrimoireStore((s) => s.zoomPercent);
  const locale = useGrimoireStore((s) => s.locale);
  useEffect(() => { if (!devToolsMode) setAnalysisOpen(false); }, [devToolsMode]);

  const requestRender = useCallback((effectsOnly = false) => {
    if (document.hidden) return;
    if (!effectsOnly) fullRenderRequiredRef.current = true;
    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current);
      animationTimerRef.current = null;
    }
    if (renderScheduledRef.current) return;
    renderScheduledRef.current = true;

    renderFrameRef.current = requestAnimationFrame((time) => {
      renderFrameRef.current = null;
      renderScheduledRef.current = false;
      if (document.hidden || !rendererRef.current || !cameraRef.current) return;

      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const fullRender = fullRenderRequiredRef.current || !renderer.canRenderEffectsOnly();
      fullRenderRequiredRef.current = false;
      const { hasActiveAnimation } = fullRender ? renderer.render(time) : renderer.renderEffectsOnly(time);

      const percent = camera.zoom * 100;
      const currentPct = percent < 0.1 ? Number(percent.toPrecision(2)) : percent < 10 ? Number(percent.toFixed(1)) : Math.round(percent);
      const store = useGrimoireStore.getState();
      if (currentPct !== store.zoomPercent) {
        store.setZoomPercent(currentPct);
      }

      if (hasActiveAnimation && !camera.animating) {
        // Ambient effects remain animated; a fresh interaction or telemetry event
        // still schedules its next frame immediately.
        const graphSize = rendererRef.current.nodes.length;
        const ambientFps = graphSize > 500 ? 20 : graphSize > 200 ? 24 : 30;
        // Leave room for the next display frame after the timer fires.
        animationTimerRef.current = window.setTimeout(() => requestRender(true), Math.max(0, 1000 / ambientFps - 16));
      }
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const vfxCanvas = vfxCanvasRef.current;
    if (!canvas || !vfxCanvas) return;

    const camera = new Camera(canvas);
    camera.reducedMotion = useGrimoireStore.getState().lightweightMode;
    const renderer = new WorldRenderer(canvas, camera);
    const vfxEngine = new VFXEngine(vfxCanvas);

    renderer.setVFXEngine(vfxEngine);

    cameraRef.current = camera;
    rendererRef.current = renderer;
    vfxEngineRef.current = vfxEngine;

    (window as any).__GRIMOIRE_RENDERER__ = renderer;
    (window as any).__GRIMOIRE_VFX__ = vfxEngine;

    const handleResize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      vfxEngine.resize(w, h, dpr);
      camera.resize(w, h);
      requestRender();
    };

    window.addEventListener('resize', handleResize);
    const handleVisibility = () => {
      if (document.hidden) {
        if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
        if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
        renderFrameRef.current = null;
        animationTimerRef.current = null;
        renderScheduledRef.current = false;
      } else requestRender();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    handleResize();

    camera.onUpdate = () => requestRender();

    camera.onClick = (event, worldPos) => {
      const candidates = renderer.hitTestNodeCandidates(worldPos.x, worldPos.y, 8);
      if (renderer.nodes.length > 1500 && camera.zoom < 0.07 && candidates.length > 1) {
        const rect = canvas.getBoundingClientRect();
        setOverlapPicker({ x: Math.max(8, Math.min(event.clientX - rect.left, camera.width - 270)),
          y: Math.max(8, Math.min(event.clientY - rect.top, camera.height - 320)), nodes: candidates });
        return;
      }
      setOverlapPicker(null);
      const hit = candidates[0] || null;
      const dependency = renderer.hitTestDependency(worldPos.x, worldPos.y);
      const store = useGrimoireStore.getState();
      if (hit) {
        store.selectNode(hit.id);
      } else if (dependency) {
        store.selectDependency(dependency.id);
      } else {
        store.selectNode(null);
      }
      requestRender();
    };

    camera.onDoubleClick = (_e, worldPos) => {
      setOverlapPicker(null);
      const hit = renderer.hitTestNode(worldPos.x, worldPos.y);
      const dependency = renderer.hitTestDependency(worldPos.x, worldPos.y);
      if (!hit && !dependency) {
        const store = useGrimoireStore.getState();
        // Double click in empty area: reset filters to 'all' without camera zoom
        store.setDiagnosticFilter('all');
        store.setFilter('all');
        store.selectNode(null);
        requestRender();
      }
    };

    camera.onHover = (worldPos) => {
      const hit = worldPos ? renderer.hitTestNode(worldPos.x, worldPos.y) : null;
      const dependency = worldPos && !hit ? renderer.hitTestDependency(worldPos.x, worldPos.y) : null;
      const store = useGrimoireStore.getState();
      const nextNodeId = hit?.id || null;
      const nextDependencyId = hit ? null : dependency?.id || null;
      if (renderer.hoveredNodeId === nextNodeId && hoveredDependencyIdRef.current === nextDependencyId) return;
      const previousNodeId = renderer.hoveredNodeId;
      hoveredDependencyIdRef.current = nextDependencyId;
      if (hit) {
        canvas.style.cursor = 'pointer';
        const screenPos = camera.worldToScreen(hit.x, hit.y);
        const rect = canvas.getBoundingClientRect();
        store.hoverNode(hit.id, rect.left + screenPos.x, rect.top + screenPos.y);
        renderer.setHoveredNode(hit.id);
      } else if (dependency) {
        canvas.style.cursor = 'pointer';
        const screenPos = camera.worldToScreen(dependency.x, dependency.y);
        const rect = canvas.getBoundingClientRect();
        store.hoverDependency(dependency.id, rect.left + screenPos.x, rect.top + screenPos.y);
        renderer.setHoveredNode(null);
      } else {
        store.hoverNode(null);
        renderer.setHoveredNode(null);
        canvas.style.cursor = '';
      }
      if (previousNodeId !== nextNodeId && renderer.hoverAffectsRender()) requestRender();
    };

    if (onMount) {
      onMount({
        focusNode: (nodeId: string) => {
          const target = renderer.nodeMap.get(nodeId);
          if (target) {
            camera.focusOnNode(target, 0.9);
          }
        },
        focusDependency: (dependencyId: string) => {
          const target = renderer.dependencies.find((dependency) => dependency.id === dependencyId);
          if (target) camera.animateTo(target.x, target.y, 0.85);
        },
        fitKingdom: () => {
          const currentGraph = useGrimoireStore.getState().graph;
          if (currentGraph?.bounds) {
            camera.fitBounds(currentGraph.bounds);
          }
        },
        fitNodes: (nodeIds: string[]) => {
          if (nodeIds.length === 0) return;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          nodeIds.forEach((id) => {
            const n = renderer.nodeMap.get(id);
            if (n) {
              const pos = renderer.getNodePos(n);
              const r = pos.r + 75;
              if (pos.x - r < minX) minX = pos.x - r;
              if (pos.x + r > maxX) maxX = pos.x + r;
              if (pos.y - r < minY) minY = pos.y - r;
              if (pos.y + r > maxY) maxY = pos.y + r;
            }
          });
          if (minX !== Infinity) {
            camera.fitBounds({ minX, minY, maxX, maxY });
            requestRender();
          }
        },
        showTelemetry: (nodeId, event, telemetry) => {
          const node = renderer.nodeMap.get(nodeId);
          if (node && telemetry) node.telemetry = telemetry;
          renderer.triggerDevToolsPulse(nodeId, event);
          requestRender();
        },
      });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (renderFrameRef.current !== null) cancelAnimationFrame(renderFrameRef.current);
      if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
      renderFrameRef.current = null;
      animationTimerRef.current = null;
      renderScheduledRef.current = false;
      fullRenderRequiredRef.current = false;
      camera.destroy();
      vfxEngine.destroy();
    };
  }, [onMount, requestRender]);

  const hasFittedRef = useRef(false);

  // Update renderer when graph data changes
  useEffect(() => {
    if (rendererRef.current && cameraRef.current && graph) {
      setOverlapPicker(null);
      rendererRef.current.setData(graph);

      if (!hasFittedRef.current) {
        hasFittedRef.current = true;
        const rootNode = graph.nodes?.find(
          (n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root'))
        );
        if (graph.nodes.length > 1500 && graph.bounds) {
          cameraRef.current.fitBounds(graph.bounds, false);
        } else if (rootNode) {
          cameraRef.current.x = rootNode.x;
          cameraRef.current.y = rootNode.y;
          cameraRef.current.zoom = 0.42;
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
      rendererRef.current.setSelectedNode(selectedNodeId, lineageNodes);
      requestRender();
    }
  }, [selectedNodeId, lineageNodes, requestRender]);

  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.selectedDependencyId = selectedDependencyId;
    requestRender();
  }, [selectedDependencyId, requestRender]);

  // Update renderer when modes change
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setModes({
        realisticMode,
        lightweightMode,
        activeFilter,
        devToolsMode,
        diagnosticFilter,
      });
      requestRender();
    }
  }, [realisticMode, lightweightMode, activeFilter, devToolsMode, diagnosticFilter, requestRender]);

  useEffect(() => {
    if (!cameraRef.current) return;
    cameraRef.current.reducedMotion = lightweightMode;
    if (lightweightMode) cameraRef.current.stopAnimation();
  }, [lightweightMode]);

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
    <main
      id="viewport-container"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas
        id="grimoire-vfx-canvas"
        ref={vfxCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />
      <canvas
        id="grimoire-canvas"
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 2 }}
      />

      {overlapPicker && <div className="overlap-picker" role="dialog" aria-label={locale === 'ru' ? 'Компоненты в этой точке' : 'Components at this point'} style={{ left: overlapPicker.x, top: overlapPicker.y }} onKeyDown={(event) => { if (event.key === 'Escape') setOverlapPicker(null); }}>
        <div className="overlap-picker-title">{locale === 'ru' ? 'Выберите печать' : 'Choose a seal'}<button type="button" onClick={() => setOverlapPicker(null)} aria-label={translate(locale, 'close')}>×</button></div>
        {overlapPicker.nodes.map((node) => <button key={node.id} type="button" className="overlap-picker-item" onClick={() => {
          useGrimoireStore.getState().selectNode(node.id);
          cameraRef.current?.focusOnNode(node, 0.9);
          setOverlapPicker(null);
        }}><strong>{node.name}</strong><small>{node.file}</small></button>)}
        <p>{locale === 'ru' ? 'Если нужной печати нет, приблизьте карту.' : 'Zoom in if the seal you need is not listed.'}</p>
      </div>}

      <DevtoolsOverview onImportWebpackStats={onImportWebpackStats} onGetWebpackBuildStatus={onGetWebpackBuildStatus}
        onStartWebpackBuild={onStartWebpackBuild} onStopWebpackBuild={onStopWebpackBuild} onFocusNode={(nodeId) => {
        const target = rendererRef.current?.nodeMap.get(nodeId);
        if (target) cameraRef.current?.focusOnNode(target, 0.9);
      }} onMeasureBuild={onMeasureBuild} onOpenAnalysis={() => setAnalysisOpen(true)} />
      {analysisOpen && <DevtoolsWorkbench onClose={() => setAnalysisOpen(false)} onFocusNode={(nodeId) => {
        const target = rendererRef.current?.nodeMap.get(nodeId);
        if (target) cameraRef.current?.focusOnNode(target, 0.9);
      }} onFocusDependency={(dependencyId) => {
        const target = rendererRef.current?.dependencies.find((item) => item.id === dependencyId);
        if (target) cameraRef.current?.animateTo(target.x, target.y, 0.85);
      }} onStartLocator={onStartLocator} />}

      {/* Canvas HUD */}
      <div className="canvas-hud">
        <button className="hud-btn" id="btn-zoom-out" onClick={handleZoomOut}>
          −
        </button>
        <span className="zoom-level-text" id="zoom-text">
          {zoomPercent}%
        </span>
        <button className="hud-btn hud-fit-btn" type="button" title={translate(locale, 'fitKingdom')} aria-label={translate(locale, 'fitKingdom')} onClick={() => {
          const currentGraph = useGrimoireStore.getState().graph;
          if (currentGraph?.bounds && cameraRef.current) cameraRef.current.fitBounds(currentGraph.bounds);
        }}>⊞</button>
        <button className="hud-btn" id="btn-zoom-in" onClick={handleZoomIn}>
          +
        </button>
      </div>
    </main>
  );
};
