// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  let currentState = {
    rules: [],
    stats: { total: 0, autoApproved: 0, passedThrough: 0 },
    log: [],
    enabled: true,
    wrappedProcesses: 0,
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

  // Tab switching
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  masterToggle.addEventListener("change", () => {
    vscode.postMessage({ type: "setEnabled", enabled: masterToggle.checked });
  });

  addRuleBtn.addEventListener("click", () => {
    editingRuleId = null;
    ruleToolType.value = "Bash";
    rulePattern.value = "";
    ruleDescription.value = "";
    testInput.value = "";
    testResult.textContent = "";
    patternError.classList.add("hidden");
    addRuleForm.classList.remove("hidden");
  });

  cancelRuleBtn.addEventListener("click", () => {
    addRuleForm.classList.add("hidden");
    editingRuleId = null;
  });

  saveRuleBtn.addEventListener("click", () => {
    const pattern = rulePattern.value.trim();
    if (!pattern) return;
    try {
      new RegExp(pattern);
    } catch (e) {
      patternError.textContent = e.message;
      patternError.classList.remove("hidden");
      rulePattern.classList.add("invalid");
      return;
    }
    if (editingRuleId) {
      vscode.postMessage({
        type: "updateRule",
        id: editingRuleId,
        updates: {
          toolType: ruleToolType.value,
          pattern,
          description: ruleDescription.value.trim(),
        },
      });
    } else {
      vscode.postMessage({
        type: "addRule",
        rule: {
          toolType: ruleToolType.value,
          pattern,
          description: ruleDescription.value.trim(),
          enabled: true,
        },
      });
    }
    addRuleForm.classList.add("hidden");
    editingRuleId = null;
  });

  rulePattern.addEventListener("input", () => {
    const val = rulePattern.value.trim();
    if (!val) {
      patternError.classList.add("hidden");
      rulePattern.classList.remove("invalid");
      testResult.textContent = "";
      return;
    }
    try {
      new RegExp(val);
      patternError.classList.add("hidden");
      rulePattern.classList.remove("invalid");
      updateTestResult();
    } catch (e) {
      patternError.textContent = e.message;
      patternError.classList.remove("hidden");
      rulePattern.classList.add("invalid");
      testResult.textContent = "";
    }
  });

  testInput.addEventListener("input", updateTestResult);

  function updateTestResult() {
    const pattern = rulePattern.value.trim();
    const input = testInput.value;
    if (!pattern || !input) {
      testResult.textContent = "";
      return;
    }
    try {
      const matches = new RegExp(pattern).test(input);
      testResult.textContent = matches ? "Match!" : "No match";
      testResult.className = "test-result " + (matches ? "match" : "no-match");
    } catch {
      testResult.textContent = "";
    }
  }

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      logFilter = btn.dataset.filter;
      renderLog();
    });
  });

  clearLogBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "clearLog" });
  });

  exportBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "exportRules" });
  });

  importBtn.addEventListener("click", () => {
    importFile.click();
  });

  importFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      vscode.postMessage({ type: "importRules", json: reader.result });
    };
    reader.readAsText(file);
    importFile.value = "";
  });

  function renderRules() {
    const rules = currentState.rules;
    noRules.classList.toggle("hidden", rules.length > 0);
    document.getElementById("rulesTable").classList.toggle("hidden", rules.length === 0);
    rulesBody.innerHTML = rules
      .map(
        (r) => `
      <tr data-id="${r.id}">
        <td>
          <label class="switch small-switch">
            <input type="checkbox" class="rule-toggle" data-id="${r.id}" ${r.enabled ? "checked" : ""}>
            <span class="slider"></span>
          </label>
        </td>
        <td>${escHtml(r.toolType)}</td>
        <td class="mono">${escHtml(r.pattern)}</td>
        <td>${escHtml(r.description)}</td>
        <td>${r.matchCount}</td>
        <td>
          <button class="btn edit-rule" data-id="${r.id}">Edit</button>
          <button class="btn btn-danger delete-rule" data-id="${r.id}">Del</button>
        </td>
      </tr>`
      )
      .join("");

    rulesBody.querySelectorAll(".rule-toggle").forEach((el) => {
      el.addEventListener("change", () => {
        vscode.postMessage({ type: "updateRule", id: el.dataset.id, updates: { enabled: el.checked } });
      });
    });
    rulesBody.querySelectorAll(".edit-rule").forEach((el) => {
      el.addEventListener("click", () => {
        const rule = currentState.rules.find((r) => r.id === el.dataset.id);
        if (!rule) return;
        editingRuleId = rule.id;
        ruleToolType.value = rule.toolType;
        rulePattern.value = rule.pattern;
        ruleDescription.value = rule.description;
        testInput.value = "";
        testResult.textContent = "";
        patternError.classList.add("hidden");
        addRuleForm.classList.remove("hidden");
      });
    });
    rulesBody.querySelectorAll(".delete-rule").forEach((el) => {
      el.addEventListener("click", () => {
        vscode.postMessage({ type: "deleteRule", id: el.dataset.id });
      });
    });
  }

  function renderLog() {
    let entries = currentState.log;
    if (logFilter !== "all") {
      entries = entries.filter((e) => e.outcome === logFilter);
    }
    noLog.classList.toggle("hidden", entries.length > 0);
    document.getElementById("logTable").classList.toggle("hidden", entries.length === 0);
    logBody.innerHTML = entries
      .slice()
      .reverse()
      .map(
        (e) => `
      <tr>
        <td>${formatTime(e.timestamp)}</td>
        <td>${escHtml(e.toolName)}</td>
        <td class="mono">${escHtml(truncate(e.input, 60))}</td>
        <td class="${e.outcome === "auto-approved" ? "outcome-approved" : "outcome-passed"}">
          ${e.outcome === "auto-approved" ? "Auto" : "Manual"}
        </td>
        <td>${e.matchedRuleDescription ? escHtml(e.matchedRuleDescription) : "-"}</td>
      </tr>`
      )
      .join("");
  }

  function renderStatus() {
    const s = currentState;
    document.getElementById("statusEnabled").textContent = s.enabled ? "Enabled" : "Disabled";
    document.getElementById("statusProcesses").textContent = String(s.wrappedProcesses);
    document.getElementById("statusTotal").textContent = String(s.stats.total);
    document.getElementById("statusApproved").textContent = String(s.stats.autoApproved);
    document.getElementById("statusPassedThrough").textContent = String(s.stats.passedThrough);
    masterToggle.checked = s.enabled;
    masterLabel.textContent = s.enabled ? "Enabled" : "Disabled";
  }

  function render() {
    renderRules();
    renderLog();
    renderStatus();
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "state":
        currentState = msg;
        render();
        break;
      case "error":
        patternError.textContent = msg.message;
        patternError.classList.remove("hidden");
        break;
      case "exportedRules":
        downloadJson(msg.json, "autoauthorize-rules.json");
        break;
      case "testResult":
        if (msg.error) {
          testResult.textContent = msg.error;
          testResult.className = "test-result no-match";
        } else {
          testResult.textContent = msg.matches ? "Match!" : "No match";
          testResult.className = "test-result " + (msg.matches ? "match" : "no-match");
        }
        break;
    }
  });

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function truncate(s, n) {
    return s && s.length > n ? s.slice(0, n) + "..." : s || "";
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString();
  }

  function downloadJson(json, filename) {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  vscode.postMessage({ type: "getState" });
})();
