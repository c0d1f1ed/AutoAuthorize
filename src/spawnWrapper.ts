import * as child_process from "child_process";
import { StreamParser } from "./streamParser";
import { MessageInterceptor } from "./messageInterceptor";

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

    this.originalSpawn = child_process.spawn;
    const self = this;

    (child_process as any).spawn = function patchedSpawn(
      command: string,
      args?: readonly string[] | child_process.SpawnOptions,
      options?: child_process.SpawnOptions
    ): child_process.ChildProcess {
      const proc = self.originalSpawn!.call(child_process, command, args as any, options as any);
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
    const originalOn = originalStdout.on.bind(originalStdout);

    const sendResponse = (response: unknown) => {
      const line = JSON.stringify(response) + "\n";
      if (this.debug) {
        this.outputChannel?.appendLine(`[OBSERVE] Ext→CLI: ${line.slice(0, 500)}`);
      }
      stdin.write(line);
    };

    const parser = new StreamParser(
      (msg: unknown) => {
        if (this.debug && typeof msg === "object" && msg !== null) {
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

  getWrappedCount(): number {
    return this.wrappedProcesses.size;
  }

  setCallbacks(onWrapped: (pid: number | undefined) => void, onExited: (pid: number | undefined) => void): void {
    this.onProcessWrapped = onWrapped;
    this.onProcessExited = onExited;
  }
}
