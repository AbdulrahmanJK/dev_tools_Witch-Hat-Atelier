import { Camera } from './canvas/camera.js';
import { WorldRenderer } from './canvas/renderer.js';
import { WHA_THEMES } from './canvas/glyphs.js';

class GrimoireApp {
  constructor() {
    this.canvas = document.getElementById('grimoire-canvas');
    this.viewport = document.getElementById('viewport-container');
    this.camera = new Camera(this.canvas);
    this.renderer = new WorldRenderer(this.canvas, this.camera);

    this.graphData = null;
    this.allNodes = [];
    this.activeFilter = 'all';
    this.realisticMode = false;

    this.drawer = document.getElementById('inspector-drawer');
    this.searchBox = document.getElementById('node-search');

    this.init();
  }

  async init() {
    this.setupResize();
    this.bindUI();
    await this.loadData();
    this.setupLiveReload();

    // Start render loop
    const renderLoop = () => {
      this.renderer.render();
      this.updateHUD();
      requestAnimationFrame(renderLoop);
    };
    requestAnimationFrame(renderLoop);
  }

  setupResize() {
    const resize = () => {
      const w = this.viewport.clientWidth;
      const h = this.viewport.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';

      this.camera.resize(w, h);
    };

    window.addEventListener('resize', resize);
    resize();
  }

  async loadData() {
    try {
      const res = await fetch('/api/graph');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.graphData = await res.json();
      this.allNodes = this.graphData.nodes;
      this.nodeMap = new Map(this.allNodes.map((n) => [n.id, n]));

      this.renderer.setData(this.graphData);

      // Update subtitle stats
      const stats = this.graphData.stats || {};
      document.getElementById('project-stats-label').textContent = 
        `${stats.totalNodes || this.allNodes.length} Glyphs • ${this.graphData.clusters.length} Archipelagos • ${stats.totalFiles || 0} Files`;

      // Focus on Root Seal (App) or fit realm
      const rootNode = this.allNodes.find((n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root')));
      if (rootNode) {
        this.camera.x = rootNode.x;
        this.camera.y = rootNode.y;
        this.camera.zoom = 0.42;
        this.selectNode(rootNode);
      } else if (this.graphData.bounds) {
        this.camera.fitBounds(this.graphData.bounds);
      }
    } catch (err) {
      console.error('Failed to load grimoire graph:', err);
      document.getElementById('project-stats-label').textContent = 'Error consulting archives (' + err.message + ')';
    }
  }

  setupLiveReload() {
    // Listen for file changes via Server-Sent Events
    try {
      const evtSource = new EventSource('/api/events');
      evtSource.onmessage = (event) => {
        if (event.data === 'reload') {
          console.log('⚡ Codebase altered: Re-inscribing grimoire…');
          this.loadData();
        }
      };
    } catch (err) {
      // Offline fallback
    }
  }

  bindUI() {
    // Canvas Click & Hover Hit Testing
    let clickStartPos = { x: 0, y: 0 };

    this.viewport.addEventListener('pointerdown', (e) => {
      clickStartPos = { x: e.clientX, y: e.clientY };
    });

    this.viewport.addEventListener('pointerup', (e) => {
      if (this.realisticMode) return; // Interactivity disabled in Art Mode!

      const moved = Math.hypot(e.clientX - clickStartPos.x, e.clientY - clickStartPos.y);
      if (moved < 5) {
        // Pure click (not drag pan)
        const hit = this.renderer.findNodeAt(e.clientX, e.clientY);
        if (hit) {
          const node = hit.node || hit;
          this.selectNode(node, hit.hitSubSeal);
        } else {
          this.deselect();
        }
      }
    });

    this.viewport.addEventListener('pointermove', (e) => {
      if (this.camera.isDragging) return;
      if (this.realisticMode) {
        this.viewport.style.cursor = 'grab';
        this.renderer.hoveredNodeId = null;
        return;
      }

      const hit = this.renderer.findNodeAt(e.clientX, e.clientY);
      const node = hit ? (hit.node || hit) : null;
      this.renderer.hoveredNodeId = node ? node.id : null;
      this.viewport.style.cursor = node ? 'pointer' : 'grab';
    });

    // Realistic Manga Art Mode Toggle
    const toggleRealBtn = document.getElementById('btn-toggle-realistic');
    if (toggleRealBtn) {
      toggleRealBtn.addEventListener('click', () => {
        this.realisticMode = !this.realisticMode;
        toggleRealBtn.classList.toggle('active', this.realisticMode);
        document.body.classList.toggle('art-mode', this.realisticMode);
        this.renderer.setRealisticMode(this.realisticMode);

        if (this.realisticMode) {
          this.deselect(); // Close drawer and clear selection for clean art viewing
        } else if (this.renderer.selectedNodeId) {
          const selNode = this.allNodes.find((n) => n.id === this.renderer.selectedNodeId);
          if (selNode) this.openInspector(selNode);
        }
      });
    }

    // Zoom Buttons
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      const cx = this.camera.width / 2;
      const cy = this.camera.height / 2;
      this.camera.zoomAt(cx, cy, 1.25);
    });

    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      const cx = this.camera.width / 2;
      const cy = this.camera.height / 2;
      this.camera.zoomAt(cx, cy, 0.8);
    });

    document.getElementById('btn-fit-world').addEventListener('click', () => {
      if (this.graphData && this.graphData.bounds) {
        this.camera.fitBounds(this.graphData.bounds);
      }
    });

    // Search bar
    const findMatchingNode = (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return null;
      return (
        this.allNodes.find((n) => n.name.toLowerCase() === q) ||
        this.allNodes.find((n) => n.name.toLowerCase().startsWith(q)) ||
        this.allNodes.find((n) => n.name.toLowerCase().includes(q))
      );
    };

    this.searchBox.addEventListener('input', (e) => {
      const match = findMatchingNode(e.target.value);
      if (match) {
        this.renderer.hoveredNodeId = match.id;
      }
    });

    this.searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const match = findMatchingNode(e.target.value);
        if (match) {
          this.selectNode(match);
          this.camera.focusNode(match, 0.9);
        }
      }
    });

    // Element Filter Pills
    document.querySelectorAll('#element-filters .pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#element-filters .pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const el = btn.getAttribute('data-el');
        this.activeFilter = el;
        this.applyFilter();
      });
    });

    // Drawer Close
    document.getElementById('btn-close-drawer').addEventListener('click', () => {
      this.deselect();
    });
  }

  applyFilter() {
    if (this.activeFilter === 'all') {
      this.renderer.nodes = this.allNodes;
    } else {
      this.renderer.nodes = this.allNodes.filter(
        (n) => (n.metrics.element || '').toLowerCase() === this.activeFilter.toLowerCase()
      );
    }
  }

  getAncestryChain(targetId) {
    if (!this.graphData || !this.graphData.edges) return [this.nodeMap.get(targetId)].filter(Boolean);

    const root = this.allNodes.find((n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root')));
    if (!root || root.id === targetId) return [this.nodeMap.get(targetId)].filter(Boolean);

    // BFS from root to target
    const adj = new Map();
    this.graphData.edges.forEach((e) => {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source).push(e.target);
    });

    const queue = [[root.id]];
    const visited = new Set([root.id]);
    let foundPath = null;

    while (queue.length > 0) {
      const path = queue.shift();
      const curr = path[path.length - 1];

      if (curr === targetId) {
        foundPath = path;
        break;
      }

      const neighbors = adj.get(curr) || [];
      for (const nextId of neighbors) {
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push([...path, nextId]);
        }
      }
    }

    if (foundPath) {
      return foundPath.map((id) => this.nodeMap.get(id)).filter(Boolean);
    }

    // Fallback: reverse traverse single parent
    const incoming = this.graphData.edges.filter((e) => e.target === targetId);
    if (incoming.length > 0) {
      const pNode = this.nodeMap.get(incoming[0].source);
      if (pNode) return [pNode, this.nodeMap.get(targetId)].filter(Boolean);
    }

    return [this.nodeMap.get(targetId)].filter(Boolean);
  }

  getDescendantTree(nodeId, currentDepth = 0, maxDepth = 3, visited = new Set()) {
    const node = this.nodeMap.get(nodeId);
    if (!node || currentDepth >= maxDepth || visited.has(nodeId)) return null;
    visited.add(nodeId);

    const childIds = new Set();
    // 1. Children from rendered JSX tags
    (node.children || []).forEach((chName) => {
      const matched = this.allNodes.find((n) => n.name === chName);
      if (matched && matched.id !== nodeId) childIds.add(matched.id);
    });

    // 2. Children from outgoing edges
    this.graphData.edges.forEach((e) => {
      if (e.source === nodeId && e.target !== nodeId) {
        childIds.add(e.target);
      }
    });

    const children = [];
    for (const cid of childIds) {
      const subTree = this.getDescendantTree(cid, currentDepth + 1, maxDepth, new Set(visited));
      if (subTree) children.push(subTree);
    }

    return {
      node,
      depth: currentDepth,
      children,
    };
  }

  selectNode(node, hitSubSeal = null) {
    this.renderer.selectedNodeId = node.id;
    const ancestry = this.getAncestryChain(node.id);
    const descendantTree = this.getDescendantTree(node.id);
    this.renderer.setHighlightedLineage(ancestry, descendantTree);
    this.openInspector(node, hitSubSeal, ancestry, descendantTree);
  }

  deselect() {
    this.renderer.selectedNodeId = null;
    this.renderer.clearHighlightedLineage();
    this.drawer.classList.remove('open');
  }

  openInspector(node, hitSubSeal = null, ancestry = null, descendantTree = null) {
    const theme = WHA_THEMES[node.metrics.element] || WHA_THEMES.Arcane;

    if (!ancestry) ancestry = this.getAncestryChain(node.id);
    if (!descendantTree) descendantTree = this.getDescendantTree(node.id);

    // 1. Full Ancestral Lineage Breadcrumbs (Путь от истока)
    const ancestryCrumbsEl = document.getElementById('insp-ancestry-crumbs');
    if (ancestryCrumbsEl) {
      ancestryCrumbsEl.innerHTML = '';
      ancestry.forEach((aNode, idx) => {
        if (idx > 0) {
          const arrow = document.createElement('span');
          arrow.className = 'crumb-arrow';
          arrow.textContent = '➔';
          ancestryCrumbsEl.appendChild(arrow);
        }

        const isCurrent = aNode.id === node.id;
        const crumb = document.createElement('button');
        crumb.className = 'crumb-step' + (isCurrent ? ' current' : '');
        crumb.innerHTML = `<span>✦</span> ${aNode.name} <span style="font-size:0.62rem;opacity:0.65">(${aNode.loc}L)</span>`;
        if (!isCurrent) {
          crumb.addEventListener('click', () => {
            this.selectNode(aNode);
            this.camera.focusNode(aNode, 0.9);
          });
        }
        ancestryCrumbsEl.appendChild(crumb);
      });
    }

    // Header values
    const elBadge = document.getElementById('insp-element');
    elBadge.textContent = node.metrics.element;
    elBadge.style.color = theme.stroke;
    elBadge.style.borderColor = theme.stroke;

    document.getElementById('insp-grade').textContent = node.metrics.grade;
    document.getElementById('insp-title').textContent = node.name;
    document.getElementById('insp-cluster').textContent = `${node.cluster} • ${node.file}`;

    // Meta box
    document.getElementById('insp-loc').textContent = node.loc;
    document.getElementById('insp-hooks-count').textContent = (node.hooks || []).length;
    document.getElementById('insp-children-count').textContent = (node.children || []).length;

    // Stability card
    const stabCard = document.getElementById('insp-stability-card');
    const isForbidden = node.metrics.isForbidden;
    stabCard.className = 'stability-card' + (isForbidden ? ' forbidden' : '');
    document.getElementById('insp-stability-grade').textContent = node.metrics.grade;
    document.getElementById('insp-stability-note').textContent = node.metrics.stabilityNote;

    // 2. Hierarchical Descent Tree (Древо переходов к младшим)
    const descTreeEl = document.getElementById('insp-descendant-tree');
    if (descTreeEl) {
      descTreeEl.innerHTML = '';
      const renderTreeBranch = (item, isRoot = false) => {
        if (!item || !item.node) return;
        const cNode = item.node;

        if (!isRoot) {
          const branch = document.createElement('div');
          branch.className = 'tree-branch';
          const indentPx = (item.depth - 1) * 14;
          branch.style.marginLeft = indentPx + 'px';

          const cTheme = WHA_THEMES[cNode.metrics.element] || WHA_THEMES.Arcane;
          const guide = item.depth === 1 ? '├──' : '└──';

          branch.innerHTML = `
            <div class="tree-branch-name">
              <span class="tree-indent-guide">${guide}</span>
              <span style="color:${cTheme.stroke}">✦</span>
              <span>${cNode.name}</span>
            </div>
            <div class="tree-meta-badge">${cNode.loc} LOC • ${cNode.metrics.element}</div>
          `;

          branch.addEventListener('click', () => {
            this.selectNode(cNode);
            this.camera.focusNode(cNode, 0.9);
          });

          descTreeEl.appendChild(branch);
        }

        if (item.children && item.children.length > 0) {
          item.children.forEach((childItem) => renderTreeBranch(childItem, false));
        }
      };

      if (descendantTree && descendantTree.children && descendantTree.children.length > 0) {
        renderTreeBranch(descendantTree, true);
      } else {
        descTreeEl.innerHTML = '<div style="font-size:0.75rem;color:var(--ink-secondary);font-style:italic">Terminal leaf seal (no downstream junior components).</div>';
      }
    }

    // 3. Internal Circuit (Inscribed Sub-Seals)
    const circuitSec = document.getElementById('insp-circuit-section');
    const circuitList = document.getElementById('insp-circuit-list');
    const subSeals = node.realisticLayout?.subSeals || [];

    if (subSeals.length > 0) {
      circuitSec.style.display = 'block';
      circuitList.innerHTML = '';

      subSeals.forEach((sub) => {
        const card = document.createElement('div');
        const isTarget = hitSubSeal && (hitSubSeal.id === sub.id || hitSubSeal.name === sub.name);
        card.className = 'circuit-sub-seal-card' + (isTarget ? ' highlight' : '');

        const icon = sub.type === 'core' ? '▲' : sub.type === 'state' ? '◇' : sub.type === 'effects' ? '◎' : sub.type === 'handler' ? '┴' : '∧';
        const varsText = sub.details && sub.details.length > 0 ? sub.details.join(', ') : 'Inscribed node';

        card.innerHTML = `
          <div class="sub-seal-title">
            <span>${icon} ${sub.name}</span>
            <span style="font-size:0.62rem;text-transform:uppercase;color:var(--ink-secondary)">${sub.type}</span>
          </div>
          <div class="sub-seal-vars">${varsText}</div>
        `;
        circuitList.appendChild(card);
      });
    } else {
      circuitSec.style.display = 'none';
    }

    // Keystones list
    const kList = document.getElementById('insp-keystones-list');
    kList.innerHTML = '';
    const keystoneDetails = node.metrics.keystoneDetails || [];
    if (keystoneDetails.length === 0) {
      kList.innerHTML = '<div style="font-size:0.75rem;color:var(--ink-secondary);font-style:italic">No reactive keystones inscribed.</div>';
    } else {
      keystoneDetails.forEach((k) => {
        const row = document.createElement('div');
        row.className = 'keystone-row';
        row.innerHTML = `
          <div class="keystone-name"><span>✦</span> ${k.name} <span style="font-size:0.65rem;color:var(--ink-secondary);font-family:monospace">(${k.hook})</span></div>
          <div class="keystone-detail">${k.detail}</div>
        `;
        kList.appendChild(row);
      });
    }

    // Children pills
    const chPills = document.getElementById('insp-children-pills');
    chPills.innerHTML = '';
    const children = node.children || [];
    if (children.length === 0) {
      chPills.innerHTML = '<div style="font-size:0.75rem;color:var(--ink-secondary);font-style:italic">Terminal leaf glyph (no sub-components).</div>';
    } else {
      children.forEach((childName) => {
        const pill = document.createElement('button');
        pill.className = 'node-link-pill';
        pill.textContent = childName;
        pill.addEventListener('click', () => {
          const target = this.allNodes.find((n) => n.name === childName);
          if (target) {
            this.selectNode(target);
            this.camera.focusNode(target);
          }
        });
        chPills.appendChild(pill);
      });
    }

    // Redux Section
    const reduxSec = document.getElementById('insp-redux-section');
    const redPills = document.getElementById('insp-redux-pills');
    const dispatches = node.reduxDispatches || [];
    if (dispatches.length > 0) {
      reduxSec.style.display = 'block';
      redPills.innerHTML = '';
      dispatches.forEach((act) => {
        const pill = document.createElement('span');
        pill.className = 'node-link-pill';
        pill.style.borderColor = '#b83a14';
        pill.textContent = act;
        redPills.appendChild(pill);
      });
    } else {
      reduxSec.style.display = 'none';
    }

    // Open in IDE
    const ideBtn = document.getElementById('btn-open-ide');
    ideBtn.href = `vscode://file/${node.absPath}`;

    this.drawer.classList.add('open');
  }

  updateHUD() {
    const zoomPct = Math.round(this.camera.zoom * 100);
    document.getElementById('zoom-text').textContent = zoomPct + '%';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.grimoireApp = new GrimoireApp();
});
