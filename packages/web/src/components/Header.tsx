import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGrimoireStore } from '../store/useGrimoireStore.js';
import type { DevtoolsInstallStatus } from '../transport/transport.js';
import { elementLabel, translate } from '../i18n.js';
import { SearchBox } from './SearchBox.js';
import { SignsGuide } from './SignsGuide.js';

interface HeaderProps {
  onFitKingdom: () => void;
  onFitNodes?: (nodeIds: string[]) => void;
  onFocusNode: (nodeId: string) => void;
  onFocusDependency: (dependencyId: string) => void;
  onMeasureBuild?: (appId?: string) => Promise<{ measured: number }>;
  onGetDevtoolsInstallStatus?: (appId?: string) => Promise<DevtoolsInstallStatus>;
  onInstallDevtools?: (appId?: string) => Promise<DevtoolsInstallStatus>;
  onUpgradeDevtools?: (appId?: string) => Promise<DevtoolsInstallStatus>;
  onRefreshDevtools?: (appId?: string) => Promise<DevtoolsInstallStatus>;
  onRemoveDevtools?: (appId?: string) => Promise<DevtoolsInstallStatus>;
  onGetWebpackInstallStatus?: (appId: string, entry?: string, script?: string) => Promise<DevtoolsInstallStatus & { preview?: string | null }>;
  onInstallWebpackDevtools?: (appId: string, entry: string, script: string) => Promise<DevtoolsInstallStatus>;
  onRemoveWebpackDevtools?: (appId: string) => Promise<DevtoolsInstallStatus>;
  onRefreshWebpackDevtools?: (appId: string) => Promise<DevtoolsInstallStatus>;
  onRefreshMap?: () => void;
  onShowScanLog?: () => void;
  hasScanWarnings?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onFitKingdom, onFitNodes, onFocusNode, onFocusDependency, onMeasureBuild, onGetDevtoolsInstallStatus, onInstallDevtools, onUpgradeDevtools, onRefreshDevtools, onRemoveDevtools, onGetWebpackInstallStatus, onInstallWebpackDevtools, onRemoveWebpackDevtools, onRefreshWebpackDevtools, onRefreshMap, onShowScanLog, hasScanWarnings }) => {
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measurementMessage, setMeasurementMessage] = useState('');
  const [installStatus, setInstallStatus] = useState<DevtoolsInstallStatus | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installMessage, setInstallMessage] = useState('');
  const [viteAppId, setViteAppId] = useState('');
  const [webpackAppId, setWebpackAppId] = useState('');
  const [webpackEntry, setWebpackEntry] = useState('');
  const [webpackScript, setWebpackScript] = useState('');
  const [webpackStatus, setWebpackStatus] = useState<(DevtoolsInstallStatus & { preview?: string | null }) | null>(null);
  const [webpackMessage, setWebpackMessage] = useState('');
  const base = typeof window === 'undefined' ? '' : window.location.origin;
  const quickSnippet = `const s=document.createElement('script');s.src='${base}/api/runtime/quick.js';document.head.appendChild(s);`;
  const vueSnippet = `import { installGrimoireVue } from '${base}/api/runtime/adapter.js';\ninstallGrimoireVue(app); // before your existing app.mount(...)`;
  const react17Snippet = `import { profileReact } from '${base}/api/runtime/adapter.js';\nReactDOM.render(profileReact(React, 'App', <App />), document.getElementById('root'));`;
  const reactModernSnippet = `import { profileReact } from '${base}/api/runtime/adapter.js';\nroot.render(profileReact(React, 'App', <App />));`;
  const reactComponentSnippet = `import { profileReactComponent } from '${base}/api/runtime/adapter.js';\nconst ProfiledCard = profileReactComponent(React, Card, import.meta.url); // in Card's module`;
  const {
    locale,
    toggleLocale,
    graph,
    browserLongTasks,
    nodeCount,
    hotNodeCount,
    activeFilter,
    realisticMode,
    lightweightMode,
    devToolsMode,
    diagnosticFilter,
    setFilter,
    setDiagnosticFilter,
    toggleRealistic,
    toggleLightweight,
    toggleDevTools,
  } = useGrimoireStore(useShallow((state) => ({
    locale: state.locale, toggleLocale: state.toggleLocale, graph: state.graph,
    browserLongTasks: state.browserLongTasks, nodeCount: state.nodes.length, hotNodeCount: state.hotNodeCount,
    activeFilter: state.activeFilter, realisticMode: state.realisticMode, lightweightMode: state.lightweightMode,
    devToolsMode: state.devToolsMode, diagnosticFilter: state.diagnosticFilter,
    setFilter: state.setFilter, setDiagnosticFilter: state.setDiagnosticFilter,
    toggleRealistic: state.toggleRealistic, toggleLightweight: state.toggleLightweight, toggleDevTools: state.toggleDevTools,
  })));
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const reactVersions = [...new Set((graph?.nodes || []).filter((node) => node.framework === 'react').map((node) => node.frameworkVersion || 'unknown'))];
  const vueVersions = [...new Set((graph?.nodes || []).filter((node) => node.framework === 'vue').map((node) => node.frameworkVersion || 'unknown'))];
  const hasReact17 = reactVersions.some((version) => /^(?:\^|~|>=)?17(?:\.|$)/.test(version));
  const hasModernReact = reactVersions.some((version) => /^(?:\^|~|>=)?(?:18|19)(?:\.|$)/.test(version));
  const staticOnlyProject = Boolean(graph?.nodes.length && graph.nodes.every((node) => node.analysisMode === 'static'));
  const viteAvailable = graph?.capabilities?.applications.some((app) => app.bundler === 'vite') ?? true;
  const webpackAvailable = graph?.capabilities?.applications.some((app) => app.bundler === 'webpack') ?? false;
  const viteApps = graph?.capabilities?.applications.filter((app) => app.bundler === 'vite') || [];
  const selectedViteApp = viteApps.find((app) => app.id === viteAppId) || viteApps[0];
  const webpackApps = graph?.capabilities?.applications.filter((app) => app.bundler === 'webpack' && (app.framework === 'react' || app.framework === 'vue')) || [];
  const selectedWebpackApp = webpackApps.find((app) => app.id === webpackAppId) || webpackApps[0];
  const selectedWebpackEntry = webpackEntry || selectedWebpackApp?.entries[0] || '';
  const selectedWebpackScript = webpackScript || selectedWebpackApp?.devScripts[0]?.name || '';

  const stats = graph?.stats || {
    totalNodes: nodeCount,
    totalFiles: 0,
    totalClusters: graph?.clusters?.length || 0,
  };

  const diag = graph?.diagnostics;
  const elements = ['all', 'Fire', 'Water', 'Earth', 'Wind', 'Light'] as const;

  return (
    <header id="grimoire-header">
      <div className="header-main">
        <div className="brand-section">
          <div className="wax-seal-icon">✦</div>
          <div>
            <div className="brand-title">Atelier Grimoire</div>
            <div className="brand-subtitle" id="project-stats-label">
              {stats.totalNodes} {t('glyphs')} • {graph?.clusters?.length || 0} {t('clusters')} • {stats.totalFiles} {t('files')}
              {graph?.stats.parseCoverage ? ` • ${graph.stats.parseCoverage.complete + graph.stats.parseCoverage.partial}/${stats.totalFiles} ${locale === 'ru' ? 'разобрано' : 'parsed'}` : ''}
            </div>
          </div>
        </div>
        <SearchBox onFocusNode={onFocusNode} onFocusDependency={onFocusDependency} />
        <div className="header-utilities">
          {onRefreshMap && <button className="header-utility-btn" onClick={onRefreshMap} title={t('scanRefresh')}>↻ {t('scanRefresh')}</button>}
          {onShowScanLog && <button className="header-utility-btn" onClick={onShowScanLog} title={t('scanLogs')}>▤ {t('scanLogs')}{hasScanWarnings ? ' ⚠' : ''}</button>}
          <button className="header-utility-btn" onClick={toggleLocale} aria-label={locale === 'ru' ? 'Язык: русский. Переключить на английский' : 'Language: English. Switch to Russian'} title={locale === 'ru' ? 'Переключить на английский' : 'Switch to Russian'}>🌐 {t('language')}</button>
          <button className="header-utility-btn" onClick={() => setGuideOpen(true)}>◇ {t('guide')}</button>
        </div>
      </div>
      <div className="header-toolbar">
        {/* Filter Pills: Switch to Diagnostic audit pills in DevTools Mode */}
        {devToolsMode ? (
          <div className="filter-pills" id="diagnostic-filters">
            <button
              className={`pill-btn ${diagnosticFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('all');
                onFitKingdom();
              }}
            >
              {t('all')} ({nodeCount})
            </button>
            <button
              className={`pill-btn pill-diag-cycle ${diagnosticFilter === 'cycles' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('cycles');
                const cycleIds = diag?.cycles.flatMap((c) => c.nodeIds) || [];
                if (cycleIds.length > 0 && onFitNodes) {
                  onFitNodes(cycleIds);
                }
              }}
              title={locale === 'ru' ? 'Показать циклы импортов' : 'Show circular import loops'}
            >
              🔄 {t('cycles')} ({diag?.totalCircularLoops || 0})
            </button>
            <button
              className={`pill-btn pill-diag-orphan ${diagnosticFilter === 'orphans' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('orphans');
                const orphanIds = diag?.orphanNodeIds || [];
                if (orphanIds.length > 0 && onFitNodes) {
                  onFitNodes(orphanIds);
                }
              }}
              title={locale === 'ru' ? 'Показать неиспользуемые модули' : 'Show unused modules'}
            >
              🍂 {t('deadCode')} ({diag?.totalOrphans || 0})
            </button>
            <button
              className={`pill-btn ${diagnosticFilter === 'pact' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('pact');
                const ids = diag?.architectureViolations?.flatMap((violation) => [violation.sourceNodeId, violation.targetNodeId]) || [];
                if (ids.length > 0 && onFitNodes) onFitNodes([...new Set(ids)]);
              }}
              title={locale === 'ru' ? 'Показать нарушения архитектурных границ' : 'Show architecture boundary violations'}
            >
              ✧ {t('pact')} ({diag?.totalArchitectureViolations || 0})
            </button>
            <button
              className={`pill-btn pill-diag-hot ${diagnosticFilter === 'hot' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('hot');
                const hotIds = useGrimoireStore.getState().nodes.filter((node) => node.telemetry?.isOverheating || ['overcharged', 'fissure'].includes(node.metrics?.devTools?.overloadState || '')).map((node) => node.id);
                if (hotIds.length > 0 && onFitNodes) {
                  onFitNodes(hotIds);
                }
              }}
              title={locale === 'ru' ? 'Показать горячие компоненты' : 'Show hot components'}
            >
              ⚡ {t('hot')} ({hotNodeCount})
            </button>
          </div>
        ) : (
          <div className="filter-pills" id="element-filters">
            {elements.map((el) => (
              <button
                key={el}
                className={`pill-btn ${activeFilter === el ? 'active' : ''}`}
                onClick={() => setFilter(el)}
              >
                {el === 'all' ? t('all') : elementLabel(locale, el)}
              </button>
            ))}
          </div>
        )}

        <div className="header-actions">
        {/* Mode Toggles */}
        {!staticOnlyProject && <button
          className={`action-btn ${devToolsMode ? 'active devtools-active' : ''}`}
          id="btn-toggle-devtools"
          title={locale === 'ru' ? 'Переключить диагностику DevTools' : 'Toggle DevTools diagnostics'}
          onClick={toggleDevTools}
        >
          <span className="mode-icon">⚡</span> {t('devtoolsMode')}
        </button>}

        {devToolsMode && <button className="action-btn" onClick={() => {
          setRuntimeOpen(!runtimeOpen);
          if (!runtimeOpen && onGetDevtoolsInstallStatus && selectedViteApp) void onGetDevtoolsInstallStatus(selectedViteApp.id).then(setInstallStatus).catch((error) => setInstallMessage(String(error)));
        }}>✦ {t('runtimeLibraries')}</button>}

        <button
          className={`action-btn ${realisticMode ? 'active' : ''}`}
          id="btn-toggle-realistic"
          title={locale === 'ru' ? 'Переключить арт-режим' : 'Toggle art mode'}
          onClick={toggleRealistic}
        >
          <span className="mode-icon">✦</span> {t('realisticArt')}
        </button>

        <button
          type="button"
          className={`action-btn ${lightweightMode ? 'active lightweight-active' : ''}`}
          id="btn-toggle-lightweight"
          aria-pressed={lightweightMode}
          title={t('lightweightHint')}
          onClick={toggleLightweight}
        >
          <span className="mode-icon">◌</span> {lightweightMode ? t('lightweightMap') : t('detailedMap')}
        </button>

        <button className="action-btn" id="btn-fit-world" onClick={onFitKingdom}>
          <span>⊕</span> {t('fitKingdom')}
        </button>
        </div>
      </div>
      {runtimeOpen && devToolsMode && <div className="runtime-popover">
        <button className="close-drawer-btn" onClick={() => setRuntimeOpen(false)}>✕</button>
        <h3>{t('connectApp')}</h3>
        <p>{t('detected')}: {reactVersions.length ? `React ${reactVersions.join(', ')}` : ''}{reactVersions.length && vueVersions.length ? ' · ' : ''}{vueVersions.length ? `Vue ${vueVersions.join(', ')}` : ''}{!reactVersions.length && !vueVersions.length ? (locale === 'ru' ? 'Компоненты React и Vue не найдены' : 'No React or Vue component yet') : ''}</p>
        {graph?.capabilities && <p>{locale === 'ru' ? 'Обнаружено приложений' : 'Detected applications'}: {graph.capabilities.applications.length} · {locale === 'ru' ? 'пакетный менеджер' : 'package manager'}: {graph.capabilities.packageManager}</p>}
        {graph?.capabilities?.allowedRuntimeOrigins?.length ? <p>{locale === 'ru' ? 'Разрешённые адреса runtime' : 'Allowed runtime origins'}: {graph.capabilities.allowedRuntimeOrigins.join(', ')}</p>
          : <p>{locale === 'ru' ? 'Runtime принимает localhost и 127.0.0.1. Для другого адреса добавьте --allow-origin при запуске Grimoire.' : 'Runtime accepts localhost and 127.0.0.1. For another address, add --allow-origin when starting Grimoire.'}</p>}
        {selectedViteApp && onInstallDevtools && onRemoveDevtools && <div className="runtime-auto-setup">
          <strong>{t('oneClick')}</strong>
          <p>{t('setupExplanation')}</p>
          {viteApps.length > 1 && <label className="vite-app-choice">{locale === 'ru' ? 'Vite-приложение' : 'Vite application'}<select value={selectedViteApp.id} onChange={(event) => {
            setViteAppId(event.target.value); setInstallStatus(null); setInstallMessage('');
            void onGetDevtoolsInstallStatus?.(event.target.value).then(setInstallStatus).catch((error) => setInstallMessage(String(error)));
          }}>{viteApps.map((app) => <option key={app.id} value={app.id}>{app.name} · {app.directory}</option>)}</select></label>}
          <button className="action-btn" disabled={installBusy || !installStatus} onClick={async () => {
            setInstallBusy(true); setInstallMessage(locale === 'ru' ? 'Обновляем выбранный проект…' : 'Updating the selected project…');
            try {
              const status = installStatus?.installed ? await onRemoveDevtools(selectedViteApp.id) : await onInstallDevtools(selectedViteApp.id);
              setInstallStatus(status);
              setInstallMessage(status.installed ? (locale === 'ru' ? `Добавлено в ${status.entry}. Запустите ${status.command}.` : `Added to ${status.entry}. Start the app with ${status.command}.`) : (locale === 'ru' ? 'Подключение Grimoire удалено.' : 'Grimoire integration removed.'));
            } catch (error) { setInstallMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{installBusy ? (locale === 'ru' ? 'Работаем…' : 'Working…') : installStatus?.installed ? t('removeDevtools') : t('addDevtools')}</button>
          {installStatus?.upgradeAvailable && onUpgradeDevtools && <button className="action-btn" disabled={installBusy} onClick={async () => {
            setInstallBusy(true); setInstallMessage(locale === 'ru' ? 'Добавляем наблюдение иерархии…' : 'Adding component hierarchy tracing…');
            try {
              const status = await onUpgradeDevtools(selectedViteApp.id);
              setInstallStatus(status);
              setInstallMessage(locale === 'ru' ? 'Наблюдение добавлено. Перезапустите dev:grimoire и обновите приложение.' : 'Component tracing added. Restart dev:grimoire and reload the app.');
            } catch (error) { setInstallMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{t('upgradeTracing')}</button>}
          {installStatus?.installed && installStatus.refreshAvailable && onRefreshDevtools && !installStatus.upgradeAvailable && <button className="action-btn" disabled={installBusy} onClick={async () => {
            setInstallBusy(true); setInstallMessage(locale === 'ru' ? 'Обновляем адаптер…' : 'Refreshing the adapter…');
            try {
              const status = await onRefreshDevtools(selectedViteApp.id);
              setInstallStatus(status);
              setInstallMessage(locale === 'ru' ? 'Адаптер обновлён. Перезапустите dev:grimoire и обновите приложение.' : 'Adapter refreshed. Restart dev:grimoire and reload the app.');
            } catch (error) { setInstallMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{locale === 'ru' ? 'Обновить адаптер' : 'Refresh adapter'}</button>}
          {installStatus?.installed && <p>{locale === 'ru' ? `Подключено для ${installStatus.framework} в` : `Installed for ${installStatus.framework} in`} <code>{installStatus.entry}</code>. {locale === 'ru' ? 'Запустите' : 'Run'} <code>{installStatus.command}</code> {locale === 'ru' ? 'в целевом проекте.' : 'from the target project.'}</p>}
          {installStatus?.componentTracing && <p>{locale === 'ru' ? 'Наблюдение иерархии компонентов включено.' : 'Component hierarchy tracing is enabled.'}</p>}
          {installMessage && <p role="status">{installMessage}</p>}
        </div>}
        {webpackApps.length > 0 && onGetWebpackInstallStatus && onInstallWebpackDevtools && onRemoveWebpackDevtools && <div className="runtime-auto-setup webpack-setup">
          <strong>{locale === 'ru' ? 'React/Vue + Webpack: подключение к выбранному приложению' : 'React/Vue + Webpack: selected app setup'}</strong>
          <p>{locale === 'ru' ? 'Выберите приложение, dev-команду и клиентский entry. Grimoire сначала покажет изменения. Установка не запускает dev-сервер или сборку.' : 'Choose an app, dev command, and browser entry. Grimoire shows the changes first. Setup does not start the dev server or build.'}</p>
          <label>{locale === 'ru' ? 'Приложение' : 'Application'}<select value={selectedWebpackApp?.id || ''} onChange={(event) => {
            setWebpackAppId(event.target.value); setWebpackEntry(''); setWebpackScript(''); setWebpackStatus(null); setWebpackMessage('');
          }}>{webpackApps.map((app) => <option key={app.id} value={app.id}>{app.name} · {app.framework} · {app.directory}</option>)}</select></label>
          <label>{locale === 'ru' ? 'Исходная dev-команда' : 'Original dev command'}<select value={selectedWebpackScript} onChange={(event) => {
            setWebpackScript(event.target.value); setWebpackStatus(null);
          }}>{selectedWebpackApp?.devScripts.map((script) => <option key={script.name} value={script.name}>{script.name}: {script.command}</option>)}</select></label>
          <label>{locale === 'ru' ? 'Клиентская точка входа относительно корня проекта' : 'Browser entry relative to project root'}
            <input list="grimoire-webpack-entries" value={selectedWebpackEntry} onChange={(event) => { setWebpackEntry(event.target.value); setWebpackStatus(null); }} placeholder="client/boot/index.js" />
            <datalist id="grimoire-webpack-entries">{selectedWebpackApp?.entries.map((entry) => <option key={entry} value={entry} />)}</datalist></label>
          <button className="action-btn" type="button" disabled={installBusy || !selectedWebpackApp || !selectedWebpackEntry || !selectedWebpackScript} onClick={async () => {
            if (!selectedWebpackApp) return;
            setInstallBusy(true); setWebpackMessage('');
            try { setWebpackStatus(await onGetWebpackInstallStatus(selectedWebpackApp.id, selectedWebpackEntry, selectedWebpackScript)); }
            catch (error) { setWebpackStatus(null); setWebpackMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{locale === 'ru' ? 'Показать изменения' : 'Preview changes'}</button>
          {webpackStatus?.preview && <pre className="webpack-setup-preview">{webpackStatus.preview}</pre>}
          {webpackStatus?.installed && <p>{locale === 'ru' ? 'Установлено:' : 'Installed:'} <code>{webpackStatus.entry}</code> · <code>{webpackStatus.command}</code></p>}
          {webpackStatus?.preview && <button className="action-btn" type="button" disabled={installBusy} onClick={async () => {
            if (!selectedWebpackApp) return;
            setInstallBusy(true);
            try { const result = await onInstallWebpackDevtools(selectedWebpackApp.id, selectedWebpackEntry, selectedWebpackScript);
              setWebpackStatus(result); setWebpackMessage(locale === 'ru' ? `Добавлено. Запустите ${result.command}.` : `Installed. Run ${result.command}.`); }
            catch (error) { setWebpackMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{locale === 'ru' ? 'Добавить DevTools' : 'Add DevTools'}</button>}
          {webpackStatus?.installed && <button className="action-btn" type="button" disabled={installBusy} onClick={async () => {
            if (!selectedWebpackApp) return;
            setInstallBusy(true);
            try { const result = await onRemoveWebpackDevtools(selectedWebpackApp.id); setWebpackStatus(result);
              setWebpackMessage(locale === 'ru' ? 'Подключение удалено.' : 'Integration removed.'); }
            catch (error) { setWebpackMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{locale === 'ru' ? 'Удалить DevTools' : 'Remove DevTools'}</button>}
          {webpackStatus?.installed && webpackStatus.refreshAvailable && onRefreshWebpackDevtools && <button className="action-btn" type="button" disabled={installBusy} onClick={async () => {
            if (!selectedWebpackApp) return;
            setInstallBusy(true);
            try { const result = await onRefreshWebpackDevtools(selectedWebpackApp.id); setWebpackStatus(result);
              setWebpackMessage(locale === 'ru' ? 'Адрес Grimoire обновлён. Перезапустите dev-сервер приложения.' : 'Grimoire address refreshed. Restart the app dev server.'); }
            catch (error) { setWebpackMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{locale === 'ru' ? 'Обновить адрес' : 'Refresh address'}</button>}
          <p>{selectedWebpackApp?.framework === 'vue'
            ? locale === 'ru' ? 'Для Vue Grimoire оборачивает единственный createApp, устанавливает dev-mixin до mount и измеряет обновления компонентов. Production-сборка не включает наблюдение.' : 'For Vue, Grimoire wraps a single createApp, installs a development mixin before mount, and measures component updates. Production builds do not enable tracing.'
            : locale === 'ru' ? 'Fiber hook включается в локальной dev-сборке React и остаётся выключенным в production. Для Webpack здесь измеряется дерево обновлений; Profiler доступен через ручную обёртку ниже.' : 'The Fiber hook runs in local React development and stays off in production. This Webpack setup measures update trees; Profiler is available with the manual wrapper below.'}</p>
          {webpackMessage && <p role="status">{webpackMessage}</p>}
        </div>}
        <p>{t('quickProbeExplanation')}</p>
        {browserLongTasks.count > 0 && <p>{locale === 'ru' ? 'Долгих задач основного потока' : 'Observed main-thread long tasks'}: {browserLongTasks.count} · {Math.round(browserLongTasks.totalDurationMs)} ms. {locale === 'ru' ? 'В этом режиме нельзя определить библиотеку-источник.' : 'Attribution to a library is unavailable in this mode.'}</p>}
        <code>{quickSnippet}</code>
        <button className="action-btn" onClick={() => navigator.clipboard.writeText(quickSnippet)}>{t('copyBrowserProbe')}</button>
        {(vueVersions.length > 0 || reactVersions.length > 0) && <p>{t('adapterExplanation')}</p>}
        {vueVersions.length > 0 && <><strong>Vue 3</strong><code>{vueSnippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(vueSnippet)}>{t('copyVueAdapter')}</button></>}
        {reactVersions.length > 0 && <>
          {(hasReact17 || !hasModernReact) && <><strong>React 17</strong><code>{react17Snippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(react17Snippet)}>{t('copyReactAdapter')} 17</button></>}
          {(hasModernReact || !hasReact17) && <><strong>React 18/19</strong><code>{reactModernSnippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(reactModernSnippet)}>{t('copyReactAdapter')} 18/19</button></>}
          <p>{t('profilerExplanation')}</p>
          <code>{reactComponentSnippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(reactComponentSnippet)}>{t('copyPropProfiler')}</button>
        </>}
        {viteAvailable && onMeasureBuild && <button className="action-btn" disabled={measuring} onClick={async () => {
          if (!onMeasureBuild) return;
          setMeasuring(true); setMeasurementMessage(locale === 'ru' ? 'Собираем целевой проект…' : 'Building the target project…');
          try { const result = await onMeasureBuild(selectedViteApp?.id); setMeasurementMessage(locale === 'ru' ? `Измерено библиотек: ${result.measured}.` : `Measured ${result.measured} packages.`); }
          catch (error) { setMeasurementMessage(String(error instanceof Error ? error.message : error)); }
          finally { setMeasuring(false); }
        }}>{measuring ? t('measuring') : t('measureBuild')}</button>}
        {webpackAvailable && <p>{locale === 'ru' ? 'Webpack: импортируйте готовый stats.json в сводке DevTools. Сборка не запускается автоматически.' : 'Webpack: import an existing stats.json in the DevTools overview. No build starts automatically.'}</p>}
        {viteAvailable && <p>{measurementMessage || t('buildOnlyOnClick')}</p>}
      </div>}
      {guideOpen && <SignsGuide locale={locale} onClose={() => setGuideOpen(false)} />}
    </header>
  );
};
