import React, { useEffect, useState } from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';
import { translate } from '../i18n.js';
import type { WebpackBuildStatus } from '../transport/transport.js';

interface DevtoolsOverviewProps {
  onFocusNode: (nodeId: string) => void;
  onMeasureBuild?: (appId?: string) => Promise<{ measured: number }>;
  onImportWebpackStats?: (relativePath: string) => Promise<{ measured: number }>;
  onGetWebpackBuildStatus?: () => Promise<WebpackBuildStatus>;
  onStartWebpackBuild?: (appId: string, script: string, statsPath: string) => Promise<WebpackBuildStatus>;
  onStopWebpackBuild?: () => Promise<WebpackBuildStatus>;
  onOpenAnalysis: () => void;
}

const kib = (bytes: number) => `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;

export const DevtoolsOverview: React.FC<DevtoolsOverviewProps> = ({ onFocusNode, onMeasureBuild, onImportWebpackStats, onGetWebpackBuildStatus, onStartWebpackBuild, onStopWebpackBuild, onOpenAnalysis }) => {
  const devToolsMode = useGrimoireStore((s) => s.devToolsMode);
  const locale = useGrimoireStore((s) => s.locale);
  const nodes = useGrimoireStore((s) => s.nodes);
  const graph = useGrimoireStore((s) => s.graph);
  const dependencies = graph?.dependencies || [];
  const hasVite = graph?.capabilities?.applications.some((app) => app.bundler === 'vite') ?? true;
  const hasWebpack = graph?.capabilities?.applications.some((app) => app.bundler === 'webpack') ?? false;
  const unmatched = useGrimoireStore((s) => s.unmatchedRuntime);
  const recentRenders = useGrimoireStore((s) => s.recentRenders);
  const recording = useGrimoireStore((s) => s.recording);
  const selectNode = useGrimoireStore((s) => s.selectNode);
  const selectDependency = useGrimoireStore((s) => s.selectDependency);
  const [measuring, setMeasuring] = useState(false);
  const [measureMessage, setMeasureMessage] = useState('');
  const [statsPath, setStatsPath] = useState('stats.json');
  const [viteAppId, setViteAppId] = useState('');
  const [webpackBuildAppId, setWebpackBuildAppId] = useState('');
  const [webpackBuildScript, setWebpackBuildScript] = useState('');
  const [webpackBuildPreview, setWebpackBuildPreview] = useState(false);
  const [webpackBuildStatus, setWebpackBuildStatus] = useState<WebpackBuildStatus | null>(null);
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem('grimoire-overview-collapsed') === 'true'; }
    catch { return false; }
  });
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  useEffect(() => {
    const detected = graph?.capabilities?.existingStatsFiles?.[0];
    if (detected) setStatsPath(detected);
  }, [graph?.projectKey]);
  useEffect(() => {
    if (!onGetWebpackBuildStatus) return;
    void onGetWebpackBuildStatus().then(setWebpackBuildStatus).catch(() => {});
  }, [onGetWebpackBuildStatus]);
  useEffect(() => {
    if (!onGetWebpackBuildStatus || !['running', 'importing'].includes(webpackBuildStatus?.state || '')) return;
    const timer = window.setInterval(() => { void onGetWebpackBuildStatus().then(setWebpackBuildStatus).catch(() => {}); }, 1500);
    return () => window.clearInterval(timer);
  }, [onGetWebpackBuildStatus, webpackBuildStatus?.state]);
  const viteApps = graph?.capabilities?.applications.filter((app) => app.bundler === 'vite') || [];
  const selectedViteApp = viteApps.find((app) => app.id === viteAppId) || viteApps[0];
  const webpackStatsApps = graph?.capabilities?.applications.filter((app) => app.bundler === 'webpack' && app.statsScripts?.length) || [];
  const selectedWebpackBuildApp = webpackStatsApps.find((app) => app.id === webpackBuildAppId) || webpackStatsApps[0];
  const selectedWebpackBuildScript = selectedWebpackBuildApp?.statsScripts?.find((item) => item.name === webpackBuildScript) || selectedWebpackBuildApp?.statsScripts?.[0];
  const webpackBuildActive = webpackBuildStatus?.state === 'running' || webpackBuildStatus?.state === 'importing';
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try { window.localStorage.setItem('grimoire-overview-collapsed', String(!value)); } catch { /* storage unavailable */ }
      return !value;
    });
  };

  if (!devToolsMode) return null;

  const updateCount = nodes.reduce((sum, node) => sum + (node.telemetry?.updateCount || 0), 0);
  const mountCount = nodes.reduce((sum, node) => sum + (node.telemetry?.mountCount || 0), 0);
  const domCount = nodes.reduce((sum, node) => sum + (node.telemetry?.domUpdateCount || 0), 0);
  const activeNodes = nodes.filter((node) => (node.telemetry?.renderCount || 0) > 0)
    .sort((a, b) => (b.telemetry?.updateCount || 0) - (a.telemetry?.updateCount || 0)
      || (b.telemetry?.avgUpdateDurationMs || 0) - (a.telemetry?.avgUpdateDurationMs || 0))
    .slice(0, 4);
  const measured = dependencies.filter((dependency) => dependency.build);
  const buildSource = measured[0]?.build?.source;
  const libraryBytes = measured.reduce((sum, dependency) => sum + (dependency.build?.emittedBytesEstimate || 0), 0);
  const initialBytes = measured.reduce((sum, dependency) => sum + (dependency.build?.initial ? dependency.build.emittedBytesEstimate || 0 : 0), 0);
  const heaviest = [...measured].sort((a, b) => (b.build?.emittedBytesEstimate || 0) - (a.build?.emittedBytesEstimate || 0)).slice(0, 4);

  if (collapsed) return <div className="devtools-overview-collapsed">
    <button onClick={toggleCollapsed} aria-expanded="false" aria-label={t('showOverview')}>⚡ {t('showOverview')} <span>{updateCount} ↻</span>{recording && <span className="recording-dot">● REC</span>}</button>
    <button onClick={onOpenAnalysis} aria-label={locale === 'ru' ? 'Открыть анализ' : 'Open analysis'} title={locale === 'ru' ? 'Открыть анализ' : 'Open analysis'}>◈</button>
  </div>;

  return <aside className="devtools-overview" aria-label={t('overview')}>
    <div className="devtools-overview-top"><div className="devtools-overview-title">⚡ {t('overview')}</div><button className="devtools-overview-hide" onClick={toggleCollapsed} aria-label={t('hideOverview')} title={t('hideOverview')}>−</button></div>
    <button className="devtools-overview-analysis" onClick={onOpenAnalysis}>◈ {locale === 'ru' ? 'Открыть анализ' : 'Open analysis'} {recording && <span className="recording-dot">● REC</span>}</button>
    <div className="devtools-overview-stats">
      <div><strong>{updateCount}</strong><span>{t('updates')}</span></div>
      <div><strong>{mountCount}</strong><span>{t('mounts')}</span></div>
      <div><strong>{domCount}</strong><span>{t('domObservations')}</span></div>
    </div>
    <p className="devtools-overview-note">{t('pulseExplanation')}</p>
    {unmatched.renders > 0 && <p className="devtools-overview-warning">{unmatched.renders} {t('unmatchedRenders')}</p>}
    <div className="devtools-overview-heading">{t('activeComponents')}</div>
    {activeNodes.length ? activeNodes.map((node) => <button key={node.id} className="devtools-overview-row" onClick={() => { selectNode(node.id); onFocusNode(node.id); }}>
      <span className="devtools-overview-name">{node.name}</span>
      <span>{node.telemetry?.updateCount ? `${node.telemetry.updateCount} ↻ · ${(node.telemetry.avgUpdateDurationMs || 0).toFixed(1)} ms` : `${node.telemetry?.mountCount || 0} mount`}</span>
    </button>) : <p className="devtools-overview-empty">{t('noRuntime')}</p>}
    {recentRenders.length > 0 && <>
      <div className="devtools-overview-heading">{t('recentTree')}</div>
      {recentRenders.slice(0, 6).map((event, index) => <button key={`${event.commitId || event.timestamp}-${index}`} className="devtools-overview-event"
        disabled={!event.mappedNodeId} onClick={() => { if (event.mappedNodeId) { selectNode(event.mappedNodeId); onFocusNode(event.mappedNodeId); } }}>
        <span className="devtools-overview-path">{event.hierarchyPath?.join(' → ') || event.componentName}</span>
        <span className="devtools-overview-event-detail">{event.changeReasons?.slice(0, 3).join(' · ') || t('unknownReason')} · {event.durationMs.toFixed(1)} ms{event.source === 'fiber' ? (locale === 'ru' ? ' (поддерево)' : ' (subtree)') : ''}</span>
      </button>)}
      <p className="devtools-overview-note">{t('causalNote')}</p>
    </>}
    <div className="devtools-overview-divider" />
    <div className="devtools-overview-heading">{t('libraryWeight')}</div>
    {measured.length ? <>
      <div className="devtools-overview-bundle"><strong>{kib(libraryBytes)}</strong><span>{t('estimateFor')} {measured.length} {t('libraries')}</span></div>
      <p className="devtools-overview-note">{buildSource === 'webpack-stats' ? 'Webpack stats' : buildSource === 'vite' ? 'Vite build' : locale === 'ru' ? 'Источник: предыдущий снимок' : 'Source: previous snapshot'}</p>
      <p className="devtools-overview-note">{t('initialLoad')}: {kib(initialBytes)}. {t('bundleNote')}</p>
      {heaviest.map((dependency) => <button key={dependency.id} className="devtools-overview-row" onClick={() => selectDependency(dependency.id)}>
        <span className="devtools-overview-name">{dependency.name}</span>
        <span>{kib(dependency.build?.emittedBytesEstimate || 0)}{dependency.build?.initial ? ' · initial' : ''}</span>
      </button>)}
    </> : <p className="devtools-overview-empty">{t('noBundle')}</p>}
    {hasWebpack && onImportWebpackStats && <div className="devtools-stats-import">
      <label htmlFor="webpack-stats-path">{locale === 'ru' ? 'Файл Webpack stats внутри проекта' : 'Webpack stats file inside project'}</label>
      <div><input id="webpack-stats-path" value={statsPath} onChange={(event) => { setStatsPath(event.target.value); setWebpackBuildPreview(false); }} placeholder="stats.json" />
        <button type="button" disabled={measuring || webpackBuildActive || !statsPath.trim()} onClick={async () => {
          setMeasuring(true);
          setMeasureMessage(locale === 'ru' ? 'Чтение Webpack stats…' : 'Reading Webpack stats…');
          try {
            const result = await onImportWebpackStats(statsPath.trim());
            setMeasureMessage(locale === 'ru' ? `Измерено библиотек: ${result.measured}.` : `Measured libraries: ${result.measured}.`);
          } catch (error) { setMeasureMessage(String(error instanceof Error ? error.message : error)); }
          finally { setMeasuring(false); }
        }}>{locale === 'ru' ? 'Импорт' : 'Import'}</button></div>
      <p>{locale === 'ru' ? 'Использует готовый stats.json. Сборка проекта не запускается.' : 'Uses an existing stats.json. Does not run a build.'}</p>
    </div>}
    {webpackStatsApps.length > 0 && onStartWebpackBuild && onGetWebpackBuildStatus && onStopWebpackBuild && <div className="webpack-build-control">
      <div className="devtools-overview-heading">{locale === 'ru' ? 'Измерить Webpack-сборку' : 'Measure Webpack build'}</div>
      <label>{locale === 'ru' ? 'Приложение' : 'Application'}<select value={selectedWebpackBuildApp?.id || ''} onChange={(event) => { setWebpackBuildAppId(event.target.value); setWebpackBuildScript(''); setWebpackBuildPreview(false); }}>
        {webpackStatsApps.map((app) => <option key={app.id} value={app.id}>{app.name} · {app.directory}</option>)}
      </select></label>
      <label>{locale === 'ru' ? 'Stats-скрипт' : 'Stats script'}<select value={selectedWebpackBuildScript?.name || ''} onChange={(event) => { setWebpackBuildScript(event.target.value); setWebpackBuildPreview(false); }}>
        {selectedWebpackBuildApp?.statsScripts?.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
      </select></label>
      <button type="button" disabled={webpackBuildActive || !statsPath.trim()} onClick={() => setWebpackBuildPreview(true)}>{locale === 'ru' ? 'Показать команду' : 'Preview command'}</button>
      {webpackBuildPreview && selectedWebpackBuildApp && selectedWebpackBuildScript && <div className="webpack-build-preview">
        <p>{locale === 'ru' ? 'Рабочая папка' : 'Working directory'}: <code>{selectedWebpackBuildApp.directory}</code></p>
        <p>{locale === 'ru' ? 'Команда' : 'Command'}: <code>{graph?.capabilities?.packageManager === 'unknown' ? 'npm' : graph?.capabilities?.packageManager} run {selectedWebpackBuildScript.name}</code></p>
        <p>{locale === 'ru' ? 'Содержимое скрипта' : 'Script content'}: <code>{selectedWebpackBuildScript.command}</code></p>
        <p>{locale === 'ru' ? 'Ожидаемый файл' : 'Expected file'}: <code>{statsPath}</code></p>
        <p>{locale === 'ru' ? 'Лимит: 15 минут. Сборка начнётся только после нажатия кнопки ниже.' : 'Limit: 15 minutes. The build starts only after pressing the button below.'}</p>
        <button type="button" disabled={webpackBuildActive} onClick={async () => {
          try { setWebpackBuildStatus(await onStartWebpackBuild(selectedWebpackBuildApp.id, selectedWebpackBuildScript.name, statsPath.trim())); setWebpackBuildPreview(false); }
          catch (error) { setMeasureMessage(String(error instanceof Error ? error.message : error)); }
        }}>{locale === 'ru' ? 'Запустить измерение' : 'Start measurement'}</button>
      </div>}
      {webpackBuildActive && <button type="button" onClick={async () => {
        try { setWebpackBuildStatus(await onStopWebpackBuild()); }
        catch (error) { setMeasureMessage(String(error instanceof Error ? error.message : error)); }
      }}>{locale === 'ru' ? 'Остановить сборку' : 'Stop build'}</button>}
      {webpackBuildStatus && webpackBuildStatus.state !== 'idle' && <div className="webpack-build-status" role="status">
        <strong>{locale === 'ru' ? 'Состояние' : 'Status'}: {locale === 'ru' ? ({ running: 'сборка', importing: 'чтение stats', ready: 'готово', error: 'ошибка', cancelled: 'остановлено', idle: 'ожидание' } as const)[webpackBuildStatus.state] : webpackBuildStatus.state}</strong>
        {webpackBuildStatus.state === 'ready' && <p>{locale === 'ru' ? `Измерено библиотек: ${webpackBuildStatus.measured}` : `Measured libraries: ${webpackBuildStatus.measured}`}</p>}
        {webpackBuildStatus.error && <p>{webpackBuildStatus.error}</p>}
        {webpackBuildStatus.logs.length > 0 && <pre>{webpackBuildStatus.logs.slice(-8).join('\n')}</pre>}
      </div>}
    </div>}
    {viteApps.length > 1 && <label className="vite-app-choice">{locale === 'ru' ? 'Измерить Vite-приложение' : 'Measure Vite application'}<select value={selectedViteApp?.id || ''} onChange={(event) => setViteAppId(event.target.value)}>{viteApps.map((app) => <option key={app.id} value={app.id}>{app.name} · {app.directory}</option>)}</select></label>}
    {hasVite && onMeasureBuild && <button className="devtools-overview-measure" disabled={measuring || webpackBuildActive} onClick={async () => {
      setMeasuring(true); setMeasureMessage(locale === 'ru' ? 'Сборка проекта…' : 'Building the project…');
      try {
        const result = await onMeasureBuild(selectedViteApp?.id);
        setMeasureMessage(locale === 'ru' ? `Измерено библиотек: ${result.measured}.` : `Measured libraries: ${result.measured}.`);
      } catch (error) { setMeasureMessage(String(error instanceof Error ? error.message : error)); }
      finally { setMeasuring(false); }
    }}>{measuring ? t('measuring') : measured.length ? t('repeatMeasure') : t('measureBuild')}</button>}
    {measureMessage && <p className="devtools-overview-note" role="status">{measureMessage}</p>}
  </aside>;
};
