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
