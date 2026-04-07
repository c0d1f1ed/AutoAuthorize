import * as vscode from "vscode";
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AutoAuthorize</title>
</head>
<body>
  <p>AutoAuthorize panel — full UI loading in next task.</p>
</body>
</html>`;
  }
}
