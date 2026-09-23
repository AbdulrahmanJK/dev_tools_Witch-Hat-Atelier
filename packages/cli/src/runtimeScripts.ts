/** Browser probes are opt in and are never injected into the target automatically. */
export const quickBrowserScript = `(() => {
  if (window.__grimoireQuickProbe) return;
  const base = new URL(document.currentScript.src).origin;
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
    fetch(base + '/api/telemetry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event), keepalive: true }).catch(() => {});
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const name = componentName(record.target.nodeType === 1 ? record.target : record.target.parentElement);
      if (name) queue.add(name);
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      for (const name of queue) send({ type: 'DOM_UPDATE', source: 'browser', componentName: name, timestamp: Date.now(), durationMs: 0, changeReasons: ['Observed DOM mutation; render duration unavailable'] });
      queue.clear();
    });
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  let tasks;
  try {
    tasks = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) send({ type: 'LONG_TASK', source: 'browser', componentName: 'Browser main thread', timestamp: Date.now(), durationMs: entry.duration });
    });
    tasks.observe({ type: 'longtask', buffered: true });
  } catch {}
  window.__grimoireQuickProbe = { stop() { observer.disconnect(); tasks?.disconnect(); cancelAnimationFrame(frame); delete window.__grimoireQuickProbe; } };
  console.info('[Grimoire] Quick browser probe active. DOM updates are observations, not measured component renders.');
})();`;

export const devAdapterScript = `const endpoint = new URL('/api/telemetry', import.meta.url).href;
function send(event) {
  fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...event, source: 'adapter', timestamp: Date.now() }), keepalive: true }).catch(() => {});
}

/** Vue 3: install once before mount. Measures each component's update phase in dev. */
export function installGrimoireVue(app) {
  const starts = new WeakMap();
  const reasons = new WeakMap();
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
      file: type.__file, durationMs: started == null ? 0 : Math.max(0, performance.now() - started), changeReasons: [phase, ...(reasons.get(vm) || [])] });
    reasons.delete(vm);
  }
  app.mixin({
    beforeMount() { starts.set(this, performance.now()); },
    mounted() { report(this, 'mount'); },
    beforeUpdate() { starts.set(this, performance.now()); },
    renderTriggered(event) {
      const key = typeof event.key === 'symbol' ? event.key.description : String(event.key);
      const old = reasons.get(this) || [];
      if (old.length < 4) reasons.set(this, [...old, event.type + ':' + key]);
    },
    updated() { report(this, 'update'); },
  });
  return app;
}

/** React 17–19: wrap a root or chosen component with React.Profiler in the dev entry. */
export function profileReact(React, id, element, file) {
  return React.createElement(React.Profiler, {
    id,
    onRender(componentName, phase, actualDuration) {
      send({ type: 'RENDER', componentName, file, durationMs: actualDuration, changeReasons: [phase] });
    },
  }, element);
}

export function profileReactComponent(React, Component, file) {
  const name = Component.displayName || Component.name || 'Anonymous';
  const Wrapped = (props) => {
    const previous = React.useRef(null);
    const latest = React.useRef(props);
    latest.current = props;
    return React.createElement(React.Profiler, {
      id: name,
      onRender(componentName, phase, actualDuration) {
        const before = previous.current;
        const after = latest.current;
        const changed = before == null ? [] : [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((key) => !Object.is(before[key], after[key]))
          .slice(0, 8)
          .map((key) => 'prop:' + key + ':' + ((typeof after[key] === 'function' || (after[key] && typeof after[key] === 'object')) ? 'identity' : 'value'));
        previous.current = after;
        send({ type: 'RENDER', componentName, file, durationMs: actualDuration, changeReasons: [phase, ...changed] });
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
  const compositeTags = new Set([0, 1, 11, 14, 15]);
  let commitId = 0;
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
    const stack = [{ fiber: current, path: [] }];
    let visited = 0;
    while (stack.length && visited++ < 15000) {
      const item = stack.pop();
      const fiber = item.fiber;
      if (!fiber) continue;
      const isComponent = compositeTags.has(fiber.tag);
      const name = isComponent ? nameOf(fiber) : null;
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
        events.push({ type: 'RENDER', source: 'fiber', componentName: name,
          parentComponentName: item.path[item.path.length - 1], hierarchyPath: path,
          commitId: id, timestamp: Date.now(), durationMs: Number.isFinite(fiber.actualDuration) ? fiber.actualDuration : 0,
          changeReasons: reasons });
      }
      if (fiber.sibling) stack.push({ fiber: fiber.sibling, path: item.path });
      if (fiber.child) stack.push({ fiber: fiber.child, path });
    }
    for (let offset = 0; offset < events.length; offset += 50) {
      fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events.slice(offset, offset + 50)), keepalive: true }).catch(() => {});
    }
  }
  function onCommit(root) {
    const current = root?.current;
    if (current) queueMicrotask(() => { try { capture(current); } catch {} });
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
  } catch (error) { console.warn('[Grimoire] Per-component tracing unavailable:', error); }
}`;
