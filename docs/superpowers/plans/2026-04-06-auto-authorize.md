# AutoAuthorize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VSCode extension that monkey-patches `child_process.spawn` to intercept Claude Code's CLI permission requests and auto-approve those matching user-defined regex patterns.

**Architecture:** The extension patches `child_process.spawn` before Claude Code activates. When Claude Code spawns its CLI, we wrap stdout/stdin to intercept newline-delimited JSON messages. `can_use_tool` control requests are tested against a regex rule engine; matches get instant approval responses written to stdin, non-matches pass through normally. A webview panel provides rule management, activity log, and status.

**Tech Stack:** TypeScript, VSCode Extension API, vanilla HTML/CSS/JS for webview panel, vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-04-06-auto-authorize-design.md`

---

## File Structure

```
c:\src\AutoAuthorize\
├── package.json              # Extension manifest + dependencies
├── tsconfig.json             # TypeScript configuration
├── .vscodeignore             # Files to exclude from VSIX
├── .gitignore
├── vitest.config.ts          # Test configuration
├── src/
│   ├── extension.ts          # activate/deactivate entry point
│   ├── spawnWrapper.ts       # Monkey-patch child_process.spawn
│   ├── streamParser.ts       # Newline-delimited JSON stream parser
│   ├── messageInterceptor.ts # Route can_use_tool messages through rule engine
│   ├── ruleEngine.ts         # Rule CRUD, storage, regex evaluation
│   ├── activityLog.ts        # In-memory log of interceptions
│   └── panel/
│       ├── panelProvider.ts  # Webview panel lifecycle + message handler
│       └── webview/
│           ├── index.html    # Panel HTML (3-tab layout)
│           ├── style.css     # Panel styles
│           └── main.js       # Panel JS (rule CRUD, log, status)
├── resources/
│   └── icon.svg              # Activity bar icon
├── test/
│   ├── ruleEngine.test.ts
│   ├── streamParser.test.ts
│   ├── messageInterceptor.test.ts
│   └── activityLog.test.ts
└── out/                      # Compiled output (gitignored)
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.vscodeignore`

- [ ] **Step 1: Initialize git repo**

```bash
cd c:/src/AutoAuthorize
git init
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "auto-authorize",
  "displayName": "AutoAuthorize for Claude Code",
  "description": "Automatically approve Claude Code tool requests matching regex patterns",
  "version": "0.1.0",
  "publisher": "local",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": ["*"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "autoAuthorize.openPanel",
        "title": "AutoAuthorize: Open Panel"
      },
      {
        "command": "autoAuthorize.enable",
        "title": "AutoAuthorize: Enable"
      },
      {
        "command": "autoAuthorize.disable",
        "title": "AutoAuthorize: Disable"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "autoAuthorize",
          "title": "AutoAuthorize",
          "icon": "resources/icon.svg"
        }
      ]
    },
    "views": {
      "autoAuthorize": [
        {
          "type": "webview",
          "id": "autoAuthorize.panel",
          "name": "AutoAuthorize"
        }
      ]
    }
  },
  "scripts": {
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "npx @vscode/vsce package --no-dependencies"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.85.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "outDir": "out",
    "rootDir": "src",
    "lib": ["ES2022"],
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "paths": {
      "vscode": ["./node_modules/@types/vscode"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "out", "test"]
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
out/
*.vsix
.vscode-test/
```

- [ ] **Step 5: Create `.vscodeignore`**

```
src/
test/
node_modules/
tsconfig.json
.gitignore
*.map
```

- [ ] **Step 6: Create activity bar icon**

Create `resources/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  <path d="M9 12l2 2 4-4"/>
</svg>
```

- [ ] **Step 7: Install dependencies and verify compilation**

```bash
cd c:/src/AutoAuthorize
npm install
```

Create a minimal `src/extension.ts` placeholder:

```typescript
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  console.log("AutoAuthorize activated");
}

export function deactivate() {}
```

```bash
npm run compile
```

Expected: `out/extension.js` is generated without errors.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json .gitignore .vscodeignore resources/icon.svg src/extension.ts
git commit -m "chore: scaffold AutoAuthorize VSCode extension project"
```

---

## Task 2: Rule Engine (TDD)

**Files:**
- Create: `src/ruleEngine.ts`
- Create: `test/ruleEngine.test.ts`

- [ ] **Step 1: Create vitest config**

Create `vitest.config.ts` at the project root:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write failing tests for rule engine**

Create `test/ruleEngine.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { RuleEngine, AutoApproveRule } from "../src/ruleEngine";

describe("RuleEngine", () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  describe("addRule", () => {
    it("should add a rule and return it with an id", () => {
      const rule = engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: true,
      });
      expect(rule.id).toBeDefined();
      expect(rule.pattern).toBe("^grep\\b");
      expect(rule.matchCount).toBe(0);
    });

    it("should throw on invalid regex", () => {
      expect(() =>
        engine.addRule({
          toolType: "Bash",
          pattern: "[invalid",
          description: "bad regex",
          enabled: true,
        })
      ).toThrow();
    });
  });

  describe("evaluate", () => {
    it("should match a Bash command against a Bash rule", () => {
      engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: true,
      });
      const result = engine.evaluate("Bash", "grep -r pattern .");
      expect(result).not.toBeNull();
      expect(result!.description).toBe("Allow grep");
    });

    it("should not match when tool type differs", () => {
      engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: true,
      });
      const result = engine.evaluate("Read", "/some/file.txt");
      expect(result).toBeNull();
    });

    it("should not match disabled rules", () => {
      engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: false,
      });
      const result = engine.evaluate("Bash", "grep -r pattern .");
      expect(result).toBeNull();
    });

    it("should match wildcard tool type against any tool", () => {
      engine.addRule({
        toolType: "*",
        pattern: ".*",
        description: "Allow all",
        enabled: true,
      });
      expect(engine.evaluate("Bash", "rm -rf /")).not.toBeNull();
      expect(engine.evaluate("Read", "/etc/passwd")).not.toBeNull();
    });

    it("should return first matching rule in order", () => {
      engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "First",
        enabled: true,
      });
      engine.addRule({
        toolType: "Bash",
        pattern: ".*",
        description: "Second",
        enabled: true,
      });
      const result = engine.evaluate("Bash", "grep foo");
      expect(result!.description).toBe("First");
    });

    it("should increment matchCount on match", () => {
      const rule = engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: true,
      });
      engine.evaluate("Bash", "grep foo");
      engine.evaluate("Bash", "grep bar");
      const rules = engine.getRules();
      expect(rules[0].matchCount).toBe(2);
    });

    it("should return null when no rules match", () => {
      engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: true,
      });
      const result = engine.evaluate("Bash", "rm -rf /");
      expect(result).toBeNull();
    });
  });

  describe("CRUD operations", () => {
    it("should update a rule", () => {
      const rule = engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: true,
      });
      engine.updateRule(rule.id, { pattern: "^rg\\b", description: "Allow ripgrep" });
      const updated = engine.getRules()[0];
      expect(updated.pattern).toBe("^rg\\b");
      expect(updated.description).toBe("Allow ripgrep");
    });

    it("should delete a rule", () => {
      const rule = engine.addRule({
        toolType: "Bash",
        pattern: "^grep\\b",
        description: "Allow grep",
        enabled: true,
      });
      engine.deleteRule(rule.id);
      expect(engine.getRules()).toHaveLength(0);
    });

    it("should reorder rules", () => {
      const r1 = engine.addRule({ toolType: "Bash", pattern: "a", description: "A", enabled: true });
      const r2 = engine.addRule({ toolType: "Bash", pattern: "b", description: "B", enabled: true });
      engine.reorderRules([r2.id, r1.id]);
      const rules = engine.getRules();
      expect(rules[0].description).toBe("B");
      expect(rules[1].description).toBe("A");
    });
  });

  describe("serialization", () => {
    it("should export and import rules", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true });
      engine.addRule({ toolType: "Read", pattern: "\\.ts$", description: "Allow TS reads", enabled: true });

      const exported = engine.exportRules();
      const engine2 = new RuleEngine();
      engine2.importRules(exported);

      expect(engine2.getRules()).toHaveLength(2);
      expect(engine2.getRules()[0].description).toBe("Allow grep");
    });
  });

  describe("getMatchTarget", () => {
    it("should extract command from Bash input", () => {
      expect(RuleEngine.getMatchTarget("Bash", { command: "grep foo" })).toBe("grep foo");
    });

    it("should extract file_path from Read input", () => {
      expect(RuleEngine.getMatchTarget("Read", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    });

    it("should extract file_path from Write input", () => {
      expect(RuleEngine.getMatchTarget("Write", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    });

    it("should extract file_path from Edit input", () => {
      expect(RuleEngine.getMatchTarget("Edit", { file_path: "/a/b.ts" })).toBe("/a/b.ts");
    });

    it("should stringify unknown tool input", () => {
      const target = RuleEngine.getMatchTarget("MCP", { server: "foo", tool: "bar" });
      expect(target).toBe('MCP: {"server":"foo","tool":"bar"}');
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd c:/src/AutoAuthorize
npx vitest run
```

Expected: All tests fail — `ruleEngine` module doesn't exist.

- [ ] **Step 4: Implement rule engine**

Create `src/ruleEngine.ts`:

```typescript
export type ToolType = "Bash" | "Read" | "Write" | "Edit" | "*";

export interface AutoApproveRule {
  id: string;
  toolType: ToolType;
  pattern: string;
  description: string;
  enabled: boolean;
  matchCount: number;
}

export interface RuleInput {
  toolType: ToolType;
  pattern: string;
  description: string;
  enabled: boolean;
}

export class RuleEngine {
  private rules: AutoApproveRule[] = [];
  private compiledPatterns = new Map<string, RegExp>();

  addRule(input: RuleInput): AutoApproveRule {
    // Validate regex
    const regex = new RegExp(input.pattern);

    const rule: AutoApproveRule = {
      id: crypto.randomUUID(),
      toolType: input.toolType,
      pattern: input.pattern,
      description: input.description,
      enabled: input.enabled,
      matchCount: 0,
    };

    this.rules.push(rule);
    this.compiledPatterns.set(rule.id, regex);
    return { ...rule };
  }

  updateRule(id: string, updates: Partial<Pick<AutoApproveRule, "pattern" | "description" | "enabled" | "toolType">>): void {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) throw new Error(`Rule not found: ${id}`);

    if (updates.pattern !== undefined) {
      const regex = new RegExp(updates.pattern);
      this.compiledPatterns.set(id, regex);
    }

    Object.assign(this.rules[index], updates);
  }

  deleteRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.compiledPatterns.delete(id);
  }

  reorderRules(orderedIds: string[]): void {
    const ruleMap = new Map(this.rules.map((r) => [r.id, r]));
    this.rules = orderedIds.map((id) => {
      const rule = ruleMap.get(id);
      if (!rule) throw new Error(`Rule not found: ${id}`);
      return rule;
    });
  }

  getRules(): AutoApproveRule[] {
    return this.rules.map((r) => ({ ...r }));
  }

  evaluate(toolName: string, matchTarget: string): AutoApproveRule | null {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.toolType !== "*" && rule.toolType !== toolName) continue;

      const regex = this.compiledPatterns.get(rule.id);
      if (regex && regex.test(matchTarget)) {
        rule.matchCount++;
        return { ...rule };
      }
    }
    return null;
  }

  static getMatchTarget(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case "Bash":
        return (input.command as string) ?? "";
      case "Read":
      case "Write":
      case "Edit":
        return (input.file_path as string) ?? "";
      default:
        return `${toolName}: ${JSON.stringify(input)}`;
    }
  }

  exportRules(): string {
    return JSON.stringify(this.rules);
  }

  importRules(json: string): void {
    const imported: AutoApproveRule[] = JSON.parse(json);
    this.rules = [];
    this.compiledPatterns.clear();
    for (const rule of imported) {
      const regex = new RegExp(rule.pattern);
      this.rules.push({ ...rule });
      this.compiledPatterns.set(rule.id, regex);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ruleEngine.ts test/ruleEngine.test.ts vitest.config.ts
git commit -m "feat: add rule engine with regex evaluation, CRUD, and serialization"
```

---

## Task 3: Stream Parser (TDD)

**Files:**
- Create: `src/streamParser.ts`
- Create: `test/streamParser.test.ts`

- [ ] **Step 1: Write failing tests for stream parser**

Create `test/streamParser.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { StreamParser } from "../src/streamParser";

describe("StreamParser", () => {
  it("should parse a complete JSON line", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);

    parser.feed(Buffer.from('{"type":"control_request","request":{"subtype":"can_use_tool"}}\n'));

    expect(onMessage).toHaveBeenCalledWith({
      type: "control_request",
      request: { subtype: "can_use_tool" },
    });
    expect(onPassthrough).not.toHaveBeenCalled();
  });

  it("should handle split chunks", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);

    parser.feed(Buffer.from('{"type":"con'));
    expect(onMessage).not.toHaveBeenCalled();

    parser.feed(Buffer.from('trol_request"}\n'));
    expect(onMessage).toHaveBeenCalledWith({ type: "control_request" });
  });

  it("should handle multiple messages in one chunk", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);

    parser.feed(Buffer.from('{"a":1}\n{"b":2}\n'));

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledWith({ a: 1 });
    expect(onMessage).toHaveBeenCalledWith({ b: 2 });
  });

  it("should pass through non-JSON lines", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);

    parser.feed(Buffer.from("not json\n"));

    expect(onMessage).not.toHaveBeenCalled();
    expect(onPassthrough).toHaveBeenCalledWith(Buffer.from("not json\n"));
  });

  it("should pass through incomplete lines when flushed", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);

    parser.feed(Buffer.from("partial"));
    parser.flush();

    expect(onPassthrough).toHaveBeenCalledWith(Buffer.from("partial"));
  });

  it("should handle empty lines", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);

    parser.feed(Buffer.from("\n\n"));

    expect(onMessage).not.toHaveBeenCalled();
    // Empty lines are passed through
    expect(onPassthrough).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/streamParser.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement stream parser**

Create `src/streamParser.ts`:

```typescript
export class StreamParser {
  private buffer = "";

  constructor(
    private onMessage: (msg: unknown) => void,
    private onPassthrough: (data: Buffer) => void
  ) {}

  feed(chunk: Buffer): void {
    this.buffer += chunk.toString("utf-8");

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line.length === 0) {
        this.onPassthrough(Buffer.from("\n"));
        continue;
      }

      try {
        const parsed = JSON.parse(line);
        this.onMessage(parsed);
      } catch {
        this.onPassthrough(Buffer.from(line + "\n"));
      }
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onPassthrough(Buffer.from(this.buffer));
      this.buffer = "";
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run test/streamParser.test.ts
```

Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/streamParser.ts test/streamParser.test.ts
git commit -m "feat: add newline-delimited JSON stream parser"
```

---

## Task 4: Message Interceptor (TDD)

**Files:**
- Create: `src/messageInterceptor.ts`
- Create: `test/messageInterceptor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/messageInterceptor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageInterceptor } from "../src/messageInterceptor";
import { RuleEngine } from "../src/ruleEngine";
import { ActivityLog } from "../src/activityLog";

describe("MessageInterceptor", () => {
  let ruleEngine: RuleEngine;
  let activityLog: ActivityLog;
  let interceptor: MessageInterceptor;
  let sendResponse: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ruleEngine = new RuleEngine();
    activityLog = new ActivityLog(100);
    sendResponse = vi.fn();
    interceptor = new MessageInterceptor(ruleEngine, activityLog, sendResponse);
  });

  function makeCanUseTool(toolName: string, input: Record<string, unknown>) {
    return {
      type: "control_request",
      request_id: "req-123",
      request: {
        subtype: "can_use_tool",
        tool_name: toolName,
        input,
        tool_use_id: "tu-456",
      },
    };
  }

  it("should auto-approve when rule matches", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true });
    const msg = makeCanUseTool("Bash", { command: "grep -r foo ." });

    const handled = interceptor.handleMessage(msg);

    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "control_response",
        response: expect.objectContaining({
          request_id: "req-123",
        }),
      })
    );
  });

  it("should pass through when no rule matches", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true });
    const msg = makeCanUseTool("Bash", { command: "rm -rf /" });

    const handled = interceptor.handleMessage(msg);

    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("should pass through non-control_request messages", () => {
    const msg = { type: "other", data: "stuff" };
    const handled = interceptor.handleMessage(msg);

    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("should pass through non-can_use_tool control requests", () => {
    const msg = {
      type: "control_request",
      request_id: "req-123",
      request: { subtype: "hook_callback" },
    };
    const handled = interceptor.handleMessage(msg);

    expect(handled).toBe(false);
  });

  it("should log auto-approved requests to activity log", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true });
    const msg = makeCanUseTool("Bash", { command: "grep foo" });

    interceptor.handleMessage(msg);

    const entries = activityLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe("auto-approved");
    expect(entries[0].toolName).toBe("Bash");
    expect(entries[0].input).toBe("grep foo");
  });

  it("should log passed-through requests to activity log", () => {
    const msg = makeCanUseTool("Bash", { command: "rm -rf /" });

    interceptor.handleMessage(msg);

    const entries = activityLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe("passed-through");
  });

  it("should not auto-approve when globally disabled", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true });
    interceptor.setEnabled(false);

    const msg = makeCanUseTool("Bash", { command: "grep foo" });
    const handled = interceptor.handleMessage(msg);

    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/messageInterceptor.test.ts
```

Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement activity log first (dependency)**

Create `src/activityLog.ts`:

```typescript
export interface LogEntry {
  timestamp: number;
  toolName: string;
  input: string;
  outcome: "auto-approved" | "passed-through";
  matchedRuleId?: string;
  matchedRuleDescription?: string;
}

export class ActivityLog {
  private entries: LogEntry[] = [];
  private listeners: Array<(entry: LogEntry) => void> = [];

  constructor(private maxSize: number = 500) {}

  add(entry: Omit<LogEntry, "timestamp">): void {
    const full: LogEntry = { ...entry, timestamp: Date.now() };
    this.entries.push(full);
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }
    for (const listener of this.listeners) {
      listener(full);
    }
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }

  onEntry(listener: (entry: LogEntry) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getStats(): { total: number; autoApproved: number; passedThrough: number } {
    let autoApproved = 0;
    let passedThrough = 0;
    for (const entry of this.entries) {
      if (entry.outcome === "auto-approved") autoApproved++;
      else passedThrough++;
    }
    return { total: this.entries.length, autoApproved, passedThrough };
  }
}
```

- [ ] **Step 4: Implement message interceptor**

Create `src/messageInterceptor.ts`:

```typescript
import { RuleEngine } from "./ruleEngine";
import { ActivityLog } from "./activityLog";

interface CanUseToolRequest {
  type: "control_request";
  request_id: string;
  request: {
    subtype: "can_use_tool";
    tool_name: string;
    input: Record<string, unknown>;
    tool_use_id: string;
    [key: string]: unknown;
  };
}

function isCanUseToolRequest(msg: unknown): msg is CanUseToolRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== "control_request") return false;
  if (typeof m.request !== "object" || m.request === null) return false;
  const req = m.request as Record<string, unknown>;
  return req.subtype === "can_use_tool";
}

export class MessageInterceptor {
  private enabled = true;

  constructor(
    private ruleEngine: RuleEngine,
    private activityLog: ActivityLog,
    private sendResponse: (response: unknown) => void
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  handleMessage(msg: unknown): boolean {
    if (!isCanUseToolRequest(msg)) return false;

    const { tool_name, input, tool_use_id } = msg.request;
    const matchTarget = RuleEngine.getMatchTarget(tool_name, input);

    if (this.enabled) {
      const matchedRule = this.ruleEngine.evaluate(tool_name, matchTarget);

      if (matchedRule) {
        this.sendResponse({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: msg.request_id,
            response: {
              toolUseID: tool_use_id,
              approved: true,
            },
          },
        });

        this.activityLog.add({
          toolName: tool_name,
          input: matchTarget,
          outcome: "auto-approved",
          matchedRuleId: matchedRule.id,
          matchedRuleDescription: matchedRule.description,
        });

        return true;
      }
    }

    this.activityLog.add({
      toolName: tool_name,
      input: matchTarget,
      outcome: "passed-through",
    });

    return false;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run
```

Expected: All tests pass (ruleEngine, streamParser, messageInterceptor).

- [ ] **Step 6: Commit**

```bash
git add src/messageInterceptor.ts src/activityLog.ts test/messageInterceptor.test.ts
git commit -m "feat: add message interceptor and activity log"
```

---

## Task 5: Activity Log Tests (TDD)

**Files:**
- Create: `test/activityLog.test.ts`

- [ ] **Step 1: Write tests for activity log**

Create `test/activityLog.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { ActivityLog } from "../src/activityLog";

describe("ActivityLog", () => {
  it("should add entries and retrieve them", () => {
    const log = new ActivityLog();
    log.add({ toolName: "Bash", input: "grep foo", outcome: "auto-approved" });
    const entries = log.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].toolName).toBe("Bash");
    expect(entries[0].timestamp).toBeGreaterThan(0);
  });

  it("should evict oldest entries when exceeding max size", () => {
    const log = new ActivityLog(2);
    log.add({ toolName: "Bash", input: "cmd1", outcome: "auto-approved" });
    log.add({ toolName: "Bash", input: "cmd2", outcome: "auto-approved" });
    log.add({ toolName: "Bash", input: "cmd3", outcome: "auto-approved" });
    const entries = log.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].input).toBe("cmd2");
    expect(entries[1].input).toBe("cmd3");
  });

  it("should clear entries", () => {
    const log = new ActivityLog();
    log.add({ toolName: "Bash", input: "cmd", outcome: "auto-approved" });
    log.clear();
    expect(log.getEntries()).toHaveLength(0);
  });

  it("should notify listeners on new entry", () => {
    const log = new ActivityLog();
    const listener = vi.fn();
    log.onEntry(listener);
    log.add({ toolName: "Bash", input: "cmd", outcome: "auto-approved" });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ toolName: "Bash" }));
  });

  it("should allow removing listeners", () => {
    const log = new ActivityLog();
    const listener = vi.fn();
    const unsubscribe = log.onEntry(listener);
    unsubscribe();
    log.add({ toolName: "Bash", input: "cmd", outcome: "auto-approved" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("should compute stats correctly", () => {
    const log = new ActivityLog();
    log.add({ toolName: "Bash", input: "cmd1", outcome: "auto-approved" });
    log.add({ toolName: "Bash", input: "cmd2", outcome: "passed-through" });
    log.add({ toolName: "Bash", input: "cmd3", outcome: "auto-approved" });
    const stats = log.getStats();
    expect(stats).toEqual({ total: 3, autoApproved: 2, passedThrough: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run test/activityLog.test.ts
```

Expected: All pass (activity log was already implemented in Task 4).

- [ ] **Step 3: Commit**

```bash
git add test/activityLog.test.ts
git commit -m "test: add activity log tests"
```

---

## Task 6: Spawn Wrapper + Extension Entry Point

**Files:**
- Create: `src/spawnWrapper.ts`
- Modify: `src/extension.ts`

This task connects the core logic to real VSCode APIs and `child_process`. It's not unit-testable in isolation (requires actual process spawning), so we rely on integration testing in Task 8.

- [ ] **Step 1: Implement spawn wrapper**

Create `src/spawnWrapper.ts`:

```typescript
import * as child_process from "child_process";
import { StreamParser } from "./streamParser";
import { MessageInterceptor } from "./messageInterceptor";

export interface WrappedProcess {
  pid: number | undefined;
  kill: () => void;
}

type SpawnFn = typeof child_process.spawn;

export class SpawnWrapper {
  private originalSpawn: SpawnFn | null = null;
  private wrappedProcesses: Set<number> = new Set();
  private onProcessWrapped: ((pid: number | undefined) => void) | null = null;
  private onProcessExited: ((pid: number | undefined) => void) | null = null;

  constructor(private interceptor: MessageInterceptor) {}

  install(): void {
    if (this.originalSpawn) return; // Already installed

    this.originalSpawn = child_process.spawn;
    const self = this;

    // Override spawn on the module
    (child_process as any).spawn = function patchedSpawn(
      command: string,
      args?: readonly string[] | child_process.SpawnOptions,
      options?: child_process.SpawnOptions
    ): child_process.ChildProcess {
      const proc = self.originalSpawn!.call(child_process, command, args as any, options as any);

      // Check if this is a Claude CLI process
      const argArray = Array.isArray(args) ? args : [];
      if (self.isClaudeProcess(command, argArray)) {
        self.wrapProcess(proc);
      }

      return proc;
    };
  }

  uninstall(): void {
    if (this.originalSpawn) {
      (child_process as any).spawn = this.originalSpawn;
      this.originalSpawn = null;
    }
  }

  private isClaudeProcess(command: string, args: readonly string[]): boolean {
    const lowerCmd = command.toLowerCase();
    const hasClaudeInPath = lowerCmd.includes("claude");
    const hasStreamJson = args.some((a) => a === "stream-json" || a === "--output-format");
    const hasPermissionTool = args.some((a) => a === "--permission-prompt-tool");

    return hasClaudeInPath && (hasStreamJson || hasPermissionTool);
  }

  private wrapProcess(proc: child_process.ChildProcess): void {
    if (!proc.stdout || !proc.stdin) return;

    const pid = proc.pid;
    if (pid !== undefined) {
      this.wrappedProcesses.add(pid);
    }
    this.onProcessWrapped?.(pid);

    const originalStdout = proc.stdout;
    const stdin = proc.stdin;

    // Store original listeners that Claude Code will attach
    const originalOn = originalStdout.on.bind(originalStdout);
    const originalAddListener = originalStdout.addListener.bind(originalStdout);

    const parser = new StreamParser(
      // onMessage: parsed JSON from CLI stdout
      (msg: unknown) => {
        const handled = this.interceptor.handleMessage(msg);
        if (handled) {
          // Message was auto-approved — don't forward to Claude Code
          return;
        }
        // Forward as original data event
        // Re-serialize and emit as if it came from the stream
        const line = JSON.stringify(msg) + "\n";
        originalStdout.emit("data", Buffer.from(line));
      },
      // onPassthrough: non-JSON data
      (data: Buffer) => {
        originalStdout.emit("data", data);
      }
    );

    // Intercept 'data' event listeners
    const interceptedListeners = new Map<Function, Function>();

    proc.stdout.on = function (event: string, listener: (...args: any[]) => void): any {
      if (event === "data") {
        // Wrap the listener: instead of receiving raw data, it receives parsed/filtered data
        const wrappedListener = (chunk: Buffer) => {
          parser.feed(chunk);
        };
        interceptedListeners.set(listener, wrappedListener);
        return originalOn("data", wrappedListener);
      }
      return originalOn(event, listener);
    } as any;

    proc.stdout.addListener = proc.stdout.on;

    // Set up the response channel: write approval responses to stdin
    const originalSendResponse = this.interceptor["sendResponse"];
    const sendResponse = (response: unknown) => {
      const line = JSON.stringify(response) + "\n";
      stdin.write(line);
    };
    // Replace the sendResponse on the interceptor for this process
    // Note: this means the last-wrapped process owns the sendResponse.
    // For multi-session support, we'd need per-process interceptors.
    (this.interceptor as any).sendResponse = sendResponse;

    proc.on("exit", () => {
      if (pid !== undefined) {
        this.wrappedProcesses.delete(pid);
      }
      parser.flush();
      this.onProcessExited?.(pid);
    });
  }

  getWrappedCount(): number {
    return this.wrappedProcesses.size;
  }

  setCallbacks(onWrapped: (pid: number | undefined) => void, onExited: (pid: number | undefined) => void): void {
    this.onProcessWrapped = onWrapped;
    this.onProcessExited = onExited;
  }
}
```

- [ ] **Step 2: Update extension entry point**

Replace `src/extension.ts` with:

```typescript
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

  // Initialize core components
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

  // Save rules whenever they change
  const saveRules = () => {
    context.globalState.update("autoAuthorize.rules", ruleEngine.exportRules());
  };

  // Create interceptor with a placeholder sendResponse (replaced per-process by SpawnWrapper)
  const interceptor = new MessageInterceptor(ruleEngine, activityLog, (response) => {
    outputChannel.appendLine(`[WARN] sendResponse called with no active process`);
  });

  // Install spawn wrapper
  spawnWrapper = new SpawnWrapper(interceptor);
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
    const symbol = entry.outcome === "auto-approved" ? "✓" : "→";
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
```

- [ ] **Step 3: Create panel provider stub**

Create `src/panel/panelProvider.ts`:

```typescript
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

    // Push initial state
    this.sendState();

    // Update on new activity
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
  <style>/* Placeholder — replaced in Task 7 */</style>
</head>
<body>
  <p>AutoAuthorize panel loading... (full UI in Task 7)</p>
  <script>/* Placeholder — replaced in Task 7 */</script>
</body>
</html>`;
  }
}
```

- [ ] **Step 4: Verify compilation**

```bash
cd c:/src/AutoAuthorize
npm run compile
```

Expected: Compiles without errors.

- [ ] **Step 5: Run all tests to make sure nothing is broken**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/spawnWrapper.ts src/extension.ts src/panel/panelProvider.ts
git commit -m "feat: add spawn wrapper, extension entry point, and panel provider stub"
```

---

## Task 7: Observe Mode + Protocol Verification

**Files:**
- Modify: `src/extension.ts`

Before wiring up auto-approval in production, we need to verify the actual message format. This task adds temporary verbose logging of all intercepted messages.

- [ ] **Step 1: Add observe-mode logging to spawnWrapper**

Add the following to `src/spawnWrapper.ts`, in the `wrapProcess` method's `onMessage` callback, before the `handled` check:

Replace the `onMessage` callback in the `StreamParser` constructor inside `wrapProcess`:

```typescript
const parser = new StreamParser(
  (msg: unknown) => {
    // Log every parsed message for protocol verification
    if (typeof msg === "object" && msg !== null) {
      const m = msg as Record<string, unknown>;
      if (m.type === "control_request") {
        outputChannel?.appendLine(`[OBSERVE] CLI→Ext: ${JSON.stringify(msg).slice(0, 500)}`);
      }
    }

    const handled = this.interceptor.handleMessage(msg);
    if (handled) return;
    const line = JSON.stringify(msg) + "\n";
    originalStdout.emit("data", Buffer.from(line));
  },
  (data: Buffer) => {
    originalStdout.emit("data", data);
  }
);
```

To support this, add an `outputChannel` parameter to the `SpawnWrapper` constructor and `wrapProcess`:

In `src/spawnWrapper.ts`, update the constructor:

```typescript
constructor(
  private interceptor: MessageInterceptor,
  private outputChannel?: { appendLine(line: string): void }
) {}
```

And in `src/extension.ts`, pass it:

```typescript
spawnWrapper = new SpawnWrapper(interceptor, outputChannel);
```

- [ ] **Step 2: Also log stdin writes**

In the `sendResponse` function inside `wrapProcess`, add logging:

```typescript
const sendResponse = (response: unknown) => {
  const line = JSON.stringify(response) + "\n";
  this.outputChannel?.appendLine(`[OBSERVE] Ext→CLI: ${line.slice(0, 500)}`);
  stdin.write(line);
};
```

- [ ] **Step 3: Compile and test locally**

```bash
npm run compile
```

At this point, you can install the extension in VSCode (via F5 debug launch or `npm run package` + install VSIX) and observe the Output > AutoAuthorize channel while using Claude Code. The logged messages will show the exact `control_request` and `control_response` structure.

**If the observed message format differs from what's in `messageInterceptor.ts`**, update the `isCanUseToolRequest` type guard and the response format in `handleMessage` accordingly before proceeding.

- [ ] **Step 4: Add a launch.json for debugging**

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/out/**/*.js"],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

Create `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "presentation": { "reveal": "never" },
      "group": { "kind": "build", "isDefault": true }
    }
  ]
}
```

- [ ] **Step 5: Commit**

```bash
git add src/spawnWrapper.ts src/extension.ts .vscode/launch.json .vscode/tasks.json
git commit -m "feat: add observe mode logging and debug launch config"
```

---

## Task 8: Management Panel — Webview UI

**Files:**
- Create: `src/panel/webview/index.html`
- Create: `src/panel/webview/style.css`
- Create: `src/panel/webview/main.js`
- Modify: `src/panel/panelProvider.ts` (load external files)

- [ ] **Step 1: Create the panel HTML**

Create `src/panel/webview/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src {{cspSource}} 'unsafe-inline'; script-src 'nonce-{{nonce}}';">
  <title>AutoAuthorize</title>
  <link rel="stylesheet" href="{{styleUri}}">
</head>
<body>
  <div class="header">
    <div class="header-left">
      <h2>AutoAuthorize</h2>
    </div>
    <div class="header-right">
      <label class="switch">
        <input type="checkbox" id="masterToggle" checked>
        <span class="slider"></span>
      </label>
      <span id="masterLabel">Enabled</span>
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" data-tab="rules">Rules</button>
    <button class="tab" data-tab="log">Activity Log</button>
    <button class="tab" data-tab="status">Status</button>
  </div>

  <!-- Rules Tab -->
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
          <option value="*">Any</option>
        </select>
      </div>
      <div class="form-group">
        <label>Regex Pattern</label>
        <input type="text" id="rulePattern" placeholder="^grep\b.*">
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
      <thead>
        <tr>
          <th>On</th>
          <th>Tool</th>
          <th>Pattern</th>
          <th>Description</th>
          <th>Matches</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="rulesBody"></tbody>
    </table>
    <p id="noRules" class="empty-state">No rules defined. Click "+ Add Rule" to get started.</p>
  </div>

  <!-- Activity Log Tab -->
  <div class="tab-content" id="tab-log">
    <div class="toolbar">
      <button class="btn filter-btn active" data-filter="all">All</button>
      <button class="btn filter-btn" data-filter="auto-approved">Auto-approved</button>
      <button class="btn filter-btn" data-filter="passed-through">Passed-through</button>
      <button id="clearLogBtn" class="btn">Clear</button>
    </div>
    <table id="logTable">
      <thead>
        <tr>
          <th>Time</th>
          <th>Tool</th>
          <th>Command / Path</th>
          <th>Outcome</th>
          <th>Rule</th>
        </tr>
      </thead>
      <tbody id="logBody"></tbody>
    </table>
    <p id="noLog" class="empty-state">No activity yet.</p>
  </div>

  <!-- Status Tab -->
  <div class="tab-content" id="tab-status">
    <div class="status-grid">
      <div class="status-card">
        <div class="status-label">Status</div>
        <div class="status-value" id="statusEnabled">Enabled</div>
      </div>
      <div class="status-card">
        <div class="status-label">Active Processes</div>
        <div class="status-value" id="statusProcesses">0</div>
      </div>
      <div class="status-card">
        <div class="status-label">Total Intercepted</div>
        <div class="status-value" id="statusTotal">0</div>
      </div>
      <div class="status-card">
        <div class="status-label">Auto-approved</div>
        <div class="status-value" id="statusApproved">0</div>
      </div>
      <div class="status-card">
        <div class="status-label">Passed Through</div>
        <div class="status-value" id="statusPassedThrough">0</div>
      </div>
    </div>
  </div>

  <input type="file" id="importFile" accept=".json" class="hidden">

  <script nonce="{{nonce}}" src="{{scriptUri}}"></script>
</body>
</html>
```

- [ ] **Step 2: Create the panel CSS**

Create `src/panel/webview/style.css`:

```css
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

.header h2 {
  font-size: 13px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

/* Toggle switch */
.switch {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
}
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: var(--vscode-input-background);
  border-radius: 18px;
  transition: 0.2s;
}
.slider::before {
  content: "";
  position: absolute;
  height: 12px;
  width: 12px;
  left: 3px;
  bottom: 3px;
  background: var(--vscode-foreground);
  border-radius: 50%;
  transition: 0.2s;
}
input:checked + .slider { background: var(--vscode-button-background); }
input:checked + .slider::before { transform: translateX(14px); }

/* Tabs */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--vscode-widget-border);
  margin-bottom: 8px;
}
.tab {
  background: none;
  border: none;
  color: var(--vscode-foreground);
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.7;
  border-bottom: 2px solid transparent;
}
.tab:hover { opacity: 1; }
.tab.active {
  opacity: 1;
  border-bottom-color: var(--vscode-focusBorder);
}
.tab-content { display: none; }
.tab-content.active { display: block; }

/* Toolbar */
.toolbar {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  padding: 4px 10px;
  border-radius: 2px;
  cursor: pointer;
  font-size: 11px;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
.btn-primary:hover { background: var(--vscode-button-hoverBackground); }
.btn-danger {
  background: var(--vscode-errorForeground);
  color: var(--vscode-editor-background);
}
.filter-btn.active {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

/* Form */
.form {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  padding: 10px;
  margin-bottom: 8px;
}
.form-group {
  margin-bottom: 8px;
}
.form-group label {
  display: block;
  font-size: 11px;
  margin-bottom: 3px;
  opacity: 0.8;
}
.form-group input, .form-group select {
  width: 100%;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border);
  padding: 4px 6px;
  font-size: 12px;
  border-radius: 2px;
}
.form-group input:focus, .form-group select:focus {
  outline: 1px solid var(--vscode-focusBorder);
}
.form-group input.invalid {
  border-color: var(--vscode-errorForeground);
}
.form-actions {
  display: flex;
  gap: 4px;
}
.error {
  color: var(--vscode-errorForeground);
  font-size: 11px;
}
.test-result {
  font-size: 11px;
  margin-top: 2px;
  display: inline-block;
}
.test-result.match { color: var(--vscode-testing-iconPassed); }
.test-result.no-match { color: var(--vscode-errorForeground); }

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
th {
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid var(--vscode-widget-border);
  opacity: 0.7;
  font-weight: 600;
}
td {
  padding: 4px 6px;
  border-bottom: 1px solid var(--vscode-widget-border);
  vertical-align: middle;
}
td.mono {
  font-family: var(--vscode-editor-font-family);
  font-size: 11px;
}
tr:hover { background: var(--vscode-list-hoverBackground); }

/* Status */
.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.status-card {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  padding: 10px;
}
.status-label {
  font-size: 10px;
  opacity: 0.7;
  text-transform: uppercase;
  margin-bottom: 4px;
}
.status-value {
  font-size: 18px;
  font-weight: 600;
}

.hidden { display: none !important; }
.empty-state {
  text-align: center;
  padding: 20px;
  opacity: 0.5;
  font-size: 12px;
}

/* Small toggle in table */
.small-switch {
  width: 24px;
  height: 14px;
}
.small-switch .slider::before {
  height: 8px;
  width: 8px;
  left: 3px;
  bottom: 3px;
}
.small-switch input:checked + .slider::before {
  transform: translateX(10px);
}

.outcome-approved {
  color: var(--vscode-testing-iconPassed);
}
.outcome-passed {
  color: var(--vscode-foreground);
  opacity: 0.6;
}
```

- [ ] **Step 3: Create the panel JavaScript**

Create `src/panel/webview/main.js`:

```javascript
// @ts-check
(function () {
  // @ts-ignore
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

  // Elements
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

  // Master toggle
  masterToggle.addEventListener("change", () => {
    vscode.postMessage({ type: "setEnabled", enabled: masterToggle.checked });
  });

  // Add rule form
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

  // Live pattern validation
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

  // Live test
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

  // Log filter
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

  // Export/Import
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

  // Render functions
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

    // Attach event listeners
    rulesBody.querySelectorAll(".rule-toggle").forEach((el) => {
      el.addEventListener("change", () => {
        vscode.postMessage({
          type: "updateRule",
          id: el.dataset.id,
          updates: { enabled: el.checked },
        });
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

  // Message handler
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

  // Utilities
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

  // Request initial state
  vscode.postMessage({ type: "getState" });
})();
```

- [ ] **Step 4: Update panelProvider to serve the webview files**

Replace the `getHtml()` method in `src/panel/panelProvider.ts`:

```typescript
import * as path from "path";

// In PanelProvider class:

private getHtml(): string {
  const webview = this.view!.webview;
  const nonce = getNonce();

  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.extensionUri, "src", "panel", "webview", "style.css")
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(this.extensionUri, "src", "panel", "webview", "main.js")
  );

  // Read the HTML template
  const fs = require("fs");
  const htmlPath = path.join(this.extensionUri.fsPath, "src", "panel", "webview", "index.html");
  let html = fs.readFileSync(htmlPath, "utf-8");

  html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
  html = html.replace(/\{\{nonce\}\}/g, nonce);
  html = html.replace(/\{\{styleUri\}\}/g, styleUri.toString());
  html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());

  return html;
}
```

Add this helper function at the bottom of the file:

```typescript
function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

- [ ] **Step 5: Compile and verify**

```bash
npm run compile
```

Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add src/panel/webview/index.html src/panel/webview/style.css src/panel/webview/main.js src/panel/panelProvider.ts
git commit -m "feat: add management panel with rules, activity log, and status tabs"
```

---

## Task 9: Fix Spawn Wrapper for Multi-Session Support

**Files:**
- Modify: `src/spawnWrapper.ts`
- Modify: `src/messageInterceptor.ts`

The current design has a flaw: `sendResponse` is shared across processes. Each wrapped process needs its own response channel.

- [ ] **Step 1: Refactor MessageInterceptor to accept sendResponse per call**

Update `src/messageInterceptor.ts` — change `handleMessage` to accept a `sendResponse` callback:

```typescript
export class MessageInterceptor {
  private enabled = true;

  constructor(
    private ruleEngine: RuleEngine,
    private activityLog: ActivityLog
  ) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  handleMessage(msg: unknown, sendResponse: (response: unknown) => void): boolean {
    if (!isCanUseToolRequest(msg)) return false;

    const { tool_name, input, tool_use_id } = msg.request;
    const matchTarget = RuleEngine.getMatchTarget(tool_name, input);

    if (this.enabled) {
      const matchedRule = this.ruleEngine.evaluate(tool_name, matchTarget);

      if (matchedRule) {
        sendResponse({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: msg.request_id,
            response: {
              toolUseID: tool_use_id,
              approved: true,
            },
          },
        });

        this.activityLog.add({
          toolName: tool_name,
          input: matchTarget,
          outcome: "auto-approved",
          matchedRuleId: matchedRule.id,
          matchedRuleDescription: matchedRule.description,
        });

        return true;
      }
    }

    this.activityLog.add({
      toolName: tool_name,
      input: matchTarget,
      outcome: "passed-through",
    });

    return false;
  }
}
```

- [ ] **Step 2: Update SpawnWrapper to pass per-process sendResponse**

In `src/spawnWrapper.ts`, update the `wrapProcess` method. Remove the shared `sendResponse` replacement. Instead, create a closure-scoped `sendResponse` per process and pass it to `interceptor.handleMessage`:

```typescript
constructor(
  private interceptor: MessageInterceptor,
  private outputChannel?: { appendLine(line: string): void }
) {}

private wrapProcess(proc: child_process.ChildProcess): void {
  if (!proc.stdout || !proc.stdin) return;

  const pid = proc.pid;
  if (pid !== undefined) {
    this.wrappedProcesses.add(pid);
  }
  this.onProcessWrapped?.(pid);

  const originalStdout = proc.stdout;
  const stdin = proc.stdin;
  const originalOn = originalStdout.on.bind(originalStdout);

  const sendResponse = (response: unknown) => {
    const line = JSON.stringify(response) + "\n";
    this.outputChannel?.appendLine(`[OBSERVE] Ext→CLI: ${line.slice(0, 500)}`);
    stdin.write(line);
  };

  const parser = new StreamParser(
    (msg: unknown) => {
      if (typeof msg === "object" && msg !== null) {
        const m = msg as Record<string, unknown>;
        if (m.type === "control_request") {
          this.outputChannel?.appendLine(`[OBSERVE] CLI→Ext: ${JSON.stringify(msg).slice(0, 500)}`);
        }
      }

      const handled = this.interceptor.handleMessage(msg, sendResponse);
      if (handled) return;
      const line = JSON.stringify(msg) + "\n";
      originalStdout.emit("data", Buffer.from(line));
    },
    (data: Buffer) => {
      originalStdout.emit("data", data);
    }
  );

  proc.stdout.on = function (event: string, listener: (...args: any[]) => void): any {
    if (event === "data") {
      const wrappedListener = (chunk: Buffer) => {
        parser.feed(chunk);
      };
      return originalOn("data", wrappedListener);
    }
    return originalOn(event, listener);
  } as any;

  proc.stdout.addListener = proc.stdout.on;

  proc.on("exit", () => {
    if (pid !== undefined) {
      this.wrappedProcesses.delete(pid);
    }
    parser.flush();
    this.onProcessExited?.(pid);
  });
}
```

- [ ] **Step 3: Update extension.ts — remove sendResponse from MessageInterceptor constructor**

In `src/extension.ts`, change:

```typescript
const interceptor = new MessageInterceptor(ruleEngine, activityLog);
```

And update the `SpawnWrapper` constructor:

```typescript
spawnWrapper = new SpawnWrapper(interceptor, outputChannel);
```

- [ ] **Step 4: Update tests for new signature**

In `test/messageInterceptor.test.ts`, update all `interceptor.handleMessage(msg)` calls to `interceptor.handleMessage(msg, sendResponse)`:

Replace the `beforeEach`:

```typescript
beforeEach(() => {
  ruleEngine = new RuleEngine();
  activityLog = new ActivityLog(100);
  sendResponse = vi.fn();
  interceptor = new MessageInterceptor(ruleEngine, activityLog);
});
```

And every `interceptor.handleMessage(msg)` becomes `interceptor.handleMessage(msg, sendResponse)`.

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: All pass.

- [ ] **Step 6: Compile**

```bash
npm run compile
```

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/messageInterceptor.ts src/spawnWrapper.ts src/extension.ts test/messageInterceptor.test.ts
git commit -m "refactor: per-process sendResponse for multi-session support"
```

---

## Task 10: End-to-End Manual Testing + Protocol Tuning

**Files:**
- Potentially modify: `src/messageInterceptor.ts` (response format adjustments)

- [ ] **Step 1: Package and install the extension**

```bash
cd c:/src/AutoAuthorize
npm run compile
npm run package
```

This creates `auto-authorize-0.1.0.vsix`. Install it:

```bash
code --install-extension auto-authorize-0.1.0.vsix
```

- [ ] **Step 2: Restart VSCode and verify activation**

1. Open VSCode
2. Open Output panel → select "AutoAuthorize" channel
3. Verify it shows "AutoAuthorize activating..." and "Spawn wrapper installed"
4. Open the AutoAuthorize panel from the activity bar

- [ ] **Step 3: Test observe mode — verify message format**

1. Start a Claude Code session (sidebar/tab)
2. Ask Claude to run a simple command (e.g., "run `ls`")
3. Check the AutoAuthorize output channel for `[OBSERVE] CLI→Ext:` messages
4. Manually approve the command in Claude Code's UI
5. Note the exact message structure

**If the message format differs from what's implemented**, update `isCanUseToolRequest` in `src/messageInterceptor.ts` and the response format accordingly.

- [ ] **Step 4: Test auto-approval**

1. Open the AutoAuthorize panel
2. Add a rule: Tool=Bash, Pattern=`^(grep|ls|cat|head|tail|wc)\b`, Description="Safe read-only commands"
3. Start a new Claude Code session
4. Ask Claude to run `grep -r "pattern" .`
5. Verify the command executes without showing an approval prompt
6. Check the Activity Log tab shows "Auto-approved"

- [ ] **Step 5: Test pass-through**

1. Ask Claude to run `rm something` (should NOT match the rule)
2. Verify the normal approval prompt appears
3. Check the Activity Log tab shows "Passed-through"

- [ ] **Step 6: Test rule management**

1. Edit the rule — change the pattern
2. Delete the rule
3. Add multiple rules, verify ordering matters
4. Export rules to JSON, delete all rules, import them back
5. Toggle the master enable/disable switch

- [ ] **Step 7: Commit any protocol adjustments**

```bash
git add -A
git commit -m "fix: adjust message protocol based on runtime observation"
```

---

## Task 11: Final Cleanup

**Files:**
- Modify: `src/spawnWrapper.ts` (remove verbose observe logging, keep as debug-only)
- Modify: `package.json` (finalize metadata)

- [ ] **Step 1: Gate observe logging behind a debug flag**

In `src/spawnWrapper.ts`, add a `debug` flag:

```typescript
constructor(
  private interceptor: MessageInterceptor,
  private outputChannel?: { appendLine(line: string): void },
  private debug: boolean = false
) {}
```

Guard the observe logs:

```typescript
if (this.debug) {
  this.outputChannel?.appendLine(`[OBSERVE] CLI→Ext: ${JSON.stringify(msg).slice(0, 500)}`);
}
```

In `src/extension.ts`, read from config:

```typescript
const debug = vscode.workspace.getConfiguration("autoAuthorize").get<boolean>("debug", false);
spawnWrapper = new SpawnWrapper(interceptor, outputChannel, debug);
```

Add to `package.json` contributes.configuration:

```json
"configuration": {
  "title": "AutoAuthorize",
  "properties": {
    "autoAuthorize.debug": {
      "type": "boolean",
      "default": false,
      "description": "Enable verbose logging of intercepted messages"
    }
  }
}
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All pass.

- [ ] **Step 3: Final compile and package**

```bash
npm run compile
npm run package
```

Expected: VSIX generated, no errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: gate debug logging, add configuration, final cleanup"
```
