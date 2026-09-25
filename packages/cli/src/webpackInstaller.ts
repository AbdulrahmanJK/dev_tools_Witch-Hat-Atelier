import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { detectProjectCapabilities } from './projectCapabilities.js';
import { devAdapterScript, reactFiberHookScript } from './runtimeScripts.js';

interface WebpackState {
  entry: string;
  importLine: string;
  hookHash: string;
  runnerHash: string;
  script: string;
  devScript: string;
  port: number;
  framework?: 'react' | 'vue';
  hookFile?: string;
  callBefore?: string;
  callAfter?: string;
}
const stateName = 'webpack-state.json';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function selectedApplication(root: string, appId: string) {
  const capabilities = detectProjectCapabilities(root);
  const app = capabilities.applications.find((item) => item.id === appId && item.bundler === 'webpack' && (item.framework === 'react' || item.framework === 'vue'));
  if (!app) throw new Error('Выберите React- или Vue-приложение с Webpack из обнаруженного списка.');
  const directory = path.resolve(root, app.directory);
  const realRoot = fs.realpathSync(root);
  const realDirectory = fs.realpathSync(directory);
  if (realDirectory !== realRoot && !realDirectory.startsWith(realRoot + path.sep)) throw new Error('Приложение находится вне проекта.');
  return { capabilities, app, directory };
}

function entryFile(root: string, directory: string, relativeEntry: string): string {
  if (!relativeEntry || path.isAbsolute(relativeEntry) || relativeEntry.split(/[\\/]/).includes('..')) throw new Error('Укажите относительный путь к entry.');
  const file = path.resolve(root, relativeEntry);
  const real = fs.realpathSync(file);
  const appRoot = fs.realpathSync(directory);
  if (!real.startsWith(appRoot + path.sep) || !/\.[cm]?[jt]sx?$/.test(real) || !fs.statSync(real).isFile() || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('Entry должен быть обычным JS/TS-файлом выбранного приложения.');
  }
  return file;
}

function stateFile(directory: string): string { return path.join(directory, '.grimoire', stateName); }
function readState(directory: string): WebpackState | null {
  const file = stateFile(directory);
  if (!fs.existsSync(file)) return null;
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Состояние Grimoire не может быть ссылкой.');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as WebpackState;
}
function hookContent(port: number, framework: 'react' | 'vue'): string {
  const endpoint = `http://127.0.0.1:${port}/api/telemetry`;
  if (framework === 'vue') return devAdapterScript
    .replace("const endpoint = new URL('/api/telemetry', import.meta.url).href;", `const endpoint = ${JSON.stringify(endpoint)};`)
    + "\nexport function grimoireVue(app) {\n  return typeof process !== 'undefined' && process.env.NODE_ENV !== 'production' ? installGrimoireVue(app) : app;\n}\n";
  return reactFiberHookScript.replace('__GRIMOIRE_ENDPOINT__', endpoint)
    .replace("const active = import.meta.env.DEV && import.meta.env.VITE_GRIMOIRE === '1';",
      "const active = process.env.NODE_ENV !== 'production' && typeof window !== 'undefined';");
}

function vueCreateAppCall(source: string, file: string): { before: string; after: string; start: number; end: number } {
  const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX
    : /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  if ((ast as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
    throw new Error('Vue entry содержит синтаксические ошибки; автоматическое подключение остановлено.');
  }
  const aliases = new Set<string>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.getText(ast).slice(1, -1) !== 'vue') continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
      if ((element.propertyName?.text || element.name.text) === 'createApp') aliases.add(element.name.text);
    }
  }
  if (!aliases.size) throw new Error('В выбранном entry нет именованного импорта createApp из vue. Укажите браузерный entry с createApp или используйте ручной адаптер.');
  const calls: ts.CallExpression[] = [];
  let mountFound = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) calls.push(node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'mount') mountFound = true;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (calls.length !== 1 || !mountFound) throw new Error('Нужен один однозначный вызов createApp и mount в выбранном entry. Для сложного запуска используйте ручной Vue-адаптер.');
  const call = calls[0]!;
  const start = call.getStart(ast);
  const end = call.getEnd();
  const before = source.slice(start, end);
  return { before, after: `grimoireVue(${before})`, start, end };
}
function runnerContent(command: string): string {
  return `import { spawn } from 'node:child_process';\nconst child = spawn(${JSON.stringify(command)}, { shell: true, stdio: 'inherit', env: { ...process.env, GRIMOIRE_DEVTOOLS: '1' } });\nchild.on('exit', code => { process.exitCode = code ?? 1; });\nchild.on('error', error => { console.error(error); process.exitCode = 1; });\n`;
}
function scriptCommand(manager: string, script: string): string {
  if (!/^[\w:-]+$/.test(script)) throw new Error('Некорректное имя dev-скрипта.');
  return `${manager === 'yarn' ? 'yarn' : manager === 'pnpm' ? 'pnpm' : 'npm'} run ${script}`;
}
function addScript(content: string): string {
  const match = /"scripts"\s*:\s*\{/.exec(content);
  if (!match) throw new Error('package.json не содержит scripts.');
  const position = match.index + match[0].length;
  const empty = /^\s*\}/.test(content.slice(position));
  const indent = content.match(/\n([ \t]*)"scripts"/)?.[1] || '  ';
  const entry = `\n${indent}  "dev:grimoire": "node .grimoire/run.mjs"${empty ? '' : ','}`;
  const next = content.slice(0, position) + entry + content.slice(position);
  JSON.parse(next);
  return next;
}
function removeScript(content: string): string {
  const line = /\n[ \t]*"dev:grimoire"\s*:\s*"node \.grimoire\/run\.mjs"\s*,?/;
  if (!line.test(content)) throw new Error('Сгенерированная команда изменена.');
  const next = content.replace(line, '');
  JSON.parse(next);
  return next;
}

export function previewWebpackInstall(root: string, appId: string, relativeEntry: string, devScript: string) {
  const { capabilities, app, directory } = selectedApplication(root, appId);
  const file = entryFile(root, directory, relativeEntry);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (readState(directory) || manifest.scripts?.['dev:grimoire']) throw new Error('Для этого приложения уже настроен dev:grimoire.');
  if (!app.devScripts.some((item) => item.name === devScript)) throw new Error('Выберите обнаруженный dev-скрипт приложения.');
  const source = fs.readFileSync(file, 'utf8');
  if (source.startsWith('#!')) throw new Error('Entry с shebang нельзя инструментировать как браузерный модуль.');
  if (source.includes('grimoire:webpack-hook')) throw new Error('Entry уже содержит импорт Grimoire.');
  const framework = app.framework as 'react' | 'vue';
  const hookName = framework === 'vue' ? 'vue-adapter.js' : 'fiber-hook.js';
  const vueCall = framework === 'vue' ? vueCreateAppCall(source, file) : null;
  const hookFile = path.join(directory, '.grimoire', hookName);
  if (fs.existsSync(hookFile) || fs.existsSync(path.join(directory, '.grimoire', 'run.mjs'))) throw new Error('Папка .grimoire содержит файлы с теми же именами.');
  const importPath = path.relative(path.dirname(file), hookFile).replace(/\\/g, '/');
  const importLine = framework === 'vue'
    ? `import { grimoireVue } from '${importPath.startsWith('.') ? importPath : `./${importPath}`}'; // grimoire:webpack-hook\n`
    : `import '${importPath.startsWith('.') ? importPath : `./${importPath}`}'; // grimoire:webpack-hook\n`;
  return { directory, file, source, manifest, importLine, hookName, framework, vueCall,
    command: scriptCommand(capabilities.packageManager, devScript),
    preview: `${path.relative(root, file)}\n+ ${importLine.trim()}${vueCall ? `\n- ${vueCall.before}\n+ ${vueCall.after}` : ''}\n${path.relative(root, path.join(directory, 'package.json'))}\n+ \"dev:grimoire\": \"node .grimoire/run.mjs\"\n+ .grimoire/${hookName}\n+ .grimoire/run.mjs`,
    app };
}

export function installWebpackDevtools(root: string, appId: string, relativeEntry: string, devScript: string, port: number) {
  const plan = previewWebpackInstall(root, appId, relativeEntry, devScript);
  const directory = path.join(plan.directory, '.grimoire');
  const hook = hookContent(port, plan.framework);
  const runner = runnerContent(plan.command);
  const manifestFile = path.join(plan.directory, 'package.json');
  const originalManifest = fs.readFileSync(manifestFile, 'utf8');
  const state: WebpackState = { entry: path.relative(plan.directory, plan.file), importLine: plan.importLine,
    hookHash: hash(hook), runnerHash: hash(runner), script: 'node .grimoire/run.mjs', devScript, port,
    framework: plan.framework, hookFile: plan.hookName, callBefore: plan.vueCall?.before, callAfter: plan.vueCall?.after };
  if (fs.existsSync(directory) && (!fs.statSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())) throw new Error('.grimoire должна быть обычной папкой.');
  fs.mkdirSync(directory, { recursive: true });
  const created: string[] = [];
  try {
    const hookPath = path.join(directory, plan.hookName);
    fs.writeFileSync(hookPath, hook, { flag: 'wx' });
    created.push(hookPath);
    const runnerPath = path.join(directory, 'run.mjs');
    fs.writeFileSync(runnerPath, runner, { flag: 'wx' });
    created.push(runnerPath);
    const modifiedSource = plan.vueCall
      ? plan.source.slice(0, plan.vueCall.start) + plan.vueCall.after + plan.source.slice(plan.vueCall.end)
      : plan.source;
    fs.writeFileSync(plan.file, plan.importLine + modifiedSource);
    fs.writeFileSync(manifestFile, addScript(originalManifest));
    const statePath = stateFile(plan.directory);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' });
    created.push(statePath);
  } catch (error) {
    for (const generated of created) if (fs.existsSync(generated)) fs.unlinkSync(generated);
    fs.writeFileSync(plan.file, plan.source);
    fs.writeFileSync(manifestFile, originalManifest);
    throw error;
  }
  return webpackInstallStatus(root, appId);
}

export function webpackInstallStatus(root: string, appId: string) {
  const { directory, capabilities } = selectedApplication(root, appId);
  const state = readState(directory);
  if (!state) return { installed: false, appId };
  const framework = state.framework || 'react';
  return { installed: true, appId, framework, entry: path.join(appId, state.entry).replace(/\\/g, '/'),
    command: scriptCommand(capabilities.packageManager, 'dev:grimoire'), port: state.port,
    refreshAvailable: state.hookHash !== hash(hookContent(state.port, framework)), componentTracing: true };
}

export function removeWebpackDevtools(root: string, appId: string) {
  const { directory } = selectedApplication(root, appId);
  const state = readState(directory);
  if (!state) throw new Error('Установка Webpack DevTools не найдена.');
  const entry = entryFile(root, directory, path.join(appId, state.entry));
  const stateDirectory = path.join(directory, '.grimoire');
  const hookFile = path.join(stateDirectory, state.hookFile || 'fiber-hook.js');
  const runnerFile = path.join(stateDirectory, 'run.mjs');
  if (fs.lstatSync(hookFile).isSymbolicLink() || fs.lstatSync(runnerFile).isSymbolicLink()
    || hash(fs.readFileSync(hookFile, 'utf8')) !== state.hookHash
    || hash(fs.readFileSync(runnerFile, 'utf8')) !== state.runnerHash) throw new Error('Сгенерированные файлы изменены; автоматическое удаление остановлено.');
  const source = fs.readFileSync(entry, 'utf8');
  const manifestFile = path.join(directory, 'package.json');
  const manifestText = fs.readFileSync(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText);
  if (!source.startsWith(state.importLine) || manifest.scripts?.['dev:grimoire'] !== state.script) throw new Error('Entry или команда dev:grimoire изменены; автоматическое удаление остановлено.');
  const sourceWithoutImport = source.slice(state.importLine.length);
  if (state.framework === 'vue' && (!state.callBefore || !state.callAfter || sourceWithoutImport.split(state.callAfter).length !== 2)) {
    throw new Error('Вызов Vue createApp изменён; автоматическое удаление остановлено.');
  }
  const restoredManifest = removeScript(manifestText);
  try {
    fs.writeFileSync(entry, state.framework === 'vue' ? sourceWithoutImport.replace(state.callAfter!, state.callBefore!) : sourceWithoutImport);
    fs.writeFileSync(manifestFile, restoredManifest);
  } catch (error) {
    fs.writeFileSync(entry, source);
    fs.writeFileSync(manifestFile, manifestText);
    throw error;
  }
  fs.unlinkSync(hookFile); fs.unlinkSync(runnerFile); fs.unlinkSync(stateFile(directory));
  if (fs.readdirSync(stateDirectory).length === 0) fs.rmdirSync(stateDirectory);
  return { installed: false, appId };
}

export function refreshWebpackDevtools(root: string, appId: string, port: number) {
  const { directory } = selectedApplication(root, appId);
  const state = readState(directory);
  if (!state) throw new Error('Установка Webpack DevTools не найдена.');
  const framework = state.framework || 'react';
  const file = path.join(directory, '.grimoire', state.hookFile || 'fiber-hook.js');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Ссылка вместо hook-файла не поддерживается.');
  const previous = fs.readFileSync(file, 'utf8');
  if (hash(previous) !== state.hookHash) throw new Error('Hook-файл изменён; обновление остановлено.');
  const next = hookContent(port, framework);
  const updated = { ...state, port, hookHash: hash(next) };
  try {
    fs.writeFileSync(file, next);
    fs.writeFileSync(stateFile(directory), JSON.stringify(updated, null, 2) + '\n');
  } catch (error) {
    fs.writeFileSync(file, previous);
    fs.writeFileSync(stateFile(directory), JSON.stringify(state, null, 2) + '\n');
    throw error;
  }
  return webpackInstallStatus(root, appId);
}
