import React from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

export const Tooltip: React.FC = () => {
  const { tooltip } = useGrimoireStore();

  if (!tooltip.visible || (!tooltip.node && !tooltip.dependency)) return null;

  if (tooltip.dependency) {
    const dependency = tooltip.dependency;
    return <div id="hover-tooltip" className="hover-tooltip" style={{ left: `${tooltip.x + 16}px`, top: `${tooltip.y + 16}px`, display: 'block' }}>
      <div className="tooltip-title"><span className="tooltip-element-dot earth">✦</span>{dependency.name}</div>
      <div className="tooltip-meta">{dependency.build ? `${Math.round((dependency.build.emittedBytesEstimate || 0) / 1024)} KiB estimated JS` : `${dependency.importerNodeIds.length} importing seals · source estimate`}</div>
    </div>;
  }

  const node = tooltip.node!;
  const loc = node.loc || node.metrics?.loc || 0;
  const element = node.metrics?.element || 'Arcane';

  return (
    <div
      id="hover-tooltip"
      className="hover-tooltip"
      style={{
        left: `${tooltip.x + 16}px`,
        top: `${tooltip.y + 16}px`,
        display: 'block',
      }}
    >
      <div className="tooltip-title">
        <span className={`tooltip-element-dot ${element.toLowerCase()}`}>✦</span>
        {node.name}
      </div>
      <div className="tooltip-meta">
        {loc} LOC • {element} • {node.cluster || 'Citadel'}
      </div>
    </div>
  );
};
