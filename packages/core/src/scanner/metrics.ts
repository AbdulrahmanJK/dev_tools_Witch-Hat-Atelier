import type {
  DevToolsDiagnostics,
  KeystoneDetail,
  RadialSign,
  RerenderRisk,
  SealElement,
  SealMetrics,
} from '../types/index.js';
import type { CodeInventory, DetectedComponent } from './detector.js';

export interface FileMetricContext {
  filePath?: string;
  antiPatterns?: Array<{ type: string; message: string }>;
  loc?: number;
  codeInventory?: CodeInventory;
  imports?: Array<{ source: string }>;
}

export function calculateDevToolsDiagnostics(
  component: DetectedComponent | null,
  fileInfo: FileMetricContext,
  _category?: string
): DevToolsDiagnostics {
  const rerenderRisks: RerenderRisk[] = [];
  const refactorTips: string[] = [];

  const loc = (component ? component.loc : fileInfo.loc) || 1;
  const isComp = !!component;
  const hooks = component?.hooksUsed || [];
  const hookNames = hooks.map((h) => h.name);
  const inlineCallbacks = component?.inlineCallbacks || [];
  const hasUseMemo = hookNames.includes('useMemo');
  const hasReactMemo = !!component?.isMemo;
  const antiPatterns = fileInfo.antiPatterns || [];

  // 1. Rerender Risk Analysis
  if (isComp) {
    if (inlineCallbacks.length > 0) {
      rerenderRisks.push({
        type: 'inline_callback',
        severity: inlineCallbacks.length > 2 ? 'high' : 'medium',
        message: `${inlineCallbacks.length} inline arrow function(s) in JSX props (${inlineCallbacks
          .map((c) => c.propName)
          .filter(Boolean)
          .slice(0, 3)
          .join(', ')}). Recreated on every render cycle.`,
        line: inlineCallbacks[0]?.line,
      });
      refactorTips.push(
        `Wrap inline handlers (${inlineCallbacks
          .map((c) => c.propName)
          .filter(Boolean)
          .slice(0, 2)
          .join(', ')}) in useCallback to stabilize child references.`
      );
    }

    const inv = component.codeInventory;
    const arrayOpsCount =
      (inv?.maps.length || 0) + (inv?.filters.length || 0) + (inv?.reduces.length || 0);
    if (arrayOpsCount > 0 && !hasUseMemo) {
      rerenderRisks.push({
        type: 'unmemoized_calc',
        severity: arrayOpsCount > 2 ? 'high' : 'medium',
        message: `${arrayOpsCount} unmemoized array transformation(s) (.map/.filter/.reduce) in render path without useMemo.`,
      });
      refactorTips.push(
        `Memoize heavy array calculations using useMemo to avoid re-computation on every tick.`
      );
    }

    if (!hasReactMemo && (component.props.length > 3 || component.renderedChildren.length > 4)) {
      rerenderRisks.push({
        type: 'missing_memo',
        severity: 'low',
        message: `Component has ${component.props.length} props & ${component.renderedChildren.length} children but is not memoized with React.memo.`,
      });
      refactorTips.push(
        `Wrap component with React.memo() to prevent unnecessary renders when parent state updates.`
      );
    }

    const effectCount = component.internalCircuit?.effects?.length || 0;
    if (effectCount > 2) {
      rerenderRisks.push({
        type: 'excessive_effects',
        severity: effectCount > 4 ? 'high' : 'medium',
        message: `${effectCount} useEffect/useLayoutEffect blocks. Multiple side-effects risk cascading re-render loops.`,
      });
      refactorTips.push(
        `Consolidate related useEffect hooks and verify dependency arrays to prevent render loops.`
      );
    }

    const stateCount = component.internalCircuit?.stateVariables?.length || 0;
    if (stateCount > 4) {
      rerenderRisks.push({
        type: 'large_state',
        severity: stateCount > 7 ? 'high' : 'medium',
        message: `${stateCount} separate useState variables. Granular state updates may trigger multiple re-renders.`,
      });
      refactorTips.push(
        `Consider grouping related state into a single useReducer or unified state object.`
      );
    }
  }

  // 2. Bundle Impact
  const imports = fileInfo.imports || [];
  const heavyLibraries: string[] = [];
  const HEAVY_LIBS = [
    'lodash',
    'moment',
    'xlsx',
    'chart.js',
    'three',
    'echarts',
    'draft-js',
    'jspdf',
    'monaco-editor',
  ];
  imports.forEach((imp) => {
    const s = (imp.source || '').toLowerCase();
    for (const lib of HEAVY_LIBS) {
      if (s === lib || s.startsWith(`${lib}/`)) {
        if (!heavyLibraries.includes(lib)) heavyLibraries.push(lib);
      }
    }
  });

  const bundleRating: 'feather' | 'standard' | 'heavy' | 'colossal' =
    loc > 700 ? 'colossal' : loc > 400 ? 'heavy' : loc > 150 ? 'standard' : 'feather';

  if (heavyLibraries.length > 0) {
    refactorTips.push(
      `Heavy dependency imported (${heavyLibraries.join(', ')}). Consider dynamic import() or tree-shakeable alternatives.`
    );
  }

  if (loc > 500) {
    refactorTips.push(
      `Monolithic file (${loc} LOC). High architectural entropy; decompose into smaller focused sub-seals.`
    );
  }

  // 3. Complexity
  const inv = component?.codeInventory;
  const loopCount = (inv?.loops.length || 0) + (inv?.forEaches.length || 0);
  const stateCount = component?.internalCircuit?.stateVariables?.length || 0;
  const effectCount = component?.internalCircuit?.effects?.length || 0;
  const handlerCount =
    (component?.internalCircuit?.handlers?.length || 0) + inlineCallbacks.length;
  const cyclomatic =
    1 +
    loopCount * 2 +
    (inv?.maps.length || 0) +
    (inv?.filters.length || 0) +
    effectCount +
    Math.floor(loc / 40);

  const complexityRating: 'simple' | 'moderate' | 'complex' | 'labyrinth' =
    cyclomatic > 22
      ? 'labyrinth'
      : cyclomatic > 12
        ? 'complex'
        : cyclomatic > 5
          ? 'moderate'
          : 'simple';

  // 4. Health Score Calculation
  let healthScore = 100;
  rerenderRisks.forEach((r) => {
    if (r.severity === 'high') healthScore -= 14;
    else if (r.severity === 'medium') healthScore -= 8;
    else healthScore -= 4;
  });

  if (loc > 800) healthScore -= 20;
  else if (loc > 500) healthScore -= 12;
  else if (loc > 300) healthScore -= 6;

  if (antiPatterns.length > 0) healthScore -= 15;
  if (complexityRating === 'labyrinth') healthScore -= 12;
  else if (complexityRating === 'complex') healthScore -= 6;

  if (heavyLibraries.length > 0) healthScore -= 5 * heavyLibraries.length;

  healthScore = Math.max(12, Math.min(100, healthScore));

  const overloadState: 'harmonious' | 'warm' | 'overcharged' | 'fissure' =
    healthScore >= 82
      ? 'harmonious'
      : healthScore >= 62
        ? 'warm'
        : healthScore >= 42
          ? 'overcharged'
          : 'fissure';

  if (refactorTips.length === 0) {
    refactorTips.push('Pact-compliant inscription: balanced reactive flow and optimal memory footprint.');
  }

  return {
    healthScore,
    overloadState,
    rerenderRisks,
    bundleImpact: {
      loc,
      importCount: imports.length,
      rating: bundleRating,
      heavyLibraries,
    },
    complexity: {
      cyclomatic,
      stateCount,
      effectCount,
      callbackCount: handlerCount,
      rating: complexityRating,
    },
    refactorTips,
  };
}

export function calculateComponentMetrics(
  component: DetectedComponent,
  fileInfo: FileMetricContext
): SealMetrics {
  const loc = component.loc || 1;
  const hooks = component.hooksUsed || [];
  const hookCount = hooks.length;
  const childCount = (component.renderedChildren || []).length;
  const antiPatterns = fileInfo.antiPatterns || [];

  // 1. Calculate Radius (Logarithmic scaling so large components don't obliterate the canvas)
  // Clean range: 28px for small components to 88px for giant monoliths
  const logFactor = Math.log2(Math.max(1, loc));
  const radius = Math.round(28 + Math.min(60, logFactor * 5.8));

  // 2. Map Hooks to WHA Keystones
  const keystones = new Set<string>();
  const keystoneDetails: KeystoneDetail[] = [];

  hooks.forEach((h) => {
    const name = h.name;
    if (['useEffect', 'useLayoutEffect', 'useInterval'].includes(name)) {
      keystones.add('Repetition');
      keystoneDetails.push({ name: 'Repetition', hook: name, detail: 'Loop / Lifecycle' });
    } else if (['useSelector', 'useContext'].includes(name)) {
      keystones.add('Pull');
      keystoneDetails.push({ name: 'Pull', hook: name, detail: h.detail || 'State Ingestion' });
    } else if (name === 'useRef') {
      keystones.add('Column');
      keystoneDetails.push({ name: 'Column', hook: name, detail: 'Direct DOM Beam' });
    } else if (['useMemo', 'useCallback'].includes(name)) {
      keystones.add('Convergence');
      keystoneDetails.push({ name: 'Convergence', hook: name, detail: 'Focal Synthesis' });
    } else if (
      ['useHistory', 'useLocation', 'useParams', 'useNavigate', 'useRouteMatch'].includes(name)
    ) {
      keystones.add('Direction');
      keystoneDetails.push({ name: 'Direction', hook: name, detail: 'Air Corridor' });
    } else if (name === 'useDispatch') {
      keystones.add('Dispersion');
      keystoneDetails.push({ name: 'Dispersion', hook: name, detail: 'Action Broadcast' });
    } else if (name === 'useState') {
      keystones.add('Diamond');
      keystoneDetails.push({ name: 'Diamond', hook: name, detail: 'Local Boundary State' });
    } else if (name === 'useReducer') {
      keystones.add('Strengthen');
      keystoneDetails.push({ name: 'Strengthen', hook: name, detail: 'Core Reinforcement' });
    } else if (['useFormik', 'useForm', 'useMediaQuery'].includes(name)) {
      keystones.add('Eye');
      keystoneDetails.push({ name: 'Eye', hook: name, detail: 'Observation Focus' });
    } else {
      keystones.add('Weave');
      keystoneDetails.push({ name: 'Weave', hook: name, detail: 'Custom Mystic Hook' });
    }
  });

  if (component.reduxDispatches && component.reduxDispatches.length > 0) {
    keystones.add('Dispersion');
  }

  // 3. Determine Dominant Elemental Affinity
  const elementScores: Record<SealElement, number> = {
    Fire: 0,
    Water: 0,
    Earth: 0,
    Wind: 0,
    Light: 0,
    Arcane: 0,
  };

  if (component.name === 'App' || childCount > 25 || hookCount > 12) {
    elementScores.Arcane += 10;
  }

  hooks.forEach((h) => {
    if (h.name === 'useSelector') elementScores.Water += 2.5;
    if (h.name === 'useDispatch') elementScores.Fire += 3;
    if (h.name === 'useState') elementScores.Light += 1.5;
    if (h.name === 'useEffect') elementScores.Water += 1;
    if (['useHistory', 'useLocation', 'useParams', 'useNavigate'].includes(h.name))
      elementScores.Wind += 3;
    if (['useMemo', 'useCallback'].includes(h.name)) elementScores.Earth += 2;
  });

  const lowerPath = (fileInfo.filePath || '').toLowerCase();
  const lowerName = (component.name || '').toLowerCase();

  if (lowerPath.includes('redux') || lowerPath.includes('api') || lowerPath.includes('signalr')) {
    elementScores.Water += 4;
  }
  if (
    lowerPath.includes('settings') ||
    lowerPath.includes('constant') ||
    lowerPath.includes('table')
  ) {
    elementScores.Earth += 3;
  }
  if (
    lowerPath.includes('modal') ||
    lowerPath.includes('menu') ||
    lowerPath.includes('crumb') ||
    lowerName.includes('nav')
  ) {
    elementScores.Wind += 3;
  }
  if (
    lowerName.includes('form') ||
    lowerName.includes('button') ||
    lowerName.includes('edit') ||
    lowerName.includes('create')
  ) {
    elementScores.Fire += 2.5;
  }
  if (lowerPath.includes('components') && elementScores.Light === 0) {
    elementScores.Light += 2;
  }

  let dominantElement: SealElement = 'Arcane';
  let maxScore = -1;
  for (const [el, score] of Object.entries(elementScores) as [SealElement, number][]) {
    if (score > maxScore && score > 0) {
      maxScore = score;
      dominantElement = el;
    }
  }

  // 4. Synthesize Dynamic Multi-Sign Inventory for the Seal's Perimeter
  const radialSigns: RadialSign[] = [];
  const inv = fileInfo.codeInventory ||
    component.codeInventory || {
      maps: [],
      filters: [],
      reduces: [],
      forEaches: [],
      loops: [],
      arrays: 0,
      sets: 0,
      recordMaps: 0,
      asyncCount: 0,
      isClass: false,
    };

  (inv.maps || []).forEach((mLoc) => {
    radialSigns.push({
      type: 'dispersion',
      size: Math.max(9, Math.min(20, 9 + Math.sqrt(mLoc) * 2.0)),
      loc: mLoc,
      label: `.map() (${mLoc}L)`,
    });
  });

  (inv.filters || []).forEach((fLoc) => {
    radialSigns.push({
      type: 'convergence',
      size: Math.max(9, Math.min(20, 9 + Math.sqrt(fLoc) * 2.0)),
      loc: fLoc,
      label: `.filter() (${fLoc}L)`,
    });
  });

  (inv.reduces || []).forEach((rLoc) => {
    radialSigns.push({
      type: 'convergence',
      size: Math.max(10, Math.min(22, 10 + Math.sqrt(rLoc) * 2.2)),
      loc: rLoc,
      label: `.reduce() (${rLoc}L)`,
    });
  });

  (inv.loops || []).forEach((lLoc) => {
    radialSigns.push({
      type: 'repetition',
      size: Math.max(10, Math.min(22, 10 + Math.sqrt(lLoc) * 2.0)),
      loc: lLoc,
      label: `Loop (${lLoc}L)`,
    });
  });

  (inv.forEaches || []).forEach((feLoc) => {
    radialSigns.push({
      type: 'repetition',
      size: Math.max(9, Math.min(20, 9 + Math.sqrt(feLoc) * 1.8)),
      loc: feLoc,
      label: `.forEach() (${feLoc}L)`,
    });
  });

  hooks
    .filter((h) => ['useEffect', 'useLayoutEffect'].includes(h.name))
    .forEach(() => {
      radialSigns.push({
        type: 'repetition',
        size: 13,
        loc: 8,
        label: 'useEffect',
      });
    });

  if (inv.arrays > 0) {
    const arrSignsCount = Math.min(3, Math.max(1, Math.floor(inv.arrays / 6)));
    for (let i = 0; i < arrSignsCount; i++) {
      radialSigns.push({
        type: 'collection',
        size: Math.max(10, Math.min(20, 10 + Math.sqrt(inv.arrays) * 1.4)),
        loc: inv.arrays,
        label: `${inv.arrays} Arrays`,
      });
    }
  }

  if (inv.sets > 0) {
    for (let i = 0; i < Math.min(3, inv.sets); i++) {
      radialSigns.push({
        type: 'orb',
        size: 13,
        loc: 1,
        label: 'new Set()',
      });
    }
  }

  if (inv.recordMaps > 0) {
    for (let i = 0; i < Math.min(3, inv.recordMaps); i++) {
      radialSigns.push({
        type: 'region',
        size: 13,
        loc: 1,
        label: 'new Map()',
      });
    }
  }

  if (inv.asyncCount > 0) {
    const boltCount = Math.min(3, Math.max(1, Math.floor(inv.asyncCount / 3)));
    for (let i = 0; i < boltCount; i++) {
      radialSigns.push({
        type: 'bolt',
        size: Math.max(10, Math.min(18, 10 + Math.sqrt(inv.asyncCount) * 1.6)),
        loc: inv.asyncCount,
        label: `${inv.asyncCount} Await`,
      });
    }
  }

  (component.internalCircuit?.handlers || []).slice(0, 3).forEach((h) => {
    radialSigns.push({
      type: 'column',
      size: Math.max(9, Math.min(20, 9 + Math.sqrt(h.loc) * 1.8)),
      loc: h.loc,
      label: `${h.name} (${h.loc}L)`,
    });
  });

  const isClass = !!inv.isClass || component.kind === 'class';
  const geometry = isClass ? 'faceted-strengthen' : 'circle';

  // 5. Determine WHA Stability & Grade
  let grade = 'Master Seal';
  let stabilityNote = 'Harmonious lines, balanced energy circulation.';
  const isForbidden = antiPatterns.length > 0;

  if (isForbidden) {
    grade = 'Forbidden Inscription';
    stabilityNote =
      'Violates Day of the Pact: direct DOM mutation disrupts the natural flow of reactive ink.';
  } else if (loc > 800) {
    grade = 'Overcharged Monolith';
    stabilityNote = `Severe energetic strain (${loc} LOC). High risk of structural fissure; decomposition into sub-glyphs strongly advised.`;
  } else if (loc > 450 || hookCount > 10) {
    grade = 'Journeyman Circle';
    stabilityNote = `Dense cluster of signs (${hookCount} hooks, ${loc} LOC). Operates stably under monitored conditions.`;
  } else if (loc > 200 || hookCount > 4) {
    grade = 'Adept Inscription';
    stabilityNote = 'Clear and articulate geometry with solid balance.';
  } else {
    grade = 'Master Seal';
    stabilityNote = 'Exquisite economy of form; minimal ink dissipation.';
  }

  const devTools = calculateDevToolsDiagnostics(component, fileInfo);

  return {
    radius,
    element: dominantElement,
    keystones: Array.from(keystones),
    keystoneDetails,
    radialSigns,
    geometry,
    isClass,
    grade,
    stabilityNote,
    isForbidden,
    loc,
    hookCount,
    childCount,
    devTools,
  };
}

export function calculateNonComponentMetrics(
  fileInfo: { loc?: number; filePath?: string; imports?: Array<{ source: string }> },
  category: string
): SealMetrics {
  const loc = fileInfo.loc || 1;
  const logFactor = Math.log2(Math.max(1, loc));
  const radius = Math.round(24 + Math.min(45, logFactor * 4.2));

  let element: SealElement = 'Earth';
  if (category === 'api') element = 'Water';
  if (category === 'redux') element = 'Water';
  if (category === 'hook') element = 'Wind';
  if (category === 'constants') element = 'Earth';

  const devTools = calculateDevToolsDiagnostics(null, fileInfo, category);

  return {
    radius,
    element,
    keystones: [category === 'api' ? 'Column' : 'Convergence'],
    keystoneDetails: [],
    radialSigns: [],
    geometry: 'circle',
    isClass: false,
    grade: loc > 600 ? 'Overcharged Monolith' : 'Adept Inscription',
    stabilityNote: `${category.toUpperCase()} tome module.`,
    isForbidden: false,
    loc,
    hookCount: 0,
    childCount: 0,
    devTools,
  };
}
