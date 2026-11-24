import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Markdown } from "@getpaseo/plugin/client/ui";
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
import type { GraphNode, GraphSpec } from "../shared/view-schema";
import { type GraphViewTransform, isWebPlatform, WebSvgGraph } from "./web";

export interface GraphViewProps {
  spec: GraphLayoutInput;
  theme: PluginTheme;
  compact: boolean;
  expanded?: boolean;
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

export function GraphView({ spec, theme, compact, expanded = false }: GraphViewProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animateFlow, setAnimateFlow] = useState(true);
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
      ? 360
      : Math.max(400, Math.min(500, layout.height + 56));

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
      computeFittedTransform(baseLayout, viewportSize.width, viewportSize.height || targetCanvasHeight, focusedIds),
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

  const renderNativeGraph = () => {
    const groupsById = new Map((spec.nodes ?? []).filter((n) => n.type === "group").map((g) => [g.id, g]));
    const nodes = layout.nodes;

    return (
      <View style={{ gap: 10 }}>
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
    <View style={{ gap: 10 }}>
      {spec.summary ? (
        <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>{spec.summary}</Text>
      ) : null}

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
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface0,
            overflow: "hidden",
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
            onSelectNode={setSelectedNodeId}
          />

          {/* Floating React Flow-style Canvas Control Bar (Top-Right) */}
          <View
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 4,
              paddingHorizontal: 6,
              paddingVertical: 4,
              borderRadius: 9,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
            }}
          >
            {hasSteps ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (isPlaying) {
                      setIsPlaying(false);
                    } else {
                      if (stepIndex === null) setStepIndex(0);
                      setIsPlaying(true);
                    }
                  }}
                  style={{
                    paddingHorizontal: 7,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: isPlaying ? theme.colors.accent : theme.colors.surface1,
                    borderWidth: 1,
                    borderColor: isPlaying ? theme.colors.accent : theme.colors.border,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      color: isPlaying ? theme.colors.accentForeground : theme.colors.foreground,
                    }}
                  >
                    {isPlaying ? "⏸" : "▶"}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setIsPlaying(false);
                    setStepIndex((cur) => (cur === null ? 0 : (cur + 1) % steps.length));
                  }}
                  style={{
                    paddingHorizontal: 5,
                    paddingVertical: 4,
                    borderRadius: 6,
                    backgroundColor: theme.colors.surface1,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <Icon name="ChevronRight" size={12} color={theme.colors.foreground} />
                </Pressable>
                <View style={{ width: 1, height: 14, backgroundColor: theme.colors.border, marginHorizontal: 2 }} />
              </>
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => setAnimateFlow((v) => !v)}
              style={{
                paddingHorizontal: 7,
                paddingVertical: 4,
                borderRadius: 6,
                backgroundColor: animateFlow ? theme.colors.surface2 : theme.colors.surface1,
                borderWidth: 1,
                borderColor: animateFlow ? theme.colors.accent : theme.colors.border,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: "600",
                  color: animateFlow ? theme.colors.accent : theme.colors.foregroundMuted,
                }}
              >
                Flow
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => handleFitView(focusedIds)}
              style={{
                paddingHorizontal: 7,
                paddingVertical: 4,
                borderRadius: 6,
                backgroundColor: theme.colors.surface1,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>
                Fit
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => zoomBy(0.86)}
              style={{
                paddingHorizontal: 7,
                paddingVertical: 4,
                borderRadius: 6,
                backgroundColor: theme.colors.surface1,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foreground }}>−</Text>
            </Pressable>
            <Text
              style={{
                fontSize: 11,
                color: theme.colors.foregroundMuted,
                minWidth: 36,
                textAlign: "center",
              }}
            >
              {Math.round(transform.scale * 100)}%
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => zoomBy(1.16)}
              style={{
                paddingHorizontal: 7,
                paddingVertical: 4,
                borderRadius: 6,
                backgroundColor: theme.colors.surface1,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foreground }}>+</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={toggleDirection}
              style={{
                paddingHorizontal: 7,
                paddingVertical: 4,
                borderRadius: 6,
                backgroundColor: theme.colors.surface1,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.foreground }}>
                {effectiveDirection === "down" || effectiveDirection === "up" ? "↓ TB" : "→ LR"}
              </Text>
            </Pressable>

            {hasCustomOffsets ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setNodeOffsets({});
                  handleFitView(focusedIds);
                }}
                style={{
                  paddingHorizontal: 7,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surface1,
                  borderWidth: 1,
                  borderColor: theme.colors.accent,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: "600", color: theme.colors.accent }}>
                  Reset
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Subtle Bottom-Right Interaction Hint */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              bottom: 8,
              right: 12,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 5,
              backgroundColor: theme.colors.surface0,
              opacity: 0.78,
            }}
          >
            <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
              {expanded ? "Drag nodes · Pan canvas · Wheel zoom" : "Drag nodes · Pan canvas · Ctrl+Wheel zoom"}
            </Text>
          </View>
        </View>
      ) : (
        renderNativeGraph()
      )}

      {/* Walkthrough Step Selector Pills + Spotlight Card */}
      {hasSteps ? (
        <View style={{ gap: 8 }}>
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
                  paddingHorizontal: 10,
                  paddingVertical: 5,
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
                      paddingHorizontal: 10,
                      paddingVertical: 5,
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

          <View
            style={{
              width: "100%",
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: activeStep ? theme.colors.accent : theme.colors.border,
              backgroundColor: theme.colors.surface1,
              gap: 6,
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
                  fontSize: 13,
                  fontWeight: "700",
                  color: activeStep ? theme.colors.accent : theme.colors.foreground,
                }}
              >
                {activeStep
                  ? `Step ${(stepIndex ?? 0) + 1}/${steps.length}: ${activeStep.title}`
                  : `${steps.length}-Step Walkthrough`}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
                    paddingHorizontal: 9,
                    paddingVertical: 4,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface2,
                  }}
                >
                  <Icon name="ChevronLeft" size={12} color={theme.colors.foreground} />
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
                    paddingHorizontal: 10,
                    paddingVertical: 4,
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
                    {activeStep ? "Next" : "Start"}
                  </Text>
                  <Icon name="ChevronRight" size={12} color={theme.colors.accentForeground} />
                </Pressable>
              </View>
            </View>

            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted, lineHeight: 18 }}>
              {activeStep
                ? activeStep.text
                : "Press Play or select a step to spotlight the active flow path and step through the diagram."}
            </Text>

            {activeStep && (activeStep.focus?.length ?? 0) > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>Focus:</Text>
                {activeStep.focus!.map((id) => {
                  const target = layout.nodes.find((n) => n.node.id === id);
                  const isNodeSel = selectedNodeId === id;
                  return (
                    <Pressable
                      key={`focus-${id}`}
                      onPress={() => setSelectedNodeId(isNodeSel ? null : id)}
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 2,
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
        </View>
      ) : null}

      {/* Selected Node Details Inspector */}
      {selectedBox ? (
        <View
          style={{
            padding: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: theme.colors.accent,
            backgroundColor: theme.colors.surface1,
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ gap: 2, flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.foreground }}>
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
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foregroundMuted }}>
                Fields
              </Text>
              {selectedBox.node.fields.map((f, i) => (
                <Text key={`det-f-${i}`} style={{ fontSize: 12, color: theme.colors.foreground }}>
                  {f.key ? `[${f.key}] ` : ""}
                  {f.name}
                  {f.type ? `: ${f.type}` : ""}
                </Text>
              ))}
            </View>
          ) : null}

          {selectedBox.node.items?.length ? (
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: theme.colors.foregroundMuted }}>
                Items
              </Text>
              {selectedBox.node.items.map((item, i) => (
                <Text key={`det-i-${i}`} style={{ fontSize: 12, color: theme.colors.foreground }}>
                  {item.status ? `[${item.status}] ` : "• "}
                  {item.label}
                </Text>
              ))}
            </View>
          ) : null}

          {selectedBox.node.links?.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
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
                    paddingHorizontal: 8,
                    paddingVertical: 4,
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
      ) : null}
    </View>
  );
}
