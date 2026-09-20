export function calculateComponentMetrics(component, fileInfo) {
  const loc = component.loc || 1;
  const hooks = component.hooksUsed || [];
  const hookCount = hooks.length;
  const childCount = (component.renderedChildren || []).length;
  const antiPatterns = fileInfo.antiPatterns || [];

  // 1. Calculate Radius (Logarithmic scaling so large components don't obliterate the canvas)
  // Clean, elegant range: 32px for small components to 88px for giant monoliths
  const logFactor = Math.log2(Math.max(1, loc));
  const radius = Math.round(28 + Math.min(60, logFactor * 5.8));

  // 2. Map Hooks to WHA Keystones
  const keystones = new Set();
  const keystoneDetails = [];

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
    } else if (['useHistory', 'useLocation', 'useParams', 'useNavigate', 'useRouteMatch'].includes(name)) {
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
  // Fire: mutations, form actions, dispatches
  // Water: streaming data, Redux state selectors, APIs, queries
  // Earth: data crystals, tables, configs, memoization, local models
  // Wind: navigation, router, history, modals, floating overlays
  // Light: visual UI presentation, local useState, styling, icons
  // Arcane: compound root or multi-element hub
  let elementScores = {
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

  // Hook-based scoring
  hooks.forEach((h) => {
    if (h.name === 'useSelector') elementScores.Water += 2.5;
    if (h.name === 'useDispatch') elementScores.Fire += 3;
    if (h.name === 'useState') elementScores.Light += 1.5;
    if (h.name === 'useEffect') elementScores.Water += 1;
    if (['useHistory', 'useLocation', 'useParams'].includes(h.name)) elementScores.Wind += 3;
    if (['useMemo', 'useCallback'].includes(h.name)) elementScores.Earth += 2;
  });

  // Path / Name heuristics
  const lowerPath = (fileInfo.filePath || '').toLowerCase();
  const lowerName = (component.name || '').toLowerCase();

  if (lowerPath.includes('redux') || lowerPath.includes('api') || lowerPath.includes('signalr')) {
    elementScores.Water += 4;
  }
  if (lowerPath.includes('settings') || lowerPath.includes('constant') || lowerPath.includes('table')) {
    elementScores.Earth += 3;
  }
  if (lowerPath.includes('modal') || lowerPath.includes('menu') || lowerPath.includes('crumb') || lowerName.includes('nav')) {
    elementScores.Wind += 3;
  }
  if (lowerName.includes('form') || lowerName.includes('button') || lowerName.includes('edit') || lowerName.includes('create')) {
    elementScores.Fire += 2.5;
  }
  if (lowerPath.includes('components') && elementScores.Light === 0) {
    elementScores.Light += 2;
  }

  // Pick top element
  let dominantElement = 'Arcane';
  let maxScore = -1;
  for (const [el, score] of Object.entries(elementScores)) {
    if (score > maxScore && score > 0) {
      maxScore = score;
      dominantElement = el;
    }
  }

  // 4. Determine WHA Stability & Grade
  let grade = 'Master Seal';
  let stabilityNote = 'Harmonious lines, balanced energy circulation.';
  const isForbidden = antiPatterns.length > 0;

  if (isForbidden) {
    grade = 'Forbidden Inscription';
    stabilityNote = 'Violates Day of the Pact: direct DOM mutation disrupts the natural flow of reactive ink.';
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

  return {
    radius,
    element: dominantElement,
    keystones: Array.from(keystones),
    keystoneDetails,
    grade,
    stabilityNote,
    isForbidden,
    loc,
    hookCount,
    childCount,
  };
}

export function calculateNonComponentMetrics(fileInfo, category) {
  const loc = fileInfo.loc || 1;
  const logFactor = Math.log2(Math.max(1, loc));
  const radius = Math.round(24 + Math.min(45, logFactor * 4.2));

  let element = 'Earth';
  if (category === 'api') element = 'Water';
  if (category === 'redux') element = 'Water';
  if (category === 'hook') element = 'Wind';
  if (category === 'constants') element = 'Earth';

  return {
    radius,
    element,
    keystones: [category === 'api' ? 'Column' : 'Convergence'],
    keystoneDetails: [],
    grade: loc > 600 ? 'Overcharged Monolith' : 'Adept Inscription',
    stabilityNote: `${category.toUpperCase()} tome module.`,
    isForbidden: false,
    loc,
    hookCount: 0,
    childCount: 0,
  };
}
