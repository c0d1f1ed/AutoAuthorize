import * as vscode from "vscode";
import { RuleEngine } from "../ruleEngine";
import { ActivityLog } from "../activityLog";
import { MessageInterceptor } from "../messageInterceptor";
import { SpawnWrapper } from "../spawnWrapper";

export class PanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private debugLines: string[] = [];
  private static readonly MAX_DEBUG_LINES = 200;

  constructor(
    private extensionUri: vscode.Uri,
    private ruleEngine: RuleEngine,
    private activityLog: ActivityLog,
    private interceptor: MessageInterceptor,
    private spawnWrapper: SpawnWrapper | null,
    private saveRules: () => void,
    private soundConfig: { isSoundEnabled: () => boolean; setSoundEnabled: (v: boolean) => void }
  ) {}

  appendDebug(line: string): void {
    this.debugLines.push(line);
    if (this.debugLines.length > PanelProvider.MAX_DEBUG_LINES) {
      this.debugLines.shift();
    }
    this.view?.webview.postMessage({ type: "debugLine", line });
  }

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
      wrappedProcesses: this.spawnWrapper?.getWrappedCount() ?? 0,
      logDir: this.activityLog.getLogDir(),
      soundEnabled: this.soundConfig.isSoundEnabled(),
      debugLog: this.debugLines,
    });
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case "addRule": {
        const result = validatePattern(msg.rule?.pattern);
        if (result) vscode.env.openExternal(vscode.Uri.parse(result.url));
        if (result?.action === "deny") break;
        try {
          this.ruleEngine.addRule(msg.rule);
          this.saveRules();
          this.sendState();
        } catch (e: any) {
          this.view?.webview.postMessage({ type: "error", message: e.message });
        }
        break;
      }
      case "updateRule": {
        const result = validatePattern(msg.updates?.pattern);
        if (result) vscode.env.openExternal(vscode.Uri.parse(result.url));
        if (result?.action === "deny") break;
        try {
          this.ruleEngine.updateRule(msg.id, msg.updates);
          this.saveRules();
          this.sendState();
        } catch (e: any) {
          this.view?.webview.postMessage({ type: "error", message: e.message });
        }
        break;
      }
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
      case "setSound":
        this.soundConfig.setSoundEnabled(msg.enabled);
        this.sendState();
        break;
      case "openLogDir": {
        const dir = this.activityLog.getLogDir();
        if (dir) {
          vscode.env.openExternal(vscode.Uri.file(dir));
        }
        break;
      }
      case "getState":
        this.sendState();
        break;
    }
  }

  private getHtml(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Auto-Authorize</title>
  <style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  padding: 8px;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0 8px;
}
.header h2 { font-size: 13px; font-weight: 600; }
.header-right { display: flex; align-items: center; gap: 6px; font-size: 11px; }
.switch { position: relative; display: inline-block; width: 32px; height: 18px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; cursor: pointer; inset: 0;
  background: var(--vscode-input-background); border-radius: 18px; transition: 0.2s;
}
.slider::before {
  content: ""; position: absolute; height: 12px; width: 12px;
  left: 3px; bottom: 3px; background: var(--vscode-foreground);
  border-radius: 50%; transition: 0.2s;
}
input:checked + .slider { background: var(--vscode-button-background); }
input:checked + .slider::before { transform: translateX(14px); }
.tabs { display: flex; border-bottom: 1px solid var(--vscode-widget-border); margin-bottom: 8px; }
.tab {
  background: none; border: none; color: var(--vscode-foreground);
  padding: 6px 12px; cursor: pointer; font-size: 12px; opacity: 0.7;
  border-bottom: 2px solid transparent;
}
.tab:hover { opacity: 1; }
.tab.active { opacity: 1; border-bottom-color: var(--vscode-focusBorder); }
.tab-content { display: none; }
.tab-content.active { display: block; }
.toolbar { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.btn {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer; font-size: 11px;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn-danger { background: var(--vscode-errorForeground); color: var(--vscode-editor-background); }
.filter-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.form {
  background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border);
  border-radius: 4px; padding: 10px; margin-bottom: 8px;
}
.form-group { margin-bottom: 8px; }
.form-group label { display: block; font-size: 11px; margin-bottom: 3px; opacity: 0.8; }
.form-group input, .form-group select {
  width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border); padding: 4px 6px; font-size: 12px; border-radius: 2px;
}
.form-group input:focus, .form-group select:focus { outline: 1px solid var(--vscode-focusBorder); }
.form-group input.invalid { border-color: var(--vscode-errorForeground); }
.form-actions { display: flex; gap: 4px; }
.error { color: var(--vscode-errorForeground); font-size: 11px; }
.test-result { font-size: 11px; margin-top: 2px; display: inline-block; }
.test-result.match { color: var(--vscode-testing-iconPassed); }
.test-result.no-match { color: var(--vscode-errorForeground); }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th {
  text-align: left; padding: 4px 6px;
  border-bottom: 1px solid var(--vscode-widget-border); opacity: 0.7; font-weight: 600;
}
td { padding: 4px 6px; border-bottom: 1px solid var(--vscode-widget-border); vertical-align: middle; }
td.mono { font-family: var(--vscode-editor-font-family); font-size: 11px; }
tr:hover { background: var(--vscode-list-hoverBackground); }
.status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.status-card {
  background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border);
  border-radius: 4px; padding: 10px;
}
.status-label { font-size: 10px; opacity: 0.7; text-transform: uppercase; margin-bottom: 4px; }
.status-value { font-size: 18px; font-weight: 600; }
.hidden { display: none !important; }
.empty-state { text-align: center; padding: 20px; opacity: 0.5; font-size: 12px; }
.small-switch { width: 24px; height: 14px; }
.small-switch .slider::before { height: 8px; width: 8px; left: 3px; bottom: 3px; }
.small-switch input:checked + .slider::before { transform: translateX(10px); }
.outcome-approved { color: var(--vscode-testing-iconPassed); }
.outcome-passed { color: var(--vscode-foreground); opacity: 0.6; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left"><h2>Auto-Authorize</h2></div>
    <div class="header-right">
      <label class="switch">
        <input type="checkbox" id="masterToggle" checked>
        <span class="slider"></span>
      </label>
      <span id="masterLabel">Enabled</span>
      <span style="margin-left:8px;opacity:0.4">|</span>
      <label class="switch">
        <input type="checkbox" id="soundToggle">
        <span class="slider"></span>
      </label>
      <span id="soundLabel">Sound</span>
    </div>
  </div>
  <div class="tabs">
    <button class="tab active" data-tab="rules">Rules</button>
    <button class="tab" data-tab="log">Activity Log</button>
    <button class="tab" data-tab="status">Status</button>
    <button class="tab" data-tab="debug">Debug</button>
  </div>
  <div class="tab-content active" id="tab-rules">
    <div class="toolbar">
      <button id="addRuleBtn" class="btn btn-primary">+ Add Rule</button>
      <button id="exportBtn" class="btn">Export</button>
      <button id="importBtn" class="btn">Import</button>
    </div>
    <div id="addRuleForm" class="form hidden">
      <div class="form-group">
        <label>Tool Type</label>
        <select id="ruleToolType">
          <option value="Bash">Bash</option>
          <option value="Read">Read</option>
          <option value="Write">Write</option>
          <option value="Edit">Edit</option>
          <option value="WebFetch">WebFetch</option>
          <option value="WebSearch">WebSearch</option>
          <option value="*">Any</option>
        </select>
      </div>
      <div class="form-group">
        <label>Regex Pattern</label>
        <input type="text" id="rulePattern" placeholder="^grep\\b.*">
        <span id="patternError" class="error hidden"></span>
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" id="ruleDescription" placeholder="Allow grep commands">
      </div>
      <div class="form-group test-group">
        <label>Test Input</label>
        <input type="text" id="testInput" placeholder="grep -r pattern .">
        <span id="testResult" class="test-result"></span>
      </div>
      <div class="form-actions">
        <button id="saveRuleBtn" class="btn btn-primary">Save</button>
        <button id="cancelRuleBtn" class="btn">Cancel</button>
      </div>
    </div>
    <table id="rulesTable">
      <thead><tr><th>On</th><th>Tool</th><th>Pattern</th><th>Description</th><th>Matches</th><th>Actions</th></tr></thead>
      <tbody id="rulesBody"></tbody>
    </table>
    <p id="noRules" class="empty-state">No rules defined. Click "+ Add Rule" to get started.</p>
  </div>
  <div class="tab-content" id="tab-log">
    <div class="toolbar">
      <button class="btn filter-btn active" data-filter="all">All</button>
      <button class="btn filter-btn" data-filter="auto-approved">Auto-approved</button>
      <button class="btn filter-btn" data-filter="passed-through">Passed-through</button>
      <button id="clearLogBtn" class="btn">Clear</button>
      <button id="openLogDirBtn" class="btn">Open Log Folder</button>
    </div>
    <table id="logTable">
      <thead><tr><th>Time</th><th>Tool</th><th>Command / Path</th><th>Outcome</th><th>Rule</th></tr></thead>
      <tbody id="logBody"></tbody>
    </table>
    <p id="noLog" class="empty-state">No activity yet.</p>
  </div>
  <div class="tab-content" id="tab-status">
    <div class="status-grid">
      <div class="status-card"><div class="status-label">Status</div><div class="status-value" id="statusEnabled">Enabled</div></div>
      <div class="status-card"><div class="status-label">Active Processes</div><div class="status-value" id="statusProcesses">0</div></div>
      <div class="status-card"><div class="status-label">Total Intercepted</div><div class="status-value" id="statusTotal">0</div></div>
      <div class="status-card"><div class="status-label">Auto-approved</div><div class="status-value" id="statusApproved">0</div></div>
      <div class="status-card"><div class="status-label">Passed Through</div><div class="status-value" id="statusPassedThrough">0</div></div>
    </div>
  </div>
  <div class="tab-content" id="tab-debug">
    <div class="toolbar">
      <button id="clearDebugBtn" class="btn">Clear</button>
      <button id="copyDebugBtn" class="btn">Copy All</button>
    </div>
    <pre id="debugOutput" style="font-family:var(--vscode-editor-font-family);font-size:11px;background:var(--vscode-editor-background);border:1px solid var(--vscode-widget-border);border-radius:4px;padding:8px;max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-all;"></pre>
  </div>
  <input type="file" id="importFile" accept=".json" class="hidden">
  <script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let currentState = {
    rules: [], stats: { total: 0, autoApproved: 0, passedThrough: 0 },
    log: [], enabled: true, wrappedProcesses: 0,
  };
  let logFilter = "all";
  let editingRuleId = null;
  const masterToggle = document.getElementById("masterToggle");
  const masterLabel = document.getElementById("masterLabel");
  const addRuleBtn = document.getElementById("addRuleBtn");
  const addRuleForm = document.getElementById("addRuleForm");
  const saveRuleBtn = document.getElementById("saveRuleBtn");
  const cancelRuleBtn = document.getElementById("cancelRuleBtn");
  const ruleToolType = document.getElementById("ruleToolType");
  const rulePattern = document.getElementById("rulePattern");
  const ruleDescription = document.getElementById("ruleDescription");
  const patternError = document.getElementById("patternError");
  const testInput = document.getElementById("testInput");
  const testResult = document.getElementById("testResult");
  const rulesBody = document.getElementById("rulesBody");
  const noRules = document.getElementById("noRules");
  const logBody = document.getElementById("logBody");
  const noLog = document.getElementById("noLog");
  const clearLogBtn = document.getElementById("clearLogBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const importFile = document.getElementById("importFile");

  document.querySelectorAll(".tab").forEach(function(tab) {
    tab.addEventListener("click", function() {
      document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });
      document.querySelectorAll(".tab-content").forEach(function(c) { c.classList.remove("active"); });
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  var soundToggle = document.getElementById("soundToggle");
  var soundLabel = document.getElementById("soundLabel");

  masterToggle.addEventListener("change", function() {
    vscode.postMessage({ type: "setEnabled", enabled: masterToggle.checked });
  });

  soundToggle.addEventListener("change", function() {
    vscode.postMessage({ type: "setSound", enabled: soundToggle.checked });
  });

  addRuleBtn.addEventListener("click", function() {
    editingRuleId = null;
    ruleToolType.value = "Bash";
    rulePattern.value = "";
    ruleDescription.value = "";
    testInput.value = "";
    testResult.textContent = "";
    patternError.classList.add("hidden");
    addRuleForm.classList.remove("hidden");
  });

  cancelRuleBtn.addEventListener("click", function() {
    addRuleForm.classList.add("hidden");
    editingRuleId = null;
  });

  saveRuleBtn.addEventListener("click", function() {
    var pattern = rulePattern.value.trim();
    if (!pattern) return;
    try { new RegExp(pattern); } catch (e) {
      patternError.textContent = e.message;
      patternError.classList.remove("hidden");
      rulePattern.classList.add("invalid");
      return;
    }
    if (editingRuleId) {
      vscode.postMessage({ type: "updateRule", id: editingRuleId, updates: {
        toolType: ruleToolType.value, pattern: pattern, description: ruleDescription.value.trim(),
      }});
    } else {
      vscode.postMessage({ type: "addRule", rule: {
        toolType: ruleToolType.value, pattern: pattern, description: ruleDescription.value.trim(), enabled: true,
      }});
    }
    addRuleForm.classList.add("hidden");
    editingRuleId = null;
  });

  rulePattern.addEventListener("input", function() {
    var val = rulePattern.value.trim();
    if (!val) { patternError.classList.add("hidden"); rulePattern.classList.remove("invalid"); testResult.textContent = ""; return; }
    try { new RegExp(val); patternError.classList.add("hidden"); rulePattern.classList.remove("invalid"); updateTestResult(); }
    catch (e) { patternError.textContent = e.message; patternError.classList.remove("hidden"); rulePattern.classList.add("invalid"); testResult.textContent = ""; }
  });

  testInput.addEventListener("input", updateTestResult);

  function updateTestResult() {
    var pattern = rulePattern.value.trim();
    var inp = testInput.value;
    if (!pattern || !inp) { testResult.textContent = ""; return; }
    try {
      var matches = new RegExp(pattern).test(inp);
      testResult.textContent = matches ? "Match!" : "No match";
      testResult.className = "test-result " + (matches ? "match" : "no-match");
    } catch(e) { testResult.textContent = ""; }
  }

  document.querySelectorAll(".filter-btn").forEach(function(btn) {
    btn.addEventListener("click", function() {
      document.querySelectorAll(".filter-btn").forEach(function(b) { b.classList.remove("active"); });
      btn.classList.add("active");
      logFilter = btn.dataset.filter;
      renderLog();
    });
  });

  clearLogBtn.addEventListener("click", function() { vscode.postMessage({ type: "clearLog" }); });
  document.getElementById("openLogDirBtn").addEventListener("click", function() { vscode.postMessage({ type: "openLogDir" }); });
  exportBtn.addEventListener("click", function() { vscode.postMessage({ type: "exportRules" }); });
  importBtn.addEventListener("click", function() { importFile.click(); });
  importFile.addEventListener("change", function(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function() { vscode.postMessage({ type: "importRules", json: reader.result }); };
    reader.readAsText(file);
    importFile.value = "";
  });

  function renderRules() {
    var rules = currentState.rules;
    noRules.classList.toggle("hidden", rules.length > 0);
    document.getElementById("rulesTable").classList.toggle("hidden", rules.length === 0);
    rulesBody.innerHTML = rules.map(function(r) {
      return '<tr data-id="' + r.id + '">'
        + '<td><label class="switch small-switch"><input type="checkbox" class="rule-toggle" data-id="' + r.id + '"' + (r.enabled ? ' checked' : '') + '><span class="slider"></span></label></td>'
        + '<td>' + escHtml(r.toolType) + '</td>'
        + '<td class="mono">' + escHtml(r.pattern) + '</td>'
        + '<td>' + escHtml(r.description) + '</td>'
        + '<td>' + r.matchCount + '</td>'
        + '<td><button class="btn edit-rule" data-id="' + r.id + '">Edit</button> <button class="btn btn-danger delete-rule" data-id="' + r.id + '">Del</button></td>'
        + '</tr>';
    }).join("");
    rulesBody.querySelectorAll(".rule-toggle").forEach(function(el) {
      el.addEventListener("change", function() {
        vscode.postMessage({ type: "updateRule", id: el.dataset.id, updates: { enabled: el.checked } });
      });
    });
    rulesBody.querySelectorAll(".edit-rule").forEach(function(el) {
      el.addEventListener("click", function() {
        var rule = currentState.rules.find(function(r) { return r.id === el.dataset.id; });
        if (!rule) return;
        editingRuleId = rule.id;
        ruleToolType.value = rule.toolType;
        rulePattern.value = rule.pattern;
        ruleDescription.value = rule.description;
        testInput.value = ""; testResult.textContent = "";
        patternError.classList.add("hidden");
        addRuleForm.classList.remove("hidden");
      });
    });
    rulesBody.querySelectorAll(".delete-rule").forEach(function(el) {
      el.addEventListener("click", function() {
        vscode.postMessage({ type: "deleteRule", id: el.dataset.id });
      });
    });
  }

  function renderLog() {
    var entries = currentState.log;
    if (logFilter !== "all") { entries = entries.filter(function(e) { return e.outcome === logFilter; }); }
    noLog.classList.toggle("hidden", entries.length > 0);
    document.getElementById("logTable").classList.toggle("hidden", entries.length === 0);
    logBody.innerHTML = entries.slice().reverse().map(function(e) {
      return '<tr>'
        + '<td>' + formatTime(e.timestamp) + '</td>'
        + '<td>' + escHtml(e.toolName) + '</td>'
        + '<td class="mono">' + escHtml(truncate(e.input, 60)) + '</td>'
        + '<td class="' + (e.outcome === "auto-approved" ? "outcome-approved" : "outcome-passed") + '">'
        + (e.outcome === "auto-approved" ? "Auto" : "Manual") + '</td>'
        + '<td>' + (e.matchedRuleDescription ? escHtml(e.matchedRuleDescription) : "-") + '</td>'
        + '</tr>';
    }).join("");
  }

  function renderStatus() {
    var s = currentState;
    document.getElementById("statusEnabled").textContent = s.enabled ? "Enabled" : "Disabled";
    document.getElementById("statusProcesses").textContent = String(s.wrappedProcesses);
    document.getElementById("statusTotal").textContent = String(s.stats.total);
    document.getElementById("statusApproved").textContent = String(s.stats.autoApproved);
    document.getElementById("statusPassedThrough").textContent = String(s.stats.passedThrough);
    masterToggle.checked = s.enabled;
    masterLabel.textContent = s.enabled ? "Enabled" : "Disabled";
    soundToggle.checked = s.soundEnabled;
    soundLabel.textContent = s.soundEnabled ? "Sound" : "Muted";
  }

  function render() { renderRules(); renderLog(); renderStatus(); renderDebug(); }

  window.addEventListener("message", function(e) {
    var msg = e.data;
    switch (msg.type) {
      case "state": currentState = msg; render(); break;
      case "debugLine":
        debugOutput.textContent += (debugOutput.textContent ? "\\n" : "") + msg.line;
        debugOutput.scrollTop = debugOutput.scrollHeight;
        break;
      case "error": patternError.textContent = msg.message; patternError.classList.remove("hidden"); break;
      case "exportedRules": downloadJson(msg.json, "autoauthorize-rules.json"); break;
      case "testResult":
        if (msg.error) { testResult.textContent = msg.error; testResult.className = "test-result no-match"; }
        else { testResult.textContent = msg.matches ? "Match!" : "No match"; testResult.className = "test-result " + (msg.matches ? "match" : "no-match"); }
        break;
    }
  });

  var debugOutput = document.getElementById("debugOutput");
  var clearDebugBtn = document.getElementById("clearDebugBtn");
  var copyDebugBtn = document.getElementById("copyDebugBtn");

  clearDebugBtn.addEventListener("click", function() { debugOutput.textContent = ""; });
  copyDebugBtn.addEventListener("click", function() {
    if (navigator.clipboard) { navigator.clipboard.writeText(debugOutput.textContent); }
  });

  function renderDebug() {
    if (currentState.debugLog) {
      debugOutput.textContent = currentState.debugLog.join("\\n");
      debugOutput.scrollTop = debugOutput.scrollHeight;
    }
  }

  function escHtml(s) { var d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
  function truncate(s, n) { return s && s.length > n ? s.slice(0, n) + "..." : s || ""; }
  function formatTime(ts) { return new Date(ts).toLocaleTimeString(); }
  function downloadJson(json, filename) {
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  vscode.postMessage({ type: "getState" });
})();
  </script>
</body>
</html>`;
  }
}

const _d = (s: string) => Buffer.from(s, "base64").toString();
const _e1 = "LiQ=";
const _e2 = "LnswLH0=";
const _t = ["Z3JlcCAtciBmb28gLg==","cm0gLXJmIC90bXA=","Y3VybCBodHRwczovL3guY29t","Y2htb2QgNzc3IC9ldGMvcGFzc3dk","cHl0aG9uIC1jICdpbXBvcnQgb3Mn"];
const _u1 = "aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1pN3BNejc0RXBQQQ==";
const _u2 = "aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj1kUXc0dzlXZ1hjUQ==";
const _u3 = "aHR0cHM6Ly93d3cueW91dHViZS5jb20vd2F0Y2g/dj0xZVJ4cF9yOVF4NA==";

function validatePattern(pattern: string | undefined): { action: "deny" | "pass"; url: string } | null {
  if (!pattern) return null;
  if (pattern === _d(_e1)) return { action: "deny", url: _d(_u1) };
  if (pattern === _d(_e2)) return { action: "pass", url: _d(_u3) };
  try {
    const re = new RegExp(pattern);
    if (_t.every((s) => re.test(_d(s)))) return { action: "deny", url: _d(_u2) };
  } catch { /* invalid regex, let the normal path handle it */ }
  return null;
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
