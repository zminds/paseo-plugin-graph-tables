import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import type { DataRow } from "../shared/query-engine";
import { exportViewRpc } from "../shared/rpc";
import { exportChartToSvg } from "../shared/svg-export";
import type { ChartKind, ColumnSpec, ViewSpec } from "../shared/view-schema";
import { formatCompactNumber, parseChartData } from "./format";
import { isWebPlatform, rasterizeSvgToPngBase64, WebSvgChart } from "./web";

const CHART_KINDS: ReadonlyArray<{ kind: ChartKind; label: string }> = [
  { kind: "bar", label: "Bar" },
  { kind: "line", label: "Line" },
  { kind: "area", label: "Area" },
  { kind: "pie", label: "Pie" },
  { kind: "donut", label: "Donut" },
  { kind: "scatter", label: "Scatter" },
];

export interface ChartViewProps {
  spec: Partial<ViewSpec>;
  columns: readonly ColumnSpec[];
  rows: readonly DataRow[];
  theme: PluginTheme;
  compact: boolean;
  expanded?: boolean;
  title?: string;
  viewId?: string;
}

export function ChartView({
  spec,
  columns,
  rows,
  theme,
  compact,
  expanded = false,
  title,
  viewId,
}: ChartViewProps) {
  const toast = useToast();
  const exportView = useRpc(exportViewRpc);
  const parsed = useMemo(() => parseChartData(rows, columns, spec, theme), [rows, columns, spec, theme]);
  const [kindOverride, setKindOverride] = useState<ChartKind | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(compact ? 320 : 560);
  const [exporting, setExporting] = useState<boolean>(false);

  useEffect(() => {
    setKindOverride(null);
    setSelectedIndex(null);
    setHoveredIndex(null);
    setHiddenSeries(new Set());
  }, [spec]);

  const kind: ChartKind = kindOverride ?? spec.chart ?? "bar";
  const activeIndex = hoveredIndex ?? selectedIndex;

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

  const buildSvgPayload = () =>
    exportChartToSvg({
      kind,
      title: title ?? spec.title,
      summary: spec.summary,
      data: parsed,
      curve: spec.curve ?? "linear",
      stacked: spec.stacked,
      hiddenSeries,
      colors: theme.colors,
      width: Math.max(640, containerWidth),
      height: Math.max(300, chartHeight + 40),
    });

  const handleCopySvg = async () => {
    try {
      const { svg } = buildSvgPayload();
      await copyText(svg);
      toast.show("Copied chart SVG", { variant: "success" });
    } catch {
      toast.error("Failed to copy SVG");
    }
  };

  const handleSaveExport = async (format: "svg" | "png") => {
    if (exporting) return;
    setExporting(true);
    try {
      const { svg, width, height } = buildSvgPayload();
      const pngBase64 =
        format === "png" ? await rasterizeSvgToPngBase64(svg, width, height, 2) : null;
      const res = await exportView({
        format,
        title: title ?? spec.title ?? `${kind}-chart`,
        viewId,
        svg,
        pngBase64: pngBase64 ?? undefined,
        width,
        height,
      });
      if (res.ok && res.filePath) {
        await copyText(res.filePath).catch(() => {});
        toast.show(`Saved ${res.filePath}`, { variant: "success" });
      } else {
        toast.error(res.error ?? `Failed to export ${format.toUpperCase()}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const styles = useMemo(
    () => ({
      root: { padding: compact ? 10 : 14, gap: 10 },
      topBar: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        flexWrap: "wrap" as const,
        gap: 8,
      },
      chipGroup: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 4,
      },
      typePill: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      typePillActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      typePillText: { fontSize: 11, fontWeight: "600" as const, color: theme.colors.foregroundMuted },
      typePillTextActive: { color: theme.colors.accentForeground },
      exportBtn: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
      },
      exportText: { fontSize: 11, fontWeight: "600" as const, color: theme.colors.foreground },
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

  const pieSlices = parsed.pieSlices.filter((s) => s.value > 0);
  const pieTotal = Math.max(1e-9, pieSlices.reduce((acc, s) => acc + s.value, 0));

  // Native RN fallback rendering when Platform.OS !== "web"
  const renderNativeFallback = () => {
    if (kind === "pie" || kind === "donut") {
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
            {pieSlices.map((slice, idx) => (
              <Pressable
                key={`npie-${idx}`}
                onPress={() => setSelectedIndex(selectedIndex === slice.rowIndex ? null : slice.rowIndex)}
                style={{
                  flex: slice.value / pieTotal,
                  backgroundColor: slice.color,
                  opacity: selectedIndex !== null && selectedIndex !== slice.rowIndex ? 0.45 : 1,
                }}
              />
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

  const activeScatterPts =
    kind === "scatter" && activeIndex !== null
      ? parsed.scatterPoints.filter((p) => p.rowIndex === activeIndex)
      : [];

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View style={styles.topBar}>
        <View style={styles.chipGroup}>
          {CHART_KINDS.map((item) => {
            const active = kind === item.kind;
            return (
              <Pressable
                key={item.kind}
                accessibilityRole="button"
                onPress={() => {
                  setKindOverride(item.kind);
                  setSelectedIndex(null);
                  setHoveredIndex(null);
                }}
                style={[styles.typePill, active ? styles.typePillActive : null]}
              >
                <Text style={[styles.typePillText, active ? styles.typePillTextActive : null]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.chipGroup}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleCopySvg()}
            style={styles.exportBtn}
          >
            <Text style={styles.exportText}>Copy SVG</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={exporting}
            onPress={() => void handleSaveExport("svg")}
            style={[styles.exportBtn, exporting ? { opacity: 0.5 } : null]}
          >
            <Text style={styles.exportText}>Save SVG</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={exporting}
            onPress={() => void handleSaveExport("png")}
            style={[styles.exportBtn, exporting ? { opacity: 0.5 } : null]}
          >
            <Text style={styles.exportText}>Save PNG</Text>
          </Pressable>
        </View>
      </View>

      {kind === "pie" || kind === "donut" ? (
        <View style={styles.legend}>
          {pieSlices.map((slice, idx) => {
            const isActive = activeIndex === slice.rowIndex;
            const pct = ((slice.value / pieTotal) * 100).toFixed(1);
            return (
              <Pressable
                key={`ps-${idx}`}
                accessibilityRole="button"
                onPress={() =>
                  setSelectedIndex(selectedIndex === slice.rowIndex ? null : slice.rowIndex)
                }
                style={[
                  styles.legendItem,
                  isActive ? { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 } : null,
                ]}
              >
                <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
                <Text style={styles.legendText}>
                  {slice.label}: {formatCompactNumber(slice.value)} ({pct}%)
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : parsed.series.length > 1 ? (
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
          hoveredIndex={hoveredIndex}
          onSelectIndex={setSelectedIndex}
          onHoverIndex={setHoveredIndex}
          theme={theme}
          width={Math.max(260, containerWidth - (compact ? 20 : 28))}
          height={chartHeight}
        />
      ) : (
        renderNativeFallback()
      )}

      {kind === "scatter" && activeScatterPts.length > 0 ? (
        <View style={styles.readout}>
          <Text style={styles.readoutLabel}>{activeScatterPts[0]!.seriesLabel}:</Text>
          {activeScatterPts.map((pt, i) => (
            <Text key={`sr-${i}`} style={styles.readoutVal}>
              {pt.xLabel} → x={formatCompactNumber(pt.x)}, y={formatCompactNumber(pt.y)}
            </Text>
          ))}
        </View>
      ) : activeIndex !== null && activeIndex < parsed.xLabels.length ? (
        <View style={styles.readout}>
          <Text style={styles.readoutLabel}>{parsed.xLabels[activeIndex]}:</Text>
          {visibleSeries.map((s) => (
            <Text key={s.key} style={styles.readoutVal}>
              {s.label} ={" "}
              {s.values[activeIndex] === null
                ? "—"
                : formatCompactNumber(s.values[activeIndex]!)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
