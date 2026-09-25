import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGrimoireStore } from '../store/useGrimoireStore.js';
import type { ITransport } from '../transport/transport.js';
import { adviceText, elementLabel, findingText, ratingText, riskText, translate } from '../i18n.js';
import { SealPortrait } from './SealPortrait.js';

interface InspectorDrawerProps {
  transport: ITransport;
  onFocusNode: (nodeId: string) => void;
}

export const InspectorDrawer: React.FC<InspectorDrawerProps> = ({ transport, onFocusNode }) => {
  const {
    locale,
    nodeMap,
    selectedNodeId,
    selectedDependencyId,
    graph,
    lineageNodes,
    isDrawerOpen,
    devToolsMode,
    realisticMode,
    selectNode,
    setDrawerOpen,
  } = useGrimoireStore(useShallow((state) => ({
    locale: state.locale, nodeMap: state.isDrawerOpen ? state.nodeMap : null,
    selectedNodeId: state.selectedNodeId, selectedDependencyId: state.selectedDependencyId,
    graph: state.graph, lineageNodes: state.lineageNodes, isDrawerOpen: state.isDrawerOpen,
    devToolsMode: state.devToolsMode, realisticMode: state.realisticMode,
    selectNode: state.selectNode, setDrawerOpen: state.setDrawerOpen,
  })));

  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  if (!isDrawerOpen || !nodeMap || (!selectedNodeId && !selectedDependencyId)) return null;

  const dependency = graph?.dependencies?.find((item) => item.id === selectedDependencyId);
  if (dependency) return (
    <aside id="inspector-drawer" className="open">
      <div className="scroll-header">
        <div>
          <div className="seal-cluster-tag">✦ {t('externalLibrary')}</div>
          <h2 className="seal-title">{dependency.name}</h2>
          <div className="seal-cluster-tag">{dependency.version || t('versionUnknown')}</div>
        </div>
        <button className="close-drawer-btn" onClick={() => setDrawerOpen(false)}>✕</button>
      </div>
      <div className="scroll-body">
        <div className="devtools-panel">
          <div className="devtools-header"><span className="devtools-badge">✦ {t('librarySeal')}</span></div>
          <p>{t('sourceSpread')}: {dependency.sourceRisk.toUpperCase()} · {dependency.direct ? t('declaredDependency') : dependency.importCount ? t('undeclaredDependency') : t('transitiveDependency')}</p>
          <p>{t('importedIn')} {dependency.importerNodeIds.length} {t('codeSeals')}; {dependency.importCount} {t('importDeclarations')}.</p>
          {dependency.dynamicImportCount > 0 && <p>{dependency.dynamicImportCount} {t('dynamicImports')}.</p>}
          {dependency.build ? <p>{t('estimatedJs')}: {Math.round((dependency.build.emittedBytesEstimate || 0) / 1024)} KiB {t('acrossChunks')} {dependency.build.chunks.length} · {dependency.build.initial ? t('initialEntry') : t('outsideInitial')}. {t('rollupLength')}: {Math.round(dependency.build.renderedBytes / 1024)} KiB.</p> : <p>{t('bundleNotMeasured')}</p>}
          {dependency.build && <p>{t('libraryRingScale')}</p>}
          {dependency.runtime && <p>{t('bundleRuntime')}: {dependency.runtime.sampleCount}, {t('selfTime')} {dependency.runtime.selfTimeMs.toFixed(1)} ms.</p>}
          <div className="devtools-section-title">{t('importingSeals')}</div>
          {dependency.importerNodeIds.map((id) => {
            const importer = nodeMap.get(id);
            return <button key={id} className="cycle-crumb-item" onClick={() => { selectNode(id); onFocusNode(id); }}>{importer?.name || id}</button>;
          })}
        </div>
      </div>
    </aside>
  );

  if (!selectedNodeId) return null;

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
  const staticSymbols = node.sourceSymbols?.filter((entry) => !(entry.name === node.name && entry.line === node.sourceLine)) || [];
  const staticKindName = (kind: string) => {
    const labels: Record<string, [string, string]> = {
      class: ['класс', 'class'], interface: ['интерфейс', 'interface'], struct: ['структура', 'struct'], record: ['запись', 'record'], enum: ['перечисление', 'enum'], object: ['объект', 'object'],
      function: ['функция', 'function'], method: ['метод', 'method'], property: ['свойство', 'property'], field: ['поле', 'field'], module: ['модуль', 'module'],
    };
    return labels[kind]?.[locale === 'ru' ? 0 : 1] || kind;
  };

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
      transport.openFileInEditor(node.sourceAbsolutePath || node.file, node.sourceLine || 1);
    }
  };

  return (
    <aside id="inspector-drawer" className={isDrawerOpen ? 'open' : ''}>
      <div className="scroll-header">
        <div>
          <div className="seal-badge-row">
            <span className={`element-badge ${metrics.element.toLowerCase()}`}>
              {elementLabel(locale, metrics.element)}
            </span>
            <span className={`grade-badge ${metrics.isForbidden ? 'forbidden' : ''}`}>
              {ratingText(locale, metrics.grade)}
            </span>
          </div>
          <h2 className="seal-title" id="insp-title">
            {node.name}
          </h2>
          {node.analysisMode === 'static' && <div className="seal-cluster-tag">{node.language === 'csharp' ? 'C#' : node.language?.toUpperCase()} · {staticKindName(node.kind)} · {t('staticSource')}</div>}
          {node.framework && node.framework !== 'none' && <div className="seal-cluster-tag">{node.framework.toUpperCase()} {node.frameworkVersion || ''}</div>}
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
        <SealPortrait key={node.id} node={node} locale={locale} realisticMode={realisticMode} />
        {/* DEVTOOLS DIAGNOSTIC OVERLAY */}
        {devToolsMode && metrics.devTools && (
          <div className="devtools-panel">
            <div className="devtools-header">
              <span className="devtools-badge">⚡ {t('diagnostics')}</span>
              <span className={`health-pill health-${metrics.devTools.overloadState}`}>
                {metrics.devTools.healthScore}/100 • {ratingText(locale, metrics.devTools.overloadState)}
              </span>
            </div>

            {metrics.devTools.findings && metrics.devTools.findings.length > 0 && (
              <div className="devtools-section">
                <div className="devtools-section-title">{t('staticFindings')}</div>
                {metrics.devTools.findings.map((finding) => <div key={finding.id} className="cycle-desc">
                  <strong>{finding.rule}</strong> · {ratingText(locale, finding.severity)} · {locale === 'ru' ? 'уверенность' : 'confidence'}: {ratingText(locale, finding.confidence)} · <button className="cycle-crumb-item" onClick={() => transport.openFileInEditor(finding.file, finding.line)}>{locale === 'ru' ? 'строка' : 'line'} {finding.line}</button><br />{findingText(locale, finding)}
                  {finding.observedCount ? <><br />{locale === 'ru' ? `При измерении поддерева ссылка prop менялась ${finding.observedCount} раз (последняя длительность ${finding.lastObservedDurationMs?.toFixed(1)} мс).` : `Runtime observed this prop's identity change ${finding.observedCount} times during profiled subtree commits (last duration ${finding.lastObservedDurationMs?.toFixed(1)} ms).`}</> : null}
                </div>)}
              </div>
            )}

            {graph?.diagnostics?.architectureViolations?.filter((violation) => violation.sourceNodeId === node.id).map((violation) => <div key={violation.id} className="devtools-section devtools-cycle-box">
              <div className="devtools-section-title" style={{ color: '#b83a14' }}>✧ {locale === 'ru' ? 'Архитектурная граница' : 'Architecture Pact'}</div>
              <div className="cycle-desc">{locale === 'ru' ? 'Компонент импортирует страницу. Вынесите общий код в нейтральный модуль или измените направление зависимости.' : violation.message}</div>
              <button className="cycle-crumb-item" onClick={() => transport.openFileInEditor(violation.file, violation.line)}>{locale === 'ru' ? 'Открыть строку' : 'Open line'} {violation.line}</button>
            </div>)}

            {/* Performance Grid */}
            {node.telemetry && <div className="devtools-section">
              <div className="devtools-section-title">{t('runtimeObservations')}</div>
              <div className="cycle-desc">{node.telemetry.updateCount || 0} {t('measuredRerenders')} · {node.telemetry.mountCount || 0} mount · {node.telemetry.domUpdateCount || 0} {t('browserDom')}{(node.telemetry.updateCount || 0) > 0 ? ` · ${t('averageUpdate')} ${node.telemetry.avgUpdateDurationMs?.toFixed(1)} ms` : ''}</div>
              {node.telemetry.isOverheating && <div className="cycle-desc">⚡ {t('hotExplanation')}</div>}
              {node.telemetry.hierarchyPath && node.telemetry.hierarchyPath.length > 1 && <div className="cycle-desc">{t('runtimePath')}: {node.telemetry.hierarchyPath.join(' → ')}</div>}
              {node.telemetry.lastReasons && node.telemetry.lastReasons.length > 0 && <div className="cycle-desc">{t('observedChanges')}: {node.telemetry.lastReasons.join(', ')}. {t('parentCaveat')}</div>}
            </div>}
            <div className="devtools-grid">
              <div className="devtools-stat">
                <span className="stat-label">{t('healthScore')}</span>
                <span className={`stat-value score-${metrics.devTools.overloadState}`}>
                  {metrics.devTools.healthScore}
                </span>
              </div>
              <div className="devtools-stat">
                <span className="stat-label">{t('sourceSize')}</span>
                <span className="stat-value">
                  {ratingText(locale, metrics.devTools.bundleImpact.rating)}
                </span>
              </div>
              <div className="devtools-stat">
                <span className="stat-label">{t('complexity')}</span>
                <span className="stat-value">
                  {ratingText(locale, metrics.devTools.complexity.rating)}
                </span>
              </div>
              <div className="devtools-stat">
                <span className="stat-label">{t('rerenderRisks')}</span>
                <span className="stat-value">{metrics.devTools.rerenderRisks.length}</span>
              </div>
            </div>

            {/* Ouroboros Circular Dependency Loop */}
            {node.isCircular && node.circularPath && (
              <div className="devtools-section devtools-cycle-box">
                <div className="devtools-section-title" style={{ color: '#8c1db8' }}>
                  🔄 {t('circularLoop')}
                </div>
                <div className="cycle-path-container">
                  <div className="cycle-desc">
                    {t('cycleRisk')}
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
                  🍂 {t('orphanModule')}
                </div>
                <div className="orphan-desc">
                  {t('orphanNote')}
                </div>
              </div>
            )}

            {/* Rerender Risks List */}
            {metrics.devTools.rerenderRisks.length > 0 && (
              <div className="devtools-section">
                <div className="devtools-section-title">🚨 {t('riskList')}</div>
                <div className="risk-list">
                  {metrics.devTools.rerenderRisks.map((risk, idx) => (
                    <div key={idx} className={`risk-item severity-${risk.severity}`}>
                      <div className="risk-type">
                        <span className={`severity-dot dot-${risk.severity}`} />
                        {risk.type.replace('_', ' ').toUpperCase()}{' '}
                        {risk.line ? `(${locale === 'ru' ? 'строка' : 'line'} ${risk.line})` : ''}
                      </div>
                      <div className="risk-msg">{riskText(locale, risk)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Logic & State Complexity */}
            <div className="devtools-section">
              <div className="devtools-section-title">🧠 {t('architectureState')}</div>
              <div className="devtools-chips">
                <span className="chip">Cyclomatic: {metrics.devTools.complexity.cyclomatic}</span>
                <span className="chip">useState: {metrics.devTools.complexity.stateCount}</span>
                <span className="chip">useEffect: {metrics.devTools.complexity.effectCount}</span>
                <span className="chip">{t('callbacks')}: {metrics.devTools.complexity.callbackCount}</span>
                <span className="chip">{t('imports')}: {metrics.devTools.bundleImpact.importCount}</span>
              </div>
              {metrics.devTools.bundleImpact.heavyLibraries.length > 0 && (
                <div className="heavy-libs-warning">
                  ⚠️ {t('heavyBundles')}: {metrics.devTools.bundleImpact.heavyLibraries.join(', ')}
                </div>
              )}
            </div>

            {/* Master Refactor Tips */}
            {metrics.devTools.refactorTips.length > 0 && (
              <div className="devtools-section">
                <div className="devtools-section-title">💡 {t('refactorAdvice')}</div>
                <ul className="refactor-tips">
                  {metrics.devTools.refactorTips.map((tip, idx) => (
                    <li key={idx} className="tip-item">
                      ✦ {adviceText(locale, tip)}
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
            <div className="section-label">{t('lineage')}</div>
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
            <div className="meta-item-lbl">{t('linesOfCode')}</div>
          </div>
          <div>
            <div className="meta-item-val" id="insp-hooks-count">
              {node.analysisMode === 'static' ? staticSymbols.length : hookCount}
            </div>
            <div className="meta-item-lbl">{node.analysisMode === 'static' ? t('sourceMembers') : t('keystones')}</div>
          </div>
          <div>
            <div className="meta-item-val" id="insp-children-count">{node.analysisMode === 'static' ? node.sourceImports?.length || 0 : childCount}</div>
            <div className="meta-item-lbl">{node.analysisMode === 'static' ? t('imports') : t('subGlyphs')}</div>
          </div>
        </div>

        {/* {t('stability')} */}
        <div>
          <div className="section-label">{t('stability')}</div>
          <div
            className={`stability-card ${metrics.isForbidden ? 'forbidden-card' : ''}`}
            id="insp-stability-card"
          >
            <div className="stability-title">{ratingText(locale, metrics.grade)}</div>
            <div className="stability-note">{node.analysisMode === 'static' ? t('staticOnly') : metrics.stabilityNote}</div>
          </div>
        </div>

        {node.analysisMode === 'static' && <div className="static-source-details">
          {node.sourceNamespace && <p><strong>{t('sourceNamespace')}:</strong> {node.sourceNamespace}</p>}
          {staticSymbols.length > 0 && <div>
            <div className="section-label">{t('sourceSymbols')}</div>
            <div className="static-symbol-list">{staticSymbols.map((symbol, index) => <button className="static-symbol-row" key={`${symbol.name}-${symbol.line}-${index}`} onClick={() => transport.openFileInEditor(node.sourceAbsolutePath || node.file, symbol.line)}>
              <span className="static-symbol-kind">{staticKindName(symbol.kind)}</span>
              <span className="static-symbol-main"><strong>{symbol.name}</strong><small>{symbol.signature || symbol.name}</small>{symbol.constructs && (symbol.constructs.loops || symbol.constructs.branches || symbol.constructs.awaits) ? <small>{[
                symbol.constructs.loops ? `${symbol.constructs.loops} ${t('sourceLoops')}` : '',
                symbol.constructs.branches ? `${symbol.constructs.branches} ${t('sourceBranches')}` : '',
                symbol.constructs.awaits ? `${symbol.constructs.awaits} ${t('sourceAwaits')}` : '',
              ].filter(Boolean).join(' · ')}</small> : null}</span>
              <span className="static-symbol-line">{t('sourceLine')} {symbol.line}</span>
            </button>)}</div>
          </div>}
          {!!node.sourceImports?.length && <details><summary>{t('sourceImports')} ({node.sourceImports.length})</summary><div className="static-import-list">{node.sourceImports.slice(0, 50).map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}{node.sourceImports.length > 50 && <div>+{node.sourceImports.length - 50} {t('sourceMoreImports')}</div>}</div></details>}
        </div>}

        {/* Master Forge Consumers (Shared Atelier Hubs) */}
        {node.isSharedHub && (node.consumers?.length || 0) > 0 && (
          <div id="insp-forge-section">
            <div className="section-label">{t('consumers')}</div>
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

        {/* Internal Circuit */}
        {(circuit.stateVariables?.length > 0 ||
          circuit.effects?.length > 0 ||
          circuit.handlers?.length > 0) && (
          <div id="insp-circuit-section">
            <div className="section-label">{t('internalCircuit')}</div>
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

        {/* {t('hooks')} */}
        {metrics.keystoneDetails && metrics.keystoneDetails.length > 0 && (
          <div>
            <div className="section-label">{t('hooks')}</div>
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
            <div className="section-label">{t('subGlyphs')}</div>
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
          <span>🖋</span> {t('openEditor')}
        </a>
      </div>
    </aside>
  );
};
