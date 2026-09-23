import React, { useState } from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

interface DevtoolsOverviewProps {
  onFocusNode: (nodeId: string) => void;
  onMeasureBuild?: () => Promise<{ measured: number }>;
}

const kib = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;

export const DevtoolsOverview: React.FC<DevtoolsOverviewProps> = ({ onFocusNode, onMeasureBuild }) => {
  const devToolsMode = useGrimoireStore((s) => s.devToolsMode);
  const nodes = useGrimoireStore((s) => s.nodes);
  const graph = useGrimoireStore((s) => s.graph);
  const dependencies = graph?.dependencies || [];
  const unmatched = useGrimoireStore((s) => s.unmatchedRuntime);
  const recentRenders = useGrimoireStore((s) => s.recentRenders);
  const selectNode = useGrimoireStore((s) => s.selectNode);
  const selectDependency = useGrimoireStore((s) => s.selectDependency);
  const [measuring, setMeasuring] = useState(false);
  const [measureMessage, setMeasureMessage] = useState('');

  if (!devToolsMode) return null;

  const updateCount = nodes.reduce((sum, node) => sum + (node.telemetry?.updateCount || 0), 0);
  const mountCount = nodes.reduce((sum, node) => sum + (node.telemetry?.mountCount || 0), 0);
  const domCount = nodes.reduce((sum, node) => sum + (node.telemetry?.domUpdateCount || 0), 0);
  const activeNodes = nodes.filter((node) => (node.telemetry?.renderCount || 0) > 0)
    .sort((a, b) => (b.telemetry?.updateCount || 0) - (a.telemetry?.updateCount || 0)
      || (b.telemetry?.avgUpdateDurationMs || 0) - (a.telemetry?.avgUpdateDurationMs || 0))
    .slice(0, 4);
  const measured = dependencies.filter((dependency) => dependency.build);
  const libraryBytes = measured.reduce((sum, dependency) => sum + (dependency.build?.emittedBytesEstimate || 0), 0);
  const initialBytes = measured.reduce((sum, dependency) => sum + (dependency.build?.initial ? dependency.build.emittedBytesEstimate || 0 : 0), 0);
  const heaviest = [...measured].sort((a, b) => (b.build?.emittedBytesEstimate || 0) - (a.build?.emittedBytesEstimate || 0)).slice(0, 4);

  return <aside className="devtools-overview" aria-label="DevTools overview">
    <div className="devtools-overview-title">⚡ DevTools · сводка</div>
    <div className="devtools-overview-stats">
      <div><strong>{updateCount}</strong><span>повторных обновлений</span></div>
      <div><strong>{mountCount}</strong><span>первых mount</span></div>
      <div><strong>{domCount}</strong><span>наблюдений DOM</span></div>
    </div>
    <p className="devtools-overview-note">Золотое кольцо — обновление, зелёное — mount или изменение DOM. DOM-события не равны рендерам.</p>
    {unmatched.renders > 0 && <p className="devtools-overview-warning">Ещё {unmatched.renders} событий Profiler не удалось однозначно сопоставить с печатью.</p>}
    <div className="devtools-overview-heading">Активные компоненты</div>
    {activeNodes.length ? activeNodes.map((node) => <button key={node.id} className="devtools-overview-row" onClick={() => { selectNode(node.id); onFocusNode(node.id); }}>
      <span className="devtools-overview-name">{node.name}</span>
      <span>{node.telemetry?.updateCount ? `${node.telemetry.updateCount} ↻ · ${(node.telemetry.avgUpdateDurationMs || 0).toFixed(1)} мс` : `${node.telemetry?.mountCount || 0} mount`}</span>
    </button>) : <p className="devtools-overview-empty">Событий пока нет. Запустите dev:grimoire и поработайте в приложении.</p>}
    {recentRenders.length > 0 && <>
      <div className="devtools-overview-heading">Последние события по дереву</div>
      {recentRenders.slice(0, 6).map((event, index) => <button key={`${event.commitId || event.timestamp}-${index}`} className="devtools-overview-event"
        disabled={!event.mappedNodeId} onClick={() => { if (event.mappedNodeId) { selectNode(event.mappedNodeId); onFocusNode(event.mappedNodeId); } }}>
        <span className="devtools-overview-path">{event.hierarchyPath?.join(' → ') || event.componentName}</span>
        <span className="devtools-overview-event-detail">{event.changeReasons?.slice(0, 3).join(' · ') || 'причина неизвестна'} · {event.durationMs.toFixed(1)} мс{event.source === 'fiber' ? ' (поддерево)' : ''}</span>
      </button>)}
      <p className="devtools-overview-note">Изменившиеся props/state — наблюдаемые сигналы. Обновление родителя само по себе не доказывает причину.</p>
    </>}
    <div className="devtools-overview-divider" />
    <div className="devtools-overview-heading">Вес библиотек в JS</div>
    {measured.length ? <>
      <div className="devtools-overview-bundle"><strong>{kib(libraryBytes)}</strong><span>оценка для {measured.length} библиотек</span></div>
      <p className="devtools-overview-note">Из них на начальном пути загрузки: {kib(initialBytes)}. Это сумма оценок библиотек, не размер всего бандла.</p>
      {heaviest.map((dependency) => <button key={dependency.id} className="devtools-overview-row" onClick={() => selectDependency(dependency.id)}>
        <span className="devtools-overview-name">{dependency.name}</span>
        <span>{kib(dependency.build?.emittedBytesEstimate || 0)}{dependency.build?.initial ? ' · initial' : ''}</span>
      </button>)}
    </> : <p className="devtools-overview-empty">Размеры ещё не измерены. Печати библиотек пока отражают число импортов.</p>}
    {onMeasureBuild && <button className="devtools-overview-measure" disabled={measuring} onClick={async () => {
      setMeasuring(true); setMeasureMessage('Сборка проекта…');
      try {
        const result = await onMeasureBuild();
        setMeasureMessage(`Измерено библиотек: ${result.measured}.`);
      } catch (error) { setMeasureMessage(String(error instanceof Error ? error.message : error)); }
      finally { setMeasuring(false); }
    }}>{measuring ? 'Измеряем…' : measured.length ? 'Повторить Measure Vite build' : 'Measure Vite build'}</button>}
    {measureMessage && <p className="devtools-overview-note" role="status">{measureMessage}</p>}
  </aside>;
};
