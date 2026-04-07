import * as child_process from "child_process";
import { StreamParser } from "./streamParser";
import { MessageInterceptor } from "./messageInterceptor";

// Get the actual module exports object from require cache — this is mutable
// even when the module's property descriptors are non-configurable.
const cp: any = require("child_process");

type SpawnFn = typeof child_process.spawn;

export class SpawnWrapper {
  private originalSpawn: SpawnFn | null = null;
  private wrappedProcesses: Set<number> = new Set();
  private onProcessWrapped: ((pid: number | undefined) => void) | null = null;
  private onProcessExited: ((pid: number | undefined) => void) | null = null;

  constructor(
    private interceptor: MessageInterceptor,
    private outputChannel?: { appendLine(line: string): void },
    private debug: boolean = false
  ) {}

  install(): void {
    if (this.originalSpawn) return;

    this.originalSpawn = cp.spawn;
    const self = this;

    // Try multiple strategies to patch spawn
    let patched = false;

    // Strategy 1: direct assignment
    try {
      cp.spawn = patchedSpawn;
      if (cp.spawn === patchedSpawn) {
        patched = true;
        this.outputChannel?.appendLine("[PATCH] Strategy 1: direct assignment succeeded");
      }
    } catch (e) {
      this.outputChannel?.appendLine(`[PATCH] Strategy 1 failed: ${e}`);
    }

    // Strategy 2: Object.defineProperty with configurable
    if (!patched) {
      try {
        Object.defineProperty(cp, "spawn", {
          value: patchedSpawn,
          writable: true,
          configurable: true,
          enumerable: true,
        });
        patched = true;
        this.outputChannel?.appendLine("[PATCH] Strategy 2: defineProperty succeeded");
      } catch (e) {
        this.outputChannel?.appendLine(`[PATCH] Strategy 2 failed: ${e}`);
      }
    }

    // Strategy 3: patch via require cache
    if (!patched) {
      try {
        const mod = require.cache[require.resolve("child_process")];
        if (mod && mod.exports) {
          mod.exports.spawn = patchedSpawn;
          patched = true;
          this.outputChannel?.appendLine("[PATCH] Strategy 3: require.cache succeeded");
        }
      } catch (e) {
        this.outputChannel?.appendLine(`[PATCH] Strategy 3 failed: ${e}`);
      }
    }

    if (!patched) {
      this.outputChannel?.appendLine("[PATCH] All strategies failed — spawn wrapper not active");
      this.originalSpawn = null;
    }

    function patchedSpawn(
      command: string,
      args?: readonly string[] | child_process.SpawnOptions,
      options?: child_process.SpawnOptions
    ): child_process.ChildProcess {
      const proc = self.originalSpawn!.call(cp, command, args as any, options as any);
      try {
        const argArray = Array.isArray(args) ? args : [];
        const argStr = argArray.map(String).join(" ");
        if (self.debug) {
          self.outputChannel?.appendLine(`[SPAWN] ${command} ${argStr.slice(0, 300)}`);
        }
        if (self.isClaudeProcess(command, argArray)) {
          self.outputChannel?.appendLine(`[SPAWN] === Claude CLI detected: ${command} ${argStr.slice(0, 200)}`);
          self.wrapProcess(proc);
        }
      } catch (e) {
        self.outputChannel?.appendLine(`[ERROR] patchedSpawn: ${e}`);
      }
      return proc;
    }
  }

  uninstall(): void {
    if (this.originalSpawn) {
      try { cp.spawn = this.originalSpawn; } catch { /* ignore */ }
      try {
        Object.defineProperty(cp, "spawn", {
          value: this.originalSpawn,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } catch { /* ignore */ }
      try {
        const mod = require.cache[require.resolve("child_process")];
        if (mod && mod.exports) {
          mod.exports.spawn = this.originalSpawn;
        }
      } catch { /* ignore */ }
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
    try {
      if (!proc.stdout || !proc.stdin) {
        this.outputChannel?.appendLine(`[WARN] wrapProcess: no stdout/stdin on process`);
        return;
      }

      const pid = proc.pid;
      if (pid !== undefined) {
        this.wrappedProcesses.add(pid);
      }
      this.onProcessWrapped?.(pid);

      const originalStdout = proc.stdout;
      const stdin = proc.stdin;
      const originalOn = originalStdout.on.bind(originalStdout);
      const oc = this.outputChannel;
      const dbg = this.debug;

      // Intercept stdin writes to observe what Claude Code sends back to the CLI
      const originalStdinWrite = stdin.write.bind(stdin);
      (stdin as any).write = function (...writeArgs: any[]): boolean {
        if (dbg) {
          try {
            const data = writeArgs[0];
            const str = typeof data === "string" ? data : data?.toString?.("utf-8") ?? "";
            if (str.includes("control_response")) {
              oc?.appendLine(`[OBSERVE] Ext->CLI (stdin): ${str.slice(0, 500)}`);
            }
          } catch { /* ignore logging errors */ }
        }
        return (originalStdinWrite as Function).apply(stdin, writeArgs);
      };

      // Collect the downstream listeners that Claude Code registers.
      // We call them directly instead of re-emitting on the stream to avoid infinite loops.
      const downstreamListeners: Array<(chunk: Buffer) => void> = [];

      const forwardToListeners = (data: Buffer) => {
        for (const listener of downstreamListeners) {
          try { listener(data); } catch (e) { oc?.appendLine(`[ERROR] downstream listener: ${e}`); }
        }
      };

      const sendResponse = (response: unknown) => {
        try {
          const line = JSON.stringify(response) + "\n";
          if (this.debug) {
            oc?.appendLine(`[OBSERVE] Ext->CLI: ${line.slice(0, 500)}`);
          }
          stdin.write(line);
        } catch (e) {
          oc?.appendLine(`[ERROR] sendResponse: ${e}`);
        }
      };

      const interceptor = this.interceptor;

      const parser = new StreamParser(
        (msg: unknown) => {
          try {
            if (dbg && typeof msg === "object" && msg !== null) {
              const m = msg as Record<string, unknown>;
              if (m.type === "control_request") {
                oc?.appendLine(`[OBSERVE] CLI->Ext: ${JSON.stringify(msg).slice(0, 500)}`);
              }
            }

            const handled = interceptor.handleMessage(msg, sendResponse);
            if (handled) return;
            // Forward non-intercepted messages directly to downstream listeners
            const line = JSON.stringify(msg) + "\n";
            forwardToListeners(Buffer.from(line));
          } catch (e) {
            oc?.appendLine(`[ERROR] onMessage: ${e}`);
            const line = JSON.stringify(msg) + "\n";
            forwardToListeners(Buffer.from(line));
          }
        },
        (data: Buffer) => {
          forwardToListeners(data);
        }
      );

      // Register our single real listener on the actual stdout stream
      originalOn("data", (chunk: Buffer) => {
        try {
          parser.feed(chunk);
        } catch (e) {
          oc?.appendLine(`[ERROR] parser.feed: ${e}`);
          forwardToListeners(chunk);
        }
      });

      // Intercept future "data" listener registrations — store them instead of
      // attaching to the real stream (which would bypass our parser).
      proc.stdout.on = function (event: string, listener: (...args: any[]) => void): any {
        if (event === "data") {
          downstreamListeners.push(listener as (chunk: Buffer) => void);
          return originalStdout;
        }
        return originalOn(event, listener);
      } as any;

      proc.stdout.addListener = proc.stdout.on;

      proc.on("exit", () => {
        if (pid !== undefined) {
          this.wrappedProcesses.delete(pid);
        }
        try { parser.flush(); } catch (e) { oc?.appendLine(`[ERROR] flush: ${e}`); }
        this.onProcessExited?.(pid);
      });

      this.outputChannel?.appendLine(`[OK] Process wrapped successfully (PID: ${pid})`);
    } catch (e) {
      this.outputChannel?.appendLine(`[ERROR] wrapProcess: ${e}`);
    }
  }

  getWrappedCount(): number {
    return this.wrappedProcesses.size;
  }

  setCallbacks(onWrapped: (pid: number | undefined) => void, onExited: (pid: number | undefined) => void): void {
    this.onProcessWrapped = onWrapped;
    this.onProcessExited = onExited;
  }
}
