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
      const hit = this.renderer.findNodeAt(e.clientX, e.clientY);
      const node = hit ? (hit.node || hit) : null;
      this.renderer.hoveredNodeId = node ? node.id : null;
      this.viewport.style.cursor = node ? 'pointer' : 'grab';
    });

    // Realistic Mode Toggle
    const toggleRealBtn = document.getElementById('btn-toggle-realistic');
    if (toggleRealBtn) {
      toggleRealBtn.addEventListener('click', () => {
        this.realisticMode = !this.realisticMode;
        toggleRealBtn.classList.toggle('active', this.realisticMode);
        this.renderer.setRealisticMode(this.realisticMode);
        if (this.renderer.selectedNodeId) {
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

  selectNode(node, hitSubSeal = null) {
    this.renderer.selectedNodeId = node.id;
    this.openInspector(node, hitSubSeal);
  }

  deselect() {
    this.renderer.selectedNodeId = null;
    this.drawer.classList.remove('open');
  }

  openInspector(node, hitSubSeal = null) {
    const theme = WHA_THEMES[node.metrics.element] || WHA_THEMES.Arcane;

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

    // Internal Circuit (Inscribed Sub-Seals)
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
