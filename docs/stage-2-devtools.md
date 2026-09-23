# Stage 2 DevTools: React 17–19, Vue 3, and library seals

The scanner detects framework per source file from imports, JSX/SFC syntax, and package manifests. It reports the installed React/Vue version when available, falling back to the declared range. Vue SFCs are parsed with the Vue 3 compiler. React and Vue findings retain file, line, rule, and confidence; source findings are estimates until an app is profiled.

The **Pact** diagnostic highlights imports from `src/components` (Atelier) into `src/pages` or `src/views` (Provinces). Its red threads and source line links make the boundary violation reviewable without treating every cross-folder import as an error.

Every imported external package appears as a seal on the main map. Its source risk reflects how widely it is imported, not bundle bytes. Select a seal to inspect importing components and modules. Dynamic imports are counted separately. After a measured Vite build, the ring grows with estimated emitted JavaScript and changes colour at 20 KiB and 100 KiB; the inspector shows the numeric estimate and whether the package is on an initial entry path.

In DevTools Mode, a fixed overview stays readable at any map zoom. It shows measured re-renders separately from first mounts and browser DOM observations, lists active components, and lets the user focus their seals. The library section shows the sum of estimated JavaScript attributed to measured libraries, the portion on an initial entry path, and the largest packages. This is not the total application bundle size. **Measure Vite build** is available directly from this overview. Telemetry rings use screen-space sizes so they remain visible when zoomed out: gold for updates, green for mount/DOM observations, and red for very rapid profiler activity. A Hot diagnostic requires at least five measured updates with an average duration above 16 ms.

## Runtime connection

Start the local Grimoire server, switch on DevTools Mode, then open **Runtime & Libraries**. The panel has copyable commands for both modes.

### One-click project setup

For a Vite app with a standard `index.html` module entry or `src/main`/`src/index`, press **Add DevTools command**. Grimoire detects the React 17–19 root render or Vue 3 `createApp`, adds a small removable wrapper at that entry, writes `.grimoire/adapter.js`, `.grimoire/adapter.d.ts`, and `.grimoire/run.mjs`, and adds `dev:grimoire` to the target project's `package.json`. It does not install dependencies, start the target app, or run a build. From the target project run `npm run dev:grimoire` (or the equivalent command for its package manager). The runner preserves the existing Vite dev command and enables instrumentation through `VITE_GRIMOIRE=1`; a normal dev run and production build leave telemetry inactive.

Press **Remove DevTools setup** to remove the generated command and entry wrapper. Removal checks that the generated code and files have not been changed; it leaves unrelated edits alone. If the project uses a custom entry or another bundler, the installer explains why it cannot patch it, and the manual browser probe or adapter remains available. Only the project selected when the Grimoire CLI started is eligible for this action.

React installations made before component tracing was added show **Upgrade to component tracing**. Press it, restart `dev:grimoire`, and reload the target app. The upgrade adds a development-only Fiber observer before the React imports. It reads each committed component's place in the runtime parent tree, shallow prop identity changes, observable state changes, and the available subtree duration. This uses private React Fiber fields across React 17–19, so unsupported renderers or unusual component wrappers may be missed. A changed prop/state is evidence of a change, not proof that it alone caused a slowdown. Events with ambiguous component names remain in the recent-event list without being assigned to an architectural seal. React DevTools and React Scan informed this approach; it does not claim their full feature set.

- **Browser probe:** paste its script command in the target app's browser DevTools console. It observes DOM mutations and long tasks. A DOM mutation is not a component render, and this mode cannot measure component render duration. It uses React fiber or Vue component markers on DOM nodes only to associate observed changes when available. Stop with `window.__grimoireQuickProbe.stop()`.
- **Vue 3 dev adapter:** import `installGrimoireVue` from the local adapter URL in the app entry, call `installGrimoireVue(app)` before `app.mount(...)`. The global mixin records mount/update lifecycle intervals and development render-trigger keys. The intervals can include child work and are not isolated render-function CPU time. It is development instrumentation and adds overhead.
- **React 17–19 dev adapter:** manual `profileReact` wraps a root or individual element with the public React Profiler API and reports actual duration for the wrapped subtree. Automatic one-click setup uses the Fiber observer above to discover rendered components across the tree. For an exact public Profiler measurement of an individual component subtree, use `profileReactComponent(React, Component, import.meta.url)` in that component's own module; the file URL helps identify its seal when names repeat. It sends changed prop names and identity/value categories, never prop values.

Events are sent to the local server and streamed to the map. Component events are mapped only when a node ID or a unique component name and file match; ambiguous names are left unmatched. The local server listens on loopback and accepts telemetry only from loopback web origins.

When the React component wrapper reports an identity change for a prop named in a parent's static JSX finding, the inspector marks that finding as runtime observed and shows the latest Profiler subtree duration. This confirms the reference changed during a profiled subtree commit; it does not prove the prop alone caused a child render or that memoization would improve performance.

Runtime transport and the build button are currently available in the local CLI/web view. The VS Code webview continues to show the static graph and library seals.

## Build measurement

**Measure Vite build** runs only after a click. It invokes the target project's Vite build with an in-memory Rollup plugin. The report keeps Rollup's per-module `renderedLength` and estimates emitted JavaScript bytes by distributing each final chunk's size in proportion to those lengths. It also follows static chunk imports from entries to mark packages on the initial loading path. The emitted byte figure is an estimate, not exact package download size, compressed transfer, parse time, or runtime cost. The target project's configured Vite build output is written as usual. Other bundlers currently retain source-only estimates and show an explicit error if measurement is requested.

The adapter and browser probe never start a target dev server or build on their own.
