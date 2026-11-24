import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createListViewsHandler, createQueryViewHandler } from "./server/handlers";
import { createShowViewTool } from "./server/show-view-tool";
import { ViewStore } from "./server/view-store";
import { GRAPH_TABLES_SYSTEM_PROMPT } from "./shared/prompt";
import { listViewsRpc, queryViewRpc } from "./shared/rpc";
import { DEFAULT_SETTINGS, pluginSettings, type GraphTablesSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  let currentSettings: GraphTablesSettings = DEFAULT_SETTINGS;
  const settingsHandle = server.registerSettings(pluginSettings);

  void settingsHandle.read().then((state) => {
    if (state.status === "ready") currentSettings = state.values;
  });

  const unsubSettings = settingsHandle.subscribe((state) => {
    if (state.status === "ready") currentSettings = state.values;
  });

  const getSettings = () => currentSettings;
  const store = new ViewStore();
  const showViewTool = createShowViewTool(store, getSettings);

  server.handle(queryViewRpc, createQueryViewHandler(store, getSettings));
  server.handle(listViewsRpc, createListViewsHandler(store));

  const removeOpenHook = server.addHook("agent.open.before", async ({ request }) => {
    if (request.purpose !== "interactive" || request.background) {
      return;
    }

    const settings = getSettings();
    const nextAppendPrompt = settings.enablePromptInjection
      ? [...(request.appendSystemPrompt ?? []), GRAPH_TABLES_SYSTEM_PROMPT]
      : request.appendSystemPrompt;
    const nextTools = settings.enableShowViewTool
      ? [...request.tools, showViewTool]
      : request.tools;

    if (!settings.enablePromptInjection && !settings.enableShowViewTool) {
      return;
    }

    return {
      ...request,
      ...(nextAppendPrompt ? { appendSystemPrompt: nextAppendPrompt } : {}),
      tools: nextTools,
    };
  });

  return async () => {
    unsubSettings();
    removeOpenHook();
    await store.flush();
  };
}
