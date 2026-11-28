import { colors } from "@/theme/tokens";
import { Task, TaskStatus, User } from "@/types";

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

export const formatCurrency = (amount: number): string => {
  if (!Number.isFinite(amount)) return "N/A";
  return `${Math.round(amount).toLocaleString("en-US")} VND`;
};

export const isTaskActive = (status: TaskStatus | string): boolean => {
  const normalized = normalizeTaskStatus(status);
  return ![TaskStatus.COMPLETED, TaskStatus.PAID, TaskStatus.CANCELLED, TaskStatus.EXPIRED].includes(normalized);
};

export const isTaskBrowsable = (task: Pick<Task, "status" | "isOverdue" | "assignedProviderId">): boolean => {
  const normalized = normalizeTaskStatus(task.status);
  if ([TaskStatus.ASSIGNED, TaskStatus.COMPLETED, TaskStatus.PAID, TaskStatus.CANCELLED, TaskStatus.EXPIRED].includes(normalized)) {
    return false;
  }
  if (Boolean(task.isOverdue) && !task.assignedProviderId) {
    return false;
  }
  return true;
};

export const normalizeTaskStatus = (status: string | null | undefined): TaskStatus => {
  const value = (status || "").trim().toUpperCase();
  if (value === "POSTED" || value === "PENDING") return TaskStatus.OPEN;
  if (value === "OPEN") return TaskStatus.OPEN;
  if (value === "BIDDING") return TaskStatus.BIDDING;
  if (value === "ASSIGNED") return TaskStatus.ASSIGNED;
  if (value === "IN_PROGRESS") return TaskStatus.IN_PROGRESS;
  if (value === "PENDING_CONFIRMATION") return TaskStatus.PENDING_CONFIRMATION;
  if (value === "COMPLETED") return TaskStatus.COMPLETED;
  if (value === "AWAITING_PAYMENT") return TaskStatus.AWAITING_PAYMENT;
  if (value === "PAID") return TaskStatus.PAID;
  if (value === "DISPUTED") return TaskStatus.DISPUTED;
  if (value === "CANCELLED") return TaskStatus.CANCELLED;
  if (value === "EXPIRED") return TaskStatus.EXPIRED;
  return TaskStatus.OPEN;
};

export const formatTaskStatusLabel = (status: TaskStatus | string): string => {
  const normalized = normalizeTaskStatus(status);
  switch (normalized) {
    case "BIDDING":
      return "Bidding";
    case "ASSIGNED":
      return "Assigned";
    case "IN_PROGRESS":
      return "In Progress";
    case "PENDING_CONFIRMATION":
      return "Pending Confirmation";
    case "COMPLETED":
      return "Completed";
    case "AWAITING_PAYMENT":
      return "Awaiting Payment";
    case "PAID":
      return "Paid";
    case "DISPUTED":
      return "Disputed";
    case "CANCELLED":
      return "Cancelled";
    case "EXPIRED":
      return "Expired";
    case "OPEN":
    default:
      return "Open";
  }
};

export const formatCategoryLabel = (category: string): string =>
  category
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    DELIVERY: "\u{1F69A}",
    HOME_REPAIR: "\u{1F527}",
    CLEANING: "\u2728",
    IT_SUPPORT: "\u{1F4BB}",
    PERSONAL_ASSISTANT: "\u{1F464}",
    MOVING: "\u{1F4E6}",
    TUTORING: "\u{1F393}",
    OTHER: "\u2605",
  };

  return icons[String(category).toUpperCase()] || "\u2605";
}

export type StatusVariant = "primary" | "warning" | "success" | "danger" | "neutral";

/**
 * Task status colour, same scheme as web (frontend-web/src/utils/statusColors.ts):
 * red = cancelled/disputed, yellow = pending/awaiting, green = done/paid, blue = open/bidding.
 */
export function getStatusVariant(status: TaskStatus | string): StatusVariant {
  const raw = String(status || "").toUpperCase();
  if (raw === "PENDING") return "warning";
  const normalized = normalizeTaskStatus(status);
  if (normalized === "OPEN" || normalized === "BIDDING") return "primary";
  if (normalized === "PENDING_CONFIRMATION" || normalized === "AWAITING_PAYMENT") {
    return "warning";
  }
  if (normalized === "COMPLETED" || normalized === "PAID") return "success";
  if (normalized === "DISPUTED" || normalized === "CANCELLED") return "danger";
  return "neutral";
}

/** Escrow / payment status colour (yellow while money is pending, green when held or paid). */
export function getMoneyStatusVariant(status?: string | null): StatusVariant {
  const value = String(status || "").toUpperCase();
  if (["PENDING", "PENDING_DEPOSIT", "ESCROW_PENDING", "AWAITING_PAYMENT", "PROCESSING"].includes(value)) return "warning";
  if (["HELD", "ESCROW_HELD", "RELEASED", "SUCCESS", "PAID"].includes(value)) return "success";
  if (["FAILED", "CANCELED", "CANCELLED", "FROZEN"].includes(value)) return "danger";
  return "neutral";
}

/** Plain colours for a variant, for places that are not a <Badge>. */
export function variantColors(variant: StatusVariant): { backgroundColor: string; borderColor: string; color: string } {
  const palette = {
    primary: [colors.primary[50], colors.primary[200], colors.primary[700]],
    success: [colors.success[50], colors.success[200], colors.success[700]],
    warning: [colors.warning[50], colors.warning[200], colors.warning[600]],
    danger: [colors.danger[50], colors.danger[200], colors.danger[700]],
    neutral: [colors.dark[50], colors.dark[200], colors.dark[700]],
  }[variant];
  return { backgroundColor: palette[0], borderColor: palette[1], color: palette[2] };
}

/** Cancelled or expired tasks can only be viewed: no progress tracking or updates. */
export function isViewOnlyTask(status?: string | null): boolean {
  return ["CANCELLED", "EXPIRED"].includes(String(status || "").toUpperCase());
}

export function getDisplayName(user?: User | null): string {
  if (!user) return "Guest Access";
  return user.fullName || user.name || "User";
}

export function getDisplayEmail(user?: User | null): string {
  return user?.email || "Email unavailable";
}

export function isRequester(user?: User | null): boolean {
  const role = String(user?.role || "").toUpperCase();
  return role === "REQUESTER" || role === "CLIENT";
}

export function isProvider(user?: User | null): boolean {
  return String(user?.role || "").toUpperCase() === "PROVIDER";
}

export function isAdmin(user?: User | null): boolean {
  return String(user?.role || "").toUpperCase() === "ADMIN";
}

/** Public task location is "Ward, City"; never a street address. */
export function extractWardLocation(location?: string): string {
  return location?.trim() || "Unknown location";
}

export function getBidCount(task: Task): number {
  return task._count?.bids ?? task.bids?.length ?? 0;
}

export function getTaskDueDate(task: Task): string | undefined {
  return task.dueDate || task.deadline;
}

export function getTaskDisplayBudget(task: Task): number {
  return Number(task.aiSuggestedPrice ?? task.budget ?? 0);
}

export function getSuccessTone(rate: number): "success" | "warning" | "danger" {
  if (rate >= 85) return "success";
  if (rate >= 60) return "warning";
  return "danger";
}

export function getVisiblePages(currentPage: number, totalPages: number): Array<number | "..."> {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 2) {
    return [1, 2, 3, "...", totalPages];
  }

  if (currentPage >= totalPages - 1) {
    return [1, "...", totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "...", currentPage, "...", totalPages];
}

/** Suggested-task distance from the provider (already rounded to 0.5 km by the server). */
export const formatDistance = (km: number): string => {
  if (km >= 100) return `About ${Math.round(km)} km away`;
  return km <= 0.5 ? "Under 1 km away" : `About ${km} km away`;
};
