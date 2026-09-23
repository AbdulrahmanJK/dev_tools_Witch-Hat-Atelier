import React from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

interface HeaderProps {
  onFitKingdom: () => void;
  onFitNodes?: (nodeIds: string[]) => void;
}

export const Header: React.FC<HeaderProps> = ({ onFitKingdom, onFitNodes }) => {
  const {
    graph,
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

  const stats = graph?.stats || {
    totalNodes: nodes.length,
    totalFiles: 0,
    totalClusters: graph?.clusters?.length || 0,
  };

  const diag = graph?.diagnostics;

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
              className={`pill-btn pill-diag-hot ${diagnosticFilter === 'hot' ? 'active' : ''}`}
              onClick={() => {
                setDiagnosticFilter('hot');
                const hotIds = nodes
                  .filter(
                    (n) =>
                      n.metrics?.devTools?.overloadState === 'overcharged' ||
                      n.metrics?.devTools?.overloadState === 'fissure'
                  )
                  .map((n) => n.id);
                if (hotIds.length > 0 && onFitNodes) {
                  onFitNodes(hotIds);
                }
              }}
              title="Filter Overheated & Fissure Components"
            >
              ⚡ Hot ({diag?.totalOvercharged || 0})
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
    </header>
  );
};
