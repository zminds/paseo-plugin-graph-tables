import { useRpc, useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { syncSkillsRpc } from "../shared/rpc";
import { pluginSettings, type GraphTablesSettings } from "../shared/settings";

type ReadySettings = Extract<SettingsState<typeof pluginSettings.schema>, { status: "ready" }>;

const PAGE_SIZE_OPTIONS = [
  { label: "10 rows", value: "10" },
  { label: "25 rows", value: "25" },
  { label: "50 rows", value: "50" },
  { label: "100 rows", value: "100" },
] as const;

const MAX_ROWS_OPTIONS = [
  { label: "1,000 rows", value: "1000" },
  { label: "5,000 rows", value: "5000" },
  { label: "10,000 rows", value: "10000" },
  { label: "25,000 rows", value: "25000" },
] as const;

const EXPORT_DIR_OPTIONS = [
  { label: "~/Downloads/paseo-exports", value: "~/Downloads/paseo-exports" },
  { label: "~/Desktop", value: "~/Desktop" },
  { label: "Workspace (.paseo-exports)", value: "workspace" },
] as const;

function SettingsEditor({
  settings,
  theme,
}: {
  settings: ReadySettings;
  theme: PluginSurfaceProps["theme"];
}) {
  const toast = useToast();
  const syncSkills = useRpc(syncSkillsRpc);
  const [skillStatusText, setSkillStatusText] = useState<string>(
    "Syncs to ~/.agents/skills, ~/.claude/skills, ~/.gemini/config/skills",
  );
  const [syncingSkills, setSyncingSkills] = useState(false);

  useEffect(() => {
    void syncSkills({ action: "status" })
      .then((res) => {
        const summary = res.targets
          .map((t) => `${t.root.replace(/^\/Users\/[^/]+/, "~")}: ${t.status}`)
          .join(" · ");
        if (summary) setSkillStatusText(summary);
        return undefined;
      })
      .catch(() => {});
  }, [syncSkills, settings.values.installGlobalSkills]);

  const handleSyncNow = async () => {
    if (syncingSkills) return;
    setSyncingSkills(true);
    try {
      const res = await syncSkills({ action: "install" });
      const summary = res.targets
        .map((t) => `${t.root.replace(/^\/Users\/[^/]+/, "~")}: ${t.status}`)
        .join(" · ");
      setSkillStatusText(summary);
      toast.show("Global SKILL.md targets synchronized", { variant: "success" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Skill sync failed");
    } finally {
      setSyncingSkills(false);
    }
  };

  const patch = useCallback(
    (partial: Partial<GraphTablesSettings>) => {
      void settings.save({ ...settings.values, ...partial }, settings.revision);
    },
    [settings],
  );

  const errorStyle = useMemo(
    () => ({ color: theme.colors.statusDanger, fontSize: 12 }),
    [theme],
  );

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title="Timeline & Agent Integration">
        <SettingsCard>
          <SettingsSwitch
            label="Inject view instructions into agent prompt"
            hint="Teaches interactive agents the paseo-view, paseo-graph, and show_view conventions on session open."
            value={settings.values.enablePromptInjection}
            disabled={settings.saving}
            onValueChange={(enablePromptInjection) => patch({ enablePromptInjection })}
          />
          <SettingsSwitch
            label="Attach show_view agent tool"
            hint="Allows agents to query files, SQLite, HTTP APIs, and scripts and return interactive view tokens."
            value={settings.values.enableShowViewTool}
            disabled={settings.saving}
            onValueChange={(enableShowViewTool) => patch({ enableShowViewTool })}
          />
          <SettingsSwitch
            label="Upgrade Markdown tables automatically"
            hint="Turns multi-row Markdown tables in assistant replies into sortable, searchable interactive tables."
            value={settings.values.upgradeMarkdownTables}
            disabled={settings.saving}
            onValueChange={(upgradeMarkdownTables) => patch({ upgradeMarkdownTables })}
          />
          <SettingsSwitch
            label="Install global agent SKILL.md"
            hint="Auto-installs ~/.agents/skills, ~/.claude/skills, and ~/.gemini/config/skills (preserves symlinks)."
            value={settings.values.installGlobalSkills}
            disabled={settings.saving}
            onValueChange={(installGlobalSkills) => patch({ installGlobalSkills })}
          />
          <SettingsAction
            label="Global skill targets"
            hint={skillStatusText}
            actionLabel={syncingSkills ? "Syncing..." : "Sync now"}
            disabled={syncingSkills}
            onPress={() => void handleSyncNow()}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Dynamic Data Sources">
        <SettingsCard>
          <SettingsSwitch
            label="Files & folders"
            hint="Allow reading JSON, JSONL, CSV, TSV files and directory listings."
            value={settings.values.allowFileSource}
            disabled={settings.saving}
            onValueChange={(allowFileSource) => patch({ allowFileSource })}
          />
          <SettingsSwitch
            label="SQLite databases (read-only)"
            hint="Allow read-only SQLite queries via sqlite3 -readonly."
            value={settings.values.allowSqliteSource}
            disabled={settings.saving}
            onValueChange={(allowSqliteSource) => patch({ allowSqliteSource })}
          />
          <SettingsSwitch
            label="HTTP endpoints"
            hint="Allow fetching JSON or CSV data from HTTP(S) URLs."
            value={settings.values.allowHttpSource}
            disabled={settings.saving}
            onValueChange={(allowHttpSource) => patch({ allowHttpSource })}
          />
          <SettingsSwitch
            label="PostgreSQL databases"
            hint="Opt-in: resolves connection URL from .env (DATABASE_URL) via psql without exposing secrets."
            value={settings.values.allowPostgresSource}
            disabled={settings.saving}
            onValueChange={(allowPostgresSource) => patch({ allowPostgresSource })}
          />
          <SettingsSwitch
            label="Shell commands"
            hint="Opt-in: allow views backed by shell command stdout."
            value={settings.values.allowCommandSource}
            disabled={settings.saving}
            onValueChange={(allowCommandSource) => patch({ allowCommandSource })}
          />
          <SettingsSwitch
            label="Inline scripts (Python, Node, sh)"
            hint="Opt-in: allow views backed by embedded scripts executed in the workspace."
            value={settings.values.allowScriptSource}
            disabled={settings.saving}
            onValueChange={(allowScriptSource) => patch({ allowScriptSource })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Query Limits">
        <SettingsCard>
          <SettingsSelect
            label="Default table page size"
            value={String(settings.values.defaultPageSize)}
            options={PAGE_SIZE_OPTIONS}
            disabled={settings.saving}
            onValueChange={(val) => patch({ defaultPageSize: Number(val) })}
          />
          <SettingsSelect
            label="Maximum rows per view"
            value={String(settings.values.maxRowsPerQuery)}
            options={MAX_ROWS_OPTIONS}
            disabled={settings.saving}
            onValueChange={(val) => patch({ maxRowsPerQuery: Number(val) })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Exports">
        <SettingsCard>
          <SettingsSelect
            label="Export directory"
            hint="Where Save .md, Save SVG, and Save PNG write files on the daemon host."
            value={settings.values.exportDirectory}
            options={EXPORT_DIR_OPTIONS}
            disabled={settings.saving}
            onValueChange={(val) => patch({ exportDirectory: val })}
          />
        </SettingsCard>
      </SettingsSection>

      {settings.saveError ? (
        <Text accessibilityRole="alert" style={errorStyle}>
          {settings.saveError}
        </Text>
      ) : null}
    </View>
  );
}

export function GraphTablesSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(pluginSettings);
  const textStyle = useMemo(() => ({ color: theme.colors.foreground }), [theme]);

  if (settings.status === "loading") {
    return <Text style={textStyle}>Loading Graph & Tables settings...</Text>;
  }
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Graph & Tables">
        <Text style={textStyle}>{settings.error}</Text>
        <SettingsAction label="Retry" actionLabel="Reload" onPress={settings.reload} />
        {settings.status === "invalid" ? (
          <SettingsAction label="Reset to defaults" actionLabel="Reset" onPress={settings.reset} />
        ) : null}
      </SettingsSection>
    );
  }
  return <SettingsEditor settings={settings} theme={theme} />;
}
