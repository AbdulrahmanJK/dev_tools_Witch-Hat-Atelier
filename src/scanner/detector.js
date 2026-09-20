import _traverse from '@babel/traverse';
const traverse = _traverse.default || _traverse;

export function detectFileEntities(ast, code, filePath) {
  const imports = [];
  const components = [];
  const hooksDefined = [];
  const reduxEntities = {
    reducers: [],
    actions: [],
    selectors: [],
    sagas: [],
  };
  const exports = [];
  const antiPatterns = [];

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
    ImportDeclaration(path) {
      const source = path.node.source.value;
      const specifiers = path.node.specifiers.map((s) => {
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

    ExportNamedDeclaration(path) {
      if (path.node.declaration) {
        if (path.node.declaration.declarations) {
          path.node.declaration.declarations.forEach((d) => {
            if (d.id?.name) exports.push(d.id.name);
          });
        } else if (path.node.declaration.id?.name) {
          exports.push(path.node.declaration.id.name);
        }
      } else if (path.node.specifiers) {
        path.node.specifiers.forEach((s) => {
          if (s.exported?.name) exports.push(s.exported.name);
        });
      }
    },

    ExportDefaultDeclaration(path) {
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

    MemberExpression(path) {
      const obj = path.node.object?.name;
      const prop = path.node.property?.name;
      if (obj === 'document' && ['getElementById', 'querySelector', 'querySelectorAll', 'getElementsByClassName'].includes(prop)) {
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
    FunctionDeclaration(path) {
      inspectFunction(path.node, path.node.id?.name, path, false);
    },
    VariableDeclarator(path) {
      const name = path.node.id?.name;
      const init = path.node.init;
      if (!name || !init) return;

      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        inspectFunction(init, name, path, false);
      } else if (init.type === 'CallExpression') {
        const callee = init.callee?.name || init.callee?.property?.name;
        if (['memo', 'forwardRef'].includes(callee)) {
          const fnArg = init.arguments[0];
          if (fnArg && (fnArg.type === 'ArrowFunctionExpression' || fnArg.type === 'FunctionExpression')) {
            inspectFunction(fnArg, name, path, true, callee);
          }
        }
      }
    },
    ClassDeclaration(path) {
      const name = path.node.id?.name;
      const superClass = path.node.superClass?.name || path.node.superClass?.property?.name;
      if (superClass === 'Component' || superClass === 'PureComponent') {
        components.push(analyzeClassComponent(path.node, name));
      }
    },
  });

  function inspectFunction(fnNode, name, path, isWrapped = false, wrapperType = '') {
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
    // Convention: Component names start with Capital Letter OR function returns JSX
    const isCapitalized = /^[A-Z]/.test(name);
    let returnsJsx = false;

    path.traverse({
      ReturnStatement(rPath) {
        if (rPath.node.argument) {
          const arg = rPath.node.argument;
          if (arg.type === 'JSXElement' || arg.type === 'JSXFragment') {
            returnsJsx = true;
          } else if (arg.type === 'ParenthesizedExpression' && (arg.expression.type === 'JSXElement' || arg.expression.type === 'JSXFragment')) {
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

  function analyzeFunctionComponent(fnNode, name, path, isWrapped, wrapperType) {
    const hooksUsed = [];
    const renderedChildren = new Set();
    const props = [];
    const reduxDispatches = [];

    // Props extraction
    if (fnNode.params && fnNode.params.length > 0) {
      const firstParam = fnNode.params[0];
      if (firstParam.type === 'ObjectPattern') {
        firstParam.properties.forEach((prop) => {
          if (prop.key?.name) props.push(prop.key.name);
        });
      } else if (firstParam.type === 'Identifier') {
        props.push(firstParam.name);
      }
    }

    // Traverse component body for hooks, JSX children, and Redux dispatches
    path.traverse({
      CallExpression(cPath) {
        const callee = cPath.node.callee;
        let callName = '';
        if (callee.type === 'Identifier') {
          callName = callee.name;
        } else if (callee.type === 'MemberExpression') {
          callName = callee.property?.name || '';
        }

        // Hook detection
        if (/^use[A-Z]/.test(callName)) {
          let detail = '';
          if (callName === 'useSelector' && cPath.node.arguments[0]?.name) {
            detail = cPath.node.arguments[0].name;
          } else if (callName === 'useContext' && cPath.node.arguments[0]?.name) {
            detail = cPath.node.arguments[0].name;
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

      JSXOpeningElement(jPath) {
        const elName = jPath.node.name;
        let tag = '';
        if (elName.type === 'JSXIdentifier') {
          tag = elName.name;
        } else if (elName.type === 'JSXMemberExpression') {
          tag = `${elName.object?.name}.${elName.property?.name}`;
        }
        // If it starts with Capital Letter, it's a subcomponent
        if (/^[A-Z]/.test(tag) && tag !== name) {
          renderedChildren.add(tag);
        }
      },
    });

    const startLine = fnNode.loc?.start?.line || 1;
    const endLine = fnNode.loc?.end?.line || startLine;

    return {
      name,
      kind: isWrapped ? wrapperType : fnNode.type === 'ArrowFunctionExpression' ? 'arrow' : 'function',
      startLine,
      endLine,
      loc: endLine - startLine + 1,
      props,
      hooksUsed,
      renderedChildren: Array.from(renderedChildren),
      reduxDispatches,
    };
  }

  function analyzeClassComponent(classNode, name) {
    const renderedChildren = new Set();
    const startLine = classNode.loc?.start?.line || 1;
    const endLine = classNode.loc?.end?.line || startLine;

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
