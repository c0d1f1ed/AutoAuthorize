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
        action: "allow",
      });
      expect(rule.id).toBeDefined();
      expect(rule.pattern).toBe("^grep\\b");
      expect(rule.matchCount).toBe(0);
      expect(rule.action).toBe("allow");
    });

    it("should throw on invalid regex", () => {
      expect(() =>
        engine.addRule({
          toolType: "Bash",
          pattern: "[invalid",
          description: "bad regex",
          enabled: true,
          action: "allow",
        })
      ).toThrow();
    });
  });

  describe("evaluate", () => {
    it("should match a Bash command against a Bash rule", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      const result = engine.evaluate("Bash", "grep -r pattern .", "allow");
      expect(result).not.toBeNull();
      expect(result!.description).toBe("Allow grep");
    });

    it("should not match when tool type differs", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      const result = engine.evaluate("Read", "/some/file.txt", "allow");
      expect(result).toBeNull();
    });

    it("should not match disabled rules", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: false, action: "allow" });
      const result = engine.evaluate("Bash", "grep -r pattern .", "allow");
      expect(result).toBeNull();
    });

    it("should match wildcard tool type against any tool", () => {
      engine.addRule({ toolType: "*", pattern: ".*", description: "Allow all", enabled: true, action: "allow" });
      expect(engine.evaluate("Bash", "rm -rf /", "allow")).not.toBeNull();
      expect(engine.evaluate("Read", "/etc/passwd", "allow")).not.toBeNull();
    });

    it("should return first matching rule in order", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "First", enabled: true, action: "allow" });
      engine.addRule({ toolType: "Bash", pattern: ".*", description: "Second", enabled: true, action: "allow" });
      const result = engine.evaluate("Bash", "grep foo", "allow");
      expect(result!.description).toBe("First");
    });

    it("should increment matchCount on match", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      engine.evaluate("Bash", "grep foo", "allow");
      engine.evaluate("Bash", "grep bar", "allow");
      const rules = engine.getRules();
      expect(rules[0].matchCount).toBe(2);
    });

    it("should return null when no rules match", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      const result = engine.evaluate("Bash", "rm -rf /", "allow");
      expect(result).toBeNull();
    });

    it("should only match rules with the requested action", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Veto grep", enabled: true, action: "veto" });
      expect(engine.evaluate("Bash", "grep foo", "allow")!.description).toBe("Allow grep");
      expect(engine.evaluate("Bash", "grep foo", "veto")!.description).toBe("Veto grep");
      expect(engine.evaluate("Bash", "grep foo", "ask")).toBeNull();
    });

    it("should match veto rules", () => {
      engine.addRule({ toolType: "Bash", pattern: "rm -rf", description: "Block rm -rf", enabled: true, action: "veto" });
      const result = engine.evaluate("Bash", "rm -rf /tmp", "veto");
      expect(result).not.toBeNull();
      expect(result!.description).toBe("Block rm -rf");
    });

    it("should match ask rules", () => {
      engine.addRule({ toolType: "Bash", pattern: "^rm\\b", description: "Ask for rm", enabled: true, action: "ask" });
      const result = engine.evaluate("Bash", "rm file.txt", "ask");
      expect(result).not.toBeNull();
      expect(result!.description).toBe("Ask for rm");
    });
  });

  describe("CRUD operations", () => {
    it("should update a rule", () => {
      const rule = engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      engine.updateRule(rule.id, { pattern: "^rg\\b", description: "Allow ripgrep" });
      const updated = engine.getRules()[0];
      expect(updated.pattern).toBe("^rg\\b");
      expect(updated.description).toBe("Allow ripgrep");
    });

    it("should delete a rule", () => {
      const rule = engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      engine.deleteRule(rule.id);
      expect(engine.getRules()).toHaveLength(0);
    });

    it("should reorder rules", () => {
      const r1 = engine.addRule({ toolType: "Bash", pattern: "a", description: "A", enabled: true, action: "allow" });
      const r2 = engine.addRule({ toolType: "Bash", pattern: "b", description: "B", enabled: true, action: "allow" });
      engine.reorderRules([r2.id, r1.id]);
      const rules = engine.getRules();
      expect(rules[0].description).toBe("B");
      expect(rules[1].description).toBe("A");
    });
  });

  describe("serialization", () => {
    it("should export and import rules", () => {
      engine.addRule({ toolType: "Bash", pattern: "^grep\\b", description: "Allow grep", enabled: true, action: "allow" });
      engine.addRule({ toolType: "Read", pattern: "\\.ts$", description: "Allow TS reads", enabled: true, action: "allow" });
      const exported = engine.exportRules();
      const engine2 = new RuleEngine();
      engine2.importRules(exported);
      expect(engine2.getRules()).toHaveLength(2);
      expect(engine2.getRules()[0].description).toBe("Allow grep");
    });

    it("should default action to allow for imported rules missing the field", () => {
      const json = JSON.stringify([{ id: "x", toolType: "Bash", pattern: ".*", description: "old", enabled: true, matchCount: 0 }]);
      engine.importRules(json);
      expect(engine.getRules()[0].action).toBe("allow");
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
    it("should extract url from WebFetch input", () => {
      expect(RuleEngine.getMatchTarget("WebFetch", { url: "https://example.com" })).toBe("https://example.com");
    });
    it("should extract query from WebSearch input", () => {
      expect(RuleEngine.getMatchTarget("WebSearch", { query: "node.js streams" })).toBe("node.js streams");
    });
    it("should stringify unknown tool input", () => {
      const target = RuleEngine.getMatchTarget("MCP", { server: "foo", tool: "bar" });
      expect(target).toBe('MCP: {"server":"foo","tool":"bar"}');
    });
  });
});
