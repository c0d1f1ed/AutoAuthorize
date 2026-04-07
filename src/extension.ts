import * as vscode from "vscode";
import { RuleEngine } from "./ruleEngine";
import { ActivityLog } from "./activityLog";
import { MessageInterceptor } from "./messageInterceptor";
import { SpawnWrapper } from "./spawnWrapper";
import { PanelProvider } from "./panel/panelProvider";

let spawnWrapper: SpawnWrapper | null = null;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("AutoAuthorize");
  outputChannel.appendLine("AutoAuthorize activating...");

  const ruleEngine = new RuleEngine();
  const activityLog = new ActivityLog(500);

  // Load saved rules
  const savedRules = context.globalState.get<string>("autoAuthorize.rules");
  if (savedRules) {
    try {
      ruleEngine.importRules(savedRules);
      outputChannel.appendLine(`Loaded ${ruleEngine.getRules().length} saved rules`);
    } catch (e) {
      outputChannel.appendLine(`Failed to load saved rules: ${e}`);
    }
  }

  const saveRules = () => {
    context.globalState.update("autoAuthorize.rules", ruleEngine.exportRules());
  };

  const interceptor = new MessageInterceptor(ruleEngine, activityLog);

  // Install spawn wrapper
  const debug = vscode.workspace.getConfiguration("autoAuthorize").get<boolean>("debug", false);
  spawnWrapper = new SpawnWrapper(interceptor, outputChannel, debug);
  spawnWrapper.setCallbacks(
    (pid) => outputChannel.appendLine(`Wrapped Claude CLI process (PID: ${pid})`),
    (pid) => outputChannel.appendLine(`Claude CLI process exited (PID: ${pid})`)
  );
  spawnWrapper.install();
  outputChannel.appendLine("Spawn wrapper installed");

  // Register panel provider
  const panelProvider = new PanelProvider(
    context.extensionUri,
    ruleEngine,
    activityLog,
    interceptor,
    spawnWrapper,
    saveRules
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("autoAuthorize.panel", panelProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("autoAuthorize.openPanel", () => {
      vscode.commands.executeCommand("autoAuthorize.panel.focus");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoAuthorize.enable", () => {
      interceptor.setEnabled(true);
      vscode.window.showInformationMessage("AutoAuthorize enabled");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoAuthorize.disable", () => {
      interceptor.setEnabled(false);
      vscode.window.showInformationMessage("AutoAuthorize disabled");
    })
  );

  // Log activity
  activityLog.onEntry((entry) => {
    const symbol = entry.outcome === "auto-approved" ? "OK" : "->";
    outputChannel.appendLine(`${symbol} [${entry.toolName}] ${entry.input} (${entry.outcome})`);
  });

  outputChannel.appendLine("AutoAuthorize ready");
}

export function deactivate() {
  if (spawnWrapper) {
    spawnWrapper.uninstall();
    spawnWrapper = null;
  }
}
