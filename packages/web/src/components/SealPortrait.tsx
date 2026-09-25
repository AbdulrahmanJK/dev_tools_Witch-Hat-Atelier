import { useEffect, useRef, useState } from 'react';
import type { SealNode } from '@wha/core';
import { drawCanonicalGlyph, getPerimeterSignLayout, GlyphRenderer, normalizeSealKind, WHA_THEMES } from '@wha/canvas-engine';
import { elementLabel, type Locale } from '../i18n.js';
import { SealElementIcon, SealKindIcon } from './SealLegendIcons.js';

const KIND_TEXT: Record<SealNode['kind'], [string, string]> = {
  component: ['компонент', 'component'],
  module: ['модуль', 'module'],
  class: ['класс', 'class'],
  function: ['функция', 'function'],
  hub: ['общий узел', 'shared hub'],
};

const MODULE_TEXT: Record<string, [string, string]> = {
  api: ['API-модуль', 'API module'],
  redux: ['Redux-модуль', 'Redux module'],
  constants: ['модуль констант', 'constants module'],
  hook: ['модуль хуков', 'hooks module'],
  utils: ['вспомогательный модуль', 'utility module'],
};

const SIGN_TEXT: Record<string, [string, string]> = {
  dispersion: ['преобразование коллекции', 'collection mapping'],
  convergence: ['отбор или свёртка данных', 'filtering or reduction'],
  repetition: ['повторение или эффект', 'loop or effect'],
  collection: ['массив', 'array'],
  orb: ['множество Set', 'Set collection'],
  region: ['словарь Map', 'Map collection'],
  bolt: ['асинхронный вызов', 'async call'],
  column: ['обработчик, метод или функция', 'handler, method, or function'],
  focus: ['состояние, поле или свойство', 'state, field, or property'],
  aeroform: ['дочерний компонент', 'child component'],
};

function SealSignGlyph({ type, color }: { type: string; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 64, 64);
    ctx.save();
    ctx.translate(32, 32);
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (!drawCanonicalGlyph(ctx, type, 40)) {
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }, [type, color]);
  return <canvas ref={ref} width={64} height={64} className="seal-sign-icon" aria-hidden="true" />;
}

export function SealPortrait({ node, locale, realisticMode }: { node: SealNode; locale: Locale; realisticMode: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [showAllSigns, setShowAllSigns] = useState(false);
  const isRu = locale === 'ru';
  const kind = normalizeSealKind(node.kind);
  const category = node.moduleCategory || (kind === 'module' && typeof node.kind === 'string' ? node.kind : '');
  const kindText = (kind === 'module' && MODULE_TEXT[category] || KIND_TEXT[kind])[isRu ? 0 : 1];
  const element = node.metrics?.element || 'Arcane';
  const color = realisticMode ? WHA_THEMES.Mono!.stroke : (WHA_THEMES[element] || WHA_THEMES.Arcane!).stroke;
  const signs = node.metrics?.radialSigns || [];
  const perimeter = getPerimeterSignLayout(signs, node.metrics?.radius || 40);
  const innerSeals = node.realisticLayout?.subSeals?.filter((seal) => seal.type !== 'core') || [];

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 640, 430);
    ctx.save();
    ctx.scale(2, 2);
    ctx.translate(160, 98);
    const radius = node.metrics?.radius || 40;
    ctx.scale(Math.min(1.7, 81 / radius), Math.min(1.7, 81 / radius));
    new GlyphRenderer().renderNode(ctx, { ...node, x: 0, y: 0 }, 2, false, false, realisticMode);
    ctx.restore();
  }, [node, realisticMode]);

  return <section className="seal-portrait" aria-label={isRu ? 'Устройство выбранной печати' : 'Selected seal anatomy'}>
    <div className="section-label">{isRu ? 'Устройство печати' : 'Seal anatomy'}</div>
    <div className="seal-portrait-art" style={{ borderColor: color }}>
      <canvas ref={ref} width={640} height={430} role="img" aria-label={`${node.name}: ${kindText}`} />
    </div>
    <div className="seal-portrait-key">
      <SealKindIcon kind={kind} color={color} />
      <div><strong>{kindText}</strong><small>{isRu ? 'Силуэт виден и на дальней карте' : 'Silhouette stays visible at overview scale'}</small></div>
    </div>
    <div className="seal-portrait-key">
      <SealElementIcon element={element} color={color} />
      <div><strong>{elementLabel(locale, element)}</strong><small>{isRu ? 'Цвет и центральный знак — тема кода по эвристике' : 'Colour and central sign: inferred code theme'}</small></div>
    </div>
    <p className="seal-portrait-note">{isRu ? 'Размер печати примерно отражает число строк исходника. Малые знаки по окружности показывают найденные конструкции.' : 'Seal size roughly follows source line count. Small perimeter signs show detected source constructs.'}</p>
    {(perimeter.dense || perimeter.omitted > 0) && <p className="seal-portrait-note">{isRu ? `${perimeter.dense ? 'Плотная печать: знаки разделены на два круга' : 'На круге показана часть знаков'}${perimeter.omitted ? `; ещё ${perimeter.omitted} есть в списке ниже` : ''}.` : `${perimeter.dense ? 'Dense seal: signs use two rings' : 'The seal shows a selection of signs'}${perimeter.omitted ? `; ${perimeter.omitted} more are in the list below` : ''}.`}</p>}
    {innerSeals.length > 0 && <div className="seal-portrait-inner">
      <strong>{isRu ? 'Внутренние круги' : 'Inner circles'}</strong>
      <span>{[...new Set(innerSeals.map((seal) => seal.type))].map((type) => {
        const label = type === 'state' ? (isRu ? 'состояние' : 'state')
          : type === 'effects' ? (isRu ? 'эффекты' : 'effects')
            : type === 'handler' ? (isRu ? 'обработчики' : 'handlers')
              : (isRu ? 'дочерние' : 'children');
        return `${label}: ${innerSeals.filter((seal) => seal.type === type).reduce((sum, seal) => sum + (seal.count || 1), 0)}`;
      }).join(' · ')}</span>
    </div>}
    {signs.length > 0 && <div className="seal-portrait-signs">
      <div className="section-label">{isRu ? `Знаки этого узла (${signs.length})` : `Signs in this node (${signs.length})`}</div>
      {(showAllSigns ? signs : signs.slice(0, 12)).map((sign, index) => <div className="seal-sign-row" key={`${sign.type}-${index}`}>
        <SealSignGlyph type={sign.type} color={color} />
        <div><strong>{sign.label}</strong><small>{SIGN_TEXT[sign.type]?.[isRu ? 0 : 1] || (isRu ? 'Конструкция исходного кода' : 'Source construct')}</small></div>
      </div>)}
      {signs.length > 12 && <button className="seal-sign-toggle" onClick={() => setShowAllSigns(!showAllSigns)}>
        {showAllSigns ? (isRu ? 'Свернуть знаки' : 'Show fewer signs') : (isRu ? `Показать ещё ${signs.length - 12}` : `Show ${signs.length - 12} more`)}
      </button>}
    </div>}
  </section>;
}
