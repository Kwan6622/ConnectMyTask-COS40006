import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { MarketplaceShell } from "@/components/MarketplaceShell";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { api } from "@/services/api";
import { useAuthStore } from "@/store/authStore";
import type { PaymentTransaction } from "@/types";
import { colors } from "@/theme/tokens";
import { formatCurrency, isRequester } from "@/utils/taskUtils";

function receiptTime(transaction: PaymentTransaction): { label: string; value: string } {
  const isPaid = transaction.status === "SUCCESS" && (transaction.type === "ESCROW_DEPOSIT" || transaction.type === "DIRECT_PAYMENT");
  const isRefund = transaction.type === "ESCROW_REFUND" && Boolean(transaction.paidAt);
  const timestamp = (isPaid || isRefund || transaction.type === "ESCROW_RELEASE") && transaction.paidAt
    ? transaction.paidAt : transaction.createdAt;
  const timeLabel = isPaid && transaction.paidAt ? "Paid at"
    : isPaid ? "Created at · payment time unavailable"
      : isRefund ? "Refunded at"
        : transaction.type === "ESCROW_RELEASE" ? "Recorded at" : "Created at";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return { label: timeLabel, value: "Not available" };
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  return { label: timeLabel, value: `${day} · ${time}` };
}

function label(value?: string): string {
  return String(value || "UNKNOWN").replaceAll("_", " ");
}

function transactionStatusLabel(transaction: PaymentTransaction): string {
  return transaction.type === "ESCROW_RELEASE" && transaction.settlementMode === "SIMULATED_DEMO"
    ? "DEMO PAYOUT · NOT TRANSFERRED"
    : label(transaction.status);
}

function transactionAmount(transaction: PaymentTransaction): number {
  return transaction.type === "ESCROW_RELEASE"
    ? Number(transaction.providerPayoutAmount ?? transaction.amount)
    : Number(transaction.totalAmount ?? transaction.amount);
}

function transactionType(transaction: PaymentTransaction): string {
  return {
    ESCROW_DEPOSIT: "Escrow Deposit",
    ESCROW_RELEASE: "Escrow Release",
    ESCROW_REFUND: "Escrow Refund",
    DIRECT_PAYMENT: "Direct Payment",
  }[transaction.type];
}

function amountLabel(transaction: PaymentTransaction): string {
  if (transaction.type === "ESCROW_RELEASE") return "Provider payout recorded";
  if (transaction.type === "ESCROW_REFUND") return "Refund amount";
  return transaction.status === "SUCCESS" ? "Amount paid" : "Payment amount";
}

function statusColors(status?: string): { backgroundColor: string; borderColor: string; color: string } {
  if (status === "SUCCESS" || status === "RELEASED" || status === "HELD") return { backgroundColor: colors.success[50], borderColor: colors.success[200], color: colors.success[700] };
  if (status === "PENDING" || status === "PENDING_DEPOSIT" || status === "FROZEN") return { backgroundColor: colors.warning[50], borderColor: colors.warning[200], color: colors.warning[600] };
  if (status === "FAILED" || status === "CANCELED") return { backgroundColor: colors.danger[50], borderColor: colors.danger[200], color: colors.danger[700] };
  if (status === "REFUNDED") return { backgroundColor: colors.accent[50], borderColor: colors.accent[200], color: colors.accent[700] };
  return { backgroundColor: colors.dark[50], borderColor: colors.dark[200], color: colors.dark[700] };
}

export default function TransactionHistoryScreen(): React.ReactElement {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [selected, setSelected] = useState<PaymentTransaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTransactions = useCallback(async (): Promise<void> => {
    if (!isRequester(user)) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await api.payments.getMine();
      const items = Array.isArray(response.data) ? response.data : [];
      setTransactions(items);
      setSelected((current) => items.find((item: PaymentTransaction) => String(item.id) === String(current?.id)) || items[0] || null);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.message || "Unable to load transaction history.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useFocusEffect(useCallback(() => {
    void loadTransactions();
  }, [loadTransactions]));

  if (!isRequester(user)) {
    return (
      <MarketplaceShell activeRoute="transactions">
        <Card>
          <Text style={styles.title}>Requester access required</Text>
          <Button title="Back" onPress={() => router.back()} />
        </Card>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell activeRoute="transactions">
      <Card>
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>Transaction History</Text>
            <Text style={styles.muted}>Newest requester transactions first.</Text>
          </View>
          <Button title="Refresh" size="sm" variant="outline" onPress={() => void loadTransactions()} loading={isLoading} />
        </View>
      </Card>

      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={() => void loadTransactions()} />
        </Card>
      ) : isLoading ? (
        <Card><Text style={styles.muted}>Loading transactions...</Text></Card>
      ) : transactions.length === 0 ? (
        <Card><Text style={styles.muted}>No requester transactions yet.</Text></Card>
      ) : (
        transactions.map((transaction) => (
          <Pressable key={String(transaction.id)} onPress={() => setSelected(transaction)}>
            <Card style={selected?.id === transaction.id ? styles.selectedCard : undefined}>
              <View style={styles.headerRow}>
                <View style={styles.flex}>
                  <Text style={styles.reference}>{transactionType(transaction)} · {transaction.reference || `CMT-${transaction.id}`}</Text>
                  <Text style={styles.itemTitle}>{transaction.task?.title || `Task #${transaction.taskId}`}</Text>
                  <Text style={styles.muted}>{receiptTime(transaction).label}: {receiptTime(transaction).value}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{formatCurrency(transactionAmount(transaction))}</Text>
                  <View style={[styles.badge, statusColors(transaction.settlementMode === "SIMULATED_DEMO" ? "PENDING" : transaction.status)]}>
                    <Text style={[styles.badgeText, { color: statusColors(transaction.settlementMode === "SIMULATED_DEMO" ? "PENDING" : transaction.status).color }]}>{transactionStatusLabel(transaction)}</Text>
                  </View>
                </View>
              </View>
            </Card>
          </Pressable>
        ))
      )}

      {selected ? (
        <Card>
          <View style={styles.receiptHeader}>
            <View style={styles.receiptIcon}><Text style={styles.receiptIconText}>▣</Text></View>
            <View style={styles.flex}>
              <Text style={styles.eyebrow}>TRANSACTION RECEIPT</Text>
              <Text style={styles.receiptTitle}>{transactionType(selected)}</Text>
            </View>
          </View>
          <View style={[styles.badge, styles.receiptBadge, statusColors(selected.status)]}>
            <Text style={[styles.badgeText, { color: statusColors(selected.status).color }]}>{label(selected.status)}</Text>
          </View>

          <View style={styles.amountPanel}>
            <Text style={styles.eyebrow}>{amountLabel(selected).toUpperCase()}</Text>
            <Text style={styles.receiptAmount}>{formatCurrency(transactionAmount(selected))}</Text>
            <Text style={styles.muted}>{receiptTime(selected).label}: {receiptTime(selected).value}</Text>
          </View>

          {selected.type === "ESCROW_RELEASE" && selected.settlementMode === "SIMULATED_DEMO" ? (
            <View style={styles.demoBanner}>
              <Text style={styles.demoBannerText}>DEMO PAYOUT · NOT TRANSFERRED</Text>
              <Text style={styles.demoBannerSubtext}>No Stripe Connect transfer was sent.</Text>
            </View>
          ) : null}

          <Text style={styles.sectionTitle}>Transaction</Text>
          <Detail label="Reference / ID" value={selected.reference || `CMT-${selected.id}`} />
          <Detail label="Task" value={selected.task?.title || `Task #${selected.taskId}`} />
          <Detail label="Type" value={transactionType(selected)} />
          {selected.task?.originalBudget != null ? <Detail label="Original budget" value={formatCurrency(selected.task.originalBudget)} /> : null}

          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>Payment details</Text>
          <Detail label="Payment method" value={selected.method === "STRIPE" ? "Stripe" : selected.method} />
          {selected.card ? <Detail label="Card" value={`${selected.card.brand.toUpperCase()} •••• ${selected.card.last4}`} /> : null}
          {(selected.type === "ESCROW_DEPOSIT" || selected.type === "ESCROW_RELEASE") ? <Detail label="Accepted bid" value={formatCurrency(Number(selected.agreedPrice ?? selected.totalAmount ?? selected.amount))} /> : null}
          {(selected.type === "ESCROW_DEPOSIT" || selected.type === "ESCROW_RELEASE") ? <Detail label="Platform fee" value={formatCurrency(Number(selected.platformFeeAmount ?? 0))} /> : null}
          {(selected.type === "ESCROW_DEPOSIT" || selected.type === "ESCROW_RELEASE") && selected.providerPayoutAmount != null ? <Detail label={selected.type === "ESCROW_RELEASE" ? "Provider payout (demo)" : "Expected provider payout"} value={formatCurrency(Number(selected.providerPayoutAmount))} /> : null}
          <Detail label={selected.type === "ESCROW_REFUND" ? "Refund amount" : "Total"} value={formatCurrency(Number(selected.totalAmount ?? selected.amount))} />

          <View style={styles.divider} />
          <Text style={styles.sectionTitle}>Status</Text>
          <StatusDetail detailLabel="Payment" status={selected.status} />
          <StatusDetail detailLabel="Escrow" status={selected.escrowStatus || selected.task?.escrowStatus} />
          {selected.refund ? <Detail label="Refund" value={`${formatCurrency(selected.refund.amount)} · ${label(selected.refund.status)}`} /> : null}
          <View style={styles.openTask}><Button title="Open Task" variant="outline" onPress={() => router.push({ pathname: "/task-detail", params: { taskId: String(selected.taskId) } })} /></View>
        </Card>
      ) : null}
    </MarketplaceShell>
  );
}

function Detail({ label: detailLabel, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{detailLabel}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function StatusDetail({ detailLabel, status }: { detailLabel: string; status?: string }): React.ReactElement {
  const tone = statusColors(status);
  return (
    <View style={styles.statusRow}>
      <Text style={styles.detailLabel}>{detailLabel}</Text>
      <View style={[styles.badge, tone]}><Text style={[styles.badgeText, { color: tone.color }]}>{label(status)}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { color: colors.dark[900], fontSize: 22, lineHeight: 28, fontWeight: "800", marginBottom: 4 },
  muted: { color: colors.dark[500], fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger[700], marginBottom: 12 },
  selectedCard: { borderColor: colors.primary[400], borderWidth: 2 },
  reference: { color: colors.primary[700], fontSize: 12, lineHeight: 16, fontWeight: "800" },
  itemTitle: { color: colors.dark[900], fontSize: 15, lineHeight: 20, fontWeight: "700", marginVertical: 2 },
  right: { alignItems: "flex-end" },
  amount: { color: colors.dark[900], fontSize: 15, lineHeight: 20, fontWeight: "800" },
  badge: { alignSelf: "flex-end", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
  receiptHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  receiptIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary[50], alignItems: "center", justifyContent: "center" },
  receiptIconText: { color: colors.primary[700], fontSize: 24, fontWeight: "700" },
  eyebrow: { color: colors.dark[500], fontSize: 10, lineHeight: 14, fontWeight: "800", letterSpacing: 1 },
  receiptTitle: { color: colors.dark[900], fontSize: 18, lineHeight: 24, fontWeight: "800" },
  receiptBadge: { marginTop: 12 },
  amountPanel: { marginTop: 18, padding: 18, borderRadius: 16, backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[100], gap: 4 },
  receiptAmount: { color: colors.dark[900], fontSize: 28, lineHeight: 34, fontWeight: "800" },
  demoBanner: { marginTop: 16, padding: 14, borderRadius: 12, backgroundColor: colors.warning[50], borderWidth: 1, borderColor: colors.warning[200] },
  demoBannerText: { color: colors.warning[600], fontSize: 12, fontWeight: "800" },
  demoBannerSubtext: { color: colors.warning[600], fontSize: 11, marginTop: 2 },
  sectionTitle: { color: colors.dark[900], fontSize: 15, lineHeight: 20, fontWeight: "800", marginTop: 20, marginBottom: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.dark[200], marginTop: 18 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  detailLabel: { color: colors.dark[500], fontSize: 12, lineHeight: 17 },
  detailValue: { flex: 1, color: colors.dark[900], fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "right" },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 6 },
  openTask: { marginTop: 18 },
});
