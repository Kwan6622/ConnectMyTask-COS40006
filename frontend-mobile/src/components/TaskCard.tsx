import React from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Task } from "@/types";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useAuthStore } from "@/store/authStore";
import { colors, radius } from "@/theme/tokens";
import {
  extractWardLocation,
  formatDistance,
  formatCategoryLabel,
  formatCurrency,
  formatDate,
  formatTaskStatusLabel,
  getStatusVariant,
  variantColors,
  getBidCount,
  getCategoryIcon,
  getDisplayName,
  getTaskDueDate,
  getTaskDisplayBudget,
  isAdmin,
  isProvider,
} from "@/utils/taskUtils";

interface TaskCardProps {
  task: Task;
  onView?: () => void;
  onBid?: () => void;
  onToggleSave?: () => void;
  isSaved?: boolean;
  /** Suggested list only: outline the card and show why it was suggested. */
  suggestionReasons?: string[];
}

function getTaskCardImageUrl(imageUrl: string): string {
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" ||
      !/^\/[^/]+\/image\/upload\//.test(url.pathname)) return imageUrl;
    url.pathname = url.pathname.replace("/image/upload/", "/image/upload/w_400,f_auto,q_auto/");
    return url.toString();
  } catch {
    return imageUrl;
  }
}

export function TaskCard({
  task,
  onView,
  onBid,
  onToggleSave,
  isSaved = false,
  suggestionReasons,
}: TaskCardProps): React.ReactElement {
  const user = useAuthStore((state) => state.user);
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const dueDate = getTaskDueDate(task);
  const postedBy = getDisplayName(task.createdBy || task.client);
  const budget = getTaskDisplayBudget(task);
  const canSeeSuspiciousRisk = isProvider(user) || isAdmin(user);

  const reasons = suggestionReasons?.filter(Boolean) ?? [];
  const card = (
    <Card style={[styles.card, reasons.length ? styles.cardSuggested : null]} contentStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={styles.iconWrap}>
            <Text style={styles.iconText}>{getCategoryIcon(task.category)}</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.title} numberOfLines={2}>
              {task.title}
            </Text>
            <Text style={styles.metaLine}>
              {formatCategoryLabel(task.category)} ·{" "}
              <Text style={{ color: variantColors(getStatusVariant(task.status)).color, fontWeight: "700" }}>
                {formatTaskStatusLabel(task.status)}
              </Text>
            </Text>
          </View>
        </View>
        <Text style={styles.priceText}>{formatCurrency(budget)}</Text>
      </View>

      {task.imageUrls && task.imageUrls.length > 0 ? (
        <Image source={{ uri: getTaskCardImageUrl(task.imageUrls[0]) }} style={styles.taskImage} resizeMode="cover" />
      ) : (
        <View style={styles.placeholderImage}>
          <Text style={styles.placeholderIcon}>{getCategoryIcon(task.category)}</Text>
          <Text style={styles.placeholderText}>{formatCategoryLabel(task.category)}</Text>
        </View>
      )}

      <Text style={styles.descriptionText} numberOfLines={compact ? 2 : 3}>
        {task.description}
      </Text>

      <View style={styles.factList}>
        <FactRow label="Location" value={extractWardLocation(task.location)} />
        {task.distanceKm != null ? <FactRow label="Distance" value={formatDistance(task.distanceKm)} /> : null}
        {task.isApproximateLocation ? (
          <FactRow label="Address" value="Nearby address (within 100 m)" />
        ) : null}
        <FactRow label="Due date" value={dueDate ? formatDate(dueDate) : "Flexible"} />
        <FactRow label="Bids" value={String(getBidCount(task))} />
        <FactRow label="Posted by" value={postedBy} />
        <FactRow label="Created" value={formatDate(task.createdAt)} />
      </View>

      {task.isSuspicious && canSeeSuspiciousRisk ? (
        <View style={styles.warningBanner}>
          <Text style={styles.warningTitle}>{task.riskLevel === "HIGH" ? "HIGH RISK · Proceed with caution" : "Potential scam risk"}</Text>
          <Text style={styles.warningBody} numberOfLines={2}>
            {task.suspiciousReason || "Budget is unusually low for this type of job"}
          </Text>
        </View>
      ) : null}

      <View style={[styles.actionRow, compact ? styles.actionRowCompact : null]}>
        <Button title="View Task" size="sm" variant="outline" onPress={onView || (() => undefined)} style={styles.actionButton} />
        {onBid ? <Button title="Place Bid" size="sm" onPress={onBid} style={styles.actionButton} /> : null}
        {onToggleSave ? (
          <Pressable onPress={onToggleSave} style={styles.savePill}>
            <Text style={styles.savePillText}>{isSaved ? "Saved" : "Save"}</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );

  if (reasons.length === 0) return card;
  // Suggested: outlined card with a small label sitting on the top-left edge saying why.
  return (
    <View style={styles.suggestedWrap}>
      {card}
      <View style={styles.reasonBadge} pointerEvents="none">
        <Text style={styles.reasonBadgeText} numberOfLines={1}>
          ✨ {reasons.slice(0, 2).join(" · ")}
        </Text>
      </View>
    </View>
  );
}

function FactRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderColor: "#d8e2f4",
  },
  cardSuggested: {
    borderColor: "#818cf8",
    borderWidth: 2,
  },
  suggestedWrap: {
    position: "relative",
    paddingTop: 10,
  },
  reasonBadge: {
    position: "absolute",
    top: 0,
    left: 16,
    maxWidth: "85%",
    zIndex: 2,
    elevation: 3,
    borderRadius: 999,
    backgroundColor: "#4f46e5",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reasonBadgeText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700",
  },
  content: {
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    gap: 10,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.primary[50],
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 20,
    lineHeight: 24,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.dark[900],
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
  },
  metaLine: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  priceText: {
    color: colors.success[700],
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "800",
    maxWidth: 120,
    textAlign: "right",
  },
  taskImage: {
    width: "100%",
    height: 160,
    borderRadius: radius.lg,
    backgroundColor: colors.dark[100],
  },
  placeholderImage: {
    height: 160,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dark[200],
    backgroundColor: colors.dark[50],
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  placeholderIcon: {
    fontSize: 30,
    lineHeight: 34,
  },
  placeholderText: {
    color: colors.dark[600],
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  descriptionText: {
    color: colors.dark[700],
    fontSize: 14,
    lineHeight: 20,
  },
  factList: {
    borderWidth: 1,
    borderColor: colors.dark[100],
    borderRadius: radius.lg,
    backgroundColor: colors.dark[50],
    overflow: "hidden",
  },
  factRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark[100],
  },
  factLabel: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  factValue: {
    flex: 1,
    color: colors.dark[800],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    textAlign: "right",
  },
  warningBanner: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.warning[200],
    backgroundColor: colors.warning[50],
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  warningTitle: {
    color: colors.warning[600],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  warningBody: {
    color: colors.warning[600],
    fontSize: 12,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionRowCompact: {
    flexWrap: "wrap",
  },
  actionButton: {
    flex: 1,
    minWidth: 96,
  },
  savePill: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary[200],
    backgroundColor: colors.primary[50],
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 78,
    alignItems: "center",
  },
  savePillText: {
    color: colors.primary[700],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
});
