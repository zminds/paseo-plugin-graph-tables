/**
 * Interactive SVG / native graph renderer with Beluga-style pill controls, step
 * playback, node/group dragging, zoom/fit, and SVG/PNG export.
 * Adapted from Beluga (https://github.com/beluga-labs/beluga).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import {
  applyGraphOffsets,
  type GraphLayoutInput,
  layoutGraph,
  type NodeOffsetMap,
  type PositionedNode,
} from "../shared/graph-layout";
import { computeFittedTransform, type GraphViewTransform, zoomAroundPoint } from "../shared/graph-viewport";
import { exportViewRpc } from "../shared/rpc";
import { exportGraphToSvg } from "../shared/svg-export";
import type { GraphSpec } from "../shared/view-schema";
import { ActionPopoverMenu, IconPillButton } from "./action-menu";
import { NativeGraph } from "./native-graph";
import { isWebPlatform, rasterizeSvgToPngBase64, WebSvgGraph } from "./web";

export interface GraphViewProps {
  spec: GraphLayoutInput;
  theme: PluginTheme;
  compact: boolean;
  expanded?: boolean;
  title?: string;
  viewId?: string;
  onExpand?(): void;
  specJson?: string;
}

export function GraphView({
  spec,
  theme,
  compact,
  expanded = false,
  title,
  viewId,
  onExpand,
  specJson,
}: GraphViewProps) {
  const toast = useToast();
  const exportView = useRpc(exportViewRpc);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animateFlow, setAnimateFlow] = useState(true);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [directionOverride, setDirectionOverride] = useState<GraphSpec["direction"] | undefined>(
    undefined,
  );
  const [nodeOffsets, setNodeOffsets] = useState<NodeOffsetMap>({});
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [transform, setTransform] = useState<GraphViewTransform>({ x: 24, y: 24, scale: 1 });

  const steps = spec.steps ?? [];
  const hasSteps = steps.length > 0;
  const activeStep =
    stepIndex !== null && stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;
  const activeStepNumber = activeStep !== null && stepIndex !== null ? stepIndex + 1 : null;

  const focusedIds = useMemo(() => {
    if (!activeStep) return null;
    const set = new Set<string>();
    for (const id of activeStep.focus ?? []) set.add(id);
    return set;
  }, [activeStep]);

  const narrowCanvas = compact || (viewportSize.width > 0 && viewportSize.width < 480);
  const direction = directionOverride ?? spec.direction ?? (narrowCanvas ? "down" : "right");
  const effectiveSpec = useMemo<GraphLayoutInput>(() => ({ ...spec, direction }), [spec, direction]);

  const baseLayout = useMemo(() => layoutGraph(effectiveSpec), [effectiveSpec]);
  const layout = useMemo(() => applyGraphOffsets(baseLayout, nodeOffsets), [baseLayout, nodeOffsets]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const targetCanvasHeight = narrowCanvas
    ? (expanded ? 420 : 300)
    : expanded
      ? Math.min(720, Math.max(baseLayout.height + 40, 540))
      : Math.max(380, Math.min(480, baseLayout.height + 52));

  const handleFitView = useCallback(
    (focus: ReadonlySet<string> | null = null, targetLayout = layoutRef.current) => {
      const width = viewportSize.width || (compact ? 340 : expanded ? 860 : 680);
      const height = viewportSize.height || targetCanvasHeight;
      setTransform(computeFittedTransform(targetLayout, width, height, focus));
    },
    [viewportSize.width, viewportSize.height, expanded, compact, targetCanvasHeight],
  );

  // Reset per-graph interactive state when the incoming graph spec changes
  const prevSpecRef = useRef(spec);
  useEffect(() => {
    if (prevSpecRef.current !== spec) {
      prevSpecRef.current = spec;
      setNodeOffsets({});
      setSelectedNodeId(null);
      setHoveredNodeId(null);
      setStepIndex(null);
      setIsPlaying(false);
      setExportMenuOpen(false);
    }
  }, [spec]);

  useEffect(() => {
    if (viewportSize.width > 0) handleFitView(focusedIds);
  }, [baseLayout, viewportSize.width, focusedIds, handleFitView]);

  // Auto-advance walkthrough when playing
  useEffect(() => {
    if (!isPlaying || steps.length === 0) return;
    const timer = setInterval(() => {
      setStepIndex((prev) => {
        if (prev === null) return 0;
        return (prev + 1) % steps.length;
      });
    }, 3500);
    return () => clearInterval(timer);
  }, [isPlaying, steps.length]);

  const handleShiftNodes = useCallback((nodeIds: readonly string[], dx: number, dy: number) => {
    if (nodeIds.length === 0) return;
    setNodeOffsets((prev) => {
      const next: Record<string, { dx: number; dy: number }> = { ...prev };
      for (const id of nodeIds) {
        const cur = next[id] ?? { dx: 0, dy: 0 };
        next[id] = { dx: cur.dx + dx, dy: cur.dy + dy };
      }
      return next;
    });
  }, []);

  const selectedBox = useMemo<PositionedNode | null>(() => {
    if (!selectedNodeId) return null;
    return layout.nodes.find((b) => b.node.id === selectedNodeId) ?? null;
  }, [layout.nodes, selectedNodeId]);

  const hasCustomOffsets = Object.keys(nodeOffsets).length > 0;
  const effectiveDirection = effectiveSpec.direction ?? "right";
  const isVerticalFlow = effectiveDirection === "down" || effectiveDirection === "up";

  const zoomBy = (factor: number) => {
    const width = viewportSize.width || 600;
    const height = viewportSize.height || targetCanvasHeight;
    setTransform((current) => zoomAroundPoint(current, factor, width / 2, height / 2));
  };

  const toggleDirection = () => {
    setNodeOffsets({});
    setDirectionOverride(isVerticalFlow ? "right" : "down");
  };

  const buildExportSvg = () =>
    exportGraphToSvg({
      layout,
      title: title ?? spec.title,
      summary: spec.summary,
      focusedIds,
      activeStepNumber,
      colors: theme.colors,
    });

  const handleCopyJson = async () => {
    try {
      await copyText(specJson ?? JSON.stringify(spec, null, 2));
      toast.show("已拷贝流程图 JSON", { variant: "success" });
    } catch {
      toast.error("拷贝 JSON 失败");
    }
  };

  const handleCopySvg = async () => {
    try {
      const { svg } = buildExportSvg();
      await copyText(svg);
      toast.show("已拷贝流程图 SVG", { variant: "success" });
    } catch {
      toast.error("拷贝 SVG 失败");
    }
  };

  const handleSaveExport = async (format: "svg" | "png") => {
    if (exporting) return;
    setExporting(true);
    try {
      const { svg, width, height } = buildExportSvg();
      const pngBase64 =
        format === "png" ? await rasterizeSvgToPngBase64(svg, width, height, 2) : null;
      const res = await exportView({
        format,
        title: title ?? spec.title ?? "diagram",
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

  const handleViewportLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const width = Math.round(nativeEvent.layout.width);
    const height = Math.round(nativeEvent.layout.height);
    if (width <= 0 || height <= 0) return;
    setViewportSize((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  }, []);

  const togglePlayback = () => {
    setExportMenuOpen(false);
    if (!isPlaying && stepIndex === null) setStepIndex(0);
    setIsPlaying(!isPlaying);
  };

  return (
    <View style={{ gap: 8 }}>
      {isWebPlatform ? (
        <View
          onLayout={handleViewportLayout}
          style={{
            position: "relative",
            width: "100%",
            height: targetCanvasHeight,
            backgroundColor: theme.colors.surface0,
            borderBottomWidth: hasSteps || selectedBox ? 1 : 0,
            borderBottomColor: theme.colors.border,
            borderBottomLeftRadius: hasSteps || selectedBox ? 0 : 9,
            borderBottomRightRadius: hasSteps || selectedBox ? 0 : 9,
            overflow: exportMenuOpen ? "visible" : "hidden",
            zIndex: exportMenuOpen ? 35 : 1,
          }}
        >
          <WebSvgGraph
            layout={layout}
            theme={theme}
            viewportHeight={viewportSize.height || targetCanvasHeight}
            transform={transform}
            selectedNodeId={selectedNodeId}
            hoveredNodeId={hoveredNodeId}
            focusedIds={focusedIds}
            activeStepNumber={activeStepNumber}
            animateFlow={animateFlow}
            enableTouchGestures={expanded}
            onTransformChange={setTransform}
            onShiftNodes={handleShiftNodes}
            onHoverNode={setHoveredNodeId}
            onSelectNode={(id) => {
              setExportMenuOpen(false);
              setSelectedNodeId(id);
            }}
          />

          {/* Top-Right Beluga Floating Pill Bar */}
          <View
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 50,
              flexDirection: "row",
              alignItems: "center",
              gap: 2,
              paddingHorizontal: 5,
              paddingVertical: 3,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              shadowColor: "#000",
              shadowOpacity: 0.08,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            {hasSteps ? (
              <IconPillButton
                icon={isPlaying ? "Pause" : "Play"}
                active={isPlaying}
                tooltip={isPlaying ? "暂停导览" : "带我看一遍"}
                theme={theme}
                onPress={togglePlayback}
              />
            ) : null}

            <IconPillButton
              icon={isVerticalFlow ? "ChevronRight" : "ChevronDown"}
              tooltip={isVerticalFlow ? "从左到右布局" : "从上到下布局"}
              theme={theme}
              onPress={() => {
                setExportMenuOpen(false);
                toggleDirection();
              }}
            />

            <IconPillButton
              icon="Scan"
              tooltip="适合视图"
              theme={theme}
              onPress={() => {
                setExportMenuOpen(false);
                handleFitView(focusedIds);
              }}
            />

            <IconPillButton
              icon="RotateCw"
              active={hasCustomOffsets}
              tooltip="重置节点与视图"
              theme={theme}
              onPress={() => {
                setExportMenuOpen(false);
                setNodeOffsets({});
                handleFitView(focusedIds, baseLayout);
              }}
            />

            <IconPillButton
              icon="Activity"
              active={animateFlow}
              tooltip={animateFlow ? "关闭流动动效" : "开启流动动效"}
              theme={theme}
              onPress={() => {
                setExportMenuOpen(false);
                setAnimateFlow((v) => !v);
              }}
            />

            <View style={{ position: "relative" }}>
              <IconPillButton
                icon="Copy"
                active={exportMenuOpen}
                tooltip="拷贝 / 导出"
                tooltipAlign="right"
                theme={theme}
                onPress={() => setExportMenuOpen((o) => !o)}
              />
              <ActionPopoverMenu
                open={exportMenuOpen}
                compact={compact}
                theme={theme}
                minWidth={164}
                onClose={() => setExportMenuOpen(false)}
                entries={[
                  {
                    id: "copy-json",
                    icon: "Code",
                    label: "拷贝为 JSON",
                    onPress: () => void handleCopyJson(),
                  },
                  {
                    id: "copy-svg",
                    icon: "Copy",
                    label: "拷贝为 SVG",
                    onPress: () => void handleCopySvg(),
                  },
                  { kind: "divider", id: "div-exp" },
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

            {!expanded && onExpand ? (
              <IconPillButton
                icon="Maximize2"
                tooltip="在完整窗口中打开"
                tooltipAlign="right"
                theme={theme}
                onPress={() => {
                  setExportMenuOpen(false);
                  onExpand();
                }}
              />
            ) : null}
          </View>

          {/* Bottom-Left Compact Zoom Pill */}
          <View
            style={{
              position: "absolute",
              bottom: 10,
              left: 10,
              zIndex: 30,
              flexDirection: "row",
              alignItems: "center",
              gap: 1,
              paddingHorizontal: 4,
              paddingVertical: 2,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              shadowColor: "#000",
              shadowOpacity: 0.06,
              shadowRadius: 6,
              elevation: 3,
            }}
          >
            <IconPillButton
              icon="Minus"
              size={22}
              iconSize={11}
              tooltip="缩小"
              tooltipAlign="left"
              theme={theme}
              onPress={() => zoomBy(0.86)}
            />
            <Text
              style={{
                fontSize: 10.5,
                fontWeight: "500",
                color: theme.colors.foregroundMuted,
                minWidth: 32,
                textAlign: "center",
              }}
            >
              {Math.round(transform.scale * 100)}%
            </Text>
            <IconPillButton
              icon="Plus"
              size={22}
              iconSize={11}
              tooltip="放大"
              theme={theme}
              onPress={() => zoomBy(1.16)}
            />
          </View>

          {/* Subtle Bottom-Right Interaction Hint */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              bottom: 8,
              right: 12,
              paddingHorizontal: 5,
              paddingVertical: 1,
              opacity: 0.65,
            }}
          >
            <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
              {narrowCanvas ? (expanded ? "双指缩放 · 拖动平移" : "点按节点查看详情") : "拖动平移 · 滚轮缩放"}
            </Text>
          </View>
        </View>
      ) : (
        <View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", paddingHorizontal: 6 }}>
            {hasSteps ? (
              <IconPillButton
                icon={isPlaying ? "Pause" : "Play"}
                tooltip={isPlaying ? "暂停导览" : "带我看一遍"}
                active={isPlaying}
                size={44}
                iconSize={16}
                theme={theme}
                onPress={togglePlayback}
              />
            ) : null}
            <IconPillButton
              icon="Code"
              label="JSON"
              tooltip="拷贝为 JSON"
              size={44}
              theme={theme}
              onPress={() => void handleCopyJson()}
            />
            <IconPillButton
              icon="Copy"
              label="SVG"
              tooltip="拷贝为 SVG"
              size={44}
              theme={theme}
              onPress={() => void handleCopySvg()}
            />
            <IconPillButton
              icon="Download"
              label="PNG"
              tooltip="保存为 PNG"
              size={44}
              disabled={exporting}
              theme={theme}
              onPress={() => void handleSaveExport("png")}
            />
            {!expanded && onExpand ? (
              <IconPillButton
                icon="Maximize2"
                tooltip="在完整窗口中打开"
                size={44}
                iconSize={16}
                theme={theme}
                onPress={onExpand}
              />
            ) : null}
          </View>
          <NativeGraph
            layout={layout}
            theme={theme}
            height={targetCanvasHeight}
            expanded={expanded}
            transform={transform}
            selectedNodeId={selectedNodeId}
            focusedIds={focusedIds}
            onLayout={handleViewportLayout}
            onTransformChange={setTransform}
            onSelectNode={setSelectedNodeId}
          />
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              paddingHorizontal: 6,
              borderTopWidth: 1,
              borderTopColor: theme.colors.border,
            }}
          >
            <IconPillButton icon="Minus" tooltip="缩小" size={44} iconSize={16} theme={theme} onPress={() => zoomBy(0.8)} />
            <Text style={{ color: theme.colors.foregroundMuted, minWidth: 38, textAlign: "center" }}>
              {Math.round(transform.scale * 100)}%
            </Text>
            <IconPillButton icon="Plus" tooltip="放大" size={44} iconSize={16} theme={theme} onPress={() => zoomBy(1.25)} />
            <IconPillButton
              icon="Scan"
              label="适配"
              tooltip="适合视图"
              size={44}
              iconSize={16}
              theme={theme}
              onPress={() => handleFitView(focusedIds)}
            />
            <IconPillButton
              icon={isVerticalFlow ? "ChevronRight" : "ChevronDown"}
              label={isVerticalFlow ? "横排" : "竖排"}
              tooltip={isVerticalFlow ? "从左到右布局" : "从上到下布局"}
              size={44}
              iconSize={16}
              theme={theme}
              onPress={toggleDirection}
            />
          </View>
        </View>
      )}

      {/* Compact Step Walkthrough Bar */}
      {hasSteps ? (
        <View style={{ paddingHorizontal: compact ? 10 : 12, paddingBottom: 8, gap: 6 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setIsPlaying(false);
                  setStepIndex(null);
                  handleFitView(null);
                }}
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 3.5,
                  borderRadius: 99,
                  borderWidth: 1,
                  borderColor: stepIndex === null ? theme.colors.accent : theme.colors.border,
                  backgroundColor: stepIndex === null ? theme.colors.accent : theme.colors.surface1,
                }}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "600",
                    color:
                      stepIndex === null ? theme.colors.accentForeground : theme.colors.foregroundMuted,
                  }}
                >
                  All
                </Text>
              </Pressable>
              {steps.map((s, idx) => {
                const isActive = stepIndex === idx;
                return (
                  <Pressable
                    key={`step-tab-${idx}`}
                    accessibilityRole="button"
                    onPress={() => {
                      setIsPlaying(false);
                      setStepIndex(isActive ? null : idx);
                    }}
                    style={{
                      paddingHorizontal: 9,
                      paddingVertical: 3.5,
                      borderRadius: 99,
                      borderWidth: 1,
                      borderColor: isActive ? theme.colors.accent : theme.colors.border,
                      backgroundColor: isActive ? theme.colors.accent : theme.colors.surface1,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color: isActive ? theme.colors.accentForeground : theme.colors.foreground,
                      }}
                    >
                      {s.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {activeStep ? (
            <View
              style={{
                width: "100%",
                paddingHorizontal: 11,
                paddingVertical: 8,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.accent,
                backgroundColor: theme.colors.surface1,
                gap: 5,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontWeight: "700",
                    color: theme.colors.accent,
                  }}
                >
                  Step {(stepIndex ?? 0) + 1}/{steps.length}: {activeStep.title}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setIsPlaying(false);
                      setStepIndex((cur) => {
                        if (cur === null) return 0;
                        return (cur - 1 + steps.length) % steps.length;
                      });
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 2,
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <Icon name="ChevronLeft" size={11} color={theme.colors.foreground} />
                    <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>
                      Prev
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setIsPlaying(false);
                      setStepIndex((cur) => {
                        if (cur === null) return 0;
                        return (cur + 1) % steps.length;
                      });
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 2,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                      backgroundColor: theme.colors.accent,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        color: theme.colors.accentForeground,
                      }}
                    >
                      Next
                    </Text>
                    <Icon name="ChevronRight" size={11} color={theme.colors.accentForeground} />
                  </Pressable>
                </View>
              </View>

              <Text style={{ fontSize: 11.5, color: theme.colors.foregroundMuted, lineHeight: 17 }}>
                {activeStep.text}
              </Text>

              {(activeStep.focus?.length ?? 0) > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                  <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>Focus:</Text>
                  {activeStep.focus!.map((id) => {
                    const target = layout.nodes.find((n) => n.node.id === id);
                    const isNodeSel = selectedNodeId === id;
                    return (
                      <Pressable
                        key={`focus-${id}`}
                        onPress={() => setSelectedNodeId(isNodeSel ? null : id)}
                        style={{
                          paddingHorizontal: 7,
                          paddingVertical: 1.5,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: theme.colors.accent,
                          backgroundColor: isNodeSel ? theme.colors.accent : theme.colors.surface0,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: "600",
                            color: isNodeSel ? theme.colors.accentForeground : theme.colors.accent,
                          }}
                        >
                          {target?.node.label ?? id}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Selected Node Details Inspector */}
      {selectedBox ? (
        <View style={{ paddingHorizontal: compact ? 10 : 12, paddingBottom: 10 }}>
          <View
            style={{
              padding: 11,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.accent,
              backgroundColor: theme.colors.surface1,
              gap: 7,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ gap: 2, flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.colors.foreground }}>
                  {selectedBox.node.label}
                </Text>
                <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>
                  {selectedBox.node.type ?? "node"}
                  {selectedBox.node.sublabel ? ` · ${selectedBox.node.sublabel}` : ""}
                  {selectedBox.node.status ? ` · ${selectedBox.node.status}` : ""}
                </Text>
              </View>
              <Pressable accessibilityRole="button" onPress={() => setSelectedNodeId(null)}>
                <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
              </Pressable>
            </View>

            {selectedBox.node.details ? (
              <Markdown>{selectedBox.node.details}</Markdown>
            ) : null}

            {selectedBox.node.fields?.length ? (
              <View style={{ gap: 3 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foregroundMuted }}>
                  Fields
                </Text>
                {selectedBox.node.fields.map((f, i) => (
                  <Text key={`det-f-${i}`} style={{ fontSize: 11.5, color: theme.colors.foreground }}>
                    {f.key ? `[${f.key}] ` : ""}
                    {f.name}
                    {f.type ? `: ${f.type}` : ""}
                  </Text>
                ))}
              </View>
            ) : null}

            {selectedBox.node.items?.length ? (
              <View style={{ gap: 3 }}>
                <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foregroundMuted }}>
                  Items
                </Text>
                {selectedBox.node.items.map((item, i) => (
                  <Text key={`det-i-${i}`} style={{ fontSize: 11.5, color: theme.colors.foreground }}>
                    {item.status ? `[${item.status}] ` : "• "}
                    {item.label}
                  </Text>
                ))}
              </View>
            ) : null}

            {selectedBox.node.links?.length ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {selectedBox.node.links.map((link, i) => (
                  <Pressable
                    key={`det-l-${i}`}
                    onPress={() => {
                      if (/^https?:\/\//.test(link.href)) {
                        void Linking.openURL(link.href);
                      }
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <Icon name="ExternalLink" size={11} color={theme.colors.accent} />
                    <Text style={{ fontSize: 11, color: theme.colors.accent }}>{link.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
