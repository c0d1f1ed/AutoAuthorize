import * as fs from "fs";
import * as path from "path";

export interface LogEntry {
  timestamp: number;
  toolName: string;
  input: string;
  outcome: "auto-approved" | "passed-through" | "vetoed";
  matchedRuleId?: string;
  matchedRuleDescription?: string;
}

export class ActivityLog {
  private entries: LogEntry[] = [];
  private listeners: Array<(entry: LogEntry) => void> = [];
  private logDir: string | null = null;
  private sessionFiles = new Map<number, string>(); // PID -> file path

  constructor(private maxSize: number = 500) {}

  setLogDir(dir: string): void {
    this.logDir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  getLogDir(): string | null {
    return this.logDir;
  }

  startSession(pid: number): void {
    if (!this.logDir) return;
    const now = new Date();
    const ts = now.toISOString().replace(/[:.]/g, "-");
    const filename = `session-${pid}-${ts}.jsonl`;
    const filePath = path.join(this.logDir, filename);
    this.sessionFiles.set(pid, filePath);
  }

  endSession(pid: number): void {
    this.sessionFiles.delete(pid);
  }

  add(pid: number | undefined, entry: Omit<LogEntry, "timestamp">): void {
    const full: LogEntry = { ...entry, timestamp: Date.now() };
    this.entries.push(full);
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }

    // Persist to disk
    this.appendToDisk(full, pid);

    for (const listener of this.listeners) {
      listener(full);
    }
  }

  private appendToDisk(entry: LogEntry, pid?: number): void {
    // Write to session-specific file if we have one
    const filePath = pid !== undefined ? this.sessionFiles.get(pid) : undefined;
    if (filePath) {
      try {
        fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");
      } catch { /* ignore write errors */ }
      return;
    }

    // Fallback: write to the most recently started session file
    if (this.sessionFiles.size > 0) {
      const lastFile = Array.from(this.sessionFiles.values()).pop()!;
      try {
        fs.appendFileSync(lastFile, JSON.stringify(entry) + "\n");
      } catch { /* ignore write errors */ }
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

  getStats(): { total: number; autoApproved: number; passedThrough: number; vetoed: number } {
    let autoApproved = 0;
    let passedThrough = 0;
    let vetoed = 0;
    for (const entry of this.entries) {
      if (entry.outcome === "auto-approved") autoApproved++;
      else if (entry.outcome === "vetoed") vetoed++;
      else passedThrough++;
    }
    return { total: this.entries.length, autoApproved, passedThrough, vetoed };
  }
}
