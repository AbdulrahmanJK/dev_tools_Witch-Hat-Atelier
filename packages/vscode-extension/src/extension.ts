import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClusterLayout, GraphBuilder, type GrimoireGraph } from '@wha/core';

export function activate(context: vscode.ExtensionContext): void {
  // 1. Register Panel Command (Full tab Grimoire canvas)
  const openCmd = vscode.commands.registerCommand('wha.openGrimoire', () => {
    GrimoirePanel.createOrShow(context.extensionUri);
  });
  context.subscriptions.push(openCmd);

  // 2. Register Sidebar Webview View Provider
  const provider = new GrimoireViewProvider(context.extensionUri);
  const viewSub = vscode.window.registerWebviewViewProvider(
    GrimoireViewProvider.viewType,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );
  context.subscriptions.push(viewSub);

  // 3. Auto-refresh on file save
  const saveSub = vscode.workspace.onDidSaveTextDocument((doc) => {
    const ext = path.extname(doc.fileName).toLowerCase();
    if (['.js', '.jsx', '.ts', '.tsx', '.vue'].includes(ext)) {
      GrimoirePanel.currentPanel?.refresh();
      provider.refresh();
    }
  });
  context.subscriptions.push(saveSub);
}

export function deactivate(): void {
  GrimoirePanel.currentPanel?.dispose();
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  // Look for built dist in web package or extension media
  const distPath = path.join(extensionUri.fsPath, '..', 'web', 'dist');
  const fallbackPath = path.join(extensionUri.fsPath, 'dist', 'web');
  const webRoot = fs.existsSync(distPath) ? distPath : fallbackPath;
  const indexPath = path.join(webRoot, 'index.html');

  if (!fs.existsSync(indexPath)) {
    return `<!DOCTYPE html>
      <html><body>
        <h2>Grimoire Parchment Unassembled</h2>
        <p>Please build the web package (<code>pnpm --filter @wha/web build</code>).</p>
      </body></html>`;
  }

  let html = fs.readFileSync(indexPath, 'utf8');

  // Convert relative asset paths (./assets/...) to webview URIs
  html = html.replace(/(src|href)=["']\.\/([^"']+)["']/g, (_match, attr, relPath) => {
    const assetUri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, relPath)));
    return `${attr}="${assetUri.toString()}"`;
  });

  return html;
}

function handleWebviewMessage(message: any, webview: vscode.Webview): void {
  if (!message) return;

  if (message.type === 'REQUEST_GRAPH') {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
      const rootDir = folders[0]!.uri.fsPath;
      try {
        const builder = new GraphBuilder(rootDir);
        const layout = new ClusterLayout();
        const raw = builder.buildGraph();
        const graph: GrimoireGraph = layout.computeLayout(raw);

        webview.postMessage({
          type: 'GRAPH_DATA',
          graph,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to inscribe Grimoire: ${err?.message}`);
      }
    }
  } else if (message.type === 'OPEN_FILE') {
    const { filePath, line } = message;
    if (filePath) {
      const folders = vscode.workspace.workspaceFolders;
      const absPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(folders?.[0]?.uri.fsPath || '', filePath);

      if (fs.existsSync(absPath)) {
        vscode.workspace.openTextDocument(absPath).then((doc) => {
          const targetLine = Math.max(0, (line || 1) - 1);
          const range = new vscode.Range(targetLine, 0, targetLine, 0);
          vscode.window.showTextDocument(doc, { selection: range });
        });
      }
    }
  }
}

export class GrimoirePanel {
  public static currentPanel: GrimoirePanel | null = null;
  public static readonly viewType = 'whaGrimoire';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (GrimoirePanel.currentPanel) {
      GrimoirePanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      GrimoirePanel.viewType,
      'Architectural Grimoire',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          extensionUri,
          vscode.Uri.file(path.join(extensionUri.fsPath, '..', 'web', 'dist')),
        ],
      }
    );

    GrimoirePanel.currentPanel = new GrimoirePanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    this.panel.webview.html = getWebviewHtml(this.panel.webview, this.extensionUri);

    this.panel.webview.onDidReceiveMessage(
      (message) => handleWebviewMessage(message, this.panel.webview),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public refresh(): void {
    handleWebviewMessage({ type: 'REQUEST_GRAPH' }, this.panel.webview);
  }

  public dispose(): void {
    GrimoirePanel.currentPanel = null;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) d.dispose();
    }
  }
}

export class GrimoireViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'wha.grimoireView';
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.extensionUri,
        vscode.Uri.file(path.join(this.extensionUri.fsPath, '..', 'web', 'dist')),
      ],
    };

    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri);

    webviewView.webview.onDidReceiveMessage((message) => {
      handleWebviewMessage(message, webviewView.webview);
    });
  }

  public refresh(): void {
    if (this.view) {
      handleWebviewMessage({ type: 'REQUEST_GRAPH' }, this.view.webview);
    }
  }
}
