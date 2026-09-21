import _traverse from '@babel/traverse';

const traverse: typeof _traverse = ((_traverse as any).default || _traverse) as any;

export interface CodeInventory {
  maps: number[];
  filters: number[];
  reduces: number[];
  forEaches: number[];
  loops: number[];
  arrays: number;
  sets: number;
  recordMaps: number;
  asyncCount: number;
  isClass: boolean;
}

export interface AntiPattern {
  type: string;
  message: string;
  line?: number;
}

export interface DetectedHook {
  name: string;
  detail?: string;
  line?: number;
  loc?: number;
}

export interface DetectedComponent {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  loc: number;
  props: string[];
  hooksUsed: DetectedHook[];
  renderedChildren: string[];
  reduxDispatches: string[];
  internalCircuit: {
    stateVariables: Array<{ name: string; setter: string; line?: number }>;
    effects: Array<{ line?: number; deps: string[] }>;
    handlers: Array<{ name: string; loc: number; line?: number }>;
  };
  codeInventory: CodeInventory;
}

export interface DetectedEntities {
  imports: Array<{
    source: string;
    specifiers: Array<{
      local: string;
      imported?: string;
      isDefault?: boolean;
      isNamespace?: boolean;
    }>;
    line?: number;
  }>;
  components: DetectedComponent[];
  hooksDefined: DetectedHook[];
  reduxEntities: {
    reducers: string[];
    actions: string[];
    selectors: string[];
    sagas: string[];
  };
  exports: string[];
  antiPatterns: AntiPattern[];
  hasJsx: boolean;
  isUtility: boolean;
}

export function detectFileEntities(ast: any, _code: string, _filePath: string): DetectedEntities {
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
  const antiPatterns: AntiPattern[] = [];

  if (!ast) {
    return {
      imports,
      components,
      hooksDefined,
      reduxEntities,
      exports,
      antiPatterns,
      hasJsx: false,
      isUtility: true,
    };
  }

  let fileHasJsx = false;

  // 1. Collect Imports & Exports & Direct DOM Anti-patterns
  traverse(ast, {
    ImportDeclaration(path: any) {
      const source = path.node.source.value;
      const specifiers = path.node.specifiers.map((s: any) => {
        if (s.type === 'ImportDefaultSpecifier') {
          return { local: s.local.name, isDefault: true };
        }
        if (s.type === 'ImportNamespaceSpecifier') {
          return { local: s.local.name, isNamespace: true };
        }
        return {
          imported: s.imported ? s.imported.name : s.local.name,
          local: s.local.name,
          isDefault: false,
        };
      });
      imports.push({ source, specifiers, line: path.node.loc?.start?.line });
    },

    ExportNamedDeclaration(path: any) {
      if (path.node.declaration) {
        if (path.node.declaration.declarations) {
          path.node.declaration.declarations.forEach((d: any) => {
            if (d.id?.name) exports.push(d.id.name);
          });
        } else if (path.node.declaration.id?.name) {
          exports.push(path.node.declaration.id.name);
        }
      } else if (path.node.specifiers) {
        path.node.specifiers.forEach((s: any) => {
          if (s.exported?.name) exports.push(s.exported.name);
        });
      }
    },

    ExportDefaultDeclaration(path: any) {
      if (path.node.declaration?.id?.name) {
        exports.push(path.node.declaration.id.name);
      } else {
        exports.push('default');
      }
    },

    JSXElement() {
      fileHasJsx = true;
    },
    JSXFragment() {
      fileHasJsx = true;
    },

    MemberExpression(path: any) {
      const obj = path.node.object?.name;
      const prop = path.node.property?.name;
      if (
        obj === 'document' &&
        ['getElementById', 'querySelector', 'querySelectorAll', 'getElementsByClassName'].includes(
          prop
        )
      ) {
        antiPatterns.push({
          type: 'DIRECT_DOM_MUTATION',
          message: `Direct DOM access via document.${prop}() violates React declarative model (Forbidden Magic)`,
          line: path.node.loc?.start?.line,
        });
      }
      if (obj === 'window' && prop === 'location' && path.parent?.type === 'AssignmentExpression') {
        antiPatterns.push({
          type: 'WINDOW_LOCATION_MUTATION',
          message: 'Direct window.location mutation bypasses React Router flow',
          line: path.node.loc?.start?.line,
        });
      }
    },
  });

  // 2. Detect Components & Hooks within their scopes
  traverse(ast, {
    FunctionDeclaration(path: any) {
      inspectFunction(path.node, path.node.id?.name, path, false);
    },
    VariableDeclarator(path: any) {
      const name = path.node.id?.name;
      const init = path.node.init;
      if (!name || !init) return;

      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        inspectFunction(init, name, path, false);
      } else if (init.type === 'CallExpression') {
        const callee = init.callee?.name || init.callee?.property?.name;
        if (['memo', 'forwardRef'].includes(callee)) {
          const fnArg = init.arguments[0];
          if (
            fnArg &&
            (fnArg.type === 'ArrowFunctionExpression' || fnArg.type === 'FunctionExpression')
          ) {
            inspectFunction(fnArg, name, path, true, callee);
          }
        }
      }
    },
    ClassDeclaration(path: any) {
      const name = path.node.id?.name;
      const superClass = path.node.superClass?.name || path.node.superClass?.property?.name;
      if (superClass === 'Component' || superClass === 'PureComponent') {
        components.push(analyzeClassComponent(path.node, name));
      }
    },
  });

  function inspectFunction(
    fnNode: any,
    name: string | undefined,
    path: any,
    isWrapped = false,
    wrapperType = ''
  ): void {
    if (!name) return;

    // Check if it's a custom hook
    if (/^use[A-Z0-9]/.test(name)) {
      hooksDefined.push({
        name,
        line: fnNode.loc?.start?.line,
        loc: fnNode.loc ? fnNode.loc.end.line - fnNode.loc.start.line + 1 : 0,
      });
      return;
    }

    // Is it a Component?
    const isCapitalized = /^[A-Z]/.test(name);
    let returnsJsx = false;

    path.traverse({
      ReturnStatement(rPath: any) {
        if (rPath.node.argument) {
          const arg = rPath.node.argument;
          if (arg.type === 'JSXElement' || arg.type === 'JSXFragment') {
            returnsJsx = true;
          } else if (
            arg.type === 'ParenthesizedExpression' &&
            (arg.expression.type === 'JSXElement' || arg.expression.type === 'JSXFragment')
          ) {
            returnsJsx = true;
          }
        }
      },
      JSXElement() {
        if (fnNode.type === 'ArrowFunctionExpression' && fnNode.body.type === 'JSXElement') {
          returnsJsx = true;
        }
      },
    });

    if (isCapitalized || returnsJsx) {
      const compInfo = analyzeFunctionComponent(fnNode, name, path, isWrapped, wrapperType);
      components.push(compInfo);
    } else {
      // Check for Redux saga or action creator
      if (fnNode.generator) {
        reduxEntities.sagas.push(name);
      } else if (/AC$|Action$|Request$/.test(name)) {
        reduxEntities.actions.push(name);
      } else if (/^get[A-Z]|Selector$/.test(name)) {
        reduxEntities.selectors.push(name);
      }
    }
  }

  function analyzeFunctionComponent(
    fnNode: any,
    name: string,
    path: any,
    isWrapped: boolean,
    wrapperType: string
  ): DetectedComponent {
    const hooksUsed: DetectedHook[] = [];
    const renderedChildren = new Set<string>();
    const props: string[] = [];
    const reduxDispatches: string[] = [];
    const stateVariables: Array<{ name: string; setter: string; line?: number }> = [];
    const effectList: Array<{ line?: number; deps: string[] }> = [];
    const internalHandlers: Array<{ name: string; loc: number; line?: number }> = [];

    // Props extraction
    if (fnNode.params && fnNode.params.length > 0) {
      const firstParam = fnNode.params[0];
      if (firstParam.type === 'ObjectPattern') {
        firstParam.properties.forEach((prop: any) => {
          if (prop.key?.name) props.push(prop.key.name);
        });
      } else if (firstParam.type === 'Identifier') {
        props.push(firstParam.name);
      }
    }

    // Traverse component body
    const codeInventory: CodeInventory = {
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

    path.traverse({
      ArrayExpression() {
        codeInventory.arrays++;
      },

      NewExpression(nPath: any) {
        const calleeName = nPath.node.callee?.name;
        if (calleeName === 'Set') codeInventory.sets++;
        if (calleeName === 'Map') codeInventory.recordMaps++;
      },

      ForStatement(lPath: any) {
        const lLoc = lPath.node.loc ? lPath.node.loc.end.line - lPath.node.loc.start.line + 1 : 1;
        codeInventory.loops.push(lLoc);
      },
      WhileStatement(lPath: any) {
        const lLoc = lPath.node.loc ? lPath.node.loc.end.line - lPath.node.loc.start.line + 1 : 1;
        codeInventory.loops.push(lLoc);
      },
      ForOfStatement(lPath: any) {
        const lLoc = lPath.node.loc ? lPath.node.loc.end.line - lPath.node.loc.start.line + 1 : 1;
        codeInventory.loops.push(lLoc);
      },
      ForInStatement(lPath: any) {
        const lLoc = lPath.node.loc ? lPath.node.loc.end.line - lPath.node.loc.start.line + 1 : 1;
        codeInventory.loops.push(lLoc);
      },

      AwaitExpression() {
        codeInventory.asyncCount++;
      },

      VariableDeclarator(vPath: any) {
        const id = vPath.node.id;
        const init = vPath.node.init;

        // Extract State Variable names: const [foo, setFoo] = useState(...)
        if (init && init.type === 'CallExpression') {
          const callee = init.callee?.name || init.callee?.property?.name;
          if (
            ['useState', 'useReducer'].includes(callee) &&
            id.type === 'ArrayPattern' &&
            id.elements[0]?.name
          ) {
            stateVariables.push({
              name: id.elements[0].name,
              setter: id.elements[1]?.name || '',
              line: vPath.node.loc?.start?.line,
            });
          }
        }

        // Extract internal helper functions: const handleClick = () => ...
        if (
          id.type === 'Identifier' &&
          init &&
          (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
        ) {
          const fnName = id.name;
          if (!/^use[A-Z]/.test(fnName) && !/^[A-Z]/.test(fnName)) {
            const loc = init.loc ? init.loc.end.line - init.loc.start.line + 1 : 1;
            internalHandlers.push({
              name: fnName,
              loc,
              line: vPath.node.loc?.start?.line,
            });
          }
        }
      },

      FunctionDeclaration(fPath: any) {
        if (fPath.parentPath === path || fPath.parentPath?.parentPath === path) {
          const fnName = fPath.node.id?.name;
          if (fnName && !/^use[A-Z]/.test(fnName) && !/^[A-Z]/.test(fnName)) {
            const loc = fPath.node.loc
              ? fPath.node.loc.end.line - fPath.node.loc.start.line + 1
              : 1;
            internalHandlers.push({
              name: fnName,
              loc,
              line: fPath.node.loc?.start?.line,
            });
          }
        }
      },

      CallExpression(cPath: any) {
        const callee = cPath.node.callee;
        let callName = '';
        let methodName = '';

        if (callee.type === 'Identifier') {
          callName = callee.name;
        } else if (callee.type === 'MemberExpression') {
          callName = callee.property?.name || '';
          methodName = callee.property?.name || '';
        }

        // Array operations: .map, .filter, .reduce, .forEach
        if (methodName) {
          const arg0 = cPath.node.arguments[0];
          const cbLoc = arg0?.loc ? arg0.loc.end.line - arg0.loc.start.line + 1 : 1;
          if (methodName === 'map') codeInventory.maps.push(cbLoc);
          else if (methodName === 'filter') codeInventory.filters.push(cbLoc);
          else if (methodName === 'reduce') codeInventory.reduces.push(cbLoc);
          else if (methodName === 'forEach') codeInventory.forEaches.push(cbLoc);
        }

        // Hook detection
        if (/^use[A-Z]/.test(callName)) {
          let detail = '';
          if (callName === 'useSelector' && cPath.node.arguments[0]?.name) {
            detail = cPath.node.arguments[0].name;
          } else if (callName === 'useContext' && cPath.node.arguments[0]?.name) {
            detail = cPath.node.arguments[0].name;
          }

          // Extract effect dependencies
          if (['useEffect', 'useLayoutEffect'].includes(callName)) {
            const deps: string[] = [];
            const depsArg = cPath.node.arguments[1];
            if (depsArg && depsArg.type === 'ArrayExpression') {
              depsArg.elements.forEach((el: any) => {
                if (el?.name) deps.push(el.name);
                else if (el?.property?.name) deps.push(el.property.name);
              });
            }
            effectList.push({ deps, line: cPath.node.loc?.start?.line });
            detail = deps.length > 0 ? `[${deps.join(', ')}]` : '[]';
          }

          hooksUsed.push({
            name: callName,
            detail,
            line: cPath.node.loc?.start?.line,
          });
        }

        // Redux dispatch detection
        if (callName === 'dispatch' || callName === 'useDispatch') {
          const arg = cPath.node.arguments[0];
          if (arg && arg.type === 'CallExpression') {
            const actionName = arg.callee?.name;
            if (actionName) reduxDispatches.push(actionName);
          }
        }
      },

      JSXOpeningElement(jPath: any) {
        const elName = jPath.node.name;
        let tag = '';
        if (elName.type === 'JSXIdentifier') {
          tag = elName.name;
        } else if (elName.type === 'JSXMemberExpression') {
          tag = `${elName.object?.name}.${elName.property?.name}`;
        }
        if (/^[A-Z]/.test(tag) && tag !== name) {
          renderedChildren.add(tag);
        }
      },
    });

    const startLine = fnNode.loc?.start?.line || 1;
    const endLine = fnNode.loc?.end?.line || startLine;

    const internalCircuit = {
      stateVariables: stateVariables.slice(0, 12),
      effects: effectList.slice(0, 8),
      handlers: internalHandlers.slice(0, 8),
    };

    return {
      name,
      kind: isWrapped
        ? wrapperType
        : fnNode.type === 'ArrowFunctionExpression'
          ? 'arrow'
          : 'function',
      startLine,
      endLine,
      loc: endLine - startLine + 1,
      props,
      hooksUsed,
      renderedChildren: Array.from(renderedChildren),
      reduxDispatches,
      internalCircuit,
      codeInventory,
    };
  }

  function analyzeClassComponent(classNode: any, name: string | undefined): DetectedComponent {
    const renderedChildren = new Set<string>();
    const startLine = classNode.loc?.start?.line || 1;
    const endLine = classNode.loc?.end?.line || startLine;

    const codeInventory: CodeInventory = {
      maps: [],
      filters: [],
      reduces: [],
      forEaches: [],
      loops: [],
      arrays: 0,
      sets: 0,
      recordMaps: 0,
      asyncCount: 0,
      isClass: true,
    };

    return {
      name: name || 'AnonymousClassComponent',
      kind: 'class',
      startLine,
      endLine,
      loc: endLine - startLine + 1,
      props: [],
      hooksUsed: [],
      renderedChildren: Array.from(renderedChildren),
      reduxDispatches: [],
      internalCircuit: { stateVariables: [], effects: [], handlers: [] },
      codeInventory,
    };
  }

  return {
    imports,
    components,
    hooksDefined,
    reduxEntities,
    exports,
    antiPatterns,
    hasJsx: fileHasJsx,
    isUtility: !fileHasJsx && components.length === 0,
  };
}
