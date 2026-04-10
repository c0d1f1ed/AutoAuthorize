export type ToolType = "Bash" | "Read" | "Write" | "Edit" | "WebFetch" | "WebSearch" | "*";
export type RuleAction = "allow" | "veto" | "ask";

export interface AutoApproveRule {
  id: string;
  toolType: ToolType;
  pattern: string;
  description: string;
  enabled: boolean;
  matchCount: number;
  action: RuleAction;
}

export interface RuleInput {
  toolType: ToolType;
  pattern: string;
  description: string;
  enabled: boolean;
  action: RuleAction;
}

export class RuleEngine {
  private rules: AutoApproveRule[] = [];
  private compiledPatterns = new Map<string, RegExp>();

  addRule(input: RuleInput): AutoApproveRule {
    const regex = new RegExp(input.pattern);
    const rule: AutoApproveRule = {
      id: crypto.randomUUID(),
      toolType: input.toolType,
      pattern: input.pattern,
      description: input.description,
      enabled: input.enabled,
      matchCount: 0,
      action: input.action,
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

  evaluate(toolName: string, matchTarget: string, action: RuleAction): AutoApproveRule | null {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.action !== action) continue;
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
      case "WebFetch":
        return (input.url as string) ?? "";
      case "WebSearch":
        return (input.query as string) ?? "";
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
      this.rules.push({ ...rule, action: rule.action ?? "allow" });
      this.compiledPatterns.set(rule.id, regex);
    }
  }
}
