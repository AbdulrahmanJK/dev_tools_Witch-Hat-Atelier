import React, { useState } from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';
import type { DevtoolsInstallStatus } from '../transport/transport.js';

interface HeaderProps {
  onFitKingdom: () => void;
  onFitNodes?: (nodeIds: string[]) => void;
  onMeasureBuild?: () => Promise<{ measured: number }>;
  onGetDevtoolsInstallStatus?: () => Promise<DevtoolsInstallStatus>;
  onInstallDevtools?: () => Promise<DevtoolsInstallStatus>;
  onUpgradeDevtools?: () => Promise<DevtoolsInstallStatus>;
  onRemoveDevtools?: () => Promise<DevtoolsInstallStatus>;
}

export const Header: React.FC<HeaderProps> = ({ onFitKingdom, onFitNodes, onMeasureBuild, onGetDevtoolsInstallStatus, onInstallDevtools, onUpgradeDevtools, onRemoveDevtools }) => {
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measurementMessage, setMeasurementMessage] = useState('');
  const [installStatus, setInstallStatus] = useState<DevtoolsInstallStatus | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installMessage, setInstallMessage] = useState('');
  const base = typeof window === 'undefined' ? '' : window.location.origin;
  const quickSnippet = `const s=document.createElement('script');s.src='${base}/api/runtime/quick.js';document.head.appendChild(s);`;
  const vueSnippet = `import { installGrimoireVue } from '${base}/api/runtime/adapter.js';\ninstallGrimoireVue(app); // before your existing app.mount(...)`;
  const react17Snippet = `import { profileReact } from '${base}/api/runtime/adapter.js';\nReactDOM.render(profileReact(React, 'App', <App />), document.getElementById('root'));`;
  const reactModernSnippet = `import { profileReact } from '${base}/api/runtime/adapter.js';\nroot.render(profileReact(React, 'App', <App />));`;
  const reactComponentSnippet = `import { profileReactComponent } from '${base}/api/runtime/adapter.js';\nconst ProfiledCard = profileReactComponent(React, Card, import.meta.url); // in Card's module`;
  const {
    graph,
    browserLongTasks,
    nodes,
    activeFilter,
    unifiedMode,
    realisticMode,
    devToolsMode,
    diagnosticFilter,
    searchQuery,
    setFilter,
    setDiagnosticFilter,
    toggleUnified,
    toggleRealistic,
    toggleDevTools,
    setSearchQuery,
    selectNode,
  } = useGrimoireStore();
  const reactVersions = [...new Set((graph?.nodes || []).filter((node) => node.framework === 'react').map((node) => node.frameworkVersion || 'unknown'))];
  const vueVersions = [...new Set((graph?.nodes || []).filter((node) => node.framework === 'vue').map((node) => node.frameworkVersion || 'unknown'))];
  const hasReact17 = reactVersions.some((version) => /^(?:\^|~|>=)?17(?:\.|$)/.test(version));
  const hasModernReact = reactVersions.some((version) => /^(?:\^|~|>=)?(?:18|19)(?:\.|$)/.test(version));

  const stats = graph?.stats || {
    totalNodes: nodes.length,
    totalFiles: 0,
    totalClusters: graph?.clusters?.length || 0,
  };

  const diag = graph?.diagnostics;
  const hotNodes = nodes.filter((node) => node.telemetry?.isOverheating || ['overcharged', 'fissure'].includes(node.metrics?.devTools?.overloadState || ''));

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);

    if (q.trim()) {
      const match = nodes.find((n) => n.name.toLowerCase().includes(q.toLowerCase().trim()));
      if (match) {
        selectNode(match.id);
      }
    }
  };

  const elements = ['all', 'Fire', 'Water', 'Earth', 'Wind', 'Light'] as const;

  return (
    <header id="grimoire-header">
      <div className="brand-section">
        <div className="wax-seal-icon">✦</div>
        <div>
          <div className="brand-title">Atelier Grimoire</div>
          <div className="brand-subtitle" id="project-stats-label">
            {stats.totalNodes} Glyphs • {graph?.clusters?.length || 0} Archipelagos •{' '}
            {stats.totalFiles} Files
          </div>
        </div>
      </div>

      <div className="header-controls">
        {/* Search box */}
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            id="node-search"
            className="search-input"
            placeholder="Search glyph or component…"
            value={searchQuery}
            onChange={handleSearchChange}
          />
        </div>

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
              All ({nodes.length})
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
              title="Filter Circular Dependency Loops (Уроборос)"
            >
              🔄 Cycles ({diag?.totalCircularLoops || 0})
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
              title="Filter Dead Code & Unused Modules (Увядшие руны)"
            >
              🍂 Dead Code ({diag?.totalOrphans || 0})
            </button>
            <button
              className={`pill-btn ${diagnosticFilter === 'pact' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('pact');
                const ids = diag?.architectureViolations?.flatMap((violation) => [violation.sourceNodeId, violation.targetNodeId]) || [];
                if (ids.length > 0 && onFitNodes) onFitNodes([...new Set(ids)]);
              }}
              title="Architecture layer violations"
            >
              ✧ Pact ({diag?.totalArchitectureViolations || 0})
            </button>
            <button
              className={`pill-btn pill-diag-hot ${diagnosticFilter === 'hot' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('hot');
                const hotIds = hotNodes.map((node) => node.id);
                if (hotIds.length > 0 && onFitNodes) {
                  onFitNodes(hotIds);
                }
              }}
              title="Filter Overheated & Fissure Components"
            >
              ⚡ Hot ({hotNodes.length})
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
                {el === 'all' ? 'All' : el}
              </button>
            ))}
          </div>
        )}

        {/* Mode Toggles */}
        <button
          className={`action-btn ${devToolsMode ? 'active devtools-active' : ''}`}
          id="btn-toggle-devtools"
          title="Toggle DevTools Mode (WHA Fissure & Re-render Diagnostics)"
          onClick={toggleDevTools}
        >
          <span className="mode-icon">⚡</span> DevTools Mode
        </button>

        {devToolsMode && onMeasureBuild && <button className="action-btn" onClick={() => {
          setRuntimeOpen(!runtimeOpen);
          if (!runtimeOpen && onGetDevtoolsInstallStatus) void onGetDevtoolsInstallStatus().then(setInstallStatus).catch((error) => setInstallMessage(String(error)));
        }}>✦ Runtime &amp; Libraries</button>}

        <button
          className={`action-btn ${unifiedMode ? 'active' : ''}`}
          id="btn-toggle-unified"
          title="Toggle Single Unified Fractal Grand Seal (Единый чертёж)"
          onClick={toggleUnified}
        >
          <span className="mode-icon">◎</span> Unified Seal
        </button>

        <button
          className={`action-btn ${realisticMode ? 'active' : ''}`}
          id="btn-toggle-realistic"
          title="Toggle Monochrome Architectural Art Blueprint Mode"
          onClick={toggleRealistic}
        >
          <span className="mode-icon">✦</span> Realistic Art Mode
        </button>

        <button className="action-btn" id="btn-fit-world" onClick={onFitKingdom}>
          <span>⊕</span> Fit Kingdom
        </button>
      </div>
      {runtimeOpen && devToolsMode && onMeasureBuild && <div className="runtime-popover">
        <button className="close-drawer-btn" onClick={() => setRuntimeOpen(false)}>✕</button>
        <h3>Connect a running app</h3>
        <p>Detected: {reactVersions.length ? `React ${reactVersions.join(', ')}` : ''}{reactVersions.length && vueVersions.length ? ' · ' : ''}{vueVersions.length ? `Vue ${vueVersions.join(', ')}` : ''}{!reactVersions.length && !vueVersions.length ? 'No React or Vue component yet' : ''}</p>
        {onInstallDevtools && onRemoveDevtools && <div className="runtime-auto-setup">
          <strong>One-click dev setup</strong>
          <p>Adds a <code>dev:grimoire</code> command and a removable runtime adapter to the selected Vite project. It does not start the project or run a build.</p>
          <button className="action-btn" disabled={installBusy || !installStatus} onClick={async () => {
            setInstallBusy(true); setInstallMessage('Updating the selected project…');
            try {
              const status = installStatus?.installed ? await onRemoveDevtools() : await onInstallDevtools();
              setInstallStatus(status);
              setInstallMessage(status.installed ? `Added to ${status.entry}. Start the app with ${status.command}.` : 'Grimoire integration removed.');
            } catch (error) { setInstallMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>{installBusy ? 'Working…' : installStatus?.installed ? 'Remove DevTools setup' : 'Add DevTools command'}</button>
          {installStatus?.upgradeAvailable && onUpgradeDevtools && <button className="action-btn" disabled={installBusy} onClick={async () => {
            setInstallBusy(true); setInstallMessage('Adding component hierarchy tracing…');
            try {
              const status = await onUpgradeDevtools();
              setInstallStatus(status);
              setInstallMessage('Component tracing added. Restart dev:grimoire and reload the app.');
            } catch (error) { setInstallMessage(String(error instanceof Error ? error.message : error)); }
            finally { setInstallBusy(false); }
          }}>Upgrade to component tracing</button>}
          {installStatus?.installed && <p>Installed for {installStatus.framework} in <code>{installStatus.entry}</code>. Run <code>{installStatus.command}</code> from the target project.</p>}
          {installStatus?.componentTracing && <p>Component hierarchy tracing is enabled for this project.</p>}
          {installMessage && <p role="status">{installMessage}</p>}
        </div>}
        <p>Quick browser mode observes DOM updates and long tasks. Paste this into the target page’s DevTools console:</p>
        {browserLongTasks.count > 0 && <p>Observed main-thread long tasks: {browserLongTasks.count} · {Math.round(browserLongTasks.totalDurationMs)} ms total. Attribution to a library is unavailable in this mode.</p>}
        <code>{quickSnippet}</code>
        <button className="action-btn" onClick={() => navigator.clipboard.writeText(quickSnippet)}>Copy browser probe</button>
        {(vueVersions.length > 0 || reactVersions.length > 0) && <p>For measured component updates, add a dev adapter to the app entry:</p>}
        {vueVersions.length > 0 && <><strong>Vue 3</strong><code>{vueSnippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(vueSnippet)}>Copy Vue adapter</button></>}
        {reactVersions.length > 0 && <>
          {(hasReact17 || !hasModernReact) && <><strong>React 17</strong><code>{react17Snippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(react17Snippet)}>Copy React 17 adapter</button></>}
          {(hasModernReact || !hasReact17) && <><strong>React 18/19</strong><code>{reactModernSnippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(reactModernSnippet)}>Copy React 18/19 adapter</button></>}
          <p>React Profiler measures the wrapped subtree. Wrap a component in its own module for prop identity changes:</p>
          <code>{reactComponentSnippet}</code><button className="action-btn" onClick={() => navigator.clipboard.writeText(reactComponentSnippet)}>Copy prop profiler</button>
        </>}
        <button className="action-btn" disabled={measuring} onClick={async () => {
          if (!onMeasureBuild) return;
          setMeasuring(true); setMeasurementMessage('Building the target project…');
          try { const result = await onMeasureBuild(); setMeasurementMessage(`Measured ${result.measured} packages.`); }
          catch (error) { setMeasurementMessage(String(error instanceof Error ? error.message : error)); }
          finally { setMeasuring(false); }
        }}>{measuring ? 'Measuring…' : 'Measure Vite build'}</button>
        <p>{measurementMessage || 'A build runs only when you press Measure Vite build.'}</p>
      </div>}
    </header>
  );
};
