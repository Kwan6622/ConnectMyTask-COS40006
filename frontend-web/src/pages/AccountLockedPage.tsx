import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { useAuthStore } from '../stores/auth.store';
import { clearAccountLock, readAccountLock } from '../utils/accountLock';

const WARNING_LIMIT = 3;

function timeLeft(until: Date, now: Date): string {
  const ms = Math.max(0, until.getTime() - now.getTime());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'} ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

/**
 * Shown after sign-in (or any request) when the account has 3 warnings.
 * The only action is to log out; the lock ends by itself at the time shown,
 * or earlier if an admin reactivates the account.
 */
export const AccountLockedPage: React.FC = () => {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const lock = readAccountLock();
  const until = lock?.lockedUntil ? new Date(lock.lockedUntil) : null;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const expired = Boolean(until && until <= now);

  const handleLogout = () => {
    clearAccountLock();
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-lg">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
          <LockClosedIcon className="h-7 w-7 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Your account is locked</h1>
        <p className="mt-3 text-gray-600">
          Your account received {lock?.warningCount ?? WARNING_LIMIT} warnings, so it is locked for 3 days.
        </p>
        {lock?.reasons && lock.reasons.length > 0 && (
          <ul className="mt-4 space-y-2 text-left">
            {lock.reasons.map((reason, index) => (
              <li key={index} className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{reason}</li>
            ))}
          </ul>
        )}

        {until ? (
          <div className="mt-6 rounded-xl bg-red-50 p-4 text-red-800">
            <p className="text-sm">Locked until</p>
            <p className="mt-1 text-lg font-semibold">
              {until.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="mt-1 text-sm">
              {expired ? 'The lock has ended. Log out and sign in again.' : `${timeLeft(until, now)} left`}
            </p>
          </div>
        ) : (
          <p className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-800">Sign in again to see when the lock ends.</p>
        )}

        <p className="mt-4 text-sm text-gray-500">
          The account is reactivated automatically at that time, or earlier if an admin reactivates it.
        </p>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-6 w-full rounded-xl bg-gray-900 px-4 py-3 font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500"
        >
          Log out
        </button>
      </div>
    </div>
  );
};
