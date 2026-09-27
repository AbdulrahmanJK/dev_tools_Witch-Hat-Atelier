/** Shared, development-only browser signals. Never sends input values or element text. */
const browserSupportScript = String.raw`
function ensureGrimoireBrowserSupport(endpoint) {
  const existing = globalThis.__grimoireBrowserContext;
  if (existing) return existing;
  const pageId = 'page-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
  const context = { pageId, lastInteraction: null, locate: false, source: 'browser', framework: null, heartbeat: null };
  globalThis.__grimoireBrowserContext = context;
  const control = endpoint.replace(/\/api\/telemetry(?:\?.*)?$/, '/api/runtime/control');
  const pending = [];
  let sending = false;
  let timer = null;
  let retryDelay = 100;
  let pendingLoss = 0;
  let lastWarning = 0;
  function schedule(delay) { if (timer === null) timer = setTimeout(flush, delay); }
  function enforceQueueLimit() {
    if (pending.length <= 10000) return;
    const lost = pending.splice(0, pending.length - 10000).length;
    pendingLoss += lost;
    console.error('[Grimoire] Browser telemetry queue overflow: ' + lost + ' events lost.');
  }
  async function flush() {
    timer = null;
    if (sending || (!pending.length && !pendingLoss)) return;
    sending = true;
    const batch = pending.splice(0, 20);
    const reportedLoss = pendingLoss;
    try {
      const body = JSON.stringify(reportedLoss ? [{ type: 'LOSS', source: context.source, framework: context.framework,
        componentName: 'Telemetry delivery', pageId, timestamp: Date.now(), durationMs: 0, droppedCount: reportedLoss }, ...batch] : batch);
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      pendingLoss = Math.max(0, pendingLoss - reportedLoss);
      retryDelay = 100;
    } catch (error) {
      pending.unshift(...batch);
      enforceQueueLimit();
      retryDelay = Math.min(5000, retryDelay * 2);
      if (Date.now() - lastWarning > 10000) {
        lastWarning = Date.now();
        console.warn('[Grimoire] Browser telemetry delivery failed; retrying ' + pending.length + ' events.', error);
      }
    } finally {
      sending = false;
      if (pending.length || pendingLoss) schedule(retryDelay === 100 ? 8 : retryDelay);
    }
  }
  const send = (event) => {
    pending.push({ pageId, source: 'browser', timestamp: Date.now(), durationMs: 0, ...event });
    enforceQueueLimit();
    schedule(8);
  };
  context.send = send;
  const pagehide = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    while (pending.length || pendingLoss) {
      const batch = pending.splice(0, 20);
      if (pendingLoss) { batch.unshift({ type: 'LOSS', source: context.source, framework: context.framework,
        componentName: 'Telemetry delivery', pageId, timestamp: Date.now(), durationMs: 0, droppedCount: pendingLoss }); pendingLoss = 0; }
      const body = JSON.stringify(batch);
      if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))) {
        fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
          .catch((error) => console.warn('[Grimoire] Final browser telemetry delivery failed.', error));
      }
    }
  };
  addEventListener('pagehide', pagehide, { once: true });
  const announce = () => send({ type: 'HELLO', componentName: 'Runtime connection', source: context.source, framework: context.framework });
  context.setMode = (source, framework) => {
    const rank = { browser: 0, adapter: 1, fiber: 2 };
    if (rank[source] >= rank[context.source]) context.source = source;
    if (framework) context.framework = framework;
    announce();
  };
  context.heartbeat = setInterval(announce, 30000);
  function targetName(element) {
    if (!(element instanceof Element)) return 'unknown';
    const tag = element.tagName.toLowerCase();
    const id = element.id ? '#' + String(element.id).slice(0, 50) : '';
    const klass = element.classList?.length ? '.' + String(element.classList[0]).slice(0, 40) : '';
    return (tag + id + klass).slice(0, 120);
  }
  function componentAt(element) {
    for (let current = element; current; current = current.parentElement) {
      const vue = current.__vueParentComponent;
      if (vue) return { componentName: vue.type?.name || vue.type?.__name || 'Unknown Vue component',
        file: vue.type?.__file, runtimeId: pageId + ':vue:' + vue.uid };
      const key = Object.keys(current).find((name) => name.startsWith('__reactFiber$'));
      let fiber = key && current[key];
      while (fiber) {
        const type = fiber.elementType || fiber.type;
        const inner = type?.type || type?.render || type;
        const name = type?.displayName || inner?.displayName || inner?.name || type?.name;
        if (name) return { componentName: name, runtimeId: globalThis.__grimoireFiberRuntimeId?.(fiber) };
        fiber = fiber.return;
      }
    }
    return { componentName: 'Unknown component' };
  }
  const click = (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (context.locate) {
      context.locate = false;
      event.preventDefault(); event.stopImmediatePropagation();
      send({ type: 'LOCATE', interactionType: 'click', interactionTarget: targetName(element), ...componentAt(element) });
      return;
    }
    const interaction = { timestamp: Date.now(), type: 'click', target: targetName(element) };
    context.lastInteraction = interaction;
    send({ type: 'INTERACTION', componentName: 'User interaction', interactionType: interaction.type, interactionTarget: interaction.target });
  };
  const keydown = (event) => {
    if (context.locate && event.key === 'Escape') { context.locate = false; return; }
    const interaction = { timestamp: Date.now(), type: 'keydown', target: targetName(event.target) };
    context.lastInteraction = interaction;
    send({ type: 'INTERACTION', componentName: 'User interaction', interactionType: interaction.type, interactionTarget: interaction.target });
  };
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', keydown, true);
  const observers = [];
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) send({ type: 'LONG_TASK', componentName: 'Browser main thread', durationMs: entry.duration, durationKind: 'browser-task' });
    }); observer.observe({ type: 'longtask', buffered: true }); observers.push(observer);
  } catch {}
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.interactionId || !['click', 'keydown'].includes(entry.name)) continue;
        if (context.lastInteraction && context.lastInteraction.type === entry.name && Date.now() - context.lastInteraction.timestamp < 1000) {
          context.lastInteraction.interactionId = entry.interactionId;
        }
        send({ type: 'INTERACTION', componentName: 'User interaction', interactionType: entry.name,
          interactionId: entry.interactionId, interactionTarget: targetName(entry.target), durationMs: entry.duration, durationKind: 'event-timing' });
      }
    }); observer.observe({ type: 'event', buffered: true, durationThreshold: 16 }); observers.push(observer);
  } catch {}
  const controlStream = new EventSource(control + '-stream');
  controlStream.onmessage = (event) => { try { context.locate = Boolean(JSON.parse(event.data).locate); } catch {} };
  controlStream.onerror = () => { context.locate = false; };
  context.stop = () => { pagehide(); clearInterval(context.heartbeat); controlStream.close(); observers.forEach((observer) => observer.disconnect());
    removeEventListener('pagehide', pagehide); if (timer !== null) clearTimeout(timer);
    document.removeEventListener('click', click, true); document.removeEventListener('keydown', keydown, true);
    delete globalThis.__grimoireBrowserContext; };
  return context;
}
`;

/** Browser probes are opt in and are never injected into the target automatically. */
export const quickBrowserScript = `(() => {
  if (window.__grimoireQuickProbe) return;
  const base = new URL(document.currentScript.src).origin;
  const endpoint = base + '/api/telemetry';
  ${browserSupportScript}
  const hadBrowserContext = Boolean(globalThis.__grimoireBrowserContext);
  const browserContext = ensureGrimoireBrowserSupport(endpoint);
  browserContext.setMode('browser');
  const queue = new Set();
  let frame = 0;
  function componentName(element) {
    for (let current = element; current; current = current.parentElement) {
      const vue = current.__vueParentComponent;
      if (vue) return vue.type?.name || vue.type?.__name || null;
      const key = Object.keys(current).find((name) => name.startsWith('__reactFiber$'));
      let fiber = key && current[key];
      while (fiber) {
        const type = fiber.type;
        const name = type?.displayName || type?.name || type?.render?.displayName || type?.render?.name;
        if (name && !name.startsWith('Anonymous')) return name;
        fiber = fiber.return;
      }
    }
    return null;
  }
  function send(event) {
    browserContext.send(event);
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (element) queue.add(element);
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const names = new Set();
      for (const element of queue) {
        const name = componentName(element);
        if (name) names.add(name);
      }
      queue.clear();
      for (const name of names) send({ type: 'DOM_UPDATE', source: 'browser', componentName: name, timestamp: Date.now(), durationMs: 0, changeReasons: ['Observed DOM mutation; render duration unavailable'] });
    });
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  window.__grimoireQuickProbe = { stop() { observer.disconnect(); if (!hadBrowserContext) browserContext.stop(); cancelAnimationFrame(frame); delete window.__grimoireQuickProbe; } };
  console.info('[Grimoire] Quick browser probe active. DOM updates are observations, not measured component renders.');
})();`;

export const devAdapterScript = `const endpoint = new URL('/api/telemetry', import.meta.url).href;
${browserSupportScript}
let browserContext = null;
function getBrowserContext() {
  if (!browserContext && typeof document !== 'undefined') browserContext = ensureGrimoireBrowserSupport(endpoint);
  return browserContext;
}
function send(event) {
  const context = getBrowserContext();
  if (!context) return;
  const recent = context?.lastInteraction;
  context.send({ ...event, source: 'adapter', framework: context.framework,
    pageId: context?.pageId, interactionType: recent && Date.now() - recent.timestamp < 1000 ? recent.type : undefined,
    interactionId: recent && Date.now() - recent.timestamp < 1000 ? recent.interactionId : undefined,
    interactionTarget: recent && Date.now() - recent.timestamp < 1000 ? recent.target : undefined,
    timestamp: Date.now() });
}

/** Vue 3: install once before mount. Measures each component's update phase in dev. */
export function installGrimoireVue(app) {
  getBrowserContext();
  browserContext?.setMode('adapter', 'vue');
  const starts = new WeakMap();
  const reasons = new WeakMap();
  const tracked = new WeakMap();
  const triggered = new WeakMap();
  const targets = new WeakMap();
  let nextTarget = 0;
  function reactiveDetail(event) {
    const target = event.target;
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return null;
    let targetId = targets.get(target);
    if (!targetId) { targetId = 'reactive-' + (++nextTarget); targets.set(target, targetId); }
    return { targetId, key: typeof event.key === 'symbol' ? String(event.key.description || 'symbol') : String(event.key).slice(0, 80), operation: String(event.type || '').slice(0, 30) };
  }
  function report(vm, phase) {
    const instance = vm.$;
    const type = instance?.type || {};
    const componentName = type.name || type.__name || vm.$options?.name;
    if (!componentName) return;
    const hierarchyPath = [];
    for (let current = instance; current && hierarchyPath.length < 12; current = current.parent) {
      const currentType = current.type || {};
      const name = currentType.name || currentType.__name;
      if (name) hierarchyPath.unshift(name);
    }
    const started = starts.get(vm);
    send({ type: 'RENDER', componentName, parentComponentName: hierarchyPath[hierarchyPath.length - 2], hierarchyPath,
      runtimeId: browserContext?.pageId + ':vue:' + instance.uid,
      parentRuntimeId: instance.parent ? browserContext?.pageId + ':vue:' + instance.parent.uid : undefined,
      file: type.__file, durationMs: started == null ? 0 : Math.max(0, performance.now() - started), durationKind: 'vue-lifecycle',
      reactiveTracked: tracked.get(vm) || [], reactiveTriggers: triggered.get(vm) || [], changeReasons: [phase, ...(reasons.get(vm) || [])] });
    reasons.delete(vm);
    triggered.delete(vm);
  }
  app.mixin({
    beforeMount() { starts.set(this, performance.now()); tracked.delete(this); },
    mounted() { report(this, 'mount'); },
    beforeUpdate() { starts.set(this, performance.now()); tracked.delete(this); },
    renderTracked(event) {
      const detail = reactiveDetail(event);
      if (!detail) return;
      const values = tracked.get(this) || [];
      if (values.length < 24 && !values.some((item) => item.targetId === detail.targetId && item.key === detail.key)) tracked.set(this, [...values, detail]);
    },
    renderTriggered(event) {
      const key = typeof event.key === 'symbol' ? event.key.description : String(event.key);
      const old = reasons.get(this) || [];
      if (old.length < 4) reasons.set(this, [...old, event.type + ':' + key]);
      const detail = reactiveDetail(event);
      const triggers = triggered.get(this) || [];
      if (detail && triggers.length < 24) triggered.set(this, [...triggers, detail]);
    },
    updated() { report(this, 'update'); },
  });
  return app;
}

/** React 17–19: wrap a root or chosen component with React.Profiler in the dev entry. */
export function profileReact(React, id, element, file) {
  getBrowserContext();
  browserContext?.setMode('adapter', 'react');
  return React.createElement(React.Profiler, {
    id,
    onRender(componentName, phase, actualDuration, _baseDuration, _startTime, commitTime) {
      send({ type: 'RENDER', componentName, file, commitId: Math.round(commitTime * 1000), durationMs: actualDuration,
        durationKind: 'profiler-subtree', changeReasons: [phase] });
    },
  }, element);
}

export function profileReactComponent(React, Component, file) {
  getBrowserContext()?.setMode('adapter', 'react');
  const name = Component.displayName || Component.name || 'Anonymous';
  const Wrapped = (props) => {
    const previous = React.useRef(null);
    const latest = React.useRef(props);
    latest.current = props;
    return React.createElement(React.Profiler, {
      id: name,
      onRender(componentName, phase, actualDuration, _baseDuration, _startTime, commitTime) {
        const before = previous.current;
        const after = latest.current;
        const changed = before == null ? [] : [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((key) => !Object.is(before[key], after[key]))
          .slice(0, 8)
          .map((key) => 'prop:' + key + ':' + ((typeof after[key] === 'function' || (after[key] && typeof after[key] === 'object')) ? 'identity' : 'value'));
        previous.current = after;
        send({ type: 'RENDER', componentName, file, commitId: Math.round(commitTime * 1000), durationMs: actualDuration,
          durationKind: 'profiler-subtree', changeReasons: [phase, ...changed] });
      },
    }, React.createElement(Component, props));
  };
  Wrapped.displayName = 'Grimoire(' + name + ')';
  return Wrapped;
}`;

/** Installed before React imports in a Vite development entry. Fiber is a private React API. */
export const reactFiberHookScript = String.raw`const endpoint = '__GRIMOIRE_ENDPOINT__';
const active = import.meta.env.DEV && import.meta.env.VITE_GRIMOIRE === '1';
if (active && !globalThis.__grimoireFiberHookActive) {
  ${browserSupportScript}
  const browserContext = ensureGrimoireBrowserSupport(endpoint);
  const compositeTags = new Set([0, 1, 11, 14, 15]);
  let commitId = 0;
  let nextRuntimeId = 0;
  const runtimeIds = new WeakMap();
  const pendingEvents = [];
  let flushTimer = null;
  let flushing = false;
  let retryDelay = 100;
  let lastWarning = 0;
  let pendingLoss = 0;
  function enforceQueueLimit() {
    if (pendingEvents.length <= 10000) return;
    const dropped = pendingEvents.splice(0, pendingEvents.length - 10000).length;
    pendingLoss += dropped;
    console.error('[Grimoire] Telemetry queue overflow: ' + dropped + ' oldest events were lost.');
  }
  function lossEvent(count) {
    return { type: 'LOSS', source: 'fiber', framework: 'react', componentName: 'Telemetry delivery',
      pageId: browserContext.pageId, timestamp: Date.now(), durationMs: 0, droppedCount: count };
  }
  async function flushTelemetry() {
    flushTimer = null;
    if (flushing || (!pendingEvents.length && !pendingLoss)) return;
    flushing = true;
    const batch = pendingEvents.splice(0, 20);
    const reportedLoss = pendingLoss;
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportedLoss ? [lossEvent(reportedLoss), ...batch] : batch), keepalive: true });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      pendingLoss = Math.max(0, pendingLoss - reportedLoss);
      retryDelay = 100;
    } catch (error) {
      pendingEvents.unshift(...batch);
      enforceQueueLimit();
      retryDelay = Math.min(5000, retryDelay * 2);
      if (Date.now() - lastWarning > 10000) {
        lastWarning = Date.now();
        console.warn('[Grimoire] Telemetry delivery failed; retrying ' + pendingEvents.length + ' events.', error);
      }
    } finally {
      flushing = false;
      if ((pendingEvents.length || pendingLoss) && flushTimer === null) flushTimer = setTimeout(flushTelemetry, retryDelay === 100 ? 8 : retryDelay);
    }
  }
  addEventListener('pagehide', () => {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = null;
    while (pendingEvents.length || pendingLoss) {
      const batch = pendingEvents.splice(0, 20);
      if (pendingLoss) { batch.unshift(lossEvent(pendingLoss)); pendingLoss = 0; }
      const body = JSON.stringify(batch);
      if (!navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))) {
        fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
          .catch((error) => console.warn('[Grimoire] Final telemetry delivery failed.', error));
      }
    }
  }, { once: true });
  function runtimeIdOf(fiber) {
    if (!fiber) return undefined;
    let id = runtimeIds.get(fiber) || (fiber.alternate && runtimeIds.get(fiber.alternate));
    if (!id) id = browserContext.pageId + ':react:' + (++nextRuntimeId);
    runtimeIds.set(fiber, id);
    if (fiber.alternate) runtimeIds.set(fiber.alternate, id);
    return id;
  }
  globalThis.__grimoireFiberRuntimeId = runtimeIdOf;
  function nameOf(fiber) {
    const type = fiber.elementType || fiber.type;
    const inner = type?.type || type?.render || type;
    return type?.displayName || inner?.displayName || inner?.name || type?.name || null;
  }
  function changedProps(previous, current) {
    if (!previous || !current) return [];
    const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
    const result = [];
    for (const key of keys) {
      if (key === 'children' || Object.is(previous[key], current[key])) continue;
      const value = current[key];
      result.push('prop:' + key + ':' + ((typeof value === 'function' || (value && typeof value === 'object')) ? 'identity' : 'value'));
      if (result.length === 4) break;
    }
    return result;
  }
  function changedState(previous, current, tag) {
    if (tag === 1) return previous?.memoizedState !== current.memoizedState;
    let before = previous?.memoizedState;
    let after = current.memoizedState;
    let index = 0;
    while (after && index < 40) {
      if (after.queue && before?.queue && !Object.is(after.memoizedState, before.memoizedState)) return true;
      before = before?.next;
      after = after.next;
      index++;
    }
    return false;
  }
  function capture(current) {
    if (!current) return;
    const events = [];
    const id = ++commitId;
    const stack = [{ fiber: current, path: [], parentRuntimeId: undefined }];
    const visited = new Set();
    while (stack.length) {
      const item = stack.pop();
      const fiber = item.fiber;
      if (!fiber || visited.has(fiber)) continue;
      visited.add(fiber);
      const isComponent = compositeTags.has(fiber.tag);
      const name = isComponent ? nameOf(fiber) : null;
      const runtimeId = name ? runtimeIdOf(fiber) : undefined;
      const path = name ? [...item.path, name].slice(-12) : item.path;
      if (isComponent && name && ((fiber.flags ?? fiber.effectTag ?? 0) & 1)) {
        const phase = fiber.alternate ? 'update' : 'mount';
        const reasons = [phase];
        if (fiber.alternate) {
          reasons.push(...changedProps(fiber.alternate.memoizedProps, fiber.memoizedProps));
          if (changedState(fiber.alternate, fiber, fiber.tag)) reasons.push('state changed');
          if (reasons.length === 1 && item.path.length) reasons.push('parent update observed');
          if (reasons.length === 1) reasons.push('trigger unknown');
        }
        const recent = browserContext.lastInteraction;
        const type = fiber.elementType || fiber.type;
        events.push({ type: 'RENDER', source: 'fiber', framework: 'react', componentName: name,
          pageId: browserContext.pageId, runtimeId, parentRuntimeId: item.parentRuntimeId,
          file: type?.__file || type?.type?.__file,
          parentComponentName: item.path[item.path.length - 1], hierarchyPath: path,
          commitId: id, timestamp: Date.now(), durationMs: Number.isFinite(fiber.actualDuration) ? fiber.actualDuration : 0,
          durationKind: 'profiler-subtree',
          interactionType: recent && Date.now() - recent.timestamp < 1000 ? recent.type : undefined,
          interactionId: recent && Date.now() - recent.timestamp < 1000 ? recent.interactionId : undefined,
          interactionTarget: recent && Date.now() - recent.timestamp < 1000 ? recent.target : undefined,
          changeReasons: reasons });
      }
      if (fiber.sibling) stack.push({ fiber: fiber.sibling, path: item.path, parentRuntimeId: item.parentRuntimeId });
      // React 18/19 bubble commit flags through subtreeFlags. A settled branch
      // cannot contain an event that this observer would report. React 17 and
      // renderers without this field retain the full walk.
      const subtreeFlags = fiber.subtreeFlags;
      if (fiber.child && (!fiber.alternate || typeof subtreeFlags !== 'number' || subtreeFlags !== 0
        || ((fiber.child.flags ?? fiber.child.effectTag ?? 0) & 1))) {
        stack.push({ fiber: fiber.child, path, parentRuntimeId: runtimeId || item.parentRuntimeId });
      }
    }
    if (events.length) {
      pendingEvents.push(...events);
      enforceQueueLimit();
      if (flushTimer === null) flushTimer = setTimeout(flushTelemetry, 8);
    }
  }
  function onCommit(root) {
    const current = root?.current;
    if (current) queueMicrotask(() => {
      try { capture(current); }
      catch (error) { console.warn('[Grimoire] React commit capture failed:', error); }
    });
  }
  try {
    let hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook) {
      let nextRendererId = 0;
      hook = { supportsFiber: true, renderers: new Map(),
        inject(renderer) { const id = ++nextRendererId; this.renderers.set(id, renderer); return id; },
        onCommitFiberRoot(_rendererId, root) { onCommit(root); },
        onCommitFiberUnmount() {} };
      Object.defineProperty(globalThis, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { value: hook, configurable: true });
    } else {
      const previous = hook.onCommitFiberRoot;
      hook.onCommitFiberRoot = function(...args) {
        const result = typeof previous === 'function' ? previous.apply(this, args) : undefined;
        onCommit(args[1]);
        return result;
      };
    }
    globalThis.__grimoireFiberHookActive = true;
    browserContext.setMode('fiber', 'react');
  } catch (error) { console.warn('[Grimoire] Per-component tracing unavailable:', error); }
}`;
