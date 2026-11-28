import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { useAccountLockStore } from "@/store/accountLockStore";
import { useAuthStore } from "@/store/authStore";
import { colors, radius } from "@/theme/tokens";

const WARNING_LIMIT = 3;

function timeLeft(until: Date, now: Date): string {
  const ms = Math.max(0, until.getTime() - now.getTime());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

/**
 * Shown when the account has 3 warnings. The only action is to log out; the
 * lock ends by itself at the time shown, or earlier if an admin reactivates it.
 */
export default function AccountLockedScreen(): React.ReactElement {
  const router = useRouter();
  const lock = useAccountLockStore((state) => state.lock);
  const clearLock = useAccountLockStore((state) => state.clear);
  const logout = useAuthStore((state) => state.logout);
  const until = lock?.lockedUntil ? new Date(lock.lockedUntil) : null;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = () => {
    logout();
    clearLock();
    router.replace("/sign-in");
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.card}>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>Your account is locked</Text>
        <Text style={styles.body}>
          Your account received {lock?.warningCount ?? WARNING_LIMIT} warnings, so it is locked for 3 days.
        </Text>
        {(lock?.reasons || []).map((reason, index) => (
          <Text key={index} style={styles.reason}>{reason}</Text>
        ))}
        <View style={styles.untilBox}>
          {until ? (
            <>
              <Text style={styles.untilLabel}>Locked until</Text>
              <Text style={styles.untilValue}>
                {until.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </Text>
              <Text style={styles.untilLabel}>
                {until <= now ? "The lock has ended. Log out and sign in again." : `${timeLeft(until, now)} left`}
              </Text>
            </>
          ) : (
            <Text style={styles.untilLabel}>Sign in again to see when the lock ends.</Text>
          )}
        </View>
        <Text style={styles.note}>
          The account is reactivated automatically at that time, or earlier if an admin reactivates it.
        </Text>
        <Button title="Log out" onPress={handleLogout} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.dark[50], justifyContent: "center", padding: 16 },
  card: {
    gap: 12,
    padding: 24,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger[200],
    backgroundColor: colors.white,
  },
  icon: { fontSize: 36, textAlign: "center" },
  title: { fontSize: 22, fontWeight: "800", color: colors.dark[900], textAlign: "center" },
  body: { fontSize: 15, lineHeight: 22, color: colors.dark[600], textAlign: "center" },
  untilBox: { gap: 4, padding: 14, borderRadius: radius.md, backgroundColor: colors.danger[50], alignItems: "center" },
  untilLabel: { fontSize: 13, color: colors.danger[700], textAlign: "center" },
  untilValue: { fontSize: 18, fontWeight: "700", color: colors.danger[700], textAlign: "center" },
  reason: { fontSize: 13, lineHeight: 19, color: colors.dark[700], backgroundColor: colors.dark[50], padding: 10, borderRadius: radius.sm },
  note: { fontSize: 13, lineHeight: 19, color: colors.dark[500], textAlign: "center" },
});
