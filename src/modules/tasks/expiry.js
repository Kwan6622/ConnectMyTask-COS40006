// Expired tasks: the deadline passed while the task was still open and nobody
// was assigned. They leave every browse list, only the requester sees them, and
// the requester can edit and repost them or delete them for good.
//
// Fairness rule: when the bidding window closed before the deadline, the system
// auto-assigns the best bid (see autoAssignExpiredBiddingTasks), so such a task
// is not expired here. A requester who received bids but let the deadline pass
// without assigning anyone gets one warning.
const taskRepository = require('./repository');
const notificationRepository = require('../notifications/repository');
const warnings = require('../users/warnings');
const { evaluateTaskRisk } = require('./riskEvaluator');
const { buildBudgetSuggestion } = require('../ai-integration/budgetEngine');

const REPOST_DAYS = 5;

function willBeAutoAssigned(task) {
  return task.status === 'BIDDING' && task.biddingEndsAt && task.dueDate
    && new Date(task.biddingEndsAt) <= new Date(task.dueDate);
}

async function notify(recipientId, message, taskId) {
  try {
    await notificationRepository.createNotification({ recipientId, senderId: null, taskId, message });
  } catch {
    // Notifications are best effort.
  }
}

async function expireOverdueOpenTasks({ logActivity, now = new Date() }) {
  const candidates = (await taskRepository.listExpirableTasks(now)).filter((task) => !willBeAutoAssigned(task));
  for (const task of candidates) {
    const claimed = await taskRepository.expireTask(task.id, now);
    if (!claimed) continue;
    const bidCount = task.bids.length;
    await logActivity(task.id, null, 'TASK_EXPIRED', `Deadline passed with ${bidCount} bid(s) and no provider assigned.`, {
      dueDate: task.dueDate,
      bidCount,
    });

    if (bidCount > 0) {
      try {
        await warnings.changeWarnings(task.createdById, {
          change: 1,
          reason: `Task "${task.title}" received ${bidCount} bid(s) but no provider was assigned before the deadline.`,
          taskId: task.id,
          now,
        });
      } catch {
        // e.g. an admin-owned task: still expire it.
      }
      await notify(task.createdById,
        `Your task "${task.title}" expired: ${bidCount} provider(s) bid but nobody was assigned before the deadline, so you received a warning. Open My Tasks to edit and repost it, then assign a provider before the new deadline.`,
        task.id);
      const providers = [...new Set(task.bids.map((bid) => bid.providerId))];
      for (const providerId of providers) {
        await notify(providerId, `Task "${task.title}" expired before the requester assigned anyone. Your bid was closed.`, task.id);
      }
    } else {
      await notify(task.createdById,
        `Your task "${task.title}" expired with no bids. Open My Tasks to edit and repost it (for example raise the budget, give more time or add photos), or delete it.`,
        task.id);
    }
  }
  return candidates.length;
}

// One run at a time; callers await the run already in progress.
let running = null;
function runExpiry(logActivity) {
  if (!running) {
    running = expireOverdueOpenTasks({ logActivity }).catch(() => 0).finally(() => { running = null; });
  }
  return running;
}

/**
 * Tips for reposting, so the task attracts providers this time.
 * Each tip may carry a value the repost form can apply with one click.
 */
function buildRepostSuggestions(task, { bidCount = 0, now = new Date() } = {}) {
  const suggestions = [];
  const budget = Number(task.budget || 0);
  const estimate = buildBudgetSuggestion({
    title: task.title, description: task.description, category: task.category, location: task.location,
  }, null);
  const fairBudget = Number(estimate?.suggestedBudget || 0);
  if (fairBudget > 0 && budget < fairBudget * 0.9) {
    suggestions.push({
      field: 'budget',
      message: `Your budget is below the usual price for this kind of task. Around ${fairBudget.toLocaleString('en-US')} VND attracts more providers.`,
      suggestedValue: fairBudget,
    });
  }

  const risk = evaluateTaskRisk({ category: task.category, budget, title: task.title, description: task.description });
  if (risk.isSuspicious) {
    suggestions.push({ field: 'budget', message: 'The budget is low enough to be flagged for review, which puts providers off. Raise it before reposting.' });
  }

  const created = new Date(task.createdAt || now).getTime();
  const due = new Date(task.dueDate || now).getTime();
  const hoursGiven = Math.max(0, Math.round((due - created) / 3600000));
  const newDue = new Date(now.getTime() + REPOST_DAYS * 24 * 3600000);
  suggestions.push({
    field: 'dueDate',
    message: hoursGiven < 48
      ? `Providers only had about ${hoursGiven} hours last time. Give them at least ${REPOST_DAYS} days.`
      : `Set a new deadline; ${REPOST_DAYS} days from now gives providers time to bid.`,
    suggestedValue: newDue.toISOString(),
  });

  if (String(task.description || '').trim().length < 80) {
    suggestions.push({ field: 'description', message: 'Add more detail: size of the job, materials, access, and the best time to come.' });
  }
  if (String(task.title || '').trim().length < 15) {
    suggestions.push({ field: 'title', message: 'Make the title specific, e.g. "Fix leaking kitchen tap" instead of "Repair".' });
  }
  if (!Array.isArray(task.imageUrls) || task.imageUrls.length === 0) {
    suggestions.push({ field: 'imageUrls', message: 'Add up to 3 photos. Providers bid more often when they can see the job.' });
  }
  if (Number(task.maxBids || 0) > 0 && Number(task.maxBids) < 5) {
    suggestions.push({ field: 'maxBids', message: 'Allow more bids (10 or more) so you get more choice.', suggestedValue: 10 });
  }
  if (bidCount > 0) {
    suggestions.push({
      field: 'assign',
      message: `You had ${bidCount} bid(s) last time. Pick a provider before the new deadline, or you will receive another warning.`,
    });
  }
  return suggestions;
}

module.exports = { runExpiry, expireOverdueOpenTasks, buildRepostSuggestions, willBeAutoAssigned, REPOST_DAYS };
