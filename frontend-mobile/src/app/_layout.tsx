import React from "react";
import { Redirect, Stack, usePathname } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@/theme/tokens";
import { useAuthStore } from "@/store/authStore";
import { useAccountLockStore } from "@/store/accountLockStore";

export default function RootLayout(): React.ReactElement {
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const isAuthScreen = pathname === "/sign-in" || pathname === "/sign-up";
  const isLocked = useAccountLockStore((state) => Boolean(state.lock));

  if (!hasHydrated || !pathname) {
    return <SafeAreaProvider />;
  }

  // 3 warnings: only the lock screen (with Log out) is reachable.
  if (isLocked && pathname !== "/account-locked") {
    return <Redirect href="/account-locked" />;
  }
  if (!isLocked && pathname === "/account-locked") {
    return <Redirect href={isAuthenticated ? "/browse-tasks" : "/sign-in"} />;
  }

  // Mobile app is auth-gated: users must sign in/register before accessing the app.
  if (!isAuthenticated && !isAuthScreen && pathname !== "/account-locked") {
    return <Redirect href="/sign-in" />;
  }

  if (isAuthenticated && isAuthScreen) {
    return <Redirect href="/browse-tasks" />;
  }

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: colors.dark[50],
          },
        }}
      />
    </SafeAreaProvider>
  );
}
