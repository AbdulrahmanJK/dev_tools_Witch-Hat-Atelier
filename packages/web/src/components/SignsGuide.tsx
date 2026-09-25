import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { drawCanonicalGlyph, WHA_THEMES } from '@wha/canvas-engine';
import { translate, type Locale } from '../i18n.js';
import { SealKindIcon } from './SealLegendIcons.js';

interface SignsGuideProps { locale: Locale; onClose: () => void; }

const Glyph: React.FC<{ name: string; color?: string }> = ({ name, color = '#60452a' }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, 96, 96);
    ctx.save(); ctx.translate(48, 48); ctx.strokeStyle = color; ctx.lineWidth = 4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!drawCanonicalGlyph(ctx, name, 60)) {
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }, [name, color]);
  return <canvas className="guide-glyph" ref={ref} width={96} height={96} aria-hidden="true" />;
};

export const SignsGuide: React.FC<SignsGuideProps> = ({ locale, onClose }) => {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', closeOnEscape, true);
    return () => window.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose]);
  const isRu = locale === 'ru';
  const elements = [
    { key: 'Fire', glyph: 'fire', meaning: isRu ? 'действия, формы и dispatch' : 'actions, forms, and dispatch' },
    { key: 'Water', glyph: 'water', meaning: isRu ? 'данные, API, эффекты и store' : 'data, API, effects, and store' },
    { key: 'Earth', glyph: 'earth', meaning: isRu ? 'таблицы, константы и мемоизация' : 'tables, constants, and memoization' },
    { key: 'Wind', glyph: 'wind-underfoot', meaning: isRu ? 'навигация, маршруты и модальные окна' : 'navigation, routes, and modals' },
    { key: 'Light', glyph: 'light', meaning: isRu ? 'интерфейс и локальное состояние' : 'UI and local state' },
    { key: 'Arcane', glyph: 'arcane', meaning: isRu ? 'корень приложения или крупный узел' : 'app root or a large hub' },
  ];
  const signs = [
    { glyph: 'dispersion', code: '.map()', meaning: isRu ? 'преобразование коллекции' : 'collection mapping' },
    { glyph: 'convergence', code: '.filter() / .reduce()', meaning: isRu ? 'отбор или свёртка данных' : 'selection or reduction' },
    { glyph: 'repetition', code: 'loop / .forEach() / useEffect', meaning: isRu ? 'повторение или эффект' : 'loop or effect' },
    { glyph: 'collection', code: 'Array', meaning: isRu ? 'массивы в коде' : 'arrays in source' },
    { glyph: 'orb', code: 'Set', meaning: isRu ? 'создание Set' : 'Set creation' },
    { glyph: 'region', code: 'Map', meaning: isRu ? 'создание Map' : 'Map creation' },
    { glyph: 'bolt', code: 'await', meaning: isRu ? 'асинхронная операция' : 'async operation' },
    { glyph: 'column', code: 'handler / method', meaning: isRu ? 'обработчик, метод или функция' : 'handler, method, or function' },
    { glyph: 'focus', code: 'state / field', meaning: isRu ? 'состояние, поле или свойство' : 'state, field, or property' },
    { glyph: 'aeroform', code: 'child', meaning: isRu ? 'дочерний компонент' : 'child component' },
  ];
  return createPortal(<div className="guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="signs-guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="signs-guide-head"><div><h2 id="guide-title">✦ {translate(locale, 'guideTitle')}</h2><p>{translate(locale, 'guideIntro')}</p></div><button onClick={onClose} aria-label={isRu ? 'Закрыть руководство' : 'Close guide'}>✕</button></div>
      <div className="signs-guide-grid">
        <div className="guide-section"><h3>{translate(locale, 'guideBasics')}</h3>
          {([
            ['component', 'Компонент', 'Component'],
            ['module', 'Модуль или файл', 'Module or file'],
            ['class', 'Класс или тип', 'Class or type'],
            ['function', 'Функция', 'Function'],
            ['hub', 'Общий узел', 'Shared hub'],
          ] as const).map(([kind, ru, en]) => <div className="guide-row" key={kind}><SealKindIcon kind={kind} className="guide-kind-icon" /><div><strong>{isRu ? ru : en}</strong><p>{isRu ? 'Силуэт виден при отдалении и повторяется малым знаком на ободе крупной печати.' : 'The silhouette remains visible when zoomed out and repeats as a small mark on the full seal rim.'}</p></div></div>)}
          <p className="guide-note">{isRu ? 'Размер примерно отражает объём исходника, а не время рендера. Для Go, Java, Kotlin и C# доступны статические знаки и исходные символы; runtime-замеры пока недоступны.' : 'Size roughly follows source length, not render time. Go, Java, Kotlin, and C# show static signs and source symbols; runtime measurements are not available yet.'}</p>
          <div className="guide-row"><span className="guide-shape guide-library">✦</span><div><strong>{isRu ? 'Внешняя печать' : 'Outer library seal'}</strong><p>{isRu ? 'Импортируемая библиотека. После измерения сборки цвет кольца показывает оценку её JS-вклада.' : 'Imported library. After build measurement, ring colour shows estimated JS contribution.'}</p></div></div>
          <div className="guide-row"><span className="guide-shape guide-thread">→</span><div><strong>{isRu ? 'Нить и архипелаг' : 'Thread and archipelago'}</strong><p>{isRu ? 'Нити — связи импортов и рендера; большой контур группирует родственные файлы.' : 'Threads connect imports and renders; a large boundary groups related files.'}</p></div></div>
        </div>
        <div className="guide-section"><h3>{translate(locale, 'guideElements')}</h3><p className="guide-note">{isRu ? 'Цвет определяется эвристикой по коду и пути файла; это не оценка качества.' : 'Colour is a source/path heuristic, not a quality score.'}</p>
          {elements.map((entry) => <div className="guide-row" key={entry.key}><Glyph name={entry.glyph} color={WHA_THEMES[entry.key]?.stroke} /><div><strong>{isRu ? ({ Fire: 'Огонь', Water: 'Вода', Earth: 'Земля', Wind: 'Ветер', Light: 'Свет', Arcane: 'Аркан' } as Record<string, string>)[entry.key] : entry.key}</strong><p>{entry.meaning}</p></div></div>)}
        </div>
        <div className="guide-section"><h3>{translate(locale, 'guideConstructs')}</h3><p className="guide-note">{isRu ? 'Малые знаки на краю печати отражают конструкции, найденные при статическом разборе исходника. В плотной печати они размещаются на двух кругах; если места не хватает, карта показывает часть знаков, а полный список остаётся в инспекторе.' : 'Small perimeter signs represent constructs found by static source analysis. Dense seals use two rings; when space runs out, the map shows a selection and the inspector keeps the full list.'}</p>
          {signs.map((entry) => <div className="guide-row" key={entry.code}><Glyph name={entry.glyph} /><div><strong>{entry.code}</strong><p>{entry.meaning}</p></div></div>)}
        </div>
        <div className="guide-section"><h3>{translate(locale, 'guideDiagnostics')}</h3>
          <div className="guide-row"><span className="guide-mark guide-purple">◎</span><p>{isRu ? 'Фиолетовый пунктир — цикл импортов.' : 'Purple dashed ring: import cycle.'}</p></div>
          <div className="guide-row"><span className="guide-mark guide-gray">◎</span><p>{isRu ? 'Серый контур — узел без входящих связей по данным сканера.' : 'Gray contour: no incoming links found by the scanner.'}</p></div>
          <div className="guide-row"><span className="guide-mark guide-red">◎</span><p>{isRu ? 'Красный пунктир — нарушение архитектурной границы Pact.' : 'Red dotted ring: Pact architecture boundary violation.'}</p></div>
          <div className="guide-row"><span className="guide-mark guide-gold">◎</span><p>{isRu ? 'Золотая пульсация — обновление; зелёная — mount или DOM; красная — частые события.' : 'Gold pulse: update; green: mount or DOM; red: rapid events.'}</p></div>
          <div className="guide-row"><span className="guide-mark guide-blue">●</span><p>{isRu ? 'В анализе: синий — действие, золото — обновление, красный — долгая задача браузера. Сопоставление по имени отмечается как предположение.' : 'In analysis: blue marks an interaction, gold a render, red a browser long task. Name-based mapping is labelled as inferred.'}</p></div>
          <p className="guide-note">{isRu ? 'Для библиотек: зелёный <20 KiB, охра 20–100 KiB, красный ≥100 KiB. Это оценка после Vite-сборки, не сетевой размер.' : 'For libraries: green <20 KiB, ochre 20–100 KiB, red ≥100 KiB. This is an estimate after a Vite build, not transfer size.'}</p>
        </div>
      </div>
      <div className="guide-section guide-controls"><h3>{translate(locale, 'guideControls')}</h3><p>{isRu ? 'Наведите курсор для краткой информации, нажмите печать для инспектора. Перетаскивайте карту, колесом меняйте масштаб. Кнопка ⊞ показывает всю карту. В больших проектах при сильном отдалении каждый узел остаётся видимым как цветной силуэт; при приближении появляются его детали. Поиск открывает список точных совпадений, Enter перемещает к выбранному узлу. Фильтры выделяют нужные группы.' : 'Hover for a hint, click a seal for its inspector. Drag to pan and scroll to zoom. The ⊞ button fits the whole map. In large projects every node remains visible as a coloured silhouette when zoomed far out; zoom in to see its details. Search lists ranked matches; Enter focuses the selected item. Filters highlight matching groups.'}</p><p>{isRu ? 'Кнопка «Подробная карта» включает лёгкий режим для слабого компьютера: убирает мелкие знаки с кругов, оставляет силуэт, центральный знак и название, показывает основные и выбранные связи без анимации. Полный список знаков остаётся в инспекторе.' : 'The Detailed map button enables light mode for slower computers: it hides small signs on seals, keeps shapes, central signs and names, and shows major and selected links without animation. The inspector retains the full list of signs.'}</p></div>
    </section>
  </div>, document.body);
};
