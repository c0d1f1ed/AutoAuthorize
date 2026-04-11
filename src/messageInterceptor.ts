import { RuleEngine, RuleAction } from "./ruleEngine";
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
    private globalRules: RuleEngine,
    private workspaceRules: RuleEngine,
    private activityLog: ActivityLog
  ) {}

  private evaluateTier(toolName: string, matchTarget: string, action: RuleAction) {
    return this.globalRules.evaluate(toolName, matchTarget, action)
      ?? this.workspaceRules.evaluate(toolName, matchTarget, action);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  handleMessage(msg: unknown, sendResponse: (response: unknown) => void, pid?: number): boolean {
    if (!isCanUseToolRequest(msg)) return false;

    const { tool_name, input, tool_use_id } = msg.request;
    const matchTarget = RuleEngine.getMatchTarget(tool_name, input);

    if (this.enabled) {
      // Tier 1: Veto — silently deny
      const vetoRule = this.evaluateTier(tool_name, matchTarget, "veto");
      if (vetoRule) {
        sendResponse({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: msg.request_id,
            response: {
              behavior: "deny",
              message: `Vetoed by Auto-Authorize rule: ${vetoRule.description}`,
            },
          },
        });

        this.activityLog.add(pid, {
          toolName: tool_name,
          input: matchTarget,
          outcome: "vetoed",
          matchedRuleId: vetoRule.id,
          matchedRuleDescription: vetoRule.description,
        });

        return true;
      }

      // Tier 2: Ask — pass through to user prompt
      const askRule = this.evaluateTier(tool_name, matchTarget, "ask");
      if (askRule) {
        this.activityLog.add(pid, {
          toolName: tool_name,
          input: matchTarget,
          outcome: "passed-through",
          matchedRuleId: askRule.id,
          matchedRuleDescription: askRule.description,
        });

        return false;
      }

      // Tier 3: Allow — auto-approve
      const allowRule = this.evaluateTier(tool_name, matchTarget, "allow");
      if (allowRule) {
        sendResponse({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: msg.request_id,
            response: {
              behavior: "allow",
              updatedInput: input,
            },
          },
        });

        this.activityLog.add(pid, {
          toolName: tool_name,
          input: matchTarget,
          outcome: "auto-approved",
          matchedRuleId: allowRule.id,
          matchedRuleDescription: allowRule.description,
        });

        return true;
      }
    }

    // No rule matched
    this.activityLog.add(pid, {
      toolName: tool_name,
      input: matchTarget,
      outcome: "passed-through",
    });

    return false;
  }
}
