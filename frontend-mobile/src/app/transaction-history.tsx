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
import { formatCurrency, formatDateTime, isRequester } from "@/utils/taskUtils";

function label(value?: string): string {
  return String(value || "UNKNOWN").replaceAll("_", " ");
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
      setSelected((current) => current
        ? items.find((item: PaymentTransaction) => String(item.id) === String(current.id)) || null
        : null);
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
                  <Text style={styles.reference}>{transaction.reference || `CMT-${transaction.id}`}</Text>
                  <Text style={styles.itemTitle}>{transaction.task?.title || `Task #${transaction.taskId}`}</Text>
                  <Text style={styles.muted}>{formatDateTime(transaction.createdAt)}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.amount}>{formatCurrency(Number(transaction.totalAmount ?? transaction.amount))}</Text>
                  <Text style={styles.status}>{label(transaction.status)}</Text>
                </View>
              </View>
            </Card>
          </Pressable>
        ))
      )}

      {selected ? (
        <Card title="Transaction detail">
          <View style={styles.details}>
            <Detail label="Reference" value={selected.reference || `CMT-${selected.id}`} />
            <Detail label="Task" value={selected.task?.title || `Task #${selected.taskId}`} />
            <Detail label="Date/time" value={formatDateTime(selected.paidAt || selected.createdAt)} />
            {selected.task?.originalBudget != null ? <Detail label="Original budget" value={formatCurrency(selected.task.originalBudget)} /> : null}
            <Detail label="Accepted bid" value={formatCurrency(Number(selected.agreedPrice ?? selected.amount))} />
            <Detail label="Platform fee" value={formatCurrency(Number(selected.platformFeeAmount || 0))} />
            <Detail label="Total" value={formatCurrency(Number(selected.totalAmount ?? selected.amount))} />
            <Detail label="Payment status" value={label(selected.status)} />
            <Detail label="Escrow status" value={label(selected.escrowStatus || selected.task?.escrowStatus)} />
            {selected.card ? <Detail label="Card" value={`${selected.card.brand.toUpperCase()} •••• ${selected.card.last4}`} /> : null}
            {selected.refund ? <Detail label="Refund" value={`${formatCurrency(selected.refund.amount)} · ${label(selected.refund.status)}`} /> : null}
            <Button
              title="Open Task"
              variant="outline"
              onPress={() => router.push({ pathname: "/task-detail", params: { taskId: String(selected.taskId) } })}
            />
          </View>
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  title: { color: colors.dark[900], fontSize: 22, lineHeight: 28, fontWeight: "800", marginBottom: 4 },
  muted: { color: colors.dark[500], fontSize: 12, lineHeight: 17 },
  error: { color: colors.danger[700], marginBottom: 12 },
  selectedCard: { borderColor: colors.primary[400] },
  reference: { color: colors.primary[700], fontSize: 12, lineHeight: 16, fontWeight: "800" },
  itemTitle: { color: colors.dark[900], fontSize: 15, lineHeight: 20, fontWeight: "700", marginVertical: 2 },
  right: { alignItems: "flex-end" },
  amount: { color: colors.dark[900], fontSize: 15, lineHeight: 20, fontWeight: "800" },
  status: { color: colors.dark[600], fontSize: 11, lineHeight: 16, fontWeight: "700" },
  details: { gap: 10 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, borderBottomWidth: 1, borderBottomColor: colors.dark[100], paddingBottom: 8 },
  detailLabel: { color: colors.dark[500], fontSize: 12, lineHeight: 17 },
  detailValue: { flex: 1, color: colors.dark[900], fontSize: 12, lineHeight: 17, fontWeight: "700", textAlign: "right" },
});
