import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "@/theme/tokens";
import { UserWarning } from "@/types";
import { formatDateTime } from "@/utils/taskUtils";

type WarningsPanelProps = {
  count: number;
  limit?: number;
  warnings?: UserWarning[];
};

/** Warning count (x / 3) and the reasons, shown on the user's own profile (same as web). */
export function WarningsPanel({ count, limit = 3, warnings = [] }: WarningsPanelProps): React.ReactElement {
  const tone = count === 0 ? styles.good : count >= limit - 1 ? styles.bad : styles.mid;
  const given = warnings.filter((item) => item.change > 0).slice(0, 5);
  return (
    <View style={[styles.box, tone]}>
      <View style={styles.header}>
        <Text style={styles.title}>Account warnings</Text>
        <Text style={styles.count}>{count} / {limit}</Text>
      </View>
      <Text style={styles.body}>
        {count === 0
          ? "No warnings. Keep it that way by assigning a provider before your deadline and following the platform rules."
          : `At ${limit} warnings your account is locked for 3 days. Warnings reset when a lock ends.`}
      </Text>
      {given.map((item) => (
        <View key={item.id} style={styles.item}>
          <Text style={styles.reason}>{item.reason}</Text>
          <Text style={styles.meta}>
            {formatDateTime(item.createdAt)} · {item.createdBy?.name ? `by ${item.createdBy.name}` : "by the system"}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, padding: 14, borderRadius: radius.md, borderWidth: 1, marginTop: 12 },
  good: { borderColor: colors.success[200], backgroundColor: colors.success[50] },
  mid: { borderColor: colors.warning[200], backgroundColor: colors.warning[50] },
  bad: { borderColor: colors.danger[200], backgroundColor: colors.danger[50] },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 14, fontWeight: "800", color: colors.dark[900] },
  count: { fontSize: 14, fontWeight: "800", color: colors.dark[900] },
  body: { fontSize: 13, lineHeight: 19, color: colors.dark[700] },
  item: { gap: 2, padding: 10, borderRadius: radius.sm, backgroundColor: colors.white },
  reason: { fontSize: 13, color: colors.dark[800], lineHeight: 18 },
  meta: { fontSize: 11, color: colors.dark[500] },
});
