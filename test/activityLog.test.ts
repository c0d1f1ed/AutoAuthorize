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
