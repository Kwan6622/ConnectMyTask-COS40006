import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import type { TaskLocationVerificationStatus } from '../types';

export const LOCATION_VERIFICATION_MESSAGE = 'Please verify your location on the mobile app';
export const AWAITING_DEPOSIT_MESSAGE = 'Awaiting requester deposit';

const POLL_INTERVAL_MS = 15000;

function isCurrent(status: TaskLocationVerificationStatus | null): boolean {
  if (!status?.isValid || !status.expiresAt) return false;
  const expiresAt = new Date(status.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function useTaskLocationVerification(taskId: string | undefined, enabled: boolean) {
  const [status, setStatus] = useState<TaskLocationVerificationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async (): Promise<TaskLocationVerificationStatus | null> => {
    if (!taskId || !enabled) return null;
    setIsLoading(true);
    try {
      const response = await api.tracking.getVerification(taskId);
      const next = response.data as TaskLocationVerificationStatus;
      setStatus(next);
      return next;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [enabled, taskId]);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    void refresh();
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!status?.isValid || !status.expiresAt) return;
    const delay = new Date(status.expiresAt).getTime() - Date.now();
    if (delay <= 0) {
      setStatus((current) => current ? { ...current, isValid: false, reason: 'EXPIRED' } : current);
      return;
    }
    const timer = window.setTimeout(() => {
      setStatus((current) => current ? { ...current, isValid: false, reason: 'EXPIRED' } : current);
    }, Math.min(delay + 25, 2147483647));
    return () => window.clearTimeout(timer);
  }, [status?.expiresAt, status?.isValid]);

  const isValid = useMemo(() => isCurrent(status), [status]);
  return { status, isValid, isLoading, refresh };
}

export function isVerificationCurrent(status: TaskLocationVerificationStatus | null): boolean {
  return isCurrent(status);
}
