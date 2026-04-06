import { describe, it, expect, vi } from "vitest";
import { StreamParser } from "../src/streamParser";

describe("StreamParser", () => {
  it("should parse a complete JSON line", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);
    parser.feed(Buffer.from('{"type":"control_request","request":{"subtype":"can_use_tool"}}\n'));
    expect(onMessage).toHaveBeenCalledWith({ type: "control_request", request: { subtype: "can_use_tool" } });
    expect(onPassthrough).not.toHaveBeenCalled();
  });

  it("should handle split chunks", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);
    parser.feed(Buffer.from('{"type":"con'));
    expect(onMessage).not.toHaveBeenCalled();
    parser.feed(Buffer.from('trol_request"}\n'));
    expect(onMessage).toHaveBeenCalledWith({ type: "control_request" });
  });

  it("should handle multiple messages in one chunk", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);
    parser.feed(Buffer.from('{"a":1}\n{"b":2}\n'));
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledWith({ a: 1 });
    expect(onMessage).toHaveBeenCalledWith({ b: 2 });
  });

  it("should pass through non-JSON lines", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);
    parser.feed(Buffer.from("not json\n"));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onPassthrough).toHaveBeenCalledWith(Buffer.from("not json\n"));
  });

  it("should pass through incomplete lines when flushed", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);
    parser.feed(Buffer.from("partial"));
    parser.flush();
    expect(onPassthrough).toHaveBeenCalledWith(Buffer.from("partial"));
  });

  it("should handle empty lines", () => {
    const onMessage = vi.fn();
    const onPassthrough = vi.fn();
    const parser = new StreamParser(onMessage, onPassthrough);
    parser.feed(Buffer.from("\n\n"));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onPassthrough).toHaveBeenCalledTimes(2);
  });
});
