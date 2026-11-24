import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import type { DataRow } from "../shared/query-engine";
import type { ChartKind, ColumnSpec, ViewSpec } from "../shared/view-schema";
import { formatCompactNumber, parseChartData } from "./format";
import { isWebPlatform, WebSvgChart } from "./web";

export interface ChartViewProps {
  spec: Partial<ViewSpec>;
  columns: readonly ColumnSpec[];
  rows: readonly DataRow[];
  theme: PluginTheme;
  compact: boolean;
  expanded?: boolean;
}

export function ChartView({
  spec,
  columns,
  rows,
  theme,
  compact,
  expanded = false,
}: ChartViewProps) {
  const kind: ChartKind = spec.chart ?? "bar";
  const parsed = useMemo(() => parseChartData(rows, columns, spec, theme), [rows, columns, spec, theme]);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(compact ? 320 : 560);

  const toggleSeries = (key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < parsed.series.length - 1) next.add(key);
      return next;
    });
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const w = Math.floor(event.nativeEvent.layout.width);
    if (w > 120) setContainerWidth(w);
  };

  const chartHeight = expanded ? 340 : compact ? 210 : 250;
  const visibleSeries = parsed.series.filter((s) => !hiddenSeries.has(s.key));

  const styles = useMemo(
    () => ({
      root: { padding: compact ? 10 : 14, gap: 10 },
      legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      legendItem: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      legendDot: { width: 8, height: 8, borderRadius: 4 },
      legendText: { fontSize: 11.5, color: theme.colors.foreground },
      readout: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      readoutLabel: { fontSize: 11.5, fontWeight: "700" as const, color: theme.colors.foreground },
      readoutVal: { fontSize: 11.5, color: theme.colors.foregroundMuted },
      empty: { padding: 20, alignItems: "center" as const },
      emptyText: { fontSize: 12, color: theme.colors.foregroundMuted },
    }),
    [theme, compact],
  );

  if (rows.length === 0 || parsed.series.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No numeric series to plot.</Text>
      </View>
    );
  }

  // Native RN fallback rendering when Platform.OS !== "web"
  const renderNativeFallback = () => {
    if (kind === "pie" || kind === "donut") {
      const slices = parsed.pieSlices.filter((s) => s.value > 0);
      const total = Math.max(1e-9, slices.reduce((a, s) => a + s.value, 0));
      return (
        <View style={{ gap: 10 }}>
          <View
            style={{
              flexDirection: "row",
              height: 22,
              borderRadius: 6,
              overflow: "hidden",
              backgroundColor: theme.colors.surface2,
            }}
          >
            {slices.map((slice, idx) => (
              <Pressable
                key={`npie-${idx}`}
                onPress={() => setSelectedIndex(selectedIndex === slice.rowIndex ? null : slice.rowIndex)}
                style={{
                  flex: slice.value / total,
                  backgroundColor: slice.color,
                  opacity: selectedIndex !== null && selectedIndex !== slice.rowIndex ? 0.45 : 1,
                }}
              />
            ))}
          </View>
          <View style={{ gap: 6 }}>
            {slices.map((slice, idx) => (
              <View
                key={`nsl-${idx}`}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: slice.color }} />
                  <Text style={{ fontSize: 12, color: theme.colors.foreground }}>{slice.label}</Text>
                </View>
                <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
                  {formatCompactNumber(slice.value)} ({((slice.value / total) * 100).toFixed(1)}%)
                </Text>
              </View>
            ))}
          </View>
        </View>
      );
    }

    const maxVal = Math.max(
      1e-9,
      ...visibleSeries.flatMap((s) => s.values.map((v) => Math.abs(v ?? 0))),
    );

    return (
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10, paddingTop: 12 }}>
          {parsed.xLabels.map((lbl, idx) => (
            <Pressable
              key={`nb-${idx}`}
              onPress={() => setSelectedIndex(selectedIndex === idx ? null : idx)}
              style={{ alignItems: "center", gap: 4, minWidth: 36 }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-end", height: 140, gap: 2 }}>
                {visibleSeries.map((s) => {
                  const val = Math.max(0, s.values[idx] ?? 0);
                  const barH = Math.max(3, Math.round((val / maxVal) * 136));
                  return (
                    <View
                      key={s.key}
                      style={{
                        width: Math.max(10, Math.round(24 / visibleSeries.length)),
                        height: barH,
                        borderRadius: 3,
                        backgroundColor: s.color,
                        opacity: selectedIndex !== null && selectedIndex !== idx ? 0.45 : 1,
                      }}
                    />
                  );
                })}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 10, color: theme.colors.foregroundMuted, maxWidth: 48 }}>
                {lbl}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      {kind !== "pie" && kind !== "donut" && parsed.series.length > 1 ? (
        <View style={styles.legend}>
          {parsed.series.map((s) => {
            const hidden = hiddenSeries.has(s.key);
            return (
              <Pressable
                key={s.key}
                accessibilityRole="button"
                onPress={() => toggleSeries(s.key)}
                style={[styles.legendItem, hidden ? { opacity: 0.45 } : null]}
              >
                <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                <Text style={styles.legendText}>{s.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {isWebPlatform ? (
        <WebSvgChart
          kind={kind}
          data={parsed}
          curve={spec.curve ?? "linear"}
          stacked={spec.stacked}
          hiddenSeries={hiddenSeries}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          theme={theme}
          width={Math.max(260, containerWidth - (compact ? 20 : 28))}
          height={chartHeight}
        />
      ) : (
        renderNativeFallback()
      )}

      {selectedIndex !== null && selectedIndex < parsed.xLabels.length ? (
        <View style={styles.readout}>
          <Text style={styles.readoutLabel}>{parsed.xLabels[selectedIndex]}:</Text>
          {visibleSeries.map((s) => (
            <Text key={s.key} style={styles.readoutVal}>
              {s.label} ={" "}
              {s.values[selectedIndex] === null
                ? "—"
                : formatCompactNumber(s.values[selectedIndex]!)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
