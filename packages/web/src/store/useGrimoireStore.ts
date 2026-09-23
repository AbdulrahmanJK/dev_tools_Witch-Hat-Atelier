import type { GrimoireGraph, SealNode } from '@wha/core';
import { create } from 'zustand';

export interface GrimoireState {
  graph: GrimoireGraph | null;
  nodes: SealNode[];
  nodeMap: Map<string, SealNode>;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  lineageNodes: string[];
  lineageEdges: string[];
  activeFilter: string;
  unifiedMode: boolean;
  realisticMode: boolean;
  devToolsMode: boolean;
  diagnosticFilter: 'all' | 'cycles' | 'orphans' | 'hot';
  searchQuery: string;
  isDrawerOpen: boolean;
  zoomPercent: number;
  tooltip: {
    visible: boolean;
    x: number;
    y: number;
    node: SealNode | null;
  };

  // Actions
  setGraph: (graph: GrimoireGraph) => void;
  selectNode: (nodeId: string | null) => void;
  hoverNode: (nodeId: string | null, clientX?: number, clientY?: number) => void;
  setFilter: (filter: string) => void;
  setDiagnosticFilter: (diagFilter: 'all' | 'cycles' | 'orphans' | 'hot') => void;
  toggleUnified: () => void;
  toggleRealistic: () => void;
  toggleDevTools: () => void;
  setSearchQuery: (query: string) => void;
  setDrawerOpen: (open: boolean) => void;
  setZoomPercent: (pct: number) => void;
}

export const useGrimoireStore = create<GrimoireState>((set, get) => ({
  graph: null,
  nodes: [],
  nodeMap: new Map(),
  selectedNodeId: null,
  hoveredNodeId: null,
  lineageNodes: [],
  lineageEdges: [],
  activeFilter: 'all',
  unifiedMode: false,
  realisticMode: false,
  devToolsMode: false,
  diagnosticFilter: 'all',
  searchQuery: '',
  isDrawerOpen: false,
  zoomPercent: 45,
  tooltip: {
    visible: false,
    x: 0,
    y: 0,
    node: null,
  },

  setGraph: (graph) => {
    const nodes = graph.nodes || [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    set({ graph, nodes, nodeMap });

    // Select Root node automatically on initial load
    const rootNode = nodes.find(
      (n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root'))
    );
    if (rootNode) {
      get().selectNode(rootNode.id);
    }
  },

  selectNode: (nodeId) => {
    if (!nodeId) {
      set({
        selectedNodeId: null,
        isDrawerOpen: false,
        lineageNodes: [],
        lineageEdges: [],
      });
      return;
    }

    const { nodes, graph } = get();
    const nodeMap = get().nodeMap;
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode) return;

    // Calculate Ancestral Lineage path from Root (App) to targetNode
    const rootNode = nodes.find(
      (n) => n.name === 'App' || (n.cluster && n.cluster.includes('Root'))
    );

    const lineageNodes: string[] = [];
    const lineageEdges: string[] = [];

    if (rootNode && rootNode.id !== targetNode.id && graph) {
      // Find shortest path from root to targetNode via BFS
      const queue: Array<{ id: string; path: string[]; edgePath: string[] }> = [
        { id: rootNode.id, path: [rootNode.id], edgePath: [] },
      ];
      const visited = new Set<string>([rootNode.id]);
      let foundPath: { path: string[]; edgePath: string[] } | null = null;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr.id === targetNode.id) {
          foundPath = curr;
          break;
        }

        const outgoing = graph.edges.filter(
          (e) => e.source === curr.id && (e.type === 'render' || e.type === 'import')
        );

        for (const edge of outgoing) {
          if (!visited.has(edge.target)) {
            visited.add(edge.target);
            const edgeKey = `${edge.source}->${edge.target}`;
            queue.push({
              id: edge.target,
              path: [...curr.path, edge.target],
              edgePath: [...curr.edgePath, edgeKey],
            });
          }
        }
      }

      if (foundPath) {
        lineageNodes.push(...foundPath.path);
        lineageEdges.push(...foundPath.edgePath);
      } else {
        lineageNodes.push(targetNode.id);
      }
    } else {
      lineageNodes.push(targetNode.id);
    }

    set({
      selectedNodeId: nodeId,
      isDrawerOpen: true,
      lineageNodes,
      lineageEdges,
    });
  },

  hoverNode: (nodeId, clientX, clientY) => {
    if (!nodeId) {
      set({
        hoveredNodeId: null,
        tooltip: { visible: false, x: 0, y: 0, node: null },
      });
      return;
    }

    const node = get().nodeMap.get(nodeId) || null;
    set({
      hoveredNodeId: nodeId,
      tooltip: {
        visible: !!node,
        x: clientX || 0,
        y: clientY || 0,
        node,
      },
    });
  },

  setFilter: (activeFilter) => set({ activeFilter }),
  setDiagnosticFilter: (diagnosticFilter) => set({ diagnosticFilter }),
  toggleUnified: () => set((s) => ({ unifiedMode: !s.unifiedMode, devToolsMode: false })),
  toggleRealistic: () => set((s) => ({ realisticMode: !s.realisticMode, devToolsMode: false })),
  toggleDevTools: () =>
    set((s) => ({
      devToolsMode: !s.devToolsMode,
      unifiedMode: false,
      realisticMode: false,
      diagnosticFilter: 'all',
    })),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setDrawerOpen: (isDrawerOpen) => set({ isDrawerOpen }),
  setZoomPercent: (zoomPercent) => set({ zoomPercent }),
}));
