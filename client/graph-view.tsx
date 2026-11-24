import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { Icon, Markdown } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { layoutGraph } from "../shared/graph-layout";
import type { GraphSpec, ViewSpec } from "../shared/view-schema";
import { isWebPlatform, WebSvgGraph } from "./web";

export interface GraphViewProps {
  spec: Partial<ViewSpec>;
  theme: PluginTheme;
  compact: boolean;
}

export function GraphView({ spec, theme, compact }: GraphViewProps) {
  const graphSpec: GraphSpec = useMemo(
    () => ({
      title: spec.title,
      summary: spec.summary,
      direction: spec.direction ?? "right",
      nodes: spec.nodes ?? [],
      edges: spec.edges ?? [],
      steps: spec.steps ?? [],
    }),
    [spec],
  );

  const layout = useMemo(() => layoutGraph(graphSpec), [graphSpec]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState<number | null>(null);

  const steps = graphSpec.steps ?? [];
  const activeStep = stepIndex !== null ? steps[stepIndex] ?? null : null;
  const focusedIds = useMemo(() => {
    if (!activeStep?.focus || activeStep.focus.length === 0) return null;
    return new Set(activeStep.focus);
  }, [activeStep]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? graphSpec.nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [graphSpec.nodes, selectedNodeId],
  );

  const styles = useMemo(
    () => ({
      root: { gap: 10, paddingBottom: 8 },
      canvasWrap: {
        padding: 8,
        backgroundColor: theme.colors.surface0,
      },
      walkthrough: {
        marginHorizontal: compact ? 10 : 12,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        gap: 6,
      },
      stepHeader: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      stepTitle: { fontSize: 12.5, fontWeight: "700" as const, color: theme.colors.foreground, flex: 1 },
      stepText: { fontSize: 12, color: theme.colors.foregroundMuted },
      btnRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      btn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      },
      btnText: { fontSize: 11.5, color: theme.colors.foreground },
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
        const isHighlighted =
          selectedNodeId !== null &&
          (edgeBox.edge.from === selectedNodeId || edgeBox.edge.to === selectedNodeId);
        return (
          <View
            key={`nedge-${edgeBox.index}`}
            pointerEvents="none"
            style={{
              position: "absolute",
              left: midX - dist / 2,
              top: midY - 1,
              width: dist,
              height: isHighlighted ? 2.5 : 1.5,
              backgroundColor: isHighlighted
                ? theme.colors.accent
                : theme.colors.foregroundMuted,
              opacity: isHighlighted ? 0.9 : 0.45,
              transform: [{ rotate: `${angleRad}rad` }],
            }}
          />
        );
      })}

      {layout.nodes.map((box) => {
        const isSelected = selectedNodeId === box.node.id;
        const isFocused = focusedIds ? focusedIds.has(box.node.id) : true;
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
              borderWidth: isSelected || box.node.emphasis ? 2 : 1,
              borderColor:
                isSelected || box.node.emphasis ? theme.colors.accent : theme.colors.border,
              backgroundColor: theme.colors.surface1,
              padding: 8,
              opacity: isFocused ? 1 : 0.4,
              justifyContent: "center",
            }}
          >
            <Text numberOfLines={1} style={{ fontSize: 9, color: theme.colors.foregroundMuted }}>
              {(box.node.type ?? "service").toUpperCase()}
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
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator style={styles.canvasWrap}>
        {isWebPlatform ? (
          <WebSvgGraph
            layout={layout}
            theme={theme}
            selectedNodeId={selectedNodeId}
            focusedIds={focusedIds}
            onSelectNode={setSelectedNodeId}
          />
        ) : (
          renderNativeGraph()
        )}
      </ScrollView>

      {steps.length > 0 ? (
        <View style={styles.walkthrough}>
          <View style={styles.stepHeader}>
            <Text style={styles.stepTitle}>
              {activeStep
                ? `Step ${(stepIndex ?? 0) + 1}/${steps.length}: ${activeStep.title}`
                : `Walkthrough (${steps.length} steps)`}
            </Text>
            <View style={styles.btnRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setStepIndex((prev) =>
                    prev === null ? 0 : Math.max(0, prev - 1),
                  )
                }
                style={styles.btn}
              >
                <Icon name="ChevronLeft" size={13} color={theme.colors.foreground} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setStepIndex((prev) =>
                    prev === null ? 0 : Math.min(steps.length - 1, prev + 1),
                  )
                }
                style={styles.btn}
              >
                <Icon name="ChevronRight" size={13} color={theme.colors.foreground} />
              </Pressable>
              {stepIndex !== null ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setStepIndex(null)}
                  style={styles.btn}
                >
                  <Text style={styles.btnText}>Reset</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {activeStep ? <Text style={styles.stepText}>{activeStep.text}</Text> : null}
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
