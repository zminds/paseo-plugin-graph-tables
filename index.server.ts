/**
 * Paseo Graph & Tables plugin server entry.
 *
 * Re-implements Beluga's (https://github.com/beluga-labs/beluga) interactive view
 * and graph visualization workflow inside Paseo's plugin subprocess:
 * - Injects visualization instructions & `show_view` tool via `agent.open.before`
 * - Hosts daemon-side data caching, live source execution, and file export RPCs
 * - Syncs global `paseo-graph-tables` SKILL.md across local agent skill directories
 */
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createExportViewHandler } from "./server/export";
import { createListViewsHandler, createQueryViewHandler } from "./server/handlers";
import { createShowViewTool } from "./server/show-view-tool";
import {
  getPluginSkillStatus,
  removePluginSkill,
  syncPluginSkill,
} from "./server/skill-sync";
import { ViewStore } from "./server/view-store";
import { GRAPH_TABLES_SYSTEM_PROMPT } from "./shared/prompt";
import { exportViewRpc, listViewsRpc, queryViewRpc, syncSkillsRpc } from "./shared/rpc";
import { DEFAULT_SETTINGS, pluginSettings, type GraphTablesSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  let currentSettings: GraphTablesSettings = DEFAULT_SETTINGS;
  let lastSkillInstallPref: boolean | null = null;
  const settingsHandle = server.registerSettings(pluginSettings);

  const reconcileGlobalSkills = (enabled: boolean) => {
    if (lastSkillInstallPref === enabled) return;
    lastSkillInstallPref = enabled;
    if (enabled) {
      void syncPluginSkill().catch(() => {});
    } else {
      void removePluginSkill().catch(() => {});
    }
  };

  void settingsHandle.read().then((state) => {
    if (state.status === "ready") {
      currentSettings = state.values;
      reconcileGlobalSkills(state.values.installGlobalSkills);
    } else {
      reconcileGlobalSkills(DEFAULT_SETTINGS.installGlobalSkills);
    }
  });

  const unsubSettings = settingsHandle.subscribe((state) => {
    if (state.status === "ready") {
      currentSettings = state.values;
      reconcileGlobalSkills(state.values.installGlobalSkills);
    }
  });

  const getSettings = () => currentSettings;
  const store = new ViewStore();
  const showViewTool = createShowViewTool(store, getSettings);

  server.handle(queryViewRpc, createQueryViewHandler(store, getSettings));
  server.handle(listViewsRpc, createListViewsHandler(store));
  server.handle(exportViewRpc, createExportViewHandler(store, getSettings));
  server.handle(syncSkillsRpc, async ({ action }) => {
    if (action === "install") {
      return { targets: await syncPluginSkill() };
    }
    if (action === "remove") {
      return { targets: await removePluginSkill() };
    }
    return { targets: await getPluginSkillStatus() };
  });

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

  return () => {
    unsubSettings();
    removeOpenHook();
  };
}
