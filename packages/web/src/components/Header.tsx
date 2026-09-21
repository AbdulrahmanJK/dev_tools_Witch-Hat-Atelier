import React from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

interface HeaderProps {
  onFitKingdom: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onFitKingdom }) => {
  const {
    graph,
    nodes,
    activeFilter,
    unifiedMode,
    realisticMode,
    searchQuery,
    setFilter,
    toggleUnified,
    toggleRealistic,
    setSearchQuery,
    selectNode,
  } = useGrimoireStore();

  const stats = graph?.stats || {
    totalNodes: nodes.length,
    totalFiles: 0,
    totalClusters: graph?.clusters?.length || 0,
  };

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

        {/* Elemental Filter Pills */}
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

        {/* Mode Toggles */}
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
