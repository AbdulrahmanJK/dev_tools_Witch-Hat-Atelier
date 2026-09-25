export type Locale = 'ru' | 'en';

const en = {
  glyphs: 'glyphs', clusters: 'archipelagos', files: 'files',
  searchPlaceholder: 'Search components, files, libraries…', searchNoResults: 'No matches', searchHint: 'Enter to open · ↑↓ to choose · Esc to close', searchComponent: 'Component', searchModule: 'Module', searchLibrary: 'Library',
  all: 'All', cycles: 'Cycles', deadCode: 'Dead code', pact: 'Pact', hot: 'Hot',
  fire: 'Fire', water: 'Water', earth: 'Earth', wind: 'Wind', light: 'Light', arcane: 'Arcane',
  devtoolsMode: 'DevTools', runtimeLibraries: 'Runtime & libraries', realisticArt: 'Art mode', detailedMap: 'Detailed map', lightweightMap: 'Light map', lightweightHint: 'Switch between the detailed and light map. Light map keeps names, shapes and central signs, simplifies links, and pauses animation.', fitKingdom: 'Fit map', guide: 'Guide', language: 'English',
  overview: 'DevTools overview', hideOverview: 'Hide overview', showOverview: 'Show overview',
  updates: 'Re-renders', mounts: 'First mounts', domObservations: 'DOM observations',
  pulseExplanation: 'Gold ring: update. Green: mount or DOM change. DOM observations are not renders.',
  unmatchedRenders: 'Profiler events could not be matched to a unique seal.', activeComponents: 'Active components',
  noRuntime: 'No events yet. Run dev:grimoire and interact with the app.', recentTree: 'Recent events in the tree',
  unknownReason: 'reason unknown', causalNote: 'Changed props/state are observed signals. Parent activity alone does not prove the cause.',
  libraryWeight: 'Library JS contribution', estimateFor: 'estimate for', libraries: 'libraries',
  initialLoad: 'On the initial load path', bundleNote: 'This sums library estimates, not the entire application bundle.',
  noBundle: 'Sizes are not measured yet. Library seals currently reflect import spread.', measureBuild: 'Measure Vite build', repeatMeasure: 'Remeasure Vite build', measuring: 'Measuring…',
  externalLibrary: 'External library', librarySeal: 'Library seal', versionUnknown: 'Version unknown',
  sourceSpread: 'Source import spread', declaredDependency: 'declared dependency', undeclaredDependency: 'not declared in nearest package', transitiveDependency: 'included transitively in build',
  importedIn: 'Imported in', codeSeals: 'code seals', importDeclarations: 'import declarations', dynamicImports: 'dynamic imports',
  estimatedJs: 'Estimated emitted JavaScript', acrossChunks: 'across chunks', initialEntry: 'initial load', outsideInitial: 'outside initial entry', rollupLength: 'Rollup module length',
  bundleNotMeasured: 'Bundle bytes are not measured. Imports alone cannot determine shipped size.',
  libraryRingScale: 'Library ring colour: green below 20 KiB, ochre below 100 KiB, red at 100 KiB or more.', importingSeals: 'Importing seals',
  diagnostics: 'DevTools diagnostics', staticFindings: 'Static findings', runtimeObservations: 'Runtime observations',
  measuredRerenders: 'measured re-renders', averageUpdate: 'average update', hotExplanation: 'Hot: average profiled subtree update exceeds 16 ms after at least five updates.',
  runtimePath: 'Runtime path', observedChanges: 'Observed changes', parentCaveat: 'Parent activity is a correlation, not proof of cause.',
  healthScore: 'Health score', sourceSize: 'Source size', complexity: 'Complexity', rerenderRisks: 'Re-render risks',
  circularLoop: 'Circular import loop', orphanModule: 'Unreferenced module', riskList: 'Re-render risk findings',
  architectureState: 'Architecture & state footprint', refactorAdvice: 'Refactor suggestions', lineage: 'Ancestral lineage',
  linesOfCode: 'Lines of code', keystones: 'Keystones', subGlyphs: 'Sub-glyphs', stability: 'Stability',
  consumers: 'Shared by modules', constructSigns: 'Code construct signs', internalCircuit: 'Internal circuit', hooks: 'Hooks',
  connectApp: 'Connect a running app', detected: 'Detected', oneClick: 'One-click dev setup',
  setupExplanation: 'Adds dev:grimoire and a removable runtime adapter to the selected Vite project. It does not start the app or build it.',
  addDevtools: 'Add DevTools command', removeDevtools: 'Remove DevTools setup', upgradeTracing: 'Upgrade component tracing',
  quickProbeExplanation: 'Quick browser mode observes DOM changes and long tasks. Paste this into the target page DevTools console:',
  copyBrowserProbe: 'Copy browser probe', adapterExplanation: 'For measured component updates, add a dev adapter to the app entry:',
  copyVueAdapter: 'Copy Vue adapter', copyReactAdapter: 'Copy React adapter', copyPropProfiler: 'Copy prop profiler',
  profilerExplanation: 'React Profiler measures the wrapped subtree. Wrap a component in its own module for prop identity changes:',
  buildOnlyOnClick: 'A target build runs only when you press Measure Vite build.',
  guideTitle: 'Map signs & controls', guideIntro: 'Read the map as an architecture diagram. Colours and rings describe source structure; runtime pulses appear after connecting the app.',
  guideBasics: 'Seals and layout', guideElements: 'Element colours', guideConstructs: 'Code signs', guideDiagnostics: 'Diagnostics and activity', guideControls: 'Using the map',
  openEditor: 'Open in editor', bundleRuntime: 'Runtime samples', selfTime: 'self time', browserDom: 'browser DOM observations',
  cycleRisk: 'Circular imports can destabilize module initialization and HMR.', orphanNote: 'No incoming import or component render was found. Review before removing this module.',
  heavyBundles: 'Large dependencies', callbacks: 'Callbacks', imports: 'Imports', stateEffect: 'State and effects', close: 'Close',
  scanTitle: 'Drawing the project map', scanReady: 'Map ready', scanLoadingGraph: 'Loading map into the browser', scanError: 'Scan failed', scanWaiting: 'Connecting to scanner…',
  scanDiscovering: 'Finding source files', scanParsing: 'Reading source files', scanNodes: 'Creating signs', scanEdges: 'Tracing connections', scanDiagnostics: 'Checking architecture', scanDependencies: 'Reading libraries', scanLayout: 'Arranging the map', scanLayoutClusters: 'Placing archipelagos', scanLayoutFinalizing: 'Finishing the map', scanTransferring: 'Sending the map to the browser', scanStarting: 'Starting scan',
  scanFiles: 'files', scanClusters: 'archipelagos', scanFound: 'found', scanElapsed: 'Elapsed', scanLastUpdate: 'Last progress', scanSeconds: 's ago', scanStale: 'No progress update for 30 seconds. The current stage may be slow; check the log below.', scanLogs: 'Scan log', scanRetry: 'Retry scan', scanCancel: 'Stop scan', scanCancelled: 'Scan stopped', scanShowLogs: 'Show log', scanHideLogs: 'Hide log', scanRefresh: 'Refresh map',
  staticSource: 'Static source map', staticOnly: 'Runtime DevTools are not available for this language.', sourceSymbols: 'Symbols inside', sourceNamespace: 'Package / namespace', sourceImports: 'Imports / using', sourceMembers: 'Members', sourceLine: 'line', sourceMoreImports: 'more imports', sourceLoops: 'loops', sourceBranches: 'branches', sourceAwaits: 'awaits',
} as const;

type Key = keyof typeof en;
const ru: Record<Key, string> = {
  glyphs: 'знаков', clusters: 'архипелагов', files: 'файлов',
  searchPlaceholder: 'Поиск компонентов, файлов, библиотек…', searchNoResults: 'Ничего не найдено', searchHint: 'Enter — открыть · ↑↓ — выбрать · Esc — закрыть', searchComponent: 'Компонент', searchModule: 'Модуль', searchLibrary: 'Библиотека',
  all: 'Все', cycles: 'Циклы', deadCode: 'Мёртвый код', pact: 'Границы', hot: 'Горячие',
  fire: 'Огонь', water: 'Вода', earth: 'Земля', wind: 'Ветер', light: 'Свет', arcane: 'Аркан',
  devtoolsMode: 'DevTools', runtimeLibraries: 'Runtime и библиотеки', realisticArt: 'Арт-режим', detailedMap: 'Подробная карта', lightweightMap: 'Лёгкая карта', lightweightHint: 'Переключить подробную и лёгкую карту. В лёгком режиме остаются имена, силуэты и центральные знаки, связи упрощаются, а анимация останавливается.', fitKingdom: 'Вся карта', guide: 'Знаки', language: 'Русский',
  overview: 'Сводка DevTools', hideOverview: 'Скрыть сводку', showOverview: 'Показать сводку',
  updates: 'Повторных обновлений', mounts: 'Первых mount', domObservations: 'Наблюдений DOM',
  pulseExplanation: 'Золотое кольцо — обновление, зелёное — mount или изменение DOM. DOM-события не равны рендерам.',
  unmatchedRenders: 'Событий Profiler не удалось однозначно сопоставить с печатью.', activeComponents: 'Активные компоненты',
  noRuntime: 'Событий пока нет. Запустите dev:grimoire и поработайте в приложении.', recentTree: 'Последние события по дереву',
  unknownReason: 'причина неизвестна', causalNote: 'Изменившиеся props/state — наблюдаемые сигналы. Обновление родителя само по себе не доказывает причину.',
  libraryWeight: 'Вес библиотек в JS', estimateFor: 'оценка для', libraries: 'библиотек',
  initialLoad: 'На начальном пути загрузки', bundleNote: 'Это сумма оценок библиотек, не размер всего бандла.',
  noBundle: 'Размеры ещё не измерены. Печати библиотек пока отражают число импортов.', measureBuild: 'Измерить Vite-сборку', repeatMeasure: 'Повторить измерение', measuring: 'Измеряем…',
  externalLibrary: 'Внешняя библиотека', librarySeal: 'Печать библиотеки', versionUnknown: 'Версия неизвестна',
  sourceSpread: 'Распространённость импортов', declaredDependency: 'указана в зависимостях', undeclaredDependency: 'не указана в ближайшем package.json', transitiveDependency: 'попала в сборку транзитивно',
  importedIn: 'Импортируется в', codeSeals: 'печатях кода', importDeclarations: 'объявлений импорта', dynamicImports: 'динамических импортов',
  estimatedJs: 'Оценка выпущенного JavaScript', acrossChunks: 'в чанках', initialEntry: 'начальная загрузка', outsideInitial: 'вне начальной загрузки', rollupLength: 'Длина модулей Rollup',
  bundleNotMeasured: 'Размер бандла ещё не измерен. По одним импортам нельзя определить итоговый вес.',
  libraryRingScale: 'Цвет кольца библиотеки: зелёный до 20 KiB, охра до 100 KiB, красный от 100 KiB.', importingSeals: 'Печати, использующие библиотеку',
  diagnostics: 'Диагностика DevTools', staticFindings: 'Находки в исходниках', runtimeObservations: 'Наблюдения при работе',
  measuredRerenders: 'измеренных повторных обновлений', averageUpdate: 'среднее обновление', hotExplanation: 'Горячий: среднее обновление поддерева больше 16 мс после пяти обновлений.',
  runtimePath: 'Путь в дереве', observedChanges: 'Замеченные изменения', parentCaveat: 'Активность родителя — совпадение, а не доказанная причина.',
  healthScore: 'Оценка состояния', sourceSize: 'Размер исходника', complexity: 'Сложность', rerenderRisks: 'Риски ререндеров',
  circularLoop: 'Цикл импортов', orphanModule: 'Модуль без входящих связей', riskList: 'Риски повторных рендеров',
  architectureState: 'Архитектура и состояние', refactorAdvice: 'Советы по рефакторингу', lineage: 'Цепочка от истока',
  linesOfCode: 'Строк кода', keystones: 'Ключевые знаки', subGlyphs: 'Внутренние знаки', stability: 'Устойчивость',
  consumers: 'Используется модулями', constructSigns: 'Знаки кода', internalCircuit: 'Внутренняя схема', hooks: 'Хуки',
  connectApp: 'Подключить приложение', detected: 'Обнаружено', oneClick: 'Подключение одной кнопкой',
  setupExplanation: 'Добавит команду dev:grimoire и удаляемый runtime-адаптер в выбранный Vite-проект. Приложение и сборка сами не запустятся.',
  addDevtools: 'Добавить команду DevTools', removeDevtools: 'Удалить подключение', upgradeTracing: 'Добавить иерархию компонентов',
  quickProbeExplanation: 'Быстрый режим наблюдает изменения DOM и долгие задачи. Вставьте команду в консоль DevTools страницы приложения:',
  copyBrowserProbe: 'Скопировать браузерный зонд', adapterExplanation: 'Для измерения обновлений компонентов добавьте dev-адаптер в точку входа:',
  copyVueAdapter: 'Скопировать адаптер Vue', copyReactAdapter: 'Скопировать адаптер React', copyPropProfiler: 'Скопировать Profiler props',
  profilerExplanation: 'React Profiler измеряет всё обёрнутое поддерево. Для изменений props оберните отдельный компонент в его модуле:',
  buildOnlyOnClick: 'Сборка проекта запускается только по нажатию кнопки измерения.',
  guideTitle: 'Знаки и управление картой', guideIntro: 'Карта показывает структуру исходников. Цвета и кольца описывают код; runtime-пульсации появляются после подключения приложения.',
  guideBasics: 'Печати и расположение', guideElements: 'Цвета стихий', guideConstructs: 'Знаки кода', guideDiagnostics: 'Диагностика и активность', guideControls: 'Как пользоваться картой',
  openEditor: 'Открыть в редакторе', bundleRuntime: 'Runtime-замеры', selfTime: 'собственное время', browserDom: 'наблюдений DOM браузера',
  cycleRisk: 'Циклические импорты могут нарушать инициализацию модулей и HMR.', orphanNote: 'Входящих импортов и рендеров компонента не найдено. Проверьте модуль перед удалением.',
  heavyBundles: 'Тяжёлые зависимости', callbacks: 'Колбэки', imports: 'Импорты', stateEffect: 'Состояние и эффекты', close: 'Закрыть',
  scanTitle: 'Создаём карту проекта', scanReady: 'Карта готова', scanLoadingGraph: 'Загружаем карту в браузер', scanError: 'Ошибка сканирования', scanWaiting: 'Подключаемся к сканеру…',
  scanDiscovering: 'Поиск исходных файлов', scanParsing: 'Чтение исходников', scanNodes: 'Создание знаков', scanEdges: 'Построение связей', scanDiagnostics: 'Проверка архитектуры', scanDependencies: 'Анализ библиотек', scanLayout: 'Размещение карты', scanLayoutClusters: 'Размещение архипелагов', scanLayoutFinalizing: 'Завершение карты', scanTransferring: 'Передача карты в браузер', scanStarting: 'Запуск сканирования',
  scanFiles: 'файлов', scanClusters: 'архипелагов', scanFound: 'найдено', scanElapsed: 'Прошло', scanLastUpdate: 'Последний прогресс', scanSeconds: 'с назад', scanStale: 'Нет обновления более 30 секунд. Этот этап может быть долгим; проверьте журнал ниже.', scanLogs: 'Журнал сканирования', scanRetry: 'Повторить сканирование', scanCancel: 'Остановить', scanCancelled: 'Сканирование остановлено', scanShowLogs: 'Показать журнал', scanHideLogs: 'Скрыть журнал', scanRefresh: 'Обновить карту',
  staticSource: 'Статическая карта кода', staticOnly: 'Runtime DevTools для этого языка пока недоступны.', sourceSymbols: 'Символы внутри', sourceNamespace: 'Пакет / пространство имён', sourceImports: 'Импорты / using', sourceMembers: 'Элементов', sourceLine: 'строка', sourceMoreImports: 'импортов не показано', sourceLoops: 'циклов', sourceBranches: 'ветвлений', sourceAwaits: 'await',
};

export function translate(locale: Locale, key: Key): string { return (locale === 'ru' ? ru : en)[key]; }
export function elementLabel(locale: Locale, element: string): string {
  const keys: Record<string, Key> = { Fire: 'fire', Water: 'water', Earth: 'earth', Wind: 'wind', Light: 'light', Arcane: 'arcane' };
  return keys[element] ? translate(locale, keys[element]) : element;
}

export function findingText(locale: Locale, finding: { rule: string; message: string; propName?: string; childName?: string }): string {
  if (locale === 'en') return finding.message;
  const prop = finding.propName || 'prop';
  const child = finding.childName || 'компонента';
  switch (finding.rule) {
    case 'react-inline-callback': return `Колбэк ${prop} создаёт новую ссылку для <${child}>. Измерьте дочерний компонент перед мемоизацией.`;
    case 'react-prop-identity': return `Значение ${prop} создаёт новый объект или массив для <${child}> при каждом вычислении.`;
    case 'vue-list-key': return `Повторяемый компонент <${child}> не имеет стабильного :key.`;
    case 'vue-prop-identity': return `Prop ${prop} создаёт новый объект или массив в шаблоне. Измерьте лишние обновления <${child}>.`;
    case 'vue-deep-watch': return 'Глубокий watch обходит вложенные реактивные значения. Измерьте его стоимость при обновлениях.';
    default: return finding.message;
  }
}

export function riskText(locale: Locale, risk: { type: string; message: string }): string {
  if (locale === 'en') return risk.message;
  const count = Number.parseInt(risk.message, 10) || 0;
  if (risk.type === 'inline_callback') return `${count} колбэков передаются дочерним компонентам. Их ссылки меняются при каждом рендере родителя; измерьте влияние на детей.`;
  if (risk.type === 'unmemoized_calc') return `${count} преобразований массивов в области компонента. Статический анализ не определяет, выполняются ли они при рендере и насколько дороги.`;
  return risk.message;
}

export function adviceText(locale: Locale, advice: string): string {
  if (locale === 'en') return advice;
  if (advice.startsWith('Profile children receiving')) return 'Измерьте дочерние компоненты перед добавлением useCallback или изменением мемоизации.';
  if (advice.startsWith('Profile array transformations')) return 'Измерьте преобразования массивов, чтобы понять, полезна ли мемоизация.';
  if (advice.startsWith('Monolithic file')) return 'Крупный файл. Рассмотрите разделение на небольшие модули с понятной ответственностью.';
  if (advice.startsWith('Limit deep watcher')) return 'Ограничьте обход глубокого watch или сузьте наблюдаемое значение, если измерения подтвердят затраты.';
  if (advice.startsWith('No source finding')) return 'В исходниках замечаний нет. Runtime-профилирование может выявить затраты, которых статический анализ не видит.';
  return advice;
}

export function ratingText(locale: Locale, value: string): string {
  if (locale === 'en') return value;
  const ratings: Record<string, string> = {
    feather: 'Лёгкий', standard: 'Обычный', heavy: 'Тяжёлый', colossal: 'Огромный',
    simple: 'Простая', moderate: 'Умеренная', complex: 'Сложная', labyrinth: 'Очень сложная',
    harmonious: 'Стабильно', warm: 'Тёплый', overcharged: 'Перегружен', fissure: 'Критично',
    low: 'низкая', medium: 'средняя', high: 'высокая',
    'Adept Inscription': 'Умеренная печать', 'Overcharged Monolith': 'Перегруженный монолит',
  };
  return ratings[value] || value;
}
