import React from 'react';
import type { UserWarning } from '../../types';

interface WarningsPanelProps {
  count: number;
  limit?: number;
  warnings?: UserWarning[];
}

/** Warning count (x / 3) and the reasons, shown on the user's own profile. */
export const WarningsPanel: React.FC<WarningsPanelProps> = ({ count, limit = 3, warnings = [] }) => {
  const tone = count === 0
    ? 'border-green-200 bg-green-50 text-green-800'
    : count >= limit - 1
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-800';
  const given = warnings.filter((item) => item.change > 0);

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Account warnings</p>
        <span className="rounded-full bg-white/70 px-2.5 py-0.5 text-sm font-bold">{count} / {limit}</span>
      </div>
      <p className="mt-1 text-sm">
        {count === 0
          ? 'No warnings. Keep it that way by assigning a provider before your deadline and following the platform rules.'
          : `At ${limit} warnings your account is locked for 3 days. Warnings reset when a lock ends.`}
      </p>
      {given.length > 0 && (
        <ul className="mt-3 space-y-2">
          {given.slice(0, 5).map((item) => (
            <li key={item.id} className="rounded-lg bg-white/70 px-3 py-2 text-sm text-gray-800">
              <p>{item.reason}</p>
              <p className="mt-0.5 text-xs text-gray-500">
                {new Date(item.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {item.createdBy?.name ? ` · by ${item.createdBy.name}` : ' · by the system'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
