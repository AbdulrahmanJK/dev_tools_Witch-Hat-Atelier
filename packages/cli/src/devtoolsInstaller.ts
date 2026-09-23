import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { devAdapterScript, reactFiberHookScript } from './runtimeScripts.js';

const directoryName = '.grimoire';
const stateName = 'devtools-state.json';
const scriptName = 'dev:grimoire';
const markerStart = '/* grimoire:runtime:start */';
const markerEnd = '/* grimoire:runtime:end */';

interface InstallState {
  entry: string;
  originalExpression: string;
  installedExpression: string;
  importLine: string;
  adapter: string;
  adapterHash: string;
  declarationHash: string;
  runnerHash: string;
  fiberHash?: string;
  fiberImportLine?: string;
  script: string;
  framework: 'react' | 'vue';
  port: number;
}

export interface DevtoolsInstallStatus {
  installed: boolean;
  framework?: 'react' | 'vue';
  entry?: string;
  command?: string;
  port?: number;
  upgradeAvailable?: boolean;
  componentTracing?: boolean;
}

function readState(targetDir: string): InstallState | null {
  const file = path.join(targetDir, directoryName, stateName);
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlinked Grimoire state is not supported.');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as InstallState;
}

function hash(content: string): string { return createHash('sha256').update(content).digest('hex'); }

function assertRegularFileWithin(targetDir: string, file: string): void {
  const relative = path.relative(targetDir, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Entry must be inside the selected project.');
  if (!fs.statSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlinked or non-file entries are not supported.');
  if (fs.realpathSync(file) !== file) throw new Error('The entry resolves outside its expected path.');
}

function findEntry(targetDir: string): string {
  const html = path.join(targetDir, 'index.html');
  if (fs.existsSync(html) && fs.statSync(html).isFile()) {
    const content = fs.readFileSync(html, 'utf8');
    const match = content.match(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/i)
      || content.match(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*\btype=["']module["']/i);
    if (match) {
      const pathname = match[1]!.split(/[?#]/)[0]!;
      const candidate = path.resolve(targetDir, pathname.replace(/^\/+/, ''));
      if (fs.existsSync(candidate)) { assertRegularFileWithin(targetDir, candidate); return candidate; }
    }
  }
  for (const name of ['main', 'index']) for (const extension of ['tsx', 'jsx', 'ts', 'js']) {
    const candidate = path.join(targetDir, 'src', `${name}.${extension}`);
    if (fs.existsSync(candidate)) { assertRegularFileWithin(targetDir, candidate); return candidate; }
  }
  throw new Error('Could not locate a Vite app entry (index.html script or src/main/index).');
}

function isCallNamed(node: ts.Node, name: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const expression = node.expression;
  return (ts.isIdentifier(expression) && expression.text === name)
    || (ts.isPropertyAccessExpression(expression) && expression.name.text === name);
}

function findTarget(source: string, file: string, framework: 'react' | 'vue'): { start: number; end: number; reactName?: string } {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  if ((ast as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
    throw new Error('The entry has syntax errors; automatic instrumentation was skipped.');
  }
  let reactName: string | undefined;
  const roots = new Set<string>();
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.getText(ast).replace(/["']/g, '') === 'react') {
      const clause = statement.importClause;
      reactName = clause?.name?.text || (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings) ? clause.namedBindings.name.text : undefined);
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && isCallNamed(declaration.initializer, 'createRoot')) roots.add(declaration.name.text);
    }
  }
  let result: { start: number; end: number; reactName?: string } | null = null;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (framework === 'vue' && isCallNamed(node, 'createApp')) {
      result = { start: node.getStart(ast), end: node.getEnd() };
      return;
    }
    if (framework === 'react' && ts.isCallExpression(node) && node.arguments.length > 0 && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'render') {
      const receiver = node.expression.expression;
      const isLegacy = ts.isIdentifier(receiver) && /^ReactDOM$|^ReactDOMClient$/.test(receiver.text);
      const isModern = (ts.isIdentifier(receiver) && roots.has(receiver.text)) || isCallNamed(receiver, 'createRoot');
      if (isLegacy || isModern) {
        result = { start: node.arguments[0]!.getStart(ast), end: node.arguments[0]!.getEnd(), reactName };
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!result) throw new Error(`Could not find a supported ${framework === 'react' ? 'React root render' : 'Vue createApp'} in the app entry.`);
  return result;
}

function devCommandFromManifest(manifest: Record<string, any>): string {
  const scripts = manifest.scripts || {};
  const original = [scripts.dev, scripts.start].find((value) => typeof value === 'string' && /^vite(?:\s|$)/.test(value.trim()));
  if (!original) {
    throw new Error('One-click setup currently supports Vite projects whose dev/start script invokes vite.');
  }
  if (scripts[scriptName]) throw new Error(`The project already has a ${scriptName} script.`);
  return original.trim();
}

function addScript(content: string, script: string): string {
  const match = /"scripts"\s*:\s*\{/.exec(content);
  if (!match) throw new Error('package.json has no scripts object.');
  const position = match.index + match[0].length;
  const empty = /^\s*\}/.test(content.slice(position));
  const lineIndent = content.match(/\n([ \t]*)"scripts"/)?.[1] || '  ';
  const entry = `\n${lineIndent}  "${scriptName}": ${JSON.stringify(script)}${empty ? '' : ','}`;
  return content.slice(0, position) + entry + content.slice(position);
}

function removeScript(content: string, script: string): string {
  const escaped = script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\n[ \\t]*"${scriptName}"\\s*:\\s*"${escaped}"\\s*,?`);
  if (!pattern.test(content)) throw new Error('The generated script was changed; remove it manually.');
  return content.replace(pattern, '');
}

function assertSafeGeneratedDirectory(targetDir: string): string {
  const directory = path.join(targetDir, directoryName);
  if (fs.existsSync(directory)) {
    if (!fs.statSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('.grimoire must be a regular directory.');
  } else fs.mkdirSync(directory);
  return directory;
}

export function getDevtoolsInstallStatus(targetDir: string): DevtoolsInstallStatus {
  const state = readState(targetDir);
  return state ? { installed: true, framework: state.framework, entry: state.entry, command: `npm run ${scriptName}`, port: state.port,
    upgradeAvailable: state.framework === 'react' && !state.fiberHash, componentTracing: state.framework === 'vue' || Boolean(state.fiberHash) } : { installed: false };
}

export function installDevtools(targetDir: string, port: number): DevtoolsInstallStatus {
  if (readState(targetDir)) throw new Error('DevTools are already installed. Remove them before installing again.');
  const manifestFile = path.join(targetDir, 'package.json');
  if (fs.lstatSync(manifestFile).isSymbolicLink()) throw new Error('Symlinked package.json is not supported.');
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText);
  if (!manifest.dependencies?.vite && !manifest.devDependencies?.vite) throw new Error('One-click setup currently supports Vite projects.');
  const hasReact = Boolean(manifest.dependencies?.react || manifest.devDependencies?.react);
  const hasVue = Boolean(manifest.dependencies?.vue || manifest.devDependencies?.vue);
  if (!hasReact && !hasVue) throw new Error('React or Vue was not found in package.json.');
  const devCommand = devCommandFromManifest(manifest);
  const script = 'node .grimoire/run.mjs';
  const entry = findEntry(targetDir);
  const source = fs.readFileSync(entry, 'utf8');
  if (source.includes(markerStart) || source.includes('grimoire:auto-import')) throw new Error('The entry already contains Grimoire markers.');
  let framework: 'react' | 'vue';
  if (hasReact && hasVue) {
    const reactMatch = (() => { try { return findTarget(source, entry, 'react'); } catch { return null; } })();
    const vueMatch = (() => { try { return findTarget(source, entry, 'vue'); } catch { return null; } })();
    if (Boolean(reactMatch) === Boolean(vueMatch)) throw new Error('Could not identify a unique React or Vue entry in this mixed project.');
    framework = reactMatch ? 'react' : 'vue';
  } else framework = hasReact ? 'react' : 'vue';
  const target = findTarget(source, entry, framework);
  const adapter = path.join(targetDir, directoryName, 'adapter.js');
  if (fs.existsSync(adapter)) throw new Error('.grimoire/adapter.js already exists.');
  const declaration = path.join(targetDir, directoryName, 'adapter.d.ts');
  if (fs.existsSync(declaration)) throw new Error('.grimoire/adapter.d.ts already exists.');
  const runner = path.join(targetDir, directoryName, 'run.mjs');
  if (fs.existsSync(runner)) throw new Error('.grimoire/run.mjs already exists.');
  const fiberFile = path.join(targetDir, directoryName, 'fiber-hook.js');
  if (framework === 'react' && fs.existsSync(fiberFile)) throw new Error('.grimoire/fiber-hook.js already exists.');
  const relativeImport = path.relative(path.dirname(entry), adapter).replace(/\\/g, '/');
  const importPath = relativeImport.startsWith('.') ? relativeImport : `./${relativeImport}`;
  const relativeFiberImport = path.relative(path.dirname(entry), fiberFile).replace(/\\/g, '/');
  const fiberImportPath = relativeFiberImport.startsWith('.') ? relativeFiberImport : `./${relativeFiberImport}`;
  const fiberImportLine = framework === 'react' ? `import '${fiberImportPath}'; // grimoire:auto-import\n` : undefined;
  const reactName = target.reactName || 'GrimoireReact';
  const importedName = framework === 'react' ? 'profileGrimoireRoot' : 'installGrimoireVueWhenActive';
  const importLine = (fiberImportLine || '') + `import { ${importedName} } from '${importPath}'; // grimoire:auto-import\n`
    + (framework === 'react' && !target.reactName ? `import * as GrimoireReact from 'react'; // grimoire:auto-import\n` : '');
  const originalExpression = source.slice(target.start, target.end);
  const installedExpression = framework === 'react'
    ? `${markerStart}${importedName}(${reactName}, ${originalExpression})${markerEnd}`
    : `${markerStart}${importedName}(${originalExpression})${markerEnd}`;
  const newSource = importLine + source.slice(0, target.start) + installedExpression + source.slice(target.end);
  const newManifest = addScript(manifestText, script);
  JSON.parse(newManifest);
  const directory = assertSafeGeneratedDirectory(targetDir);
  const endpoint = `http://127.0.0.1:${port}/api/telemetry`;
  const generatedAdapter = devAdapterScript.replace("const endpoint = new URL('/api/telemetry', import.meta.url).href;", `const endpoint = ${JSON.stringify(endpoint)};`)
    + `\n\nconst active = import.meta.env.DEV && import.meta.env.VITE_GRIMOIRE === '1';\n`
    + `export function profileGrimoireRoot(React, element) {\n  return active && !globalThis.__grimoireFiberHookActive ? profileReact(React, 'App', element) : element;\n}\n`
    + `export function installGrimoireVueWhenActive(app) {\n  return active ? installGrimoireVue(app) : app;\n}\n`;
  const generatedRunner = `import { spawn } from 'node:child_process';\nconst child = spawn(${JSON.stringify(devCommand)}, { shell: true, stdio: 'inherit', env: { ...process.env, VITE_GRIMOIRE: '1' } });\nchild.on('exit', (code) => { process.exitCode = code ?? 1; });\nchild.on('error', (error) => { console.error(error); process.exitCode = 1; });\n`;
  const generatedDeclaration = 'export declare function profileGrimoireRoot<T>(React: unknown, element: T): T;\nexport declare function installGrimoireVueWhenActive<T>(app: T): T;\n';
  const generatedFiber = framework === 'react' ? reactFiberHookScript.replace('__GRIMOIRE_ENDPOINT__', endpoint) : undefined;
  const state: InstallState = { entry: path.relative(targetDir, entry), originalExpression, installedExpression, importLine, adapter: 'adapter.js', adapterHash: hash(generatedAdapter), declarationHash: hash(generatedDeclaration), runnerHash: hash(generatedRunner), fiberHash: generatedFiber ? hash(generatedFiber) : undefined, fiberImportLine, script, framework, port };
  const stateFile = path.join(directory, stateName);
  try {
    fs.writeFileSync(adapter, generatedAdapter, { flag: 'wx' });
    fs.writeFileSync(declaration, generatedDeclaration, { flag: 'wx' });
    fs.writeFileSync(runner, generatedRunner, { flag: 'wx' });
    if (generatedFiber) fs.writeFileSync(fiberFile, generatedFiber, { flag: 'wx' });
    fs.writeFileSync(entry, newSource);
    fs.writeFileSync(manifestFile, newManifest);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    if (fs.existsSync(adapter)) fs.unlinkSync(adapter);
    if (fs.existsSync(declaration)) fs.unlinkSync(declaration);
    if (fs.existsSync(runner)) fs.unlinkSync(runner);
    if (generatedFiber && fs.existsSync(fiberFile)) fs.unlinkSync(fiberFile);
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    fs.writeFileSync(entry, source);
    fs.writeFileSync(manifestFile, manifestText);
    throw error;
  }
  return getDevtoolsInstallStatus(targetDir);
}

export function upgradeDevtools(targetDir: string): DevtoolsInstallStatus {
  const state = readState(targetDir);
  if (!state || state.framework !== 'react') throw new Error('No React DevTools installation to upgrade.');
  if (state.fiberHash) return getDevtoolsInstallStatus(targetDir);
  const entry = path.resolve(targetDir, state.entry);
  assertRegularFileWithin(targetDir, entry);
  const source = fs.readFileSync(entry, 'utf8');
  if (!source.startsWith(state.importLine) || !source.includes(state.installedExpression)) throw new Error('The app entry was changed; automatic upgrade was skipped.');
  const directory = assertSafeGeneratedDirectory(targetDir);
  const adapter = path.join(directory, state.adapter);
  const adapterSource = fs.readFileSync(adapter, 'utf8');
  if (hash(adapterSource) !== state.adapterHash) throw new Error('The generated adapter was changed; automatic upgrade was skipped.');
  const originalReturn = "return active ? profileReact(React, 'App', element) : element;";
  if (!adapterSource.includes(originalReturn)) throw new Error('Cannot upgrade this adapter version automatically.');
  const updatedAdapter = adapterSource.replace(originalReturn, "return active && !globalThis.__grimoireFiberHookActive ? profileReact(React, 'App', element) : element;");
  const fiberFile = path.join(directory, 'fiber-hook.js');
  if (fs.existsSync(fiberFile)) throw new Error('.grimoire/fiber-hook.js already exists.');
  const relative = path.relative(path.dirname(entry), fiberFile).replace(/\\/g, '/');
  const importPath = relative.startsWith('.') ? relative : `./${relative}`;
  const fiberImportLine = `import '${importPath}'; // grimoire:auto-import\n`;
  const fiberContent = reactFiberHookScript.replace('__GRIMOIRE_ENDPOINT__', `http://127.0.0.1:${state.port}/api/telemetry`);
  const upgradedState: InstallState = { ...state, importLine: fiberImportLine + state.importLine,
    fiberImportLine, fiberHash: hash(fiberContent), adapterHash: hash(updatedAdapter) };
  const stateFile = path.join(directory, stateName);
  try {
    fs.writeFileSync(fiberFile, fiberContent, { flag: 'wx' });
    fs.writeFileSync(entry, fiberImportLine + source);
    fs.writeFileSync(adapter, updatedAdapter);
    fs.writeFileSync(stateFile, JSON.stringify(upgradedState, null, 2) + '\n');
  } catch (error) {
    if (fs.existsSync(fiberFile)) fs.unlinkSync(fiberFile);
    fs.writeFileSync(entry, source);
    fs.writeFileSync(adapter, adapterSource);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    throw error;
  }
  return getDevtoolsInstallStatus(targetDir);
}

export function removeDevtools(targetDir: string): DevtoolsInstallStatus {
  const state = readState(targetDir);
  if (!state) throw new Error('No Grimoire DevTools installation was found.');
  const entry = path.resolve(targetDir, state.entry);
  assertRegularFileWithin(targetDir, entry);
  if (state.adapter !== 'adapter.js') throw new Error('Unexpected Grimoire adapter path.');
  const directory = path.join(targetDir, directoryName);
  const adapter = path.join(directory, state.adapter);
  const declaration = path.join(directory, 'adapter.d.ts');
  const runner = path.join(directory, 'run.mjs');
  const fiberFile = path.join(directory, 'fiber-hook.js');
  if (fs.lstatSync(adapter).isSymbolicLink() || fs.lstatSync(declaration).isSymbolicLink() || fs.lstatSync(runner).isSymbolicLink()
    || hash(fs.readFileSync(adapter, 'utf8')) !== state.adapterHash
    || hash(fs.readFileSync(declaration, 'utf8')) !== state.declarationHash
    || hash(fs.readFileSync(runner, 'utf8')) !== state.runnerHash) {
    throw new Error('Generated DevTools files were changed; automatic removal was skipped.');
  }
  if (state.fiberHash && (fs.lstatSync(fiberFile).isSymbolicLink() || hash(fs.readFileSync(fiberFile, 'utf8')) !== state.fiberHash)) {
    throw new Error('Generated React tracing file was changed; automatic removal was skipped.');
  }
  const source = fs.readFileSync(entry, 'utf8');
  const manifestFile = path.join(targetDir, 'package.json');
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  if (!source.includes(state.importLine) || !source.includes(state.installedExpression)) throw new Error('The generated entry code was changed; automatic removal was skipped.');
  const newSource = source.replace(state.importLine, '').replace(state.installedExpression, state.originalExpression);
  const newManifest = removeScript(manifestText, state.script);
  JSON.parse(newManifest);
  fs.writeFileSync(entry, newSource);
  fs.writeFileSync(manifestFile, newManifest);
  fs.unlinkSync(adapter);
  fs.unlinkSync(declaration);
  fs.unlinkSync(runner);
  if (state.fiberHash) fs.unlinkSync(fiberFile);
  fs.unlinkSync(path.join(directory, stateName));
  if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  return { installed: false };
}
