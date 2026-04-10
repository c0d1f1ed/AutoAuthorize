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
    interceptor = new MessageInterceptor(ruleEngine, activityLog);
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

  it("should auto-approve when allow rule matches", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true, action: "allow" });
    const msg = makeCanUseTool("Bash", { command: "grep -r foo ." });
    const handled = interceptor.handleMessage(msg, sendResponse);
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
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true, action: "allow" });
    const msg = makeCanUseTool("Bash", { command: "rm -rf /" });
    const handled = interceptor.handleMessage(msg, sendResponse);
    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("should pass through non-control_request messages", () => {
    const msg = { type: "other", data: "stuff" };
    const handled = interceptor.handleMessage(msg, sendResponse);
    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("should pass through non-can_use_tool control requests", () => {
    const msg = {
      type: "control_request",
      request_id: "req-123",
      request: { subtype: "hook_callback" },
    };
    const handled = interceptor.handleMessage(msg, sendResponse);
    expect(handled).toBe(false);
  });

  it("should log auto-approved requests to activity log", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true, action: "allow" });
    const msg = makeCanUseTool("Bash", { command: "grep foo" });
    interceptor.handleMessage(msg, sendResponse);
    const entries = activityLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe("auto-approved");
    expect(entries[0].toolName).toBe("Bash");
    expect(entries[0].input).toBe("grep foo");
  });

  it("should log passed-through requests to activity log", () => {
    const msg = makeCanUseTool("Bash", { command: "rm -rf /" });
    interceptor.handleMessage(msg, sendResponse);
    const entries = activityLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe("passed-through");
  });

  it("should not auto-approve when globally disabled", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "grep", enabled: true, action: "allow" });
    interceptor.setEnabled(false);
    const msg = makeCanUseTool("Bash", { command: "grep foo" });
    const handled = interceptor.handleMessage(msg, sendResponse);
    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("should send deny response when veto rule matches", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "rm -rf", description: "Block rm -rf", enabled: true, action: "veto" });
    const msg = makeCanUseTool("Bash", { command: "rm -rf /tmp" });
    const handled = interceptor.handleMessage(msg, sendResponse);
    expect(handled).toBe(true);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "control_response",
        response: expect.objectContaining({
          response: expect.objectContaining({
            behavior: "deny",
          }),
        }),
      })
    );
    expect(activityLog.getEntries()[0].outcome).toBe("vetoed");
  });

  it("should pass through when ask rule matches without sending response", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^rm\\b", description: "Ask for rm", enabled: true, action: "ask" });
    const msg = makeCanUseTool("Bash", { command: "rm file.txt" });
    const handled = interceptor.handleMessage(msg, sendResponse);
    expect(handled).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
    expect(activityLog.getEntries()[0].outcome).toBe("passed-through");
    expect(activityLog.getEntries()[0].matchedRuleDescription).toBe("Ask for rm");
  });

  it("should evaluate veto before ask before allow", () => {
    ruleEngine.addRule({ toolType: "Bash", pattern: "^rm\\b", description: "Allow rm", enabled: true, action: "allow" });
    ruleEngine.addRule({ toolType: "Bash", pattern: "^rm\\b", description: "Ask rm", enabled: true, action: "ask" });
    ruleEngine.addRule({ toolType: "Bash", pattern: "rm -rf", description: "Veto rm -rf", enabled: true, action: "veto" });

    // rm -rf matches veto → denied
    const msg1 = makeCanUseTool("Bash", { command: "rm -rf /tmp" });
    expect(interceptor.handleMessage(msg1, sendResponse)).toBe(true);
    expect(activityLog.getEntries()[0].outcome).toBe("vetoed");

    // rm file.txt matches ask (no veto match) → passed through
    const msg2 = makeCanUseTool("Bash", { command: "rm file.txt" });
    expect(interceptor.handleMessage(msg2, sendResponse)).toBe(false);
    expect(activityLog.getEntries()[1].outcome).toBe("passed-through");
    expect(activityLog.getEntries()[1].matchedRuleDescription).toBe("Ask rm");
  });
});
