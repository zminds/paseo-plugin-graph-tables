import { settingsRpc } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GraphTablesSettingsScreen } from "./client/settings-screen";
import {
  DataViewRenderer,
  MarkdownSegmentRenderer,
  ToolBadgeRenderer,
} from "./client/timeline-renderers";
import {
  createAssistantTransformer,
  dataViewSegmentSchema,
  markdownSegmentSchema,
  toolBadgeSchema,
  transformShowViewToolCall,
} from "./client/timeline-transform";
import { ViewsWorkspacePanel } from "./client/views-panel";
import { FullViewerScreen } from "./client/viewer-screen";
import { getViewerEntry, registerFullScreenOpener } from "./client/viewer-store";
import { pluginSettings } from "./shared/settings";

export default function contribute(client: PluginClientContext) {
  let upgradeMarkdownTables = true;
  const settingsRead = settingsRpc(pluginSettings.id).read;

  void client
    .rpc(settingsRead, {})
    .then((result) => {
      if (result.status === "ready") {
        const parsed = pluginSettings.schema.safeParse(result.values);
        if (parsed.success) {
          upgradeMarkdownTables = parsed.data.upgradeMarkdownTables;
        }
      }
      return undefined;
    })
    .catch(() => {
      // Keep default true if settings read fails before daemon sync
    });

  client.addTimelineTransformer({
    id: "assistant-views",
    query: { itemType: "assistant_message" },
    transform: createAssistantTransformer(() => upgradeMarkdownTables),
  });

  client.addTimelineTransformer({
    id: "show-view-tool-calls",
    query: { itemType: "tool_call" },
    transform: transformShowViewToolCall,
  });

  client.addTimelineRenderer({
    kind: "gt-markdown",
    version: 1,
    schema: markdownSegmentSchema,
    Component: MarkdownSegmentRenderer,
  });

  client.addTimelineRenderer({
    kind: "gt-view",
    version: 1,
    schema: dataViewSegmentSchema,
    Component: DataViewRenderer,
  });

  client.addTimelineRenderer({
    kind: "gt-tool-badge",
    version: 1,
    schema: toolBadgeSchema,
    Component: ToolBadgeRenderer,
  });

  client.addScreen({
    id: "viewer",
    title: (params) => getViewerEntry(params.id)?.title ?? "Data view",
    Component: FullViewerScreen,
  });

  registerFullScreenOpener((id) => {
    client.openScreen({ screenId: "viewer", params: { id } });
  });

  client.addSettingsScreen({
    id: "graph-tables",
    title: "Graph & Tables",
    icon: "ChartNoAxesColumn",
    Component: GraphTablesSettingsScreen,
  });

  client.addWorkspacePanel({
    id: "views",
    title: "Views",
    icon: "ChartNoAxesColumn",
    locations: ["workspace", "explorer"],
    Component: ViewsWorkspacePanel,
  });

  client.addCommandCenterItem({
    id: "open-views",
    title: "Open Data Views panel",
    icon: "ChartNoAxesColumn",
    keywords: ["table", "chart", "graph", "diagram", "views"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("views");
    },
  });

  client.addCommandCenterItem({
    id: "open-settings",
    title: "Configure Graph & Tables",
    icon: "Settings2",
    keywords: ["table", "chart", "graph", "settings"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("graph-tables");
    },
  });

  client.addSlashCommand({
    name: "views",
    description: "Open the Data Views & Diagrams workspace panel",
    argumentHint: "",
    context: "workspace",
    onSubmit({ openPanel }) {
      openPanel("views");
    },
  });

  return () => {
    registerFullScreenOpener(null);
  };
}
