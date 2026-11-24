import { describe, expect, it } from "vitest";
import {
  transformAssistantMessage,
  transformShowViewToolCall,
} from "../client/timeline-transform";

describe("timeline transformers", () => {
  it("returns undefined for plain assistant replies", () => {
    const res = transformAssistantMessage({
      phase: "complete",
      item: { type: "assistant_message", text: "Plain markdown reply." },
    });
    expect(res).toBeUndefined();
  });

  it("explodes assistant replies with fenced blocks and tokens into stable plugin segments", () => {
    const res = transformAssistantMessage({
      phase: "streaming",
      item: {
        type: "assistant_message",
        text: "Intro\n<<paseo-view:v_12345>>\nTail text",
      },
    });
    expect(res?.items).toHaveLength(3);
    expect(res?.items[0]).toMatchObject({
      type: "plugin",
      id: "seg-0",
      kind: "gt-markdown",
      data: { text: "Intro", phase: "streaming", isTail: false },
    });
    expect(res?.items[1]).toMatchObject({
      type: "plugin",
      id: "seg-1",
      kind: "gt-view",
      data: { mode: "token", viewId: "v_12345" },
    });
    expect(res?.items[2]).toMatchObject({
      type: "plugin",
      id: "seg-2",
      kind: "gt-markdown",
      data: { text: "Tail text", phase: "streaming", isTail: true },
    });
  });

  it("compacts show_view tool calls and ignores other tools", () => {
    expect(
      transformShowViewToolCall({
        phase: "complete",
        item: {
          type: "tool_call",
          callId: "c1",
          name: "read_file",
          status: "completed",
          error: null,
          detail: { type: "unknown", input: {}, output: {} },
        },
      }),
    ).toBeUndefined();

    const compacted = transformShowViewToolCall({
      phase: "complete",
      item: {
        type: "tool_call",
        callId: "c2",
        name: "plugin__show_view",
        status: "completed",
        error: null,
        detail: {
          type: "unknown",
          input: {},
          output: {
            structuredContent: {
              viewId: "v_999",
              title: "Sales",
              type: "table",
              rowCount: 42,
            },
          },
        },
      },
    });

    expect(compacted?.items[0]).toMatchObject({
      type: "plugin",
      kind: "gt-tool-badge",
      data: {
        status: "completed",
        viewId: "v_999",
        title: "Sales",
        viewType: "table",
        rowCount: 42,
      },
    });
  });
});
