import path from 'node:path';
import { parse as parseJavaScript } from '@babel/parser';
import _traverse from '@babel/traverse';
import { parse as parseSfc } from 'vue/compiler-sfc';
import type { DiagnosticFinding } from '../types/index.js';
import type { CodeInventory, DetectedComponent, DetectedEntities, DetectedHook } from './detector.js';

const traverse: typeof _traverse = ((_traverse as any).default || _traverse) as any;

function keyName(node: any): string | undefined {
  return node?.name || node?.value || node?.content;
}

function option(object: any, key: string): any {
  return object?.properties?.find((property: any) => keyName(property.key) === key);
}

function readProps(node: any, props: Set<string>): void {
  if (node?.type === 'ArrayExpression') {
    for (const value of node.elements) if (value?.value) props.add(String(value.value));
  } else if (node?.type === 'ObjectExpression') {
    for (const value of node.properties) {
      const name = keyName(value.key);
      if (name) props.add(name);
    }
  }
}

export function detectVueFileEntities(fileContent: string, filePath: string): DetectedEntities {
  const imports: DetectedEntities['imports'] = [];
  const hooksUsed: DetectedHook[] = [];
  const stateVariables: DetectedComponent['internalCircuit']['stateVariables'] = [];
  const effects: DetectedComponent['internalCircuit']['effects'] = [];
  const handlers: DetectedComponent['internalCircuit']['handlers'] = [];
  const antiPatterns: DetectedEntities['antiPatterns'] = [];
  const findings: DiagnosticFinding[] = [];
  const props = new Set<string>();
  const children = new Set<string>();
  const inventory: CodeInventory = {
    maps: [], filters: [], reduces: [], forEaches: [], loops: [],
    arrays: 0, sets: 0, recordMaps: 0, asyncCount: 0, isClass: false,
  };
  let componentName = path.basename(filePath, '.vue');
  const parsed = parseSfc(fileContent, { filename: filePath });
  for (const error of parsed.errors) {
    antiPatterns.push({ type: 'VUE_SFC_PARSE', message: String(error) });
  }
  const descriptor = parsed.descriptor;

  const visitTemplate = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 1) {
      const tag: string = node.tag || '';
      const isComponent = /^[A-Z]/.test(tag) || tag.includes('-');
      if (isComponent && tag !== componentName) children.add(tag);
      const directives = (node.props || []).filter((prop: any) => prop.type === 7);
      const repeat = directives.find((prop: any) => prop.name === 'for');
      const key = directives.find((prop: any) => prop.name === 'bind' && prop.arg?.content === 'key');
      if (repeat && isComponent && !key) {
        const line = node.loc.start.line;
        findings.push({
          id: filePath + ':' + line + ':vue-list-key', framework: 'vue',
          rule: 'vue-list-key', severity: 'medium', confidence: 'high',
          message: 'Repeated component <' + tag + '> has no stable :key.',
          file: filePath, line, childName: tag, evidence: 'static',
        });
      }
      if (isComponent) for (const directive of directives) {
        if (directive.name !== 'bind' || !directive.arg?.content || !directive.exp?.content) continue;
        const expression = String(directive.exp.content).trim();
        if (!/^(\{[\s\S]*\}|\[[\s\S]*\])$/.test(expression)) continue;
        const line = directive.loc.start.line;
        const propName = directive.arg.content;
        findings.push({
          id: filePath + ':' + line + ':vue-prop-identity:' + propName,
          framework: 'vue', rule: 'vue-prop-identity', severity: 'low', confidence: 'medium',
          message: 'The ' + propName + ' prop creates a fresh object or array in the template. Measure whether <' + tag + '> updates unnecessarily.',
          file: filePath, line, propName, childName: tag, evidence: 'static',
        });
      }
    }
    for (const child of node.children || []) visitTemplate(child);
    for (const branch of node.branches || []) visitTemplate(branch);
  };
  visitTemplate(descriptor.template?.ast);

  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (!block) continue;
    if (block.src) {
      antiPatterns.push({ type: 'VUE_EXTERNAL_SCRIPT', message: 'External SFC script requires separate analysis.' });
      continue;
    }
    const lineOffset = block.loc.start.line - 1;
    try {
      const ast = parseJavaScript(block.content, {
        sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy'],
      });
      traverse(ast, {
        ImportDeclaration(p: any) {
          imports.push({
            source: p.node.source.value,
            specifiers: p.node.specifiers.map((s: any) => ({
              local: s.local.name, imported: keyName(s.imported) || s.local.name,
            })),
            line: lineOffset + (p.node.loc?.start.line || 1),
          });
        },
        ExportAllDeclaration(p: any) {
          if (p.node.source?.value) imports.push({ source: p.node.source.value, specifiers: [], line: lineOffset + (p.node.loc?.start.line || 1) });
        },
        ExportNamedDeclaration(p: any) {
          if (p.node.source?.value) imports.push({ source: p.node.source.value, specifiers: [], line: lineOffset + (p.node.loc?.start.line || 1) });
        },
        CallExpression(p: any) {
          if (p.node.callee?.type === 'Import' && p.node.arguments[0]?.type === 'StringLiteral') {
            imports.push({ source: p.node.arguments[0].value, specifiers: [], line: lineOffset + (p.node.loc?.start.line || 1), dynamic: true });
          } else if (p.node.callee?.name === 'require' && p.node.arguments[0]?.type === 'StringLiteral') {
            imports.push({ source: p.node.arguments[0].value, specifiers: [], line: lineOffset + (p.node.loc?.start.line || 1) });
          }
          const callName = keyName(p.node.callee) || '';
          const line = lineOffset + (p.node.loc?.start.line || 1);
          if (callName === 'defineProps') {
            readProps(p.node.arguments[0], props);
            const type = p.node.typeParameters?.params?.[0] || p.node.typeArguments?.params?.[0];
            if (type?.type === 'TSTypeLiteral') for (const member of type.members || []) {
              const name = keyName(member.key);
              if (name) props.add(name);
            }
          }
          if (callName === 'defineOptions') {
            const value = option(p.node.arguments[0], 'name')?.value?.value;
            if (value) componentName = String(value);
          }
          if (['ref', 'reactive', 'shallowRef', 'computed'].includes(callName)) {
            const declarator = p.findParent((parent: any) => parent.isVariableDeclarator());
            const variable = declarator?.node.id?.name;
            if (variable && callName !== 'computed') stateVariables.push({ name: variable, setter: variable, line });
            hooksUsed.push({ name: callName, detail: variable, line });
          } else if (['watch', 'watchEffect', 'onMounted', 'onUpdated', 'onUnmounted'].includes(callName)) {
            effects.push({ line, deps: [callName] });
            hooksUsed.push({ name: callName, line });
          } else if (callName && /^use[A-Z]/.test(callName)) {
            hooksUsed.push({ name: callName, line });
          }
          if (callName === 'watch' && option(p.node.arguments[2], 'deep')?.value?.value === true) {
            findings.push({
              id: filePath + ':' + line + ':vue-deep-watch', framework: 'vue',
              rule: 'vue-deep-watch', severity: 'medium', confidence: 'high',
              message: 'Deep watch traverses nested reactive values; measure its cost during updates.',
              file: filePath, line, evidence: 'static',
            });
          }
        },
        ExportDefaultDeclaration(p: any) {
          const value = p.node.declaration;
          const options = value.type === 'CallExpression' ? value.arguments[0] : value;
          if (options?.type !== 'ObjectExpression') return;
          const name = option(options, 'name')?.value?.value;
          if (name) componentName = String(name);
          readProps(option(options, 'props')?.value, props);
          const computed = option(options, 'computed')?.value;
          if (computed?.type === 'ObjectExpression') for (const entry of computed.properties) {
            const key = keyName(entry.key);
            if (key) hooksUsed.push({ name: 'computed', detail: key, line: lineOffset + (entry.loc?.start.line || 1) });
          }
          const methods = option(options, 'methods')?.value;
          if (methods?.type === 'ObjectExpression') for (const entry of methods.properties) {
            const key = keyName(entry.key);
            if (key) handlers.push({ name: key, line: lineOffset + (entry.loc?.start.line || 1), loc: entry.loc ? entry.loc.end.line - entry.loc.start.line + 1 : 1 });
          }
          const data = option(options, 'data')?.value;
          const returned = data?.body?.body?.find((statement: any) => statement.type === 'ReturnStatement')?.argument;
          if (returned?.type === 'ObjectExpression') for (const entry of returned.properties) {
            const key = keyName(entry.key);
            if (key) stateVariables.push({ name: key, setter: key, line: lineOffset + (entry.loc?.start.line || 1) });
          }
          const watch = option(options, 'watch')?.value;
          if (watch?.type !== 'ObjectExpression') return;
          for (const entry of watch.properties) {
            const line = lineOffset + (entry.loc?.start.line || 1);
            effects.push({ line, deps: [keyName(entry.key) || 'watch'] });
            if (option(entry.value, 'deep')?.value?.value === true) {
              findings.push({
                id: filePath + ':' + line + ':vue-deep-watch', framework: 'vue',
                rule: 'vue-deep-watch', severity: 'medium', confidence: 'high',
                message: 'Deep watcher may traverse a large reactive object on updates.',
                file: filePath, line, evidence: 'static',
              });
            }
          }
        },
        FunctionDeclaration(p: any) {
          const name = p.node.id?.name;
          if (name && !/^use[A-Z]/.test(name)) {
            handlers.push({
              name, loc: p.node.loc ? p.node.loc.end.line - p.node.loc.start.line + 1 : 1,
              line: lineOffset + (p.node.loc?.start.line || 1),
            });
          }
        },
      });
    } catch (error) {
      antiPatterns.push({ type: 'VUE_SCRIPT_PARSE', message: String(error), line: block.loc.start.line });
    }
  }

  const loc = fileContent.split('\n').length;
  const component: DetectedComponent = {
    name: componentName, kind: 'vue-sfc', startLine: 1, endLine: loc, loc,
    props: [...props], hooksUsed, renderedChildren: [...children], reduxDispatches: [],
    internalCircuit: { stateVariables, effects, handlers }, codeInventory: inventory, findings,
  };
  return {
    imports, components: [component], hooksDefined: [],
    reduxEntities: { reducers: [], actions: [], selectors: [], sagas: [] },
    exports: ['default'], antiPatterns, hasJsx: false, isUtility: false,
  };
}
