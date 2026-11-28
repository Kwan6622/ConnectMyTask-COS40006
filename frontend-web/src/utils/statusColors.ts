// One colour scheme for every task / escrow / payment status badge (keep in step
// with frontend-mobile/src/utils/statusColors.ts):
//   red    = cancelled, failed            yellow = pending / awaiting (money or confirmation)
//   green  = paid, released, held, done   blue   = open, sky = bidding, purple = in progress
//   rose   = disputed                     gray   = expired / none
export interface StatusTone {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

// Written out in full so Tailwind keeps every class in the build.
const BLUE: StatusTone = { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' };
const SKY: StatusTone = { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500' };
const GREEN: StatusTone = { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' };
const PURPLE: StatusTone = { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500' };
const YELLOW: StatusTone = { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-300', dot: 'bg-yellow-500' };
const SLATE: StatusTone = { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300', dot: 'bg-slate-500' };
const ROSE: StatusTone = { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', dot: 'bg-rose-500' };
const RED: StatusTone = { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' };
const GRAY: StatusTone = { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', dot: 'bg-gray-400' };
const VIOLET: StatusTone = { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', dot: 'bg-violet-500' };

const TASK_TONES: Record<string, StatusTone> = {
  OPEN: BLUE,
  POSTED: BLUE,
  BIDDING: SKY,
  ASSIGNED: GREEN,
  IN_PROGRESS: PURPLE,
  PENDING: YELLOW,
  PENDING_CONFIRMATION: YELLOW,
  AWAITING_PAYMENT: YELLOW,
  COMPLETED: GREEN,
  PAID: GREEN,
  DISPUTED: ROSE,
  CANCELLED: RED,
  EXPIRED: GRAY,
};

// Escrow (TASKS.escrowStatus), task payment and payment transaction statuses.
const MONEY_TONES: Record<string, StatusTone> = {
  NONE: SLATE,
  UNPAID: SLATE,
  PENDING: YELLOW,
  PENDING_DEPOSIT: YELLOW,
  ESCROW_PENDING: YELLOW,
  AWAITING_PAYMENT: YELLOW,
  PROCESSING: YELLOW,
  HELD: GREEN,
  ESCROW_HELD: GREEN,
  RELEASED: GREEN,
  SUCCESS: GREEN,
  PAID: GREEN,
  FROZEN: ROSE,
  REFUNDED: VIOLET,
  FAILED: RED,
  CANCELED: RED,
  CANCELLED: RED,
};

const key = (status?: string | null) => String(status || '').toUpperCase();

export function taskStatusTone(status?: string | null): StatusTone {
  return TASK_TONES[key(status)] || SLATE;
}

export function moneyStatusTone(status?: string | null): StatusTone {
  return MONEY_TONES[key(status)] || SLATE;
}

/** "bg-… text-… border-…" for a task status badge. */
export function taskStatusClasses(status?: string | null): string {
  const t = taskStatusTone(status);
  return `${t.bg} ${t.text} ${t.border}`;
}

/** "bg-… text-… border-…" for an escrow / payment status badge. */
export function moneyStatusClasses(status?: string | null): string {
  const t = moneyStatusTone(status);
  return `${t.bg} ${t.text} ${t.border}`;
}
