import { describe, expect, it } from "vitest";
import { parseAssistantMessage } from "../shared/parser";

describe("parseAssistantMessage", () => {
  it("returns hasSpecialContent=false for plain markdown", () => {
    const res = parseAssistantMessage("## Hello\n\nJust regular text and `inline` code.", "complete");
    expect(res.hasSpecialContent).toBe(false);
  });

  it("ignores view-like syntax inside normal code fences", () => {
    const msg = [
      "Here is an example:",
      "```markdown",
      "<<paseo-view:v_fake>>",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
      "| 3 | 4 |",
      "```",
    ].join("\n");
    const res = parseAssistantMessage(msg, "complete");
    expect(res.hasSpecialContent).toBe(false);
  });

  it("splits fenced paseo-view and beluga-graph blocks with surrounding prose", () => {
    const msg = [
      "Summary before.",
      "",
      "```paseo-view",
      '{"type":"stats","items":[{"label":"Users","value":42}]}',
      "```",
      "",
      "```beluga-graph",
      '{"title":"Flow","nodes":[{"id":"a","label":"Web"},{"id":"b","label":"API"}],"edges":[{"from":"a","to":"b"}]}',
      "```",
      "",
      "Summary after.",
    ].join("\n");
    const res = parseAssistantMessage(msg, "complete");
    expect(res.hasSpecialContent).toBe(true);
    expect(res.segments.map((s) => s.kind)).toEqual([
      "markdown",
      "inline-view",
      "inline-view",
      "markdown",
    ]);
    const viewSeg = res.segments[1];
    const graphSeg = res.segments[2];
    expect(viewSeg.kind === "inline-view" && viewSeg.spec.type).toBe("stats");
    expect(graphSeg.kind === "inline-view" && graphSeg.spec.type).toBe("graph");
  });

  it("emits streaming-view placeholder for unclosed fence while streaming", () => {
    const msg = ["Intro", "", "```beluga-view", '{"type":"table","data":[{"a":1'].join("\n");
    const streaming = parseAssistantMessage(msg, "streaming");
    expect(streaming.hasSpecialContent).toBe(true);
    expect(streaming.segments).toEqual([
      { kind: "markdown", text: "Intro\n" },
      { kind: "streaming-view", fenceKind: "beluga-view" },
    ]);

    const complete = parseAssistantMessage(msg, "complete");
    expect(complete.segments[1]?.kind).toBe("invalid-view");
  });

  it("extracts standalone view tokens and GFM tables", () => {
    const msg = [
      "Top results:",
      "<<paseo-view:v_deadbeef01>>",
      "",
      "| Name | Score |",
      "| :--- | ---: |",
      "| Alpha | 95 |",
      "| Beta | 88 |",
    ].join("\n");

    const res = parseAssistantMessage(msg, "complete");
    expect(res.hasSpecialContent).toBe(true);
    expect(res.segments.map((s) => s.kind)).toEqual(["markdown", "token", "gfm-table"]);
    const tokenSeg = res.segments[1];
    expect(tokenSeg.kind === "token" && tokenSeg.viewId).toBe("v_deadbeef01");
    const tableSeg = res.segments[2];
    if (tableSeg.kind === "gfm-table") {
      expect(tableSeg.columns).toEqual([
        { key: "Name", label: "Name", align: "left" },
        { key: "Score", label: "Score", align: "right" },
      ]);
      expect(tableSeg.rows).toEqual([
        { Name: "Alpha", Score: 95 },
        { Name: "Beta", Score: 88 },
      ]);
    }
  });
});
