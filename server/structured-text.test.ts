import { describe, expect, it, vi } from "vitest";
import { runTools, withText } from "./tools";
import type { Runtime } from "./runtime";

type Result = { isError?: boolean; text: string; structuredContent?: Record<string, unknown> };

describe("read_agent_conversation reaches Claude callers (they see only structuredContent)", () => {
  const entries = [
    { seqStart: 1, item: { type: "user_message", text: "Do it" } },
    { seqStart: 2, item: { type: "assistant_message", text: "On it." } },
  ];
  const readTimeline = vi.fn(async () => ({ entries, hasOlder: true, startCursor: { epoch: "e1", seq: 1 } }));
  const tool = runTools({ readTimeline } as unknown as Runtime).find((t) => t.name === "read_agent_conversation")!;
  const call = (input: Record<string, unknown>) => (tool.execute as (i: unknown, c: unknown) => Promise<Result>)(input, { agent: { id: "a" } });

  it("puts the rendered conversation in structuredContent.text, next to the paging fields", async () => {
    const result = await call({ agentId: "other", limit: 60, includeReasoning: false, includeToolDetail: false, maxChars: 2000 });
    expect(result.structuredContent).toEqual({ agentId: "other", hasOlder: true, before: { epoch: "e1", seq: 1 }, entries: 2, text: "user: Do it\nassistant: On it." });
    expect(result.text).toContain("user: Do it\nassistant: On it.");
  });

  it("says so when there is nothing to show", async () => {
    readTimeline.mockResolvedValueOnce({ entries: [], hasOlder: false, startCursor: null as never });
    const result = await call({ agentId: "other", limit: 60, includeReasoning: false, includeToolDetail: false, maxChars: 2000 });
    expect(result.structuredContent?.text).toBe("(nothing to show in these entries)");
  });
});

describe("withText", () => {
  it("adds the text to a structured object that lacks it", () => {
    expect(withText("Gate g1 decided: approved.", { gateId: "g1" })).toEqual({ gateId: "g1", text: "Gate g1 decided: approved." });
  });
  it("leaves a result that already has a text field, or whose text is just its JSON", () => {
    expect(withText("x", { text: "own" })).toEqual({ text: "own" });
    expect(withText(JSON.stringify({ a: 1 }), { a: 1 })).toEqual({ a: 1 });
    expect(withText(JSON.stringify({ a: 1 }, null, 2), { a: 1 })).toEqual({ a: 1 });
  });
  it("wraps a non-object result instead of losing it", () => {
    expect(withText("list", [1, 2])).toEqual({ text: "list", result: [1, 2] });
  });
});
