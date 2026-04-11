import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
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

  const globalRules = new RuleEngine();
  const workspaceRules = new RuleEngine();
  const activityLog = new ActivityLog(500);

  // Set up persistent log directory
  const logDir = vscode.Uri.joinPath(context.globalStorageUri, "logs").fsPath;
  activityLog.setLogDir(logDir);
  log(`Log directory: ${logDir}`);

  // Load saved rules
  const savedGlobal = context.globalState.get<string>("autoAuthorize.rules");
  if (savedGlobal) {
    try {
      globalRules.importRules(savedGlobal);
      log(`Loaded ${globalRules.getRules().length} global rules`);
    } catch (e) {
      log(`Failed to load global rules: ${e}`);
    }
  }
  const savedWorkspace = context.workspaceState.get<string>("autoAuthorize.rules");
  if (savedWorkspace) {
    try {
      workspaceRules.importRules(savedWorkspace);
      log(`Loaded ${workspaceRules.getRules().length} workspace rules`);
    } catch (e) {
      log(`Failed to load workspace rules: ${e}`);
    }
  }

  const saveGlobalRules = () => {
    context.globalState.update("autoAuthorize.rules", globalRules.exportRules());
  };
  const saveWorkspaceRules = () => {
    context.workspaceState.update("autoAuthorize.rules", workspaceRules.exportRules());
  };

  const interceptor = new MessageInterceptor(globalRules, workspaceRules, activityLog);

  // Install spawn wrapper
  try {
    const debug = true; // TODO: restore vscode.workspace.getConfiguration("autoAuthorize").get<boolean>("debug", false);
    const logger = { appendLine: (msg: string) => log(msg) };
    spawnWrapper = new SpawnWrapper(interceptor, logger, debug);
    spawnWrapper.setCallbacks(
      (pid) => {
        if (pid !== undefined) activityLog.startSession(pid);
        log(`Wrapped Claude CLI process (PID: ${pid})`);
      },
      (pid) => {
        if (pid !== undefined) activityLog.endSession(pid);
        log(`Claude CLI process exited (PID: ${pid})`);
      }
    );
    spawnWrapper.install();
    log("Spawn wrapper installed");
  } catch (e) {
    log(`ERROR installing spawn wrapper: ${e}`);
  }

  // Register panel provider
  panelProvider = new PanelProvider(
    context.extensionUri,
    globalRules,
    workspaceRules,
    activityLog,
    interceptor,
    spawnWrapper,
    saveGlobalRules,
    saveWorkspaceRules,
    {
      isSoundEnabled: () => soundEnabled,
      setSoundEnabled: (v: boolean) => { soundEnabled = v; },
    }
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

  // Log activity + sound notification
  let soundEnabled = false;
  activityLog.onEntry((entry) => {
    const symbol = entry.outcome === "auto-approved" ? "OK" : "->";
    log(`${symbol} [${entry.toolName}] ${entry.input} (${entry.outcome})`);
    if (entry.outcome === "passed-through" && soundEnabled) {
      const wav = path.join(context.extensionPath, "resources", "notify.wav");
      switch (process.platform) {
        case "win32":
          exec(`powershell -c "(New-Object System.Media.SoundPlayer '${wav}').PlaySync()"`, { windowsHide: true });
          break;
        case "darwin":
          exec(`afplay "${wav}"`);
          break;
        default:
          exec(`paplay "${wav}" || aplay "${wav}"`);
          break;
      }
    }
  });

  log("Auto-Authorize ready");
}

export function deactivate() {
  if (spawnWrapper) {
    spawnWrapper.uninstall();
    spawnWrapper = null;
  }
}
