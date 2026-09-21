import React from 'react';
import { useGrimoireStore } from '../store/useGrimoireStore.js';

export const Tooltip: React.FC = () => {
  const { tooltip } = useGrimoireStore();

  if (!tooltip.visible || !tooltip.node) return null;

  const node = tooltip.node;
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
