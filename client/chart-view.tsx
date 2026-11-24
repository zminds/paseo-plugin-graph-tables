/**
 * Interactive chart renderer with 6 chart modes, hover crosshairs/readouts,
 * and Beluga-style SVG/PNG export controls (https://github.com/beluga-labs/beluga).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import type { DataRow } from "../shared/query-engine";
import { exportViewRpc } from "../shared/rpc";
import { exportChartToSvg } from "../shared/svg-export";
import type { ChartKind, ColumnSpec, ViewSpec } from "../shared/view-schema";
import { ActionPopoverMenu, IconPillButton } from "./action-menu";
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
  onExpand?(): void;
  onToggleTable?(): void;
  showTableToggle?: boolean;
  specJson?: string;
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
  onExpand,
  onToggleTable,
  showTableToggle = false,
  specJson,
}: ChartViewProps) {
  const toast = useToast();
  const exportView = useRpc(exportViewRpc);
  const parsed = useMemo(() => parseChartData(rows, columns, spec, theme), [rows, columns, spec, theme]);
  const [kindOverride, setKindOverride] = useState<ChartKind | null>(null);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(compact ? 320 : 560);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);

  useEffect(() => {
    setKindOverride(null);
    setSelectedIndex(null);
    setHoveredIndex(null);
    setMenuOpen(false);
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
      toast.show("已拷贝图表 SVG", { variant: "success" });
    } catch {
      toast.error("拷贝 SVG 失败");
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
        toast.show(`已保存 ${res.filePath}`, { variant: "success" });
      } else {
        toast.error(res.error ?? `导出 ${format.toUpperCase()} 失败`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const styles = useMemo(
    () => ({
      root: { padding: compact ? 10 : 12, gap: 9 },
      topBar: {
        position: "relative" as const,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        flexWrap: "wrap" as const,
        gap: 6,
      },
      segmented: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        gap: 2,
        padding: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      typePill: {
        paddingHorizontal: 7,
        paddingVertical: 2.5,
        borderRadius: 6,
      },
      typePillActive: {
        backgroundColor: theme.colors.accent,
      },
      typePillText: { fontSize: 11, fontWeight: "500" as const, color: theme.colors.foregroundMuted },
      typePillTextActive: { fontWeight: "600" as const, color: theme.colors.accentForeground },
      legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
      legendItem: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
        paddingHorizontal: 7,
        paddingVertical: 2.5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      legendDot: { width: 7, height: 7, borderRadius: 3.5 },
      legendText: { fontSize: 11, color: theme.colors.foreground },
      readout: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 5,
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
      <View style={[styles.topBar, { zIndex: menuOpen ? 60 : 2 }]}>
        <View style={styles.segmented}>
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

        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          {showTableToggle && onToggleTable ? (
            <IconPillButton
              icon="Table"
              tooltip="切换为表格"
              theme={theme}
              onPress={onToggleTable}
            />
          ) : null}
          <IconPillButton
            icon="Copy"
            tooltip="拷贝 SVG"
            theme={theme}
            onPress={() => void handleCopySvg()}
          />
          {onExpand ? (
            <IconPillButton
              icon="Maximize2"
              tooltip="在完整窗口中打开"
              theme={theme}
              onPress={onExpand}
            />
          ) : null}
          <View style={{ position: "relative" }}>
            <IconPillButton
              icon="MoreHorizontal"
              active={menuOpen}
              tooltip="导出图表"
              tooltipAlign="right"
              theme={theme}
              onPress={() => setMenuOpen((o) => !o)}
            />
            <ActionPopoverMenu
              open={menuOpen}
              compact={compact}
              theme={theme}
              minWidth={164}
              onClose={() => setMenuOpen(false)}
              entries={[
                {
                  id: "copy-svg",
                  icon: "Copy",
                  label: "拷贝为 SVG",
                  onPress: () => void handleCopySvg(),
                },
                ...(specJson
                  ? [
                      {
                        id: "copy-json",
                        icon: "Code",
                        label: "拷贝视图定义",
                        onPress: () =>
                          void copyText(specJson)
                            .then(() => toast.show("已拷贝视图定义", { variant: "success" }))
                            .catch(() => toast.error("拷贝失败")),
                      },
                    ]
                  : []),
                { kind: "divider", id: "div-c" },
                {
                  id: "save-svg",
                  icon: "Download",
                  label: "保存为 SVG...",
                  onPress: () => void handleSaveExport("svg"),
                },
                {
                  id: "save-png",
                  icon: "Image",
                  label: "保存为 PNG...",
                  onPress: () => void handleSaveExport("png"),
                },
              ]}
            />
          </View>
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
          width={Math.max(260, containerWidth - (compact ? 20 : 24))}
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
