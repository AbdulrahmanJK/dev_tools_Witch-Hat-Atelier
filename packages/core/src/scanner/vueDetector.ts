import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import type { DetectedComponent, DetectedEntities, DetectedHook } from './detector.js';

const traverse: typeof _traverse = ((_traverse as any).default || _traverse) as any;

export function detectVueFileEntities(fileContent: string, _filePath: string): DetectedEntities {
  const imports: DetectedEntities['imports'] = [];
  const components: DetectedComponent[] = [];
  const hooksDefined: DetectedHook[] = [];
  const reduxEntities: DetectedEntities['reduxEntities'] = {
    reducers: [],
    actions: [],
    selectors: [],
    sagas: [],
  };
  const exports: string[] = [];
  const antiPatterns: DetectedEntities['antiPatterns'] = [];

  // Extract <template> and <script> blocks
  const templateMatch = fileContent.match(/<template>([\s\S]*?)<\/template>/i);
  const scriptMatch = fileContent.match(
    /<script(?:\s+setup)?(?:\s+lang=["'](?:ts|js)["'])?>([\s\S]*?)<\/script>/i
  );

  const renderedChildren = new Set<string>();
  if (templateMatch && templateMatch[1]) {
    const templateContent = templateMatch[1];
    // Find PascalCase components: <MyComponent ... />
    const componentRegex = /<([A-Z][a-zA-Z0-9]+)[\s\/>]/g;
    let match: RegExpExecArray | null;
    while ((match = componentRegex.exec(templateContent)) !== null) {
      if (match[1]) renderedChildren.add(match[1]);
    }
  }

  const scriptCode = scriptMatch && scriptMatch[1] ? scriptMatch[1] : '';
  const totalLoc = fileContent.split('\n').length;

  if (!scriptCode) {
    // Pure template component
    components.push({
      name: 'VueComponent',
      kind: 'vue-sfc',
      startLine: 1,
      endLine: totalLoc,
      loc: totalLoc,
      props: [],
      hooksUsed: [],
      renderedChildren: Array.from(renderedChildren),
      reduxDispatches: [],
      internalCircuit: { stateVariables: [], effects: [], handlers: [] },
      codeInventory: {
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
      },
    });

    return {
      imports,
      components,
      hooksDefined,
      reduxEntities,
      exports,
      antiPatterns,
      hasJsx: true,
      isUtility: false,
    };
  }

  try {
    const ast = parse(scriptCode, {
      sourceType: 'module',
      plugins: ['typescript', 'topLevelAwait', 'decorators-legacy'],
    });

    const hooksUsed: DetectedHook[] = [];
    const stateVariables: Array<{ name: string; setter: string; line?: number }> = [];
    const effectList: Array<{ line?: number; deps: string[] }> = [];
    const internalHandlers: Array<{ name: string; loc: number; line?: number }> = [];

    traverse(ast, {
      ImportDeclaration(path: any) {
        const source = path.node.source.value;
        const specifiers = path.node.specifiers.map((s: any) => ({
          local: s.local.name,
          imported: s.imported ? s.imported.name : s.local.name,
        }));
        imports.push({ source, specifiers, line: path.node.loc?.start?.line });
      },

      CallExpression(path: any) {
        const callee = path.node.callee?.name;
        if (!callee) return;

        // Vue 3 reactivity & lifecycle hooks
        if (['ref', 'reactive', 'shallowRef'].includes(callee)) {
          const parentDeclarator = path.findParent((p: any) => p.isVariableDeclarator());
          const varName = parentDeclarator?.node?.id?.name || 'state';
          stateVariables.push({ name: varName, setter: `set_${varName}` });
          hooksUsed.push({ name: 'useState', detail: varName });
        } else if (['computed'].includes(callee)) {
          hooksUsed.push({ name: 'useMemo', detail: 'computed' });
        } else if (
          ['watch', 'watchEffect', 'onMounted', 'onUpdated', 'onUnmounted'].includes(callee)
        ) {
          effectList.push({ deps: [callee], line: path.node.loc?.start?.line });
          hooksUsed.push({ name: 'useEffect', detail: callee });
        } else if (/^use[A-Z]/.test(callee)) {
          hooksUsed.push({ name: callee });
        }
      },

      FunctionDeclaration(path: any) {
        const fnName = path.node.id?.name;
        if (fnName && !fnName.startsWith('use')) {
          const loc = path.node.loc ? path.node.loc.end.line - path.node.loc.start.line + 1 : 1;
          internalHandlers.push({ name: fnName, loc });
        }
      },
    });

    components.push({
      name: 'VueComponent',
      kind: 'vue-sfc',
      startLine: 1,
      endLine: totalLoc,
      loc: totalLoc,
      props: [],
      hooksUsed,
      renderedChildren: Array.from(renderedChildren),
      reduxDispatches: [],
      internalCircuit: {
        stateVariables,
        effects: effectList,
        handlers: internalHandlers,
      },
      codeInventory: {
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
      },
    });
  } catch {
    // Fallback if script fails parsing
  }

  return {
    imports,
    components,
    hooksDefined,
    reduxEntities,
    exports,
    antiPatterns,
    hasJsx: true,
    isUtility: false,
  };
}
