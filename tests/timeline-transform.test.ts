import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  TextInput: "TextInput",
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: vi.fn(),
  useRpc: vi.fn(),
  openExternalUrl: vi.fn(),
}));

vi.mock("@getpaseo/plugin/client/ui", () => ({
  Icon: "Icon",
  Markdown: "Markdown",
  Modal: Object.assign(() => null, { Content: () => null }),
  ScrollView: "ScrollView",
  StreamedText: "StreamedText",
  TextInput: "TextInput",
  copyText: vi.fn(),
  useToast: vi.fn(),
  SettingsAction: "SettingsAction",
  SettingsCard: "SettingsCard",
  SettingsSection: "SettingsSection",
  SettingsSelect: "SettingsSelect",
  SettingsSwitch: "SettingsSwitch",
}));

import { hasNumericColumn } from "../client/format";
import {
  getViewerEntry,
  openViewInFullScreen,
  registerFullScreenOpener,
} from "../client/viewer-store";
import contribute from "../index.client";
import {
  createAssistantTransformer,
  dataViewSegmentSchema,
  markdownSegmentSchema,
  toolBadgeSchema,
  transformAssistantMessage,
  transformShowViewToolCall,
} from "../client/timeline-transform";

function isStrictTimelineData(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (Array.isArray(value)) return value.every(isStrictTimelineData);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(value).every(isStrictTimelineData);
}

describe("timeline transformers", () => {
  it("returns undefined for plain assistant replies", () => {
    const res = transformAssistantMessage({
      phase: "complete",
      item: { type: "assistant_message", text: "Plain markdown reply." },
    });
    expect(res).toBeUndefined();
  });

  it("explodes assistant replies without fixed IDs so multiple messages do not collide", () => {
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
      kind: "gt-markdown",
      data: { text: "Intro", phase: "streaming", isTail: false },
    });
    expect(res?.items[0]?.id).toBeUndefined();
    expect(res?.items[1]).toMatchObject({
      type: "plugin",
      kind: "gt-view",
      data: { mode: "token", viewId: "v_12345" },
    });
    expect(res?.items[1]?.id).toBeUndefined();
    expect(res?.items[2]).toMatchObject({
      type: "plugin",
      kind: "gt-markdown",
      data: { text: "Tail text", phase: "streaming", isTail: true },
    });
    expect(res?.items[2]?.id).toBeUndefined();
  });

  it("transforms Chinese paseo-graph and paseo-view blocks into strict Paseo timeline items", () => {
    const screenshotReply = [
      "插件 UI 不在 daemon 上画。下面用一张简图和一张表把这条路径摊开。",
      "",
      "```paseo-graph",
      JSON.stringify({
        title: "远程客户端渲染插件",
        summary: "Daemon 下发 bundle，客户端本地渲染，RPC 回子进程取数。",
        direction: "right",
        nodes: [
          { id: "client", type: "client", label: "远程客户端", sublabel: "手机或浏览器" },
          { id: "relay", type: "external", label: "中继或直连", sublabel: "同一条 WebSocket" },
          { id: "daemon", type: "service", label: "Paseo Daemon", sublabel: "编译并下发" },
          { id: "worker", type: "worker", label: "插件子进程", sublabel: "index.server.ts" },
          { id: "bundle", type: "file", label: "客户端 Bundle", sublabel: "index.client.tsx" },
          { id: "surface", type: "function", label: "本地界面", sublabel: "React Native" },
        ],
        edges: [
          { from: "client", to: "relay", label: "连接", kind: "flow" },
          { from: "relay", to: "daemon", label: "catalog.get", kind: "call" },
          { from: "daemon", to: "bundle", label: "按哈希下发", kind: "data" },
          { from: "bundle", to: "surface", label: "本机 eval", kind: "flow" },
          { from: "surface", to: "client", label: "画在屏幕上", kind: "data" },
          { from: "surface", to: "daemon", label: "useRpc", kind: "call" },
          { from: "daemon", to: "worker", label: "IPC", kind: "async" },
          { from: "worker", to: "surface", label: "JSON 或字节", kind: "data" },
        ],
        steps: [
          { title: "1. 取包", text: "客户端报已有 bundle 哈希，daemon 只补缺的源码包。", focus: ["client", "daemon", "bundle"] },
          { title: "2. 本地画", text: "客户端执行 bundle。", focus: ["bundle", "surface", "client"] },
          { title: "3. 回主机取数", text: "界面调用 RPC。", focus: ["surface", "daemon", "worker"] },
        ],
      }),
      "```",
      "",
      "```paseo-view",
      JSON.stringify({
        type: "table",
        title: "谁负责哪一段",
        data: [
          { 段: "客户端 bundle", 在哪跑: "每台已连接的 App", "daemon 做什么": "编译并按 SHA-256 下发" },
          { 段: "屏幕与面板", 在哪跑: "客户端 React Native", "daemon 做什么": "不解释布局和回调" },
          { 段: "RPC 与订阅", 在哪跑: "插件子进程", "daemon 做什么": "校验后经 IPC 转发" },
          { 段: "内置插件", 在哪跑: "daemon 进程内", "daemon 做什么": "始终加载，不看总开关" },
        ],
        columns: [
          { key: "段", type: "text" },
          { key: "在哪跑", type: "text" },
          { key: "daemon 做什么", type: "text" },
        ],
      }),
      "```",
    ].join("\n");

    const res = transformAssistantMessage({
      phase: "complete",
      item: { type: "assistant_message", text: screenshotReply },
    });

    expect(res?.items).toHaveLength(3);
    expect(res?.items.map((item) => item.kind)).toEqual(["gt-markdown", "gt-view", "gt-view"]);
    for (const item of res?.items ?? []) {
      expect(item.id).toBeUndefined();
      expect(isStrictTimelineData(item.data)).toBe(true);
    }
    expect(markdownSegmentSchema.safeParse(res?.items[0]?.data).success).toBe(true);
    expect(res?.items[1]?.data).toMatchObject({
      mode: "inline",
      spec: {
        nodes: expect.arrayContaining([
          { id: "worker", type: "worker", label: "插件子进程", sublabel: "index.server.ts" },
        ]),
      },
    });
    expect(dataViewSegmentSchema.safeParse(res?.items[1]?.data).success).toBe(true);
    expect(dataViewSegmentSchema.safeParse(res?.items[2]?.data).success).toBe(true);
  });

  it("leaves plain GFM tables unclaimed when upgradeMarkdownTables is disabled", () => {
    const transform = createAssistantTransformer(() => false);
    const mdTable = "| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |";
    expect(
      transform({
        phase: "complete",
        item: { type: "assistant_message", text: mdTable },
      }),
    ).toBeUndefined();

    const mixed = `${mdTable}\n\n\`\`\`paseo-view\n{"type":"stats","items":[{"label":"N","value":1}]}\n\`\`\``;
    const res = transform({
      phase: "complete",
      item: { type: "assistant_message", text: mixed },
    });
    expect(res?.items.map((i) => i.kind)).toEqual(["gt-markdown", "gt-view"]);
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
    expect(isStrictTimelineData(compacted?.items[0]?.data)).toBe(true);
    expect(toolBadgeSchema.safeParse(compacted?.items[0]?.data).success).toBe(true);
  });

  it("detects numeric columns and opens full-screen viewer store entries", () => {
    expect(
      hasNumericColumn(
        [{ segment: "bundle", where: "client" }],
        [{ key: "segment", type: "text" }, { key: "where", type: "text" }],
      ),
    ).toBe(false);

    expect(
      hasNumericColumn(
        [{ segment: "bundle", latency: 12 }],
        [{ key: "segment", type: "text" }, { key: "latency", type: "number" }],
      ),
    ).toBe(true);

    registerFullScreenOpener(null);
    expect(openViewInFullScreen("Test", { kind: "token", viewId: "v_1" })).toBe(false);

    let openedId = "";
    registerFullScreenOpener((id) => {
      openedId = id;
    });
    expect(openViewInFullScreen("Test View", { kind: "token", viewId: "v_2" })).toBe(true);
    expect(getViewerEntry(openedId)?.title).toBe("Test View");
    registerFullScreenOpener(null);
  });

  it("registers all client contributions and returns a cleanup function", () => {
    const calls = {
      transformers: [] as string[],
      renderers: [] as string[],
      screens: [] as string[],
      settings: [] as string[],
      panels: [] as string[],
      commands: [] as string[],
      slash: [] as string[],
    };
    const mockClient = {
      rpc: vi.fn().mockResolvedValue({ status: "ready", revision: "1", values: {} }),
      openScreen: vi.fn(),
      addTimelineTransformer: vi.fn((c: { id: string }) => {
        calls.transformers.push(c.id);
        return () => {};
      }),
      addTimelineRenderer: vi.fn((c: { kind: string }) => {
        calls.renderers.push(c.kind);
        return () => {};
      }),
      addScreen: vi.fn((c: { id: string }) => {
        calls.screens.push(c.id);
        return () => {};
      }),
      addSettingsScreen: vi.fn((c: { id: string }) => {
        calls.settings.push(c.id);
        return () => {};
      }),
      addWorkspacePanel: vi.fn((c: { id: string }) => {
        calls.panels.push(c.id);
        return () => {};
      }),
      addCommandCenterItem: vi.fn((c: { id: string }) => {
        calls.commands.push(c.id);
        return () => {};
      }),
      addSlashCommand: vi.fn((c: { name: string }) => {
        calls.slash.push(c.name);
        return () => {};
      }),
    };

    const cleanup = contribute(mockClient as never);
    expect(typeof cleanup).toBe("function");
    expect(calls.transformers).toEqual(["assistant-views", "show-view-tool-calls"]);
    expect(calls.renderers).toEqual(["gt-markdown", "gt-view", "gt-tool-badge"]);
    expect(calls.screens).toEqual(["viewer"]);
    expect(calls.settings).toEqual(["graph-tables"]);
    expect(calls.panels).toEqual(["views"]);
    expect(calls.commands).toEqual(["open-views", "open-settings"]);
    expect(calls.slash).toEqual(["views"]);
  });
});
