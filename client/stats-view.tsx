import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { DataRow } from "../shared/query-engine";
import type { StatItem, ViewSpec } from "../shared/view-schema";

export interface StatsViewProps {
  spec: Partial<ViewSpec>;
  rows: readonly DataRow[];
  theme: PluginTheme;
  compact: boolean;
}

function normalizeStatItems(spec: Partial<ViewSpec>, rows: readonly DataRow[]): StatItem[] {
  if (spec.items && spec.items.length > 0) return spec.items;
  return rows.map((row) => ({
    label: String(row.label ?? row.name ?? "Metric"),
    value: (row.value as string | number) ?? "—",
    unit: typeof row.unit === "string" ? row.unit : undefined,
    delta: typeof row.delta === "number" || typeof row.delta === "string" ? row.delta : undefined,
    invert: typeof row.invert === "boolean" ? row.invert : undefined,
    trend: Array.isArray(row.trend)
      ? row.trend.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      : undefined,
  }));
}

function formatDelta(delta: string | number): { text: string; num: number | null } {
  if (typeof delta === "number") {
    const sign = delta > 0 ? "+" : "";
    return { text: `${sign}${delta}`, num: delta };
  }
  const num = Number(String(delta).replace(/[,%a-zA-Z\s]/g, ""));
  return { text: delta, num: Number.isFinite(num) ? num : null };
}

export function StatsView({ spec, rows, theme, compact }: StatsViewProps) {
  const items = useMemo(() => normalizeStatItems(spec, rows), [spec, rows]);

  const styles = useMemo(
    () => ({
      grid: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 10,
        padding: compact ? 10 : 12,
      },
      tile: {
        minWidth: compact ? 132 : 164,
        flexGrow: 1,
        flexBasis: compact ? ("46%" as const) : ("22%" as const),
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        gap: 6,
      },
      label: { fontSize: 11.5, color: theme.colors.foregroundMuted, fontWeight: "600" as const },
      valueRow: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: 4 },
      value: { fontSize: compact ? 20 : 24, fontWeight: "700" as const, color: theme.colors.foreground },
      unit: { fontSize: 12, color: theme.colors.foregroundMuted },
      bottomRow: {
        flexDirection: "row" as const,
        alignItems: "flex-end" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        minHeight: 22,
      },
      spark: { flexDirection: "row" as const, alignItems: "flex-end" as const, gap: 2, height: 22 },
    }),
    [theme, compact],
  );

  if (items.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>No stats items.</Text>
      </View>
    );
  }

  return (
    <View style={styles.grid}>
      {items.map((item, idx) => {
        const deltaInfo = item.delta !== undefined ? formatDelta(item.delta) : null;
        let deltaColor = theme.colors.foregroundMuted;
        if (deltaInfo && deltaInfo.num !== null && deltaInfo.num !== 0) {
          const isUp = deltaInfo.num > 0;
          const isGood = item.invert ? !isUp : isUp;
          deltaColor = isGood ? theme.colors.statusSuccess : theme.colors.statusDanger;
        }

        const trend = item.trend ?? [];
        const minT = trend.length ? Math.min(...trend) : 0;
        const maxT = trend.length ? Math.max(...trend) : 1;
        const spanT = Math.max(1e-9, maxT - minT);

        return (
          <View key={`stat-${idx}`} style={styles.tile}>
            <Text numberOfLines={1} style={styles.label}>
              {item.label}
            </Text>
            <View style={styles.valueRow}>
              <Text selectable style={styles.value}>
                {typeof item.value === "number"
                  ? item.value.toLocaleString("en-US", { maximumFractionDigits: 3 })
                  : String(item.value)}
              </Text>
              {item.unit ? <Text style={styles.unit}>{item.unit}</Text> : null}
            </View>
            {(deltaInfo || trend.length > 0) ? (
              <View style={styles.bottomRow}>
                {deltaInfo ? (
                  <Text style={{ fontSize: 12, fontWeight: "600", color: deltaColor }}>
                    {deltaInfo.text}
                  </Text>
                ) : (
                  <View />
                )}
                {trend.length > 1 ? (
                  <View style={styles.spark}>
                    {trend.slice(-16).map((v, tIdx) => {
                      const barH = Math.max(3, Math.round(((v - minT) / spanT) * 18) + 3);
                      return (
                        <View
                          key={`sp-${tIdx}`}
                          style={{
                            width: 4,
                            height: barH,
                            borderRadius: 1.5,
                            backgroundColor: theme.colors.accent,
                            opacity: 0.45 + (tIdx / Math.max(1, trend.length - 1)) * 0.55,
                          }}
                        />
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
