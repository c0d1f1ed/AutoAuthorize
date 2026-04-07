import * as vscode from "vscode";
import * as path from "path";
import { RuleEngine } from "../ruleEngine";
import { ActivityLog } from "../activityLog";
import { MessageInterceptor } from "../messageInterceptor";
import { SpawnWrapper } from "../spawnWrapper";

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private extensionUri: vscode.Uri,
    private ruleEngine: RuleEngine,
    private activityLog: ActivityLog,
    private interceptor: MessageInterceptor,
    private spawnWrapper: SpawnWrapper,
    private saveRules: () => void
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg) => {
      this.handleMessage(msg);
    });

    this.sendState();

    this.activityLog.onEntry(() => {
      this.sendState();
    });
  }

  private sendState(): void {
    this.view?.webview.postMessage({
      type: "state",
      rules: this.ruleEngine.getRules(),
      stats: this.activityLog.getStats(),
      log: this.activityLog.getEntries().slice(-50),
      enabled: this.interceptor.isEnabled(),
      wrappedProcesses: this.spawnWrapper.getWrappedCount(),
    });
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "addRule":
        try {
          this.ruleEngine.addRule(msg.rule);
          this.saveRules();
          this.sendState();
        } catch (e: any) {
          this.view?.webview.postMessage({ type: "error", message: e.message });
        }
        break;
      case "updateRule":
        try {
          this.ruleEngine.updateRule(msg.id, msg.updates);
          this.saveRules();
          this.sendState();
        } catch (e: any) {
          this.view?.webview.postMessage({ type: "error", message: e.message });
        }
        break;
      case "deleteRule":
        this.ruleEngine.deleteRule(msg.id);
        this.saveRules();
        this.sendState();
        break;
      case "reorderRules":
        this.ruleEngine.reorderRules(msg.ids);
        this.saveRules();
        this.sendState();
        break;
      case "setEnabled":
        this.interceptor.setEnabled(msg.enabled);
        this.sendState();
        break;
      case "testPattern":
        try {
          const regex = new RegExp(msg.pattern);
          const matches = regex.test(msg.testInput);
          this.view?.webview.postMessage({ type: "testResult", matches });
        } catch (e: any) {
          this.view?.webview.postMessage({ type: "testResult", error: e.message });
        }
        break;
      case "clearLog":
        this.activityLog.clear();
        this.sendState();
        break;
      case "exportRules":
        this.view?.webview.postMessage({
          type: "exportedRules",
          json: this.ruleEngine.exportRules(),
        });
        break;
      case "importRules":
        try {
          this.ruleEngine.importRules(msg.json);
          this.saveRules();
          this.sendState();
        } catch (e: any) {
          this.view?.webview.postMessage({ type: "error", message: e.message });
        }
        break;
      case "getState":
        this.sendState();
        break;
    }
  }

  private getHtml(): string {
    const webview = this.view!.webview;
    const nonce = getNonce();

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "panel", "webview", "style.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "panel", "webview", "main.js")
    );

    const fs = require("fs");
    const htmlPath = path.join(this.extensionUri.fsPath, "src", "panel", "webview", "index.html");
    let html = fs.readFileSync(htmlPath, "utf-8");

    html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());
    html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

    return html;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
