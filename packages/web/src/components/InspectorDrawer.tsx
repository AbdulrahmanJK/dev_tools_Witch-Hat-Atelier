import React from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';
import type { ITransport } from '../transport/transport.js';

interface InspectorDrawerProps {
  transport: ITransport;
  onFocusNode: (nodeId: string) => void;
}

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({ transport, onFocusNode }) => {
  const {
    nodeMap,
    selectedNodeId,
    lineageNodes,
    isDrawerOpen,
    devToolsMode,
    selectNode,
    setDrawerOpen,
  } = useGrimoireStore();

  if (!isDrawerOpen || !selectedNodeId) return null;

  const node = nodeMap.get(selectedNodeId);
  if (!node) return null;

  const metrics = node.metrics || {
    radius: 40,
    element: 'Arcane',
    keystones: [],
    keystoneDetails: [],
    radialSigns: [],
    grade: 'Master Seal',
    stabilityNote: '',
    isForbidden: false,
    loc: 0,
    hookCount: 0,
    childCount: 0,
  };

  const loc = node.loc || metrics.loc || 0;
  const hookCount = node.hooks?.length || metrics.hookCount || 0;
  const childCount = node.children?.length || metrics.childCount || 0;
  const circuit = node.internalCircuit || { stateVariables: [], effects: [], handlers: [] };

  const handleCrumbClick = (id: string) => {
    selectNode(id);
    onFocusNode(id);
  };

  const handleCycleCrumbClick = (name: string) => {
    const target = Array.from(nodeMap.values()).find((n) => n.name === name);
    if (target) {
      selectNode(target.id);
      onFocusNode(target.id);
    }
  };

  const handleOpenInEditor = (e: React.MouseEvent) => {
    e.preventDefault();
    if (node.file) {
      transport.openFileInEditor(node.file, 1);
    }
  };

  return (
    <aside id="inspector-drawer" className={isDrawerOpen ? 'open' : ''}>
      <div className="scroll-header">
        <div>
          <div className="seal-badge-row">
            <span className={`element-badge ${metrics.element.toLowerCase()}`}>
              {metrics.element}
            </span>
            <span className={`grade-badge ${metrics.isForbidden ? 'forbidden' : ''}`}>
              {metrics.grade}
            </span>
          </div>
          <h2 className="seal-title" id="insp-title">
            {node.name}
          </h2>
          <div className="seal-cluster-tag" id="insp-cluster">
            ✦ {node.cluster || 'Great Citadel'}
          </div>
        </div>
        <button
          className="close-drawer-btn"
          id="btn-close-drawer"
          onClick={() => setDrawerOpen(false)}
        >
          ✕
        </button>
      </div>

      <div className="scroll-body">
        {/* DEVTOOLS DIAGNOSTIC OVERLAY */}
        {devToolsMode && metrics.devTools && (
          <div className="devtools-panel">
            <div className="devtools-header">
              <span className="devtools-badge">⚡ DEVTOOLS DIAGNOSTICS</span>
              <span className={`health-pill health-${metrics.devTools.overloadState}`}>
                {metrics.devTools.healthScore}/100 • {metrics.devTools.overloadState.toUpperCase()}
              </span>
            </div>

            {/* Performance Grid */}
            <div className="devtools-grid">
              <div className="devtools-stat">
                <span className="stat-label">Health Score</span>
                <span className={`stat-value score-${metrics.devTools.overloadState}`}>
                  {metrics.devTools.healthScore}
                </span>
              </div>
              <div className="devtools-stat">
                <span className="stat-label">Bundle Weight</span>
                <span className="stat-value">
                  {metrics.devTools.bundleImpact.rating.toUpperCase()}
                </span>
              </div>
              <div className="devtools-stat">
                <span className="stat-label">Complexity</span>
                <span className="stat-value">
                  {metrics.devTools.complexity.rating.toUpperCase()}
                </span>
              </div>
              <div className="devtools-stat">
                <span className="stat-label">Re-renders</span>
                <span className="stat-value">{metrics.devTools.rerenderRisks.length}</span>
              </div>
            </div>

            {/* Ouroboros Circular Dependency Loop */}
            {node.isCircular && node.circularPath && (
              <div className="devtools-section devtools-cycle-box">
                <div className="devtools-section-title" style={{ color: '#8c1db8' }}>
                  🔄 Ouroboros Circular Loop
                </div>
                <div className="cycle-path-container">
                  <div className="cycle-desc">
                    Breaks HMR live reload, leaks memory, and risks undefined imports on startup:
                  </div>
                  <div className="cycle-breadcrumbs">
                    {node.circularPath.map((name, i) => (
                      <React.Fragment key={i}>
                        <span
                          className={`cycle-crumb-item ${name === node.name ? 'active' : ''}`}
                          onClick={() => handleCycleCrumbClick(name)}
                          style={{ cursor: 'pointer' }}
                          title={`Jump to ${name}`}
                        >
                          {name}
                        </span>
                        {i < node.circularPath!.length - 1 && <span className="cycle-arrow"> ➔ </span>}
                      </React.Fragment>
                    ))}
                    <span className="cycle-arrow"> ➔ </span>
                    <span
                      className="cycle-crumb-item"
                      onClick={() => handleCycleCrumbClick(node.circularPath![0]!)}
                      style={{ cursor: 'pointer' }}
                      title={`Close loop to ${node.circularPath[0]}`}
                    >
                      {node.circularPath[0]}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Dead Code & Orphan Module */}
            {node.isOrphan && (
              <div className="devtools-section devtools-orphan-box">
                <div className="devtools-section-title" style={{ color: '#78756d' }}>
                  🍂 Forgotten Scroll (Dead Code)
                </div>
                <div className="orphan-desc">
                  Zero incoming imports or component renders across the entire kingdom. 
                  This module ({loc} LOC) appears completely unused and can be safely pruned.
                </div>
              </div>
            )}

            {/* Rerender Risks List */}
            {metrics.devTools.rerenderRisks.length > 0 && (
              <div className="devtools-section">
                <div className="devtools-section-title">🚨 Re-render Vulnerabilities</div>
                <div className="risk-list">
                  {metrics.devTools.rerenderRisks.map((risk, idx) => (
                    <div key={idx} className={`risk-item severity-${risk.severity}`}>
                      <div className="risk-type">
                        <span className={`severity-dot dot-${risk.severity}`} />
                        {risk.type.replace('_', ' ').toUpperCase()}{' '}
                        {risk.line ? `(line ${risk.line})` : ''}
                      </div>
                      <div className="risk-msg">{risk.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Logic & State Complexity */}
            <div className="devtools-section">
              <div className="devtools-section-title">🧠 Architecture & State Footprint</div>
              <div className="devtools-chips">
                <span className="chip">Cyclomatic: {metrics.devTools.complexity.cyclomatic}</span>
                <span className="chip">useState: {metrics.devTools.complexity.stateCount}</span>
                <span className="chip">useEffect: {metrics.devTools.complexity.effectCount}</span>
                <span className="chip">Callbacks: {metrics.devTools.complexity.callbackCount}</span>
                <span className="chip">Imports: {metrics.devTools.bundleImpact.importCount}</span>
              </div>
              {metrics.devTools.bundleImpact.heavyLibraries.length > 0 && (
                <div className="heavy-libs-warning">
                  ⚠️ Heavy bundles: {metrics.devTools.bundleImpact.heavyLibraries.join(', ')}
                </div>
              )}
            </div>

            {/* Master Refactor Tips */}
            {metrics.devTools.refactorTips.length > 0 && (
              <div className="devtools-section">
                <div className="devtools-section-title">💡 Master Refactor Advice</div>
                <ul className="refactor-tips">
                  {metrics.devTools.refactorTips.map((tip, idx) => (
                    <li key={idx} className="tip-item">
                      ✦ {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Ancestral Lineage */}
        {lineageNodes.length > 0 && (
          <div id="insp-ancestry-section">
            <div className="section-label">Ancestral Lineage (Цепочка от истока)</div>
            <div className="lineage-breadcrumbs">
              {lineageNodes.map((id, idx) => {
                const n = nodeMap.get(id);
                const isCurrent = id === node.id;
                return (
                  <React.Fragment key={id}>
                    <span
                      className={`crumb-item ${isCurrent ? 'active' : ''}`}
                      onClick={() => handleCrumbClick(id)}
                    >
                      {n ? n.name : id.split('#')[1] || id}
                    </span>
                    {idx < lineageNodes.length - 1 && <span className="crumb-arrow"> › </span>}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Quantitative Metrics */}
        <div className="meta-box">
          <div>
            <div className="meta-item-val" id="insp-loc">
              {loc}
            </div>
            <div className="meta-item-lbl">Lines of Code</div>
          </div>
          <div>
            <div className="meta-item-val" id="insp-hooks-count">
              {hookCount}
            </div>
            <div className="meta-item-lbl">Keystones</div>
          </div>
          <div>
            <div className="meta-item-val" id="insp-children-count">
              {childCount}
            </div>
            <div className="meta-item-lbl">Sub-Glyphs</div>
          </div>
        </div>

        {/* Stability & Day of Pact */}
        <div>
          <div className="section-label">Stability & Day of Pact</div>
          <div
            className={`stability-card ${metrics.isForbidden ? 'forbidden-card' : ''}`}
            id="insp-stability-card"
          >
            <div className="stability-title">{metrics.grade}</div>
            <div className="stability-note">{metrics.stabilityNote}</div>
          </div>
        </div>

        {/* Master Forge Consumers (Shared Atelier Hubs) */}
        {node.isSharedHub && (node.consumers?.length || 0) > 0 && (
          <div id="insp-forge-section">
            <div className="section-label">Master Forge Consumers (Питает модули)</div>
            <div className="link-pills">
              {node.consumers!.map((consumerId) => {
                const c = nodeMap.get(consumerId);
                return (
                  <span
                    key={consumerId}
                    className="node-link-pill"
                    onClick={() => handleCrumbClick(consumerId)}
                  >
                    ✦ {c ? c.name : consumerId}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Code Construct Signs */}
        {metrics.radialSigns && metrics.radialSigns.length > 0 && (
          <div id="insp-inventory-section">
            <div className="section-label">Code Construct Signs (Знаки кода)</div>
            <div className="link-pills">
              {metrics.radialSigns.map((sign, idx) => (
                <span key={idx} className="node-link-pill">
                  {sign.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Internal Circuit */}
        {(circuit.stateVariables?.length > 0 ||
          circuit.effects?.length > 0 ||
          circuit.handlers?.length > 0) && (
          <div id="insp-circuit-section">
            <div className="section-label">Internal Circuit (Inscribed Sub-Seals)</div>
            <div className="keystone-list">
              {circuit.stateVariables.map((v, i) => (
                <div key={`s-${i}`} className="keystone-row">
                  <span className="keystone-name">
                    <span style={{ color: '#a88915' }}>○</span> [state] {v.name}
                  </span>
                  <span className="keystone-detail">{v.setter || 'useState'}</span>
                </div>
              ))}
              {circuit.effects.map((e, i) => (
                <div key={`e-${i}`} className="keystone-row">
                  <span className="keystone-name">
                    <span style={{ color: '#106ba3' }}>◎</span> [effect]
                  </span>
                  <span className="keystone-detail">
                    {e.deps?.length > 0 ? `[${e.deps.join(', ')}]` : '[]'}
                  </span>
                </div>
              ))}
              {circuit.handlers.map((h, i) => (
                <div key={`h-${i}`} className="keystone-row">
                  <span className="keystone-name">
                    <span style={{ color: '#b83a14' }}>┴</span> {h.name}
                  </span>
                  <span className="keystone-detail">{h.loc} LOC</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Enchanted Keystones (Hooks) */}
        {metrics.keystoneDetails && metrics.keystoneDetails.length > 0 && (
          <div>
            <div className="section-label">Enchanted Keystones (Hooks)</div>
            <div className="keystone-list">
              {metrics.keystoneDetails.map((kd, idx) => (
                <div key={idx} className="keystone-row">
                  <span className="keystone-name">
                    <span>✦</span> {kd.hook}
                  </span>
                  <span className="keystone-detail">{kd.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rendered Children */}
        {node.children && node.children.length > 0 && (
          <div>
            <div className="section-label">Sub-Glyphs Rendered (Children)</div>
            <div className="link-pills">
              {node.children.map((chName) => {
                const childNode = Array.from(nodeMap.values()).find((n) => n.name === chName);
                return (
                  <span
                    key={chName}
                    className="node-link-pill"
                    onClick={() => childNode && handleCrumbClick(childNode.id)}
                  >
                    ✦ {chName}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Open in Editor button */}
        <a className="open-ide-btn" id="btn-open-ide" href="#" onClick={handleOpenInEditor}>
          <span>🖋</span> Inscribe in Editor
        </a>
      </div>
    </aside>
  );
};
