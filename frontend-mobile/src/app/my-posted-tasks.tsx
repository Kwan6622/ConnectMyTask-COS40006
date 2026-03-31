import React, { useEffect, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MarketplaceShell } from "@/components/MarketplaceShell";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useAuthStore } from "@/store/authStore";
import { useTaskStore } from "@/store/taskStore";
import { colors, radius } from "@/theme/tokens";
import { formatCurrency, formatDate, formatTaskStatusLabel, getBidCount, isRequester } from "@/utils/taskUtils";

export default function MyPostedTasksPage(): React.ReactElement {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { requesterTasks, fetchRequesterTasks, isLoading } = useTaskStore((state) => ({
    requesterTasks: state.requesterTasks,
    fetchRequesterTasks: state.fetchRequesterTasks,
    isLoading: state.isLoading,
  }));

  useEffect(() => {
    if (!isAuthenticated || !isRequester(user)) return;
    void fetchRequesterTasks();
  }, [fetchRequesterTasks, isAuthenticated, user]);

  const metrics = useMemo(() => {
    const assigned = requesterTasks.filter((task) => task.assignedProviderId != null).length;
    const inProgress = requesterTasks.filter((task) =>
      ["IN_PROGRESS", "PENDING_CONFIRMATION"].includes(String(task.status))
    ).length;
    const totalBudget = requesterTasks.reduce((sum, task) => sum + Number(task.budget || 0), 0);

    return {
      posted: requesterTasks.length,
      assigned,
      inProgress,
      totalBudget,
    };
  }, [requesterTasks]);

  if (!isAuthenticated || !isRequester(user)) {
    return (
      <MarketplaceShell activeRoute="posted">
        <Card>
          <View style={styles.promptBox}>
            <Text style={styles.promptTitle}>Requester workspace required</Text>
            <Text style={styles.promptBody}>
              My Posted Tasks follows the requester workflow from web. Sign in with a requester/client account to continue.
            </Text>
            <Button title="Sign In" onPress={() => router.push("/sign-in")} />
          </View>
        </Card>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell activeRoute="posted">
      <View style={styles.dashboardCard}>
        <View style={styles.dashboardHeader}>
          <View style={styles.dashboardCopy}>
            <Text style={styles.workspaceTag}>REQUESTER WORKSPACE</Text>
            <Text style={styles.dashboardTitle}>Task Progress Dashboard</Text>
            <Text style={styles.dashboardBody}>
              Track assigned work, review bids, and monitor provider progress updates transparently.
            </Text>
          </View>
          <View style={styles.dashboardActions}>
            <Button title={isLoading ? "Refreshing..." : "Refresh"} size="sm" variant="outline" onPress={() => void fetchRequesterTasks()} />
            <Button title="Post Task" size="sm" onPress={() => router.push("/post-task")} />
          </View>
        </View>

        <View style={styles.metricRow}>
          <MetricCard label="My Posted Tasks" value={String(metrics.posted)} />
          <MetricCard label="Assigned Tasks" value={String(metrics.assigned)} />
          <MetricCard label="Task Progress" value={String(metrics.inProgress)} />
          <MetricCard label="Budget Pipeline" value={formatCurrency(metrics.totalBudget)} />
        </View>
      </View>

      {requesterTasks.length === 0 ? (
        <Card>
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No posted tasks yet</Text>
            <Text style={styles.emptyBody}>Start by creating your first task in the shared requester workflow.</Text>
            <Button title="Create Task" onPress={() => router.push("/post-task")} />
          </View>
        </Card>
      ) : (
        requesterTasks.map((task) => (
          <Card key={String(task.id)}>
            <View style={styles.taskRow}>
              <View style={styles.taskCopy}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskDescription} numberOfLines={3}>
                  {task.description}
                </Text>
                <View style={styles.taskMetaGrid}>
                  <Text style={styles.taskMeta}>Bids: {getBidCount(task)}</Text>
                  <Text style={styles.taskMeta}>Budget: {formatCurrency(Number(task.budget || 0))}</Text>
                  <Text style={styles.taskMeta}>Assigned: {formatTaskStatusLabel(task.status)}</Text>
                  <Text style={styles.taskMeta}>Created: {formatDate(task.createdAt)}</Text>
                </View>
              </View>

              <View style={styles.taskActionColumn}>
                <Button
                  title="View Task"
                  size="sm"
                  variant="outline"
                  onPress={() =>
                    router.push({ pathname: "/task-detail", params: { taskId: String(task.id) } })
                  }
                />
                <Button
                  title="Track Progress"
                  size="sm"
                  onPress={() =>
                    router.push({ pathname: "/task-progress", params: { taskId: String(task.id) } })
                  }
                />
              </View>
            </View>
          </Card>
        ))
      )}
    </MarketplaceShell>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dashboardCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.dark[100],
    padding: 18,
    gap: 16,
  },
  dashboardHeader: {
    gap: 14,
  },
  dashboardCopy: {
    gap: 4,
  },
  workspaceTag: {
    color: colors.primary[700],
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  dashboardTitle: {
    color: colors.dark[900],
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  dashboardBody: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
  },
  dashboardActions: {
    flexDirection: "row",
    gap: 8,
  },
  metricRow: {
    gap: 10,
  },
  metricCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.dark[50],
    padding: 12,
    gap: 4,
  },
  metricLabel: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  metricValue: {
    color: colors.dark[900],
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
  },
  taskRow: {
    gap: 12,
  },
  taskCopy: {
    gap: 8,
  },
  taskTitle: {
    color: colors.dark[900],
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "800",
  },
  taskDescription: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
  },
  taskMetaGrid: {
    gap: 4,
  },
  taskMeta: {
    color: colors.dark[700],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },
  taskActionColumn: {
    gap: 8,
  },
  emptyBox: {
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    color: colors.dark[900],
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "800",
  },
  emptyBody: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  promptBox: {
    alignItems: "center",
    gap: 8,
  },
  promptTitle: {
    color: colors.dark[900],
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  promptBody: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
