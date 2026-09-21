import React from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';
import type { ITransport } from '../transport/transport.js';

interface InspectorDrawerProps {
  transport: ITransport;
  onFocusNode: (nodeId: string) => void;
}

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({ transport, onFocusNode }) => {
  const { nodeMap, selectedNodeId, lineageNodes, isDrawerOpen, selectNode, setDrawerOpen } =
    useGrimoireStore();

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
