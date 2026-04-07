import * as vscode from "vscode";
import { RuleEngine } from "./ruleEngine";
import { ActivityLog } from "./activityLog";
import { MessageInterceptor } from "./messageInterceptor";
import { SpawnWrapper } from "./spawnWrapper";
import { PanelProvider } from "./panel/panelProvider";

let spawnWrapper: SpawnWrapper | null = null;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Auto-Authorize");
  let panelProvider: PanelProvider | undefined;

  const log = (msg: string) => {
    outputChannel.appendLine(msg);
    panelProvider?.appendDebug(msg);
  };

  log("Auto-Authorize activating...");

  const ruleEngine = new RuleEngine();
  const activityLog = new ActivityLog(500);

  // Load saved rules
  const savedRules = context.globalState.get<string>("autoAuthorize.rules");
  if (savedRules) {
    try {
      ruleEngine.importRules(savedRules);
      log(`Loaded ${ruleEngine.getRules().length} saved rules`);
    } catch (e) {
      log(`Failed to load saved rules: ${e}`);
    }
  }

  const saveRules = () => {
    context.globalState.update("autoAuthorize.rules", ruleEngine.exportRules());
  };

  const interceptor = new MessageInterceptor(ruleEngine, activityLog);

  // Install spawn wrapper
  try {
    const debug = true; // TODO: restore vscode.workspace.getConfiguration("autoAuthorize").get<boolean>("debug", false);
    const logger = { appendLine: (msg: string) => log(msg) };
    spawnWrapper = new SpawnWrapper(interceptor, logger, debug);
    spawnWrapper.setCallbacks(
      (pid) => log(`Wrapped Claude CLI process (PID: ${pid})`),
      (pid) => log(`Claude CLI process exited (PID: ${pid})`)
    );
    spawnWrapper.install();
    log("Spawn wrapper installed");
  } catch (e) {
    log(`ERROR installing spawn wrapper: ${e}`);
  }

  // Register panel provider
  panelProvider = new PanelProvider(
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
      vscode.window.showInformationMessage("Auto-Authorize enabled");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoAuthorize.disable", () => {
      interceptor.setEnabled(false);
      vscode.window.showInformationMessage("Auto-Authorize disabled");
    })
  );

  // Log activity
  activityLog.onEntry((entry) => {
    const symbol = entry.outcome === "auto-approved" ? "OK" : "->";
    log(`${symbol} [${entry.toolName}] ${entry.input} (${entry.outcome})`);
  });

  log("Auto-Authorize ready");
}

export function deactivate() {
  if (spawnWrapper) {
    spawnWrapper.uninstall();
    spawnWrapper = null;
  }
}
