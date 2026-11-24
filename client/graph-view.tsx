/**
 * Interactive SVG / native graph renderer with Beluga-style pill controls, step
 * playback, node/group dragging, zoom/fit, and SVG/PNG export.
 * Adapted from Beluga (https://github.com/beluga-labs/beluga).
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import {
  applyGraphOffsets,
  type GraphLayoutInput,
  type GraphLayoutResult,
  layoutGraph,
  type NodeOffsetMap,
  type PositionedNode,
} from "../shared/graph-layout";
import { exportViewRpc } from "../shared/rpc";
import { exportGraphToSvg } from "../shared/svg-export";
import type { GraphNode, GraphSpec } from "../shared/view-schema";
import { ActionPopoverMenu, IconPillButton } from "./action-menu";
import { type GraphViewTransform, isWebPlatform, rasterizeSvgToPngBase64, WebSvgGraph } from "./web";

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

function statusColor(status: GraphNode["status"], theme: PluginTheme): string {
  switch (status) {
    case "done":
      return theme.colors.statusSuccess;
    case "active":
    case "review":
      return theme.colors.accent;
    case "blocked":
      return theme.colors.statusWarning;
    case "failed":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

function computeFittedTransform(
  layout: GraphLayoutResult,
  viewportWidth: number,
  viewportHeight: number,
  focusIds: ReadonlySet<string> | null,
): GraphViewTransform {
  const vw = Math.max(260, viewportWidth);
  const vh = Math.max(220, viewportHeight);

  const targets: Array<{ x: number; y: number; width: number; height: number }> = [];
  if (focusIds && focusIds.size > 0) {
    for (const pn of layout.nodes) {
      if (focusIds.has(pn.node.id)) targets.push(pn);
    }
    for (const pg of layout.groups) {
      if (pg.memberIds.some((id) => focusIds.has(id))) targets.push(pg);
    }
  } else {
    targets.push(...layout.nodes, ...layout.groups);
  }

  if (targets.length === 0) {
    return { x: 24, y: 24, scale: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of targets) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }

  const contentW = Math.max(120, maxX - minX);
  const contentH = Math.max(100, maxY - minY);
  const padX = vw < 480 ? 28 : 52;
  const padY = vh < 340 ? 28 : 48;

  const rawScale = Math.min((vw - padX * 2) / contentW, (vh - padY * 2) / contentH);
  const maxAllowedScale = focusIds && focusIds.size > 0 ? 1.15 : 1.08;
  const scale = Math.round(Math.max(0.42, Math.min(maxAllowedScale, rawScale)) * 100) / 100;

  const cx = minX + contentW / 2;
  const cy = minY + contentH / 2;

  return {
    x: Math.round((vw / 2 - cx * scale) * 10) / 10,
    y: Math.round((vh / 2 - cy * scale) * 10) / 10,
    scale,
  };
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

  const effectiveSpec = useMemo<GraphLayoutInput>(
    () => (directionOverride ? { ...spec, direction: directionOverride } : spec),
    [spec, directionOverride],
  );

  const baseLayout = useMemo(() => layoutGraph(effectiveSpec), [effectiveSpec]);
  const layout = useMemo(() => applyGraphOffsets(baseLayout, nodeOffsets), [baseLayout, nodeOffsets]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const targetCanvasHeight = expanded
    ? Math.max(480, Math.min(720, Math.max(layout.height + 40, 540)))
    : compact
      ? 350
      : Math.max(380, Math.min(480, layout.height + 52));

  const fittedSignatureRef = useRef<string>("");

  const handleFitView = useCallback(
    (focus: ReadonlySet<string> | null = null) => {
      const vw = viewportSize.width || (expanded ? 860 : compact ? 340 : 680);
      const vh = viewportSize.height || targetCanvasHeight;
      setTransform(computeFittedTransform(layoutRef.current, vw, vh, focus));
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
      fittedSignatureRef.current = "";
    }
  }, [spec]);

  // Fit diagram when layout or initial viewport dimensions settle
  useEffect(() => {
    if (viewportSize.width <= 0) return;
    const sig = `${spec.title ?? ""}|${effectiveSpec.direction ?? "right"}|${baseLayout.nodes.length}|${expanded ? "1" : "0"}|${Math.round(viewportSize.width / 20)}`;
    if (fittedSignatureRef.current === sig) return;
    fittedSignatureRef.current = sig;
    setTransform(
      computeFittedTransform(
        baseLayout,
        viewportSize.width,
        viewportSize.height || targetCanvasHeight,
        focusedIds,
      ),
    );
  }, [
    spec.title,
    effectiveSpec.direction,
    baseLayout,
    viewportSize.width,
    viewportSize.height,
    targetCanvasHeight,
    expanded,
    focusedIds,
  ]);

  // Smoothly focus camera on active step targets when stepping through walkthrough
  const prevStepIdxRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevStepIdxRef.current === stepIndex) return;
    prevStepIdxRef.current = stepIndex;
    if (viewportSize.width <= 0) return;
    setTransform(
      computeFittedTransform(
        layoutRef.current,
        viewportSize.width,
        viewportSize.height || targetCanvasHeight,
        focusedIds,
      ),
    );
  }, [stepIndex, focusedIds, viewportSize.width, viewportSize.height, targetCanvasHeight]);

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
    const vw = viewportSize.width || 600;
    const vh = viewportSize.height || targetCanvasHeight;
    setTransform((cur) => {
      const nextScale = Math.max(0.35, Math.min(2.4, Math.round(cur.scale * factor * 100) / 100));
      if (nextScale === cur.scale) return cur;
      const anchorX = vw / 2;
      const anchorY = vh / 2;
      const gx = (anchorX - cur.x) / cur.scale;
      const gy = (anchorY - cur.y) / cur.scale;
      return {
        scale: nextScale,
        x: anchorX - gx * nextScale,
        y: anchorY - gy * nextScale,
      };
    });
  };

  const toggleDirection = () => {
    setNodeOffsets({});
    setDirectionOverride((cur) => ((cur ?? spec.direction ?? "right") === "right" ? "down" : "right"));
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

  const renderNativeGraph = () => {
    const groupsById = new Map((spec.nodes ?? []).filter((n) => n.type === "group").map((g) => [g.id, g]));
    const nodes = layout.nodes;

    return (
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 4 }}>
          <IconPillButton
            icon="Code"
            label="JSON"
            size={24}
            theme={theme}
            onPress={() => void handleCopyJson()}
          />
          <IconPillButton
            icon="Copy"
            label="SVG"
            size={24}
            theme={theme}
            onPress={() => void handleCopySvg()}
          />
          <IconPillButton
            icon="Download"
            label="PNG"
            size={24}
            disabled={exporting}
            theme={theme}
            onPress={() => void handleSaveExport("png")}
          />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {nodes.map(({ node }) => {
            const isSelected = selectedNodeId === node.id;
            const isFocus = focusedIds ? focusedIds.has(node.id) : false;
            const dimmed = focusedIds !== null && !isFocus;
            const grpLabel = node.group ? groupsById.get(node.group)?.label : undefined;

            return (
              <Pressable
                key={node.id}
                onPress={() => setSelectedNodeId(isSelected ? null : node.id)}
                style={{
                  minWidth: compact ? "100%" : 175,
                  flexGrow: 1,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: isSelected || isFocus ? 2 : 1,
                  borderColor:
                    isSelected || isFocus || node.emphasis ? theme.colors.accent : theme.colors.border,
                  backgroundColor: isSelected || isFocus ? theme.colors.surface2 : theme.colors.surface1,
                  opacity: dimmed ? 0.35 : 1,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "700",
                      color: isFocus ? theme.colors.accent : theme.colors.foregroundMuted,
                    }}
                  >
                    {(node.type ?? "service").toUpperCase()}
                    {grpLabel ? ` · ${grpLabel}` : ""}
                  </Text>
                  {isFocus && activeStepNumber !== null ? (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                        borderRadius: 99,
                        backgroundColor: theme.colors.accent,
                      }}
                    >
                      <Text style={{ fontSize: 9, fontWeight: "700", color: theme.colors.accentForeground }}>
                        STEP {activeStepNumber}
                      </Text>
                    </View>
                  ) : node.status ? (
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: statusColor(node.status, theme),
                      }}
                    />
                  ) : null}
                </View>
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.colors.foreground }}>
                  {node.label}
                </Text>
                {node.sublabel ? (
                  <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>{node.sublabel}</Text>
                ) : null}
                {node.value !== undefined ? (
                  <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.accent }}>
                    {String(node.value)}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {layout.edges.length > 0 ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foregroundMuted }}>
              Connections
            </Text>
            {layout.edges.map((edgeBox) => {
              const e = edgeBox.edge;
              const activeEdge =
                focusedIds !== null && focusedIds.has(e.from) && focusedIds.has(e.to);
              return (
                <Text
                  key={`ne-${edgeBox.index}`}
                  style={{
                    fontSize: 12,
                    color: activeEdge ? theme.colors.accent : theme.colors.foregroundMuted,
                    fontWeight: activeEdge ? "700" : "400",
                    opacity: focusedIds !== null && !activeEdge ? 0.38 : 1,
                  }}
                >
                  {e.from} {e.kind === "async" ? "⇢" : "→"} {e.to}
                  {e.label ? `  (${e.label})` : ""}
                </Text>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 8 }}>
      {isWebPlatform ? (
        <View
          onLayout={(e) => {
            const nextW = Math.round(e.nativeEvent.layout.width);
            const nextH = Math.round(e.nativeEvent.layout.height);
            if (nextW > 0 && (nextW !== viewportSize.width || nextH !== viewportSize.height)) {
              setViewportSize({ width: nextW, height: nextH });
            }
          }}
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
            viewportWidth={viewportSize.width || 640}
            viewportHeight={viewportSize.height || targetCanvasHeight}
            transform={transform}
            selectedNodeId={selectedNodeId}
            hoveredNodeId={hoveredNodeId}
            focusedIds={focusedIds}
            activeStepNumber={activeStepNumber}
            animateFlow={animateFlow}
            enableWheelZoom={expanded}
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
              <>
                <IconPillButton
                  icon={isPlaying ? "Pause" : "Play"}
                  active={isPlaying}
                  tooltip={isPlaying ? "暂停导览" : "带我看一遍"}
                  theme={theme}
                  onPress={() => {
                    setExportMenuOpen(false);
                    if (isPlaying) {
                      setIsPlaying(false);
                    } else {
                      if (stepIndex === null) setStepIndex(0);
                      setIsPlaying(true);
                    }
                  }}
                />
                <IconPillButton
                  icon="ChevronRight"
                  tooltip="下一步"
                  theme={theme}
                  onPress={() => {
                    setExportMenuOpen(false);
                    setIsPlaying(false);
                    setStepIndex((cur) => (cur === null ? 0 : (cur + 1) % steps.length));
                  }}
                />
              </>
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

          {/* Bottom-Left Compact Zoom & Reset Pill */}
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
            {hasCustomOffsets ? (
              <IconPillButton
                icon="RotateCw"
                size={22}
                iconSize={11}
                active
                tooltip="重置节点位置"
                theme={theme}
                onPress={() => {
                  setNodeOffsets({});
                  handleFitView(focusedIds);
                }}
              />
            ) : null}
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
              {expanded ? "Drag nodes · Pan · Wheel zoom" : "Drag nodes · Pan · Ctrl+Wheel zoom"}
            </Text>
          </View>
        </View>
      ) : (
        renderNativeGraph()
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
