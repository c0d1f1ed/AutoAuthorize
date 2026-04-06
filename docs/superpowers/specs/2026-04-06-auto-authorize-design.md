# AutoAuthorize: VSCode Extension Design Spec

## Context

Users with enterprise-managed Claude Code subscriptions cannot modify permission rules or PreToolUse hooks — these are locked by organizational policy. This forces manual approval of every tool request, even benign commands like `grep` or `ls`. AutoAuthorize is a VSCode extension that intercepts Claude Code's CLI subprocess communication to automatically approve tool requests matching user-defined regex patterns, bypassing the need for manual approval.

## Chosen Approach: child_process.spawn Wrapper

All VSCode extensions share the same Node.js extension host process. AutoAuthorize monkey-patches `child_process.spawn` before Claude Code activates, wrapping the stdio streams of Claude CLI subprocesses. Permission request messages (`can_use_tool`) are intercepted, tested against regex rules, and either auto-approved (response written directly to stdin) or passed through to the normal approval flow.

### Why This Approach

- Works regardless of enterprise-managed settings — operates at the Node.js process level, not Claude Code's configuration
- Full regex support (not limited to glob patterns)
- Clean separation — never modifies Claude Code's files or settings
- The CLI process receives standard approval responses, indistinguishable from manual approval
- Operates at a well-defined protocol boundary (JSON stdio messages)

### Rejected Alternatives

**Webview Prototype Patching:** Intercept at VSCode's webview `postMessage` prototype level. Rejected because: extremely fragile (depends on VSCode internal class hierarchy), could break other extensions' webviews, and the response synthesis is harder since the webview protocol is more complex than the CLI stdio protocol.

**Extension Module Cache Patching:** Access Claude Code's bundled `extension.js` via Node.js `require.cache` and patch internal functions. Rejected because: the code is minified/bundled making function identification brittle, breaks on every Claude Code update, and hardest to maintain of all approaches.

## Architecture

```
Extension Host (shared Node.js process)
├── AutoAuthorize Extension
│   ├── activate() — patches child_process.spawn
│   ├── SpawnWrapper — identifies Claude CLI processes, wraps stdio
│   ├── MessageInterceptor — parses JSON messages, evaluates rules
│   ├── RuleEngine — stores and evaluates regex rules
│   ├── ActivityLog — records all interceptions
│   └── ManagementPanel — webview UI for rules and status
└── Claude Code Extension
    └── spawns Claude CLI subprocess (now wrapped)
```

## Component Details

### 1. Spawn Wrapper

**Activation:** Uses `"*"` activation event to ensure the patch is in place before Claude Code's `onStartupFinished` activation.

**Process identification:** When `child_process.spawn` is called, check if the command path contains "claude" (case-insensitive) AND the arguments include IDE-related flags (e.g., `--ide`, `--vscode`, or `--channel`). This avoids false positives from unrelated processes that happen to have "claude" in the path. The exact identification heuristic should be refined during implementation by observing the actual spawn arguments used by Claude Code.

**Wrapping:** For identified processes:
- Replace `stdout` data events with a wrapper that buffers and parses newline-delimited JSON
- Keep a reference to `stdin` for writing approval responses
- Track all wrapped processes for cleanup

**Multiple sessions:** Each Claude CLI process gets its own independent stream wrapper. All are tracked and cleaned up on deactivation.

**Deactivation:** Restore original `child_process.spawn`. Existing wrapped processes continue to work until they exit.

### 2. Message Interceptor

**Protocol:** Claude CLI communicates via newline-delimited JSON over stdio. Note: the exact message schema below is inferred from minified source analysis. The first implementation step should be a "observe mode" that logs raw messages without intercepting, to verify the actual format before wiring up auto-approval.

**Inbound (CLI stdout) — permission request:**
```json
{
  "type": "control_request",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "Bash",
    "input": { "command": "grep -r pattern ." },
    "request_id": "<uuid>",
    "tool_use_id": "<uuid>",
    "title": "...",
    "description": "..."
  }
}
```

**Outbound (CLI stdin) — approval response:**
```json
{
  "type": "control_response",
  "response": {
    "subtype": "can_use_tool",
    "request_id": "<matches request>",
    "tool_use_id": "<matches request>",
    "action": "approve"
  }
}
```

**Stream framing:** Data arrives in arbitrary chunks. The interceptor:
1. Appends each chunk to a per-process buffer
2. Splits on `\n` to extract complete lines
3. Attempts JSON.parse on each line
4. If a line is a `can_use_tool` control_request, evaluates against rules
5. On match: writes approval to stdin, drops the line from the forwarded buffer
6. On no match or parse failure: forwards the original bytes unchanged

**Error handling:** If JSON parsing fails or the message structure is unexpected, the message is forwarded unchanged. The extension never blocks or corrupts the communication channel.

### 3. Rule Engine

**Rule model:**
```typescript
interface AutoApproveRule {
  id: string;           // UUID
  toolType: "Bash" | "Read" | "Write" | "Edit" | "*";
  pattern: string;      // Regex pattern string
  description: string;  // User label
  enabled: boolean;
  matchCount: number;   // Lifetime matches
}
```

**Match targets by tool type:**
| Tool | Match target field |
|------|-------------------|
| Bash | `input.command` |
| Read | `input.file_path` |
| Write | `input.file_path` |
| Edit | `input.file_path` |
| * | `"<tool_name>: <primary_input>"` (for unknown tools, uses JSON.stringify of input) |

**Evaluation:** Rules are evaluated in definition order. First matching enabled rule wins — the request is auto-approved. If no rules match, the message passes through to Claude Code's normal approval flow.

**Regex compilation:** Patterns are compiled to `RegExp` objects on rule creation/edit. Invalid patterns are rejected at input time. Compiled regexes are cached for performance.

**Storage:** `context.globalState` — persisted per machine, not synced. Avoids leaking personal rules through enterprise Settings Sync. Rules can be imported/exported as JSON.

### 4. Activity Log

Records every intercepted `can_use_tool` request:
```typescript
interface LogEntry {
  timestamp: number;
  toolName: string;
  input: string;        // The command or file path
  outcome: "auto-approved" | "passed-through";
  matchedRule?: string;  // Rule ID if auto-approved
}
```

Log is kept in memory with a configurable max size (default: 500 entries, oldest evicted). Not persisted across sessions.

### 5. Management Panel (Webview)

Opens via command palette (`AutoAuthorize: Open Panel`) and a sidebar activity bar icon.

**Three tabs:**

**Rules tab:**
- Table: Enabled toggle | Pattern | Tool filter | Description | Match count | Edit / Delete
- "Add Rule" button → inline form:
  - Regex pattern input with live validation (red border + error message on invalid regex)
  - Tool type dropdown (Bash, Read, Write, Edit, Any)
  - Description text field
  - "Test" input: paste a sample command/path, see real-time match result
- Drag to reorder (affects evaluation priority)

**Activity Log tab:**
- Chronological list of intercepted requests
- Columns: Time | Tool | Command/Path | Outcome | Matched Rule
- Filter buttons: All | Auto-approved | Passed-through

**Status tab:**
- Master enable/disable toggle
- Number of active wrapped processes
- Stats: total intercepted, auto-approved count, pass-through count
- Extension version and Claude Code version detected

**Webview implementation:** Standard VSCode webview panel with HTML/CSS/JS. Communication via `postMessage` between the extension host and webview. No external dependencies — vanilla HTML/CSS with minimal JS.

## Extension Manifest

```json
{
  "name": "auto-authorize",
  "displayName": "AutoAuthorize for Claude Code",
  "description": "Automatically approve Claude Code tool requests matching regex patterns",
  "publisher": "local",
  "version": "0.1.0",
  "engines": { "vscode": "^1.85.0" },
  "activationEvents": ["*"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      { "command": "autoAuthorize.openPanel", "title": "AutoAuthorize: Open Panel" },
      { "command": "autoAuthorize.enable", "title": "AutoAuthorize: Enable" },
      { "command": "autoAuthorize.disable", "title": "AutoAuthorize: Disable" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "autoAuthorize", "title": "AutoAuthorize", "icon": "resources/icon.svg" }
      ]
    }
  }
}
```

## File Structure

```
auto-authorize/
├── package.json
├── tsconfig.json
├── src/
│   ├── extension.ts          # activate/deactivate, spawn patching
│   ├── spawnWrapper.ts       # Process identification and stdio wrapping
│   ├── messageInterceptor.ts # JSON stream parsing, message routing
│   ├── ruleEngine.ts         # Rule storage, evaluation, import/export
│   ├── activityLog.ts        # In-memory log of interceptions
│   └── panel/
│       ├── panelProvider.ts  # Webview panel lifecycle
│       └── webview/
│           ├── index.html    # Panel HTML
│           ├── style.css     # Panel styles
│           └── main.js       # Panel JS (rule CRUD, log display, status)
├── resources/
│   └── icon.svg              # Activity bar icon
└── out/                      # Compiled output
```

## Edge Cases

1. **Claude Code not installed:** Extension activates but spawn wrapper never matches a Claude process. No-op.
2. **Claude Code updates change protocol:** Unrecognized message structures are forwarded unchanged. Auto-approval silently stops for unrecognizable messages — fails safe.
3. **Session started before activation:** Processes already running can't be wrapped. The user must restart the Claude session. Status tab indicates this.
4. **Invalid regex in rule:** Caught at input time, rule is not saved. If a persisted rule becomes invalid (shouldn't happen), it's skipped during evaluation.
5. **Performance:** Regex evaluation is sub-millisecond. JSON parsing is the main cost — negligible for the message volume (one per tool use).
6. **Extension deactivation:** Original `spawn` restored. Existing wrapped processes continue working until they exit.

## Verification Plan

1. **Unit tests:** Rule engine regex matching, message parsing, stream framing with split chunks
2. **Integration test:** Mock a child process, send simulated `can_use_tool` messages, verify auto-approval and pass-through
3. **Manual testing:**
   - Install extension in VSCode alongside Claude Code
   - Add a rule like `^grep\b` for Bash
   - Start a Claude session and ask it to grep something
   - Verify the command executes without showing an approval prompt
   - Ask Claude to run something not matching any rule (e.g., `rm`)
   - Verify the normal approval prompt appears
   - Check activity log shows both entries correctly
