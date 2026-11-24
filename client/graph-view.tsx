import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, Markdown } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import { layoutGraph } from "../shared/graph-layout";
import type { GraphSpec, ViewSpec } from "../shared/view-schema";
import { isWebPlatform, WebSvgGraph } from "./web";

export interface GraphViewProps {
  spec: Partial<ViewSpec>;
  theme: PluginTheme;
  compact: boolean;
  expanded?: boolean;
}

export function GraphView({ spec, theme, compact, expanded = false }: GraphViewProps) {
  const [directionOverride, setDirectionOverride] = useState<"right" | "down" | null>(null);
  const effectiveDirection = directionOverride ?? spec.direction ?? "right";

  const graphSpec: GraphSpec = useMemo(
    () => ({
      title: spec.title,
      summary: spec.summary,
      direction: effectiveDirection,
      nodes: spec.nodes ?? [],
      edges: spec.edges ?? [],
      steps: spec.steps ?? [],
    }),
    [spec, effectiveDirection],
  );

  const layout = useMemo(() => layoutGraph(graphSpec), [graphSpec]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(compact ? 320 : 680);
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");

  const steps = graphSpec.steps ?? [];
  const activeStep = stepIndex !== null ? steps[stepIndex] ?? null : null;
  const focusedIds = useMemo(() => {
    if (!activeStep?.focus || activeStep.focus.length === 0) return null;
    return new Set(activeStep.focus);
  }, [activeStep]);

  const nodeLabelById = useMemo(
    () => new Map(graphSpec.nodes.map((n) => [n.id, n.label])),
    [graphSpec.nodes],
  );

  const selectedNode = useMemo(
    () => (selectedNodeId ? graphSpec.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [graphSpec.nodes, selectedNodeId],
  );

  const fitScale = useMemo(() => {
    const avail = Math.max(220, containerWidth - 20);
    const ratio = avail / Math.max(1, layout.width);
    return Math.min(expanded ? 1.35 : 1.0, Math.max(0.42, ratio));
  }, [containerWidth, layout.width, expanded]);

  const effectiveScale = zoomMode === "fit" ? fitScale : zoomMode;

  const onLayout = (event: LayoutChangeEvent) => {
    const w = Math.floor(event.nativeEvent.layout.width);
    if (w > 120 && Math.abs(w - containerWidth) > 2) setContainerWidth(w);
  };

  const styles = useMemo(
    () => ({
      root: { gap: 10, paddingBottom: 10 },
      toolbar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
        paddingHorizontal: compact ? 10 : 12,
        paddingTop: 8,
      },
      toolGroup: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
      },
      toolBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      toolBtnActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      toolBtnText: { fontSize: 11.5, color: theme.colors.foreground, fontWeight: "600" as const },
      toolBtnTextActive: { color: theme.colors.accentForeground, fontWeight: "700" as const },
      zoomReadout: {
        fontSize: 11,
        color: theme.colors.foregroundMuted,
        minWidth: 38,
        textAlign: "center" as const,
      },
      canvasWrap: {
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: theme.colors.surface0,
      },
      stepSection: {
        marginHorizontal: compact ? 10 : 12,
        gap: 8,
      },
      stepPills: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      stepPill: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      stepPillActive: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      stepPillText: { fontSize: 11.5, color: theme.colors.foreground },
      stepPillTextActive: { color: theme.colors.accentForeground, fontWeight: "700" as const },
      walkthroughCard: {
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        borderLeftWidth: 4,
        backgroundColor: theme.colors.surface2,
        gap: 8,
      },
      stepHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      stepTitle: { fontSize: 13, fontWeight: "700" as const, color: theme.colors.foreground, flex: 1 },
      stepText: { fontSize: 12.5, lineHeight: 18, color: theme.colors.foreground },
      focusChipsRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      focusChip: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface0,
      },
      focusChipActive: {
        backgroundColor: theme.colors.accent,
      },
      focusChipText: { fontSize: 11, fontWeight: "600" as const, color: theme.colors.accent },
      focusChipTextActive: { color: theme.colors.accentForeground },
      btnRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      btn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 3,
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      btnNext: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accent,
      },
      btnText: { fontSize: 11.5, fontWeight: "600" as const, color: theme.colors.foreground },
      btnNextText: { fontSize: 11.5, fontWeight: "700" as const, color: theme.colors.accentForeground },
      detailsCard: {
        marginHorizontal: compact ? 10 : 12,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface0,
        gap: 8,
      },
      detailsHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
      },
      detailsTitle: { fontSize: 13.5, fontWeight: "700" as const, color: theme.colors.foreground },
      detailsSub: { fontSize: 11.5, color: theme.colors.foregroundMuted },
      linkRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8 },
      linkBtn: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      linkText: { fontSize: 11.5, color: theme.colors.accent },
    }),
    [theme, compact],
  );

  if (graphSpec.nodes.length === 0) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>Empty graph.</Text>
      </View>
    );
  }

  const renderNativeGraph = () => (
    <View style={{ width: layout.width, height: layout.height, position: "relative" }}>
      {layout.groups.map((grp) => (
        <View
          key={`ngrp-${grp.node.id}`}
          style={{
            position: "absolute",
            left: grp.x,
            top: grp.y,
            width: grp.width,
            height: grp.height,
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface2,
            opacity: 0.45,
            padding: 6,
          }}
        >
          <Text style={{ fontSize: 10.5, fontWeight: "600", color: theme.colors.foregroundMuted }}>
            {grp.node.label}
          </Text>
        </View>
      ))}

      {layout.edges.map((edgeBox) => {
        const dx = edgeBox.x2 - edgeBox.x1;
        const dy = edgeBox.y2 - edgeBox.y1;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const angleRad = Math.atan2(dy, dx);
        const midX = (edgeBox.x1 + edgeBox.x2) / 2;
        const midY = (edgeBox.y1 + edgeBox.y2) / 2;
        const bothFocused =
          focusedIds !== null &&
          focusedIds.has(edgeBox.edge.from) &&
          focusedIds.has(edgeBox.edge.to);
        const isHighlighted =
          bothFocused ||
          (selectedNodeId !== null &&
            (edgeBox.edge.from === selectedNodeId || edgeBox.edge.to === selectedNodeId));
        return (
          <View
            key={`nedge-${edgeBox.index}`}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: midX - dist / 2,
              top: midY - 1,
              width: dist,
              height: isHighlighted ? 2.8 : 1.5,
              backgroundColor: isHighlighted
                ? theme.colors.accent
                : theme.colors.foregroundMuted,
              opacity: isHighlighted ? 1 : focusedIds !== null ? 0.16 : 0.5,
              transform: [{ rotate: `${angleRad}rad` }],
            }}
          />
        );
      })}

      {layout.nodes.map((box) => {
        const isSelected = selectedNodeId === box.node.id;
        const isFocusTarget = focusedIds ? focusedIds.has(box.node.id) : false;
        const isDimmed = focusedIds !== null && !isFocusTarget;
        const highlighted = isSelected || isFocusTarget || box.node.emphasis;
        return (
          <Pressable
            key={`nnode-${box.node.id}`}
            onPress={() => setSelectedNodeId(isSelected ? null : box.node.id)}
            style={{
              position: "absolute",
              left: box.x,
              top: box.y,
              width: box.width,
              height: box.height,
              borderRadius: 8,
              borderWidth: isFocusTarget || isSelected ? 2.5 : box.node.emphasis ? 1.8 : 1,
              borderColor: highlighted ? theme.colors.accent : theme.colors.border,
              backgroundColor: isFocusTarget || isSelected ? theme.colors.surface2 : theme.colors.surface1,
              padding: 8,
              opacity: isDimmed ? 0.2 : 1,
              justifyContent: "center",
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 9, color: isFocusTarget ? theme.colors.accent : theme.colors.foregroundMuted }}>
              {(box.node.type ?? "service").toUpperCase()}
              {isFocusTarget && stepIndex !== null ? ` · STEP ${stepIndex + 1}` : ""}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: 12, fontWeight: "700", color: theme.colors.foreground }}
            >
              {box.node.label}
            </Text>
            {box.node.sublabel ? (
              <Text numberOfLines={1} style={{ fontSize: 10.5, color: theme.colors.foregroundMuted }}>
                {box.node.sublabel}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={styles.root} onLayout={onLayout}>
      <View style={styles.toolbar}>
        <View style={styles.toolGroup}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setZoomMode("fit")}
            style={[styles.toolBtn, zoomMode === "fit" ? styles.toolBtnActive : null]}
          >
            <Text style={[styles.toolBtnText, zoomMode === "fit" ? styles.toolBtnTextActive : null]}>
              Fit
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setZoomMode(Math.max(0.35, Number((effectiveScale - 0.15).toFixed(2))))
            }
            style={styles.toolBtn}
          >
            <Text style={styles.toolBtnText}>-</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setZoomMode(1)}
            style={[styles.toolBtn, zoomMode === 1 ? styles.toolBtnActive : null]}
          >
            <Text style={[styles.toolBtnText, zoomMode === 1 ? styles.toolBtnTextActive : null]}>
              {Math.round(effectiveScale * 100)}%
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setZoomMode(Math.min(2, Number((effectiveScale + 0.15).toFixed(2))))
            }
            style={styles.toolBtn}
          >
            <Text style={styles.toolBtnText}>+</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setDirectionOverride(effectiveDirection === "right" ? "down" : "right")
            }
            style={styles.toolBtn}
          >
            <Text style={styles.toolBtnText}>
              {effectiveDirection === "right" ? "→ LR" : "↓ TB"}
            </Text>
          </Pressable>
        </View>

        {steps.length > 0 && stepIndex === null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setStepIndex(0)}
            style={[styles.toolBtn, styles.toolBtnActive]}
          >
            <Text style={styles.toolBtnTextActive}>
              Walkthrough ({steps.length})
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.canvasWrap}>
        {isWebPlatform ? (
          <WebSvgGraph
            layout={layout}
            theme={theme}
            selectedNodeId={selectedNodeId}
            focusedIds={focusedIds}
            activeStepNumber={stepIndex !== null ? stepIndex + 1 : null}
            scale={effectiveScale}
            onSelectNode={setSelectedNodeId}
          />
        ) : (
          renderNativeGraph()
        )}
      </ScrollView>

      {steps.length > 0 ? (
        <View style={styles.stepSection}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.stepPills}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setStepIndex(null)}
                style={[styles.stepPill, stepIndex === null ? styles.stepPillActive : null]}
              >
                <Text
                  style={[
                    styles.stepPillText,
                    stepIndex === null ? styles.stepPillTextActive : null,
                  ]}
                >
                  All
                </Text>
              </Pressable>
              {steps.map((st, idx) => {
                const active = stepIndex === idx;
                return (
                  <Pressable
                    key={`stp-${idx}`}
                    accessibilityRole="button"
                    onPress={() => setStepIndex(active ? null : idx)}
                    style={[styles.stepPill, active ? styles.stepPillActive : null]}
                  >
                    <Text style={[styles.stepPillText, active ? styles.stepPillTextActive : null]}>
                      {st.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          {activeStep && stepIndex !== null ? (
            <View style={styles.walkthroughCard}>
              <View style={styles.stepHeader}>
                <Text style={styles.stepTitle}>
                  Step {stepIndex + 1}/{steps.length}: {activeStep.title}
                </Text>
                <View style={styles.btnRow}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={stepIndex <= 0}
                    onPress={() => setStepIndex(Math.max(0, stepIndex - 1))}
                    style={[styles.btn, stepIndex <= 0 ? { opacity: 0.45 } : null]}
                  >
                    <Icon name="ChevronLeft" size={13} color={theme.colors.foreground} />
                    <Text style={styles.btnText}>Prev</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={stepIndex >= steps.length - 1}
                    onPress={() => setStepIndex(Math.min(steps.length - 1, stepIndex + 1))}
                    style={[
                      styles.btn,
                      stepIndex < steps.length - 1 ? styles.btnNext : { opacity: 0.45 },
                    ]}
                  >
                    <Text
                      style={stepIndex < steps.length - 1 ? styles.btnNextText : styles.btnText}
                    >
                      Next
                    </Text>
                    <Icon
                      name="ChevronRight"
                      size={13}
                      color={
                        stepIndex < steps.length - 1
                          ? theme.colors.accentForeground
                          : theme.colors.foreground
                      }
                    />
                  </Pressable>
                </View>
              </View>
              <Text style={styles.stepText}>{activeStep.text}</Text>
              {activeStep.focus?.length ? (
                <View style={styles.focusChipsRow}>
                  <Text style={{ fontSize: 11, color: theme.colors.foregroundMuted }}>Focus:</Text>
                  {activeStep.focus.map((nodeId) => {
                    const chipSelected = selectedNodeId === nodeId;
                    return (
                      <Pressable
                        key={`fc-${nodeId}`}
                        accessibilityRole="button"
                        onPress={() => setSelectedNodeId(chipSelected ? null : nodeId)}
                        style={[styles.focusChip, chipSelected ? styles.focusChipActive : null]}
                      >
                        <Text
                          style={[
                            styles.focusChipText,
                            chipSelected ? styles.focusChipTextActive : null,
                          ]}
                        >
                          {nodeLabelById.get(nodeId) ?? nodeId}
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

      {selectedNode ? (
        <View style={styles.detailsCard}>
          <View style={styles.detailsHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.detailsTitle}>{selectedNode.label}</Text>
              <Text style={styles.detailsSub}>
                {selectedNode.type ?? "service"}
                {selectedNode.status ? ` · ${selectedNode.status}` : ""}
                {selectedNode.sublabel ? ` · ${selectedNode.sublabel}` : ""}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => setSelectedNodeId(null)}>
              <Icon name="X" size={15} color={theme.colors.foregroundMuted} />
            </Pressable>
          </View>

          {selectedNode.details ? <Markdown>{selectedNode.details}</Markdown> : null}

          {selectedNode.fields?.length ? (
            <View style={{ gap: 3 }}>
              {selectedNode.fields.map((f, idx) => (
                <Text
                  key={`df-${idx}`}
                  style={{ fontSize: 11.5, fontFamily: "monospace", color: theme.colors.foregroundMuted }}
                >
                  {f.key ? `[${f.key}] ` : ""}
                  {f.name}
                  {f.type ? `: ${f.type}` : ""}
                </Text>
              ))}
            </View>
          ) : null}

          {selectedNode.items?.length ? (
            <View style={{ gap: 3 }}>
              {selectedNode.items.map((it, idx) => (
                <Text key={`di-${idx}`} style={{ fontSize: 12, color: theme.colors.foreground }}>
                  {it.status === "done" ? "✓" : it.status === "failed" ? "✕" : "•"} {it.label}
                </Text>
              ))}
            </View>
          ) : null}

          {selectedNode.links?.length ? (
            <View style={styles.linkRow}>
              {selectedNode.links.map((link, idx) => (
                <Pressable
                  key={`dl-${idx}`}
                  accessibilityRole="link"
                  onPress={() => {
                    if (/^https?:\/\//i.test(link.href)) {
                      void openExternalUrl(link.href);
                    }
                  }}
                  style={styles.linkBtn}
                >
                  <Icon name="ExternalLink" size={12} color={theme.colors.accent} />
                  <Text style={styles.linkText}>{link.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
