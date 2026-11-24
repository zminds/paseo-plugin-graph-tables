import { useRpc, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { listViewsRpc } from "../shared/rpc";
import { DEMO_VIEW_ITEMS } from "./demo-views";
import { ViewCard } from "./view-card";

export function ViewsWorkspacePanel({ theme, layout }: PluginWorkspacePanelProps) {
  const listViews = useRpc(listViewsRpc);
  const [tabOverride, setTabOverride] = useState<"live" | "demos" | null>(null);
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [selectedDemoId, setSelectedDemoId] = useState<string>(DEMO_VIEW_ITEMS[0]!.id);

  const viewsQuery = useQuery({
    queryKey: ["graph-tables", "list"],
    queryFn: () => listViews({}),
    refetchInterval: 8000,
  });

  const views = viewsQuery.data?.views ?? [];
  const activeTab = tabOverride ?? (views.length > 0 ? "live" : "demos");
  const activeViewId = selectedViewId ?? views[0]?.viewId ?? null;
  const activeDemo =
    DEMO_VIEW_ITEMS.find((d) => d.id === selectedDemoId) ?? DEMO_VIEW_ITEMS[0]!;

  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
        padding: layout.compact ? 12 : 16,
        gap: 12,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        flexWrap: "wrap" as const,
        gap: 8,
      },
      title: {
        fontSize: layout.compact ? 16 : 18,
        fontWeight: "700" as const,
        color: theme.colors.foreground,
      },
      tabRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      tabBtn: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      tabBtnActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      tabText: { fontSize: 12, fontWeight: "600" as const, color: theme.colors.foreground },
      tabTextActive: { color: theme.colors.accentForeground },
      refreshBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      refreshText: { fontSize: 12, color: theme.colors.foreground },
      chipRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      chipActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      chipText: { fontSize: 12, color: theme.colors.foreground },
      chipTextActive: { color: theme.colors.accentForeground, fontWeight: "600" as const },
      empty: {
        padding: 24,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 10,
      },
      emptyTitle: { fontSize: 14, fontWeight: "700" as const, color: theme.colors.foreground },
      emptyBody: { fontSize: 12.5, color: theme.colors.foregroundMuted },
    }),
    [theme, layout.compact],
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Data Views & Diagrams</Text>
          <View style={styles.tabRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTabOverride("live")}
              style={[styles.tabBtn, activeTab === "live" ? styles.tabBtnActive : null]}
            >
              <Text style={[styles.tabText, activeTab === "live" ? styles.tabTextActive : null]}>
                Live Views ({views.length})
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTabOverride("demos")}
              style={[styles.tabBtn, activeTab === "demos" ? styles.tabBtnActive : null]}
            >
              <Text style={[styles.tabText, activeTab === "demos" ? styles.tabTextActive : null]}>
                Demo Gallery ({DEMO_VIEW_ITEMS.length})
              </Text>
            </Pressable>
            {activeTab === "live" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void viewsQuery.refetch()}
                style={styles.refreshBtn}
              >
                <Icon name="RotateCw" size={13} color={theme.colors.foreground} />
                <Text style={styles.refreshText}>Refresh</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {activeTab === "demos" ? (
          <>
            <View style={styles.chipRow}>
              {DEMO_VIEW_ITEMS.map((demo) => {
                const active = demo.id === activeDemo.id;
                return (
                  <Pressable
                    key={demo.id}
                    accessibilityRole="button"
                    onPress={() => setSelectedDemoId(demo.id)}
                    style={[styles.chip, active ? styles.chipActive : null]}
                  >
                    <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                      {demo.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <ViewCard
              input={{ kind: "inline", spec: activeDemo.spec }}
              theme={theme}
              compact={layout.compact}
            />
          </>
        ) : views.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No live views created yet</Text>
            <Text style={styles.emptyBody}>
              Ask any interactive agent to visualize data using show_view or output a paseo-view /
              paseo-graph block in chat. Or open the Demo Gallery above to test all chart types,
              diagram interactions, and Markdown/SVG/PNG export immediately.
            </Text>
            <View style={{ flexDirection: "row" }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setTabOverride("demos")}
                style={[styles.tabBtn, styles.tabBtnActive]}
              >
                <Text style={[styles.tabText, styles.tabTextActive]}>Open Demo Gallery</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.chipRow}>
              {views.map((v) => {
                const active = v.viewId === activeViewId;
                return (
                  <Pressable
                    key={v.viewId}
                    accessibilityRole="button"
                    onPress={() => setSelectedViewId(v.viewId)}
                    style={[styles.chip, active ? styles.chipActive : null]}
                  >
                    <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                      {v.title} ({v.rowCount})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {activeViewId ? (
              <ViewCard
                input={{ kind: "token", viewId: activeViewId }}
                theme={theme}
                compact={layout.compact}
              />
            ) : null}
          </>
        )}
      </View>
    </ScrollView>
  );
}
