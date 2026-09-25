import type { GrimoireGraph } from '@wha/core';
import type { ITransport } from './transport.js';

export class MockTransport implements ITransport {
  public async getGraph(): Promise<GrimoireGraph> {
    return {
      nodes: [
        {
          id: 'src/App.tsx#App',
          name: 'App',
          file: 'src/App.tsx',
          kind: 'component',
          hooks: [{ name: 'useState' }, { name: 'useEffect' }],
          children: ['Header', 'Orders', 'Reports', 'Settings'],
          metrics: {
            radius: 80,
            element: 'Arcane',
            keystones: ['Diamond', 'Repetition'],
            keystoneDetails: [
              { name: 'Diamond', hook: 'useState', detail: 'Local Boundary State' },
              { name: 'Repetition', hook: 'useEffect', detail: 'Loop / Lifecycle' },
            ],
            radialSigns: [
              { type: 'dispersion', size: 14, loc: 12, label: '.map() (12L)' },
              { type: 'repetition', size: 13, loc: 8, label: 'useEffect' },
            ],
            geometry: 'circle',
            isClass: false,
            grade: 'Master Seal',
            stabilityNote: 'Harmonious lines, balanced energy circulation.',
            isForbidden: false,
            loc: 350,
            hookCount: 2,
            childCount: 4,
          },
          internalCircuit: {
            stateVariables: [{ name: 'currentTab', setter: 'setCurrentTab' }],
            effects: [{ deps: ['currentTab'] }],
            handlers: [{ name: 'handleNavigate', loc: 15 }],
          },
          realisticLayout: {
            realisticRadius: 100,
            subSeals: [
              {
                id: 'src/App.tsx#App#core',
                type: 'core',
                name: 'Arcane',
                element: 'Arcane',
                angle: 0,
                distRatio: 0,
                radiusRatio: 0.18,
                dx: 0,
                dy: 0,
                radius: 18,
              },
              {
                id: 'src/App.tsx#App#state',
                type: 'state',
                name: 'State Orbit',
                element: 'Light',
                angle: Math.PI * 0.95,
                distRatio: 0.4,
                radiusRatio: 0.14,
                dx: -32,
                dy: 5,
                radius: 14,
              },
            ],
            conduits: [{ from: 'state', to: 'core' }],
          },
          x: 0,
          y: 0,
        },
        {
          id: 'src/components/Header.tsx#Header',
          name: 'Header',
          file: 'src/components/Header.tsx',
          kind: 'component',
          hooks: [{ name: 'useLocation' }],
          children: ['NavMenu'],
          metrics: {
            radius: 46,
            element: 'Wind',
            keystones: ['Direction'],
            keystoneDetails: [{ name: 'Direction', hook: 'useLocation', detail: 'Air Corridor' }],
            radialSigns: [{ type: 'convergence', size: 12, loc: 5, label: '.filter() (5L)' }],
            geometry: 'circle',
            isClass: false,
            grade: 'Master Seal',
            stabilityNote: 'Clear and articulate geometry with solid balance.',
            isForbidden: false,
            loc: 110,
            hookCount: 1,
            childCount: 1,
          },
          x: 0,
          y: -400,
        },
        {
          id: 'src/pages/Orders.tsx#Orders',
          name: 'Orders',
          file: 'src/pages/Orders.tsx',
          kind: 'component',
          hooks: [{ name: 'useSelector' }, { name: 'useDispatch' }],
          children: ['OrderTable', 'OrderForm'],
          metrics: {
            radius: 58,
            element: 'Water',
            keystones: ['Pull', 'Dispersion'],
            keystoneDetails: [
              { name: 'Pull', hook: 'useSelector', detail: 'State Ingestion' },
              { name: 'Dispersion', hook: 'useDispatch', detail: 'Action Broadcast' },
            ],
            radialSigns: [{ type: 'dispersion', size: 14, loc: 25, label: '.map() (25L)' }],
            geometry: 'circle',
            isClass: false,
            grade: 'Adept Inscription',
            stabilityNote: 'Clear and articulate geometry with solid balance.',
            isForbidden: false,
            loc: 280,
            hookCount: 2,
            childCount: 2,
          },
          x: 500,
          y: 0,
        },
      ],
      edges: [
        {
          source: 'src/App.tsx#App',
          target: 'src/components/Header.tsx#Header',
          type: 'render',
          _key1: 'src/App.tsx#App->src/components/Header.tsx#Header',
          _key2: 'src/components/Header.tsx#Header->src/App.tsx#App',
        },
        {
          source: 'src/App.tsx#App',
          target: 'src/pages/Orders.tsx#Orders',
          type: 'render',
          _key1: 'src/App.tsx#App->src/pages/Orders.tsx#Orders',
          _key2: 'src/pages/Orders.tsx#Orders->src/App.tsx#App',
        },
      ],
      clusters: [
        {
          id: 'cluster-root',
          name: 'Great Citadel (Core & Root)',
          files: ['src/App.tsx'],
          nodeIds: ['src/App.tsx#App'],
          x: 0,
          y: 0,
          radius: 120,
        },
        {
          id: 'cluster-shell',
          name: 'Atelier: Navigation & Shell',
          files: ['src/components/Header.tsx'],
          nodeIds: ['src/components/Header.tsx#Header'],
          x: 0,
          y: -400,
          radius: 90,
        },
        {
          id: 'cluster-commerce',
          name: 'Province: Orders',
          files: ['src/pages/Orders.tsx'],
          nodeIds: ['src/pages/Orders.tsx#Orders'],
          x: 500,
          y: 0,
          radius: 110,
        },
      ],
      bounds: { minX: -600, minY: -600, maxX: 700, maxY: 600 },
      stats: {
        totalNodes: 3,
        totalEdges: 2,
        totalClusters: 3,
        totalFiles: 3,
        locTotal: 740,
      },
    };
  }

  public subscribeEvents(_onReload: () => void): () => void {
    return () => {};
  }

  public openFileInEditor(filePath: string, line = 1): void {
    window.open(`vscode://file/${filePath}:${line}`, '_blank');
  }
}
