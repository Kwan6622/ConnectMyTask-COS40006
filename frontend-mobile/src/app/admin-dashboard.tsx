import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MarketplaceShell } from "@/components/MarketplaceShell";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/authStore";
import { colors, radius } from "@/theme/tokens";
import { formatCurrency, getMoneyStatusVariant, getStatusVariant, isAdmin } from "@/utils/taskUtils";
import { Badge } from "@/components/Badge";

type AdminTab = "overview" | "users" | "tasks" | "certificates" | "payments" | "disputes" | "support";

export default function AdminDashboardScreen(): React.ReactElement {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const [tab, setTab] = useState<AdminTab>("overview");
  const [stats, setStats] = useState<any | null>(null);
  // Users tab filters (same as web): name/email search, role and city.
  const [userSearch, setUserSearch] = useState("");
  const [userRole, setUserRole] = useState("ALL");
  const [userCity, setUserCity] = useState("ALL");
  // Items still needing action per tab (same badges as web): locked users, unreviewed flags, ...
  const attentionFor = (tabId: string): number => {
    const attention = (stats?.attention || {}) as Record<string, number>;
    return Number(attention[tabId] || 0);
  };
  const [tasks, setTasks] = useState<any[]>([]);
  const [suspiciousTasks, setSuspiciousTasks] = useState<any[]>([]);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);
  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [feeSettings, setFeeSettings] = useState<any | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [taskStatusReason, setTaskStatusReason] = useState("");

  const loadAdminData = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const results = await Promise.allSettled([
        api.admin.getStats(),
        api.admin.getUsers(),
        api.admin.getTasks(),
        api.admin.getSuspiciousTasks(),
        api.admin.getCertificates(),
        api.admin.getPayments(),
        api.admin.getDisputes(),
        api.support.list({ limit: 50 }),
        api.admin.getPlatformFeeSettings(),
      ]);
      const data = (index: number): any => {
        const result = results[index];
        return result?.status === "fulfilled" ? result.value.data : undefined;
      };
      if (data(0) !== undefined) setStats(data(0) || null);
      if (data(1) !== undefined) setUsers(Array.isArray(data(1)) ? data(1) : []);
      if (data(2) !== undefined) setTasks(Array.isArray(data(2)) ? data(2) : []);
      if (data(3) !== undefined) setSuspiciousTasks(Array.isArray(data(3)) ? data(3) : []);
      if (data(4) !== undefined) setCertificates(Array.isArray(data(4)) ? data(4) : []);
      if (data(5) !== undefined) setPayments(Array.isArray(data(5)) ? data(5) : []);
      if (data(6) !== undefined) setDisputes(Array.isArray(data(6)) ? data(6) : []);
      if (data(7) !== undefined) setSupportTickets(Array.isArray(data(7)?.items) ? data(7).items : []);
      if (data(8) !== undefined) setFeeSettings(data(8) || null);
      const failedCount = results.filter((result) => result.status === "rejected").length;
      if (failedCount) setLoadError(`${failedCount} admin section${failedCount === 1 ? "" : "s"} could not be loaded. Available sections remain usable.`);
    } catch (error: any) {
      const message = error?.response?.data?.message || "Cannot load admin dashboard data.";
      setLoadError(message);
      Alert.alert("Admin load failed", message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin(user)) return;
    void loadAdminData();
  }, [isAuthenticated, loadAdminData, user]);

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase();
    return users.filter((item) => {
      if (userRole !== "ALL" && String(item.role).toUpperCase() !== userRole) return false;
      if (userCity === "NONE" && item.cityName) return false;
      if (userCity !== "ALL" && userCity !== "NONE" && item.cityName !== userCity) return false;
      if (query && !`${item.name} ${item.email}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [users, userSearch, userRole, userCity]);

  const overviewCards = useMemo(
    () => [
      { label: "Total Users", value: String(stats?.totalUsers ?? 0) },
      { label: "Active Tasks", value: String(stats?.activeTasks ?? 0) },
      { label: "Suspicious Tasks", value: String(stats?.suspiciousTasks ?? 0) },
      { label: "Escrow-held Payments", value: String(stats?.escrowHeldPayments ?? 0) },
      { label: "Pending Certificates", value: String(stats?.pendingCertificates ?? 0) },
      { label: "Disputes", value: String(stats?.disputes ?? 0) },
      { label: "Open Support Tickets", value: String(stats?.openSupportTickets ?? 0) },
      { label: "Escrow Held Amount", value: formatCurrency(Number(stats?.totalEscrowHeldAmount ?? 0)) },
      { label: "Platform Revenue", value: formatCurrency(Number(stats?.totalPlatformRevenue ?? 0)) },
      {
        label: "Current Fee (future deposits)",
        value: feeSettings?.config?.isActive === false
          ? "Inactive"
          : feeSettings?.config?.feeType === "FIXED"
            ? formatCurrency(Number(feeSettings?.config?.fixedAmount || 0))
            : `${Number(feeSettings?.config?.percentageRate || 0) * 100}%`,
      },
    ],
    [feeSettings, stats]
  );

  if (!isAuthenticated || !isAdmin(user)) {
    return (
      <MarketplaceShell activeRoute="admin">
        <Card>
          <View style={styles.promptBox}>
            <Text style={styles.promptTitle}>Admin access required</Text>
            <Text style={styles.promptBody}>This page is restricted to admin accounts only.</Text>
            <Button title="Back to Browse Tasks" onPress={() => router.replace("/browse-tasks")} />
          </View>
        </Card>
      </MarketplaceShell>
    );
  }

  // Removing a task needs a reason (typed inline; Android has no prompt).
  const [removeDraft, setRemoveDraft] = useState<{ taskId: string; reason: string } | null>(null);
  const handleDeleteTask = async (taskId: string | number): Promise<void> => {
    const reason = removeDraft?.taskId === String(taskId) ? removeDraft.reason.trim() : "";
    if (reason.length < 5) {
      Alert.alert("Reason required", "Give a reason of at least 5 characters. It is sent to the requester and bidders.");
      return;
    }
    try {
      const { data } = await api.admin.deleteTask(taskId, reason);
      setRemoveDraft(null);
      Alert.alert("Task removed", `The requester${data?.closedBids ? ` and ${data.closedBids} bidder(s)` : ""} were notified.`);
      await loadAdminData();
    } catch (error: any) {
      Alert.alert("Delete failed", error?.response?.data?.message || "Cannot delete task.");
    }
  };

  const handleReviewTask = async (taskId: string | number): Promise<void> => {
    try {
      await api.admin.reviewTask(taskId);
      Alert.alert("Updated", "Task marked as reviewed.");
      await loadAdminData();
    } catch (error: any) {
      Alert.alert("Review failed", error?.response?.data?.message || "Cannot review task.");
    }
  };

  const handleCertificateAction = async (
    certificateId: string | number,
    action: "verify" | "reject"
  ): Promise<void> => {
    try {
      if (action === "verify") {
        await api.admin.verifyCertificate(certificateId);
      } else {
        await api.admin.rejectCertificate(certificateId);
      }
      Alert.alert("Updated", `Certificate ${action}d.`);
      await loadAdminData();
    } catch (error: any) {
      Alert.alert("Certificate update failed", error?.response?.data?.message || "Cannot update certificate status.");
    }
  };

  const handleReleasePayment = async (paymentId: string | number): Promise<void> => {
    try {
      await api.admin.releasePayment(paymentId);
      Alert.alert("Updated", "Escrow released.");
      await loadAdminData();
    } catch (error: any) {
      Alert.alert("Release failed", error?.response?.data?.message || "Cannot release escrow.");
    }
  };

  // Warnings: 3 lock the account for 3 days. The reason is typed inline (Android has no prompt).
  const [warningDraft, setWarningDraft] = useState<{ userId: string; change: 1 | -1; reason: string } | null>(null);
  const [warningHistory, setWarningHistory] = useState<Record<string, any[]>>({});
  const submitWarning = async (target: any): Promise<void> => {
    if (!warningDraft) return;
    if (warningDraft.reason.trim().length < 3) {
      Alert.alert("Reason required", "Give a reason of at least 3 characters.");
      return;
    }
    try {
      const { data } = await api.admin.changeUserWarnings(target.id, warningDraft.change, warningDraft.reason.trim());
      setWarningDraft(null);
      setWarningHistory((current) => { const next = { ...current }; delete next[String(target.id)]; return next; });
      Alert.alert("Warnings updated", data.status === "LOCKED"
        ? `${target.email} is locked until ${new Date(data.lockedUntil).toLocaleString()}.`
        : `${target.email} now has ${data.warningCount}/3 warnings.`);
      await loadAdminData();
    } catch (error: any) {
      Alert.alert("Update failed", error?.response?.data?.message || "Cannot change warnings.");
    }
  };
  const toggleWarningHistory = async (target: any): Promise<void> => {
    const key = String(target.id);
    if (warningHistory[key]) {
      setWarningHistory((current) => { const next = { ...current }; delete next[key]; return next; });
      return;
    }
    try {
      const { data } = await api.admin.getUserWarnings(target.id);
      setWarningHistory((current) => ({ ...current, [key]: Array.isArray(data.warnings) ? data.warnings : [] }));
    } catch (error: any) {
      Alert.alert("Load failed", error?.response?.data?.message || "Cannot load warnings.");
    }
  };

  const handleUserStatus = (target: any): void => {
    const nextStatus: "ACTIVE" | "SUSPENDED" = ["SUSPENDED", "LOCKED"].includes(target.status) ? "ACTIVE" : "SUSPENDED";
    Alert.alert(`${nextStatus === "SUSPENDED" ? "Suspend" : "Reactivate"} user`, target.status === "LOCKED" ? `${target.email}: the lock ends and the warnings reset to 0.` : target.email, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", style: nextStatus === "SUSPENDED" ? "destructive" : "default", onPress: () => void (async () => {
        try {
          await api.admin.updateUserStatus(target.id, nextStatus);
          await loadAdminData();
        } catch (error: any) {
          Alert.alert("Update failed", error?.response?.data?.message || "Cannot update user status.");
        }
      })() },
    ]);
  };

  const handleReviewDispute = async (dispute: any): Promise<void> => {
    try {
      await api.admin.reviewDispute(dispute.taskId, dispute.id, { status: "UNDER_REVIEW", action: "NONE" });
      await loadAdminData();
    } catch (error: any) {
      Alert.alert("Review failed", error?.response?.data?.message || "Cannot update dispute.");
    }
  };

  const taskTransitions: Record<string, string[]> = {
    PENDING: ["OPEN", "CANCELLED"],
    OPEN: ["CANCELLED"],
    BIDDING: ["CANCELLED"],
    ASSIGNED: ["CANCELLED"],
  };

  const handleTaskStatus = async (taskId: string | number, status: string): Promise<void> => {
    const reason = taskStatusReason.trim();
    if (reason.length < 5) {
      Alert.alert("Reason required", "Enter at least 5 characters before changing a task status.");
      return;
    }
    try {
      await api.admin.updateTaskStatus(taskId, { status, reason });
      setTaskStatusReason("");
      await loadAdminData();
    } catch (error: any) {
      Alert.alert("Status update failed", error?.response?.data?.message || "Cannot change task status.");
    }
  };

  return (
    <MarketplaceShell activeRoute="admin">
      <Card>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Admin Dashboard</Text>
            <Text style={styles.headerBody}>Manage suspicious tasks, certificates, and escrow payments using live backend data.</Text>
          </View>
          <Button title={isLoading ? "Refreshing..." : "Refresh"} size="sm" onPress={() => void loadAdminData()} />
        </View>
      </Card>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {[
          { id: "overview", label: "Overview" },
          { id: "users", label: "Users" },
          { id: "tasks", label: "Tasks" },
          { id: "certificates", label: "Certificates" },
          { id: "payments", label: "Payments / Escrow" },
          { id: "disputes", label: "Disputes / Reports" },
          { id: "support", label: "Support" },
        ].map((item) => (
          <Pressable
            key={item.id}
            onPress={() => setTab(item.id as AdminTab)}
            style={[styles.tabChip, tab === item.id ? styles.tabChipActive : null]}
          >
            <Text style={[styles.tabChipText, tab === item.id ? styles.tabChipTextActive : null]}>{item.label}</Text>
            {attentionFor(item.id) > 0 ? (
              <View style={styles.attentionBadge} accessibilityLabel={`${attentionFor(item.id)} need attention`}>
                <Text style={styles.attentionText}>{attentionFor(item.id) > 99 ? "99+" : attentionFor(item.id)}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>

      {loadError ? <Card><Text style={styles.riskMeta}>{loadError}</Text><Button title="Retry" size="sm" variant="outline" onPress={() => void loadAdminData()} /></Card> : null}

      {tab === "overview" ? (
        <View style={styles.grid}>
          {overviewCards.map((card) => (
            <Card key={card.label}>
              <Text style={styles.cardLabel}>{card.label}</Text>
              <Text style={styles.cardValue}>{card.value}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === "users" ? (
        <Card title={`Users (${filteredUsers.length}${filteredUsers.length !== users.length ? ` of ${users.length}` : ""})`}>
          <View style={styles.listWrap}>
            <Input label="Search" value={userSearch} onChangeText={setUserSearch} placeholder="Name or email" autoCapitalize="none" />
            <View style={styles.filterRow}>
              {[["ALL", "All roles"], ["REQUESTER", "Requester"], ["PROVIDER", "Provider"], ["ADMIN", "Admin"]].map(([value, label]) => (
                <Pressable key={value} onPress={() => setUserRole(value)} style={[styles.filterChip, userRole === value ? styles.filterChipActive : null]}>
                  <Text style={[styles.filterChipText, userRole === value ? styles.filterChipTextActive : null]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.filterRow}>
              {[["ALL", "All cities"], ["Ho Chi Minh City", "Ho Chi Minh City"], ["Hanoi", "Hanoi"], ["NONE", "No city set"]].map(([value, label]) => (
                <Pressable key={value} onPress={() => setUserCity(value)} style={[styles.filterChip, userCity === value ? styles.filterChipActive : null]}>
                  <Text style={[styles.filterChipText, userCity === value ? styles.filterChipTextActive : null]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {filteredUsers.length === 0 ? <Text style={styles.emptyText}>No users match these filters.</Text> : null}
            {filteredUsers.map((item) => <View key={String(item.id)} style={styles.listItem}>
              <Text style={styles.itemTitle}>{item.name} · {item.role}</Text>
              <Text style={styles.itemMeta}>{item.email}</Text>
              <Text style={styles.itemMeta}>Status: {item.status} · Tasks: {item._count?.tasksCreated || 0} · Disputes: {item._count?.disputesOpened || 0}</Text>
              <Text style={styles.itemMeta}>
                {item.location || "No city set"} · {item.ratingCount > 0 ? `★ ${Number(item.averageRating).toFixed(1)} (${item.ratingCount} rating${item.ratingCount === 1 ? "" : "s"})` : "No ratings yet"}
              </Text>
              {String(item.role).toUpperCase() === "PROVIDER" ? (
                item.verifiedDocuments?.length > 0 ? (
                  <View style={styles.badgeLine}>
                    <Text style={styles.itemMeta}>Verified documents:</Text>
                    {item.verifiedDocuments.map((doc: any) => (
                      <Pressable key={String(doc.id)} onPress={() => void Linking.openURL(String(doc.fileUrl || ""))}>
                        <Text style={styles.docLink}>✓ {doc.title}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.itemMeta}>No verified documents yet</Text>
                )
              ) : null}
              {item.role !== "ADMIN" ? (
                <Text style={[styles.itemMeta, item.warningCount >= 3 ? styles.warnHigh : item.warningCount > 0 ? styles.warnMid : null]}>
                  Warnings: {item.warningCount || 0}/3
                  {item.status === "LOCKED" && item.lockedUntil ? ` · Locked until ${new Date(item.lockedUntil).toLocaleString()}` : ""}
                </Text>
              ) : null}
              {item.role !== "ADMIN" ? (
                <View style={styles.warnActions}>
                  <Button title="− Warning" size="sm" variant="outline" disabled={!item.warningCount} onPress={() => setWarningDraft({ userId: String(item.id), change: -1, reason: "" })} />
                  <Button title="+ Warning" size="sm" variant="outline" onPress={() => setWarningDraft({ userId: String(item.id), change: 1, reason: "" })} />
                  <Button title={warningHistory[String(item.id)] ? "Hide history" : "History"} size="sm" variant="outline" onPress={() => void toggleWarningHistory(item)} />
                  <Button title={["SUSPENDED", "LOCKED"].includes(item.status) ? "Reactivate" : "Suspend"} size="sm" variant="outline" onPress={() => handleUserStatus(item)} />
                </View>
              ) : null}
              {warningDraft?.userId === String(item.id) ? (
                <View style={styles.warnDraft}>
                  <Input
                    label={warningDraft.change > 0 ? "Reason for the warning (shown to the user)" : "Reason for removing a warning"}
                    value={warningDraft.reason}
                    onChangeText={(reason) => setWarningDraft((current) => (current ? { ...current, reason } : current))}
                    placeholder="e.g. Did not assign a provider before the deadline"
                  />
                  <View style={styles.warnActions}>
                    <Button title="Confirm" size="sm" onPress={() => void submitWarning(item)} />
                    <Button title="Cancel" size="sm" variant="outline" onPress={() => setWarningDraft(null)} />
                  </View>
                </View>
              ) : null}
              {warningHistory[String(item.id)] ? (
                <View style={styles.warnDraft}>
                  {warningHistory[String(item.id)].length === 0 ? <Text style={styles.itemMeta}>No warnings yet.</Text> : null}
                  {warningHistory[String(item.id)].map((entry: any) => (
                    <Text key={String(entry.id)} style={styles.itemMeta}>
                      {entry.change > 0 ? `+${entry.change}` : entry.change} · {entry.reason} ({entry.countAfter}/3, {new Date(entry.createdAt).toLocaleString()}, {entry.createdBy?.name || "System"})
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>)}
          </View>
        </Card>
      ) : null}

      {tab === "tasks" ? (
        <View style={styles.grid}>
          <Card title="All Tasks">
            <View style={styles.listWrap}>
              <Input label="Audit reason for status change" value={taskStatusReason} onChangeText={setTaskStatusReason} />
              {tasks.length === 0 ? <Text style={styles.emptyText}>No tasks found.</Text> : null}
              {tasks.map((task) => (
                <View key={String(task.id)} style={styles.listItem}>
                  <Text style={styles.itemTitle}>{task.title}</Text>
                  <View style={styles.badgeLine}>
                    <Text style={styles.itemMeta}>{task.category}</Text>
                    <Badge label={String(task.status)} variant={getStatusVariant(task.status)} />
                  </View>
                  <Text style={styles.itemMeta}>Requester: {task.createdBy?.name || "-"}</Text>
                  <Text style={styles.itemMeta}>Provider: {task.assignedProvider?.name || "Unassigned"}</Text>
                  <View style={styles.badgeLine}>
                    <Text style={styles.itemMeta}>Escrow</Text>
                    <Badge label={task.escrowStatus || "NONE"} variant={getMoneyStatusVariant(task.escrowStatus || "NONE")} />
                    <Text style={styles.itemMeta}>Payment</Text>
                    <Badge label={task.paymentStatus || "UNPAID"} variant={getMoneyStatusVariant(task.paymentStatus || "UNPAID")} />
                  </View>
                  <Text style={styles.itemMeta}>GPS: {task.gpsVerificationStatus || "NOT_REQUIRED"} · Disputes: {task._count?.disputes || 0}</Text>
                  {(taskTransitions[task.status] || []).length > 0 ? (
                    <View style={styles.actionRow}>
                      {(taskTransitions[task.status] || []).map((status) => (
                        <Button key={status} title={status} size="sm" variant="outline" onPress={() => void handleTaskStatus(task.id, status)} />
                      ))}
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>

          <Card title="Suspicious / Flagged Tasks">
            <View style={styles.listWrap}>
              {suspiciousTasks.length === 0 ? <Text style={styles.emptyText}>No suspicious tasks.</Text> : null}
              {suspiciousTasks.map((task) => (
                <View key={String(task.id)} style={styles.listItem}>
                  <Text style={styles.itemTitle}>{task.title}</Text>
                  <View style={styles.badgeLine}>
                    <Badge label={task.riskLevel === "HIGH" ? "HIGH RISK" : "MEDIUM RISK"} variant={task.riskLevel === "HIGH" ? "danger" : "warning"} />
                    {task.reviewedByAdminAt ? <Badge label="Reviewed" variant="success" /> : null}
                  </View>
                  <Text style={styles.riskMeta}>{task.suspiciousReason || "Flagged as suspicious"}</Text>
                  <Text style={styles.itemMeta}>Posted by: {task.createdBy?.name || "Unknown"} · Budget: {formatCurrency(Number(task.budget || 0))}</Text>
                  <View style={styles.actionRow}>
                    {!task.reviewedByAdminAt ? <Button title="Mark Reviewed" size="sm" variant="outline" onPress={() => void handleReviewTask(task.id)} /> : null}
                    <Button title="Remove task" size="sm" variant="outline" onPress={() => setRemoveDraft({ taskId: String(task.id), reason: "" })} />
                  </View>
                  {removeDraft?.taskId === String(task.id) ? (
                    <View style={styles.warnDraft}>
                      <Text style={styles.itemMeta}>
                        The task is hidden everywhere and cancelled, and open bids are closed. The reason is sent to the
                        requester and every provider who bid.
                      </Text>
                      <Input
                        label="Reason"
                        value={removeDraft.reason}
                        onChangeText={(reason) => setRemoveDraft((current) => (current ? { ...current, reason } : current))}
                        placeholder="e.g. Budget far below market price, likely a scam"
                      />
                      <View style={styles.warnActions}>
                        <Button title="Remove" size="sm" onPress={() => void handleDeleteTask(task.id)} />
                        <Button title="Cancel" size="sm" variant="outline" onPress={() => setRemoveDraft(null)} />
                      </View>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      {tab === "certificates" ? (
        <Card title={`Provider Certificates · ${certificates.filter((cert) => cert.verificationStatus === "PENDING").length} waiting`}>
          <View style={styles.listWrap}>
            {certificates.length === 0 ? <Text style={styles.emptyText}>No certificates.</Text> : null}
            {/* Waiting for review first; reviewed ones have no Verify / Reject buttons. */}
            {[...certificates].sort((a, b) => Number(b.verificationStatus === "PENDING") - Number(a.verificationStatus === "PENDING")).map((cert) => (
              <View key={String(cert.id)} style={styles.listItem}>
                <Text style={styles.itemTitle}>{cert.title}</Text>
                <Text style={styles.itemMeta}>{cert.certificateType}</Text>
                <Text style={styles.itemMeta}>
                  Provider: {cert.provider?.name || "-"} ({cert.provider?.email || "-"})
                </Text>
                <Badge
                  label={cert.verificationStatus === "PENDING" ? "Waiting for review" : String(cert.verificationStatus)}
                  variant={cert.verificationStatus === "VERIFIED" ? "success" : cert.verificationStatus === "REJECTED" ? "danger" : "warning"}
                />
                <Pressable onPress={() => void Linking.openURL(String(cert.fileUrl || ""))}>
                  <Text style={styles.linkText}>Open document</Text>
                </Pressable>
                {cert.verificationStatus === "PENDING" ? (
                  <View style={styles.actionRow}>
                    <Button title="Verify" size="sm" variant="outline" onPress={() => void handleCertificateAction(cert.id, "verify")} />
                    <Button title="Reject" size="sm" variant="outline" onPress={() => void handleCertificateAction(cert.id, "reject")} />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {tab === "payments" ? (
        <Card title="Escrow & Payment Transactions">
          <View style={styles.listWrap}>
            {payments.length === 0 ? <Text style={styles.emptyText}>No payments.</Text> : null}
            {payments.map((payment) => (
              <View key={String(payment.id)} style={styles.listItem}>
                <Text style={styles.itemTitle}>{payment.task?.title || `Task #${payment.taskId}`}</Text>
                <Text style={styles.itemMeta}>Requester: {payment.payer?.name || "-"}</Text>
                <Text style={styles.itemMeta}>Provider: {payment.provider?.name || "-"}</Text>
                <Text style={styles.itemMeta}>
                  Total paid: <Text style={styles.itemStrong}>{formatCurrency(Number(payment.totalAmount || payment.amount || 0))}</Text>
                </Text>
                <Text style={styles.itemMeta}>
                  Platform fee: <Text style={styles.itemStrong}>{formatCurrency(Number(payment.platformFeeAmount || 0))}</Text>
                </Text>
                <Text style={styles.itemMeta}>
                  Provider payout: <Text style={styles.itemStrong}>{formatCurrency(Number(payment.providerPayoutAmount || 0))}</Text>
                </Text>
                <Text style={styles.itemMeta}>Lifecycle: {payment.lifecycleStatus || "PENDING"}</Text>
                {payment.lifecycleStatus === "ESCROW_HELD" ? (
                  <Button title="Release Escrow" size="sm" onPress={() => void handleReleasePayment(payment.id)} />
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {tab === "disputes" ? (
        <Card title="Disputes">
          <View style={styles.listWrap}>
            {disputes.length === 0 ? <Text style={styles.emptyText}>No disputes.</Text> : null}
            {disputes.map((dispute) => <View key={String(dispute.id)} style={styles.listItem}>
              <Text style={styles.itemTitle}>{dispute.task?.title || `Task #${dispute.taskId}`}</Text>
              <Text style={styles.itemMeta}>{dispute.reason}: {dispute.description || "No description"}</Text>
              <Text style={styles.itemMeta}>Status: {dispute.status} · Escrow: {dispute.task?.escrowStatus || "NONE"}</Text>
              {dispute.status === "OPEN" ? <Button title="Start Review" size="sm" variant="outline" onPress={() => void handleReviewDispute(dispute)} /> : null}
            </View>)}
          </View>
        </Card>
      ) : null}

      {tab === "support" ? (
        <Card title="Support Tickets">
          <View style={styles.listWrap}>
            {supportTickets.map((ticket) => <View key={String(ticket.id)} style={styles.listItem}><Text style={styles.itemTitle}>{ticket.subject}</Text><Text style={styles.itemMeta}>{ticket.category} · {ticket.priority} · {ticket.status}</Text></View>)}
            {supportTickets.length === 0 ? <Text style={styles.emptyText}>No support tickets.</Text> : null}
            <Button title="Open Support Center" variant="outline" onPress={() => router.push("/support")} />
          </View>
        </Card>
      ) : null}
    </MarketplaceShell>
  );
}

const styles = StyleSheet.create({
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.dark[200], backgroundColor: colors.white },
  filterChipActive: { borderColor: colors.primary[600], backgroundColor: colors.primary[50] },
  filterChipText: { fontSize: 12, color: colors.dark[700] },
  filterChipTextActive: { color: colors.primary[700], fontWeight: "700" },
  docLink: { fontSize: 12, fontWeight: "700", color: colors.success[700], textDecorationLine: "underline" },
  attentionBadge: {
    position: "absolute",
    top: -7,
    right: -7,
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 10,
    backgroundColor: colors.danger[600],
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: "center",
  },
  attentionText: { color: colors.white, fontSize: 10, fontWeight: "800", lineHeight: 12 },
  badgeLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  warnActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  warnDraft: { gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.dark[50] },
  warnMid: { color: colors.warning[600], fontWeight: "700" },
  warnHigh: { color: colors.danger[600], fontWeight: "700" },
  promptBox: {
    alignItems: "center",
    gap: 8,
  },
  promptTitle: {
    color: colors.dark[900],
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
  },
  promptBody: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  headerTitle: {
    color: colors.dark[900],
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
  },
  headerBody: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
  },
  tabRow: {
    gap: 8,
    paddingRight: 8,
    // Room for the attention badges that sit on the tab corners.
    paddingTop: 8,
  },
  tabChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.dark[200],
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  tabChipActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  tabChipText: {
    color: colors.dark[700],
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  tabChipTextActive: {
    color: colors.primary[700],
  },
  grid: {
    gap: 12,
  },
  cardLabel: {
    color: colors.dark[500],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  cardValue: {
    color: colors.dark[900],
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    marginTop: 6,
  },
  listWrap: {
    gap: 10,
  },
  listItem: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dark[200],
    backgroundColor: colors.dark[50],
    padding: 12,
    gap: 4,
  },
  itemTitle: {
    color: colors.dark[900],
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "800",
  },
  itemMeta: {
    color: colors.dark[600],
    fontSize: 12,
    lineHeight: 16,
  },
  itemStrong: {
    color: colors.dark[900],
    fontWeight: "700",
  },
  riskMeta: {
    color: colors.danger[700],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  linkText: {
    color: colors.primary[700],
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    textDecorationLine: "underline",
    marginTop: 2,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  emptyText: {
    color: colors.dark[500],
    fontSize: 13,
    lineHeight: 18,
  },
  disputeText: {
    color: colors.dark[600],
    fontSize: 14,
    lineHeight: 20,
  },
});
