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
              behavior: "allow",
              updatedInput: input,
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
