const { env } = require('../../config/env');
const chatRepository = require('./repository');

const CONNECTMYTASK_SYSTEM_PROMPT = `
You are the ConnectMyTask AI Assistant.
You help users understand and use the ConnectMyTask platform, including task posting, bidding, requester/provider workflows, task progress, saved tasks, notifications, and payment flow.
Keep answers concise, friendly, and helpful.

Privacy and access rules:
- You may use ONLY the CURRENT AUTHENTICATED USER CONTEXT provided by the server.
- Never claim to access, estimate, compare, reveal, or discuss private information about any other user.
- If the user asks about another person's account, tasks, money, profile, or activity, refuse briefly and explain you can only help with their own account data.
- If the answer is not present in the provided current-user context, say you do not have that information.
- Do not invent counts, balances, names, or statuses.
- Treat requester and provider data as scoped only to the authenticated user.
`.trim();

const COMPLETED_TASK_STATUSES = ['COMPLETED', 'PAID'];
const PENDING_TASK_STATUSES = ['PENDING', 'OPEN', 'BIDDING', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'AWAITING_PAYMENT', 'DISPUTED'];

function toGeminiInput(payload) {
  const safeHistory = Array.isArray(payload.history) ? payload.history : [];

  // Keep only the latest turns to keep latency/cost stable.
  const recentHistory = safeHistory.slice(-12);

  const msg = String(payload.message || '').trim();
  const turns = recentHistory.map((item) => {
    const role = item.role === 'assistant' ? 'Assistant' : 'User';
    return `${role}: ${String(item.content || '').trim()}`;
  });

  const last = recentHistory[recentHistory.length - 1];
  if (msg && !(last?.role === 'user' && String(last.content || '').trim() === msg)) {
    turns.push(`User: ${msg}`);
  }

  return turns.join('\n\n') || msg;
}

function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

function sumGroupedStatuses(groups, statuses) {
  return (Array.isArray(groups) ? groups : [])
    .filter((item) => statuses.includes(String(item.status || '').toUpperCase()))
    .reduce((total, item) => total + Number(item?._count?._all || 0), 0);
}

function groupsToMap(groups) {
  const map = {};
  for (const item of Array.isArray(groups) ? groups : []) {
    map[String(item.status || '').toUpperCase()] = Number(item?._count?._all || 0);
  }
  return map;
}

function toMoney(value) {
  return Number(value || 0);
}

function formatTaskSnapshot(task) {
  if (!task) return null;
  const description = String(task.description || '').trim();
  return {
    id: task.id,
    title: task.title,
    description: description ? description.slice(0, 1200) : null,
    status: task.status,
    budget: toMoney(task.budget),
    escrowAmount: toMoney(task.escrowAmount ?? task.budget),
    dueDate: task.dueDate,
    updatedAt: task.updatedAt,
  };
}

function summarizeTaskSnapshots(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map(formatTaskSnapshot)
    .filter(Boolean)
    .slice(0, 4);
}

function buildCurrentUserContext(rawContext) {
  const user = rawContext?.user;
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  const role = normalizeRole(user.role);
  const requesterStatusCounts = groupsToMap(rawContext.requesterTaskCounts);
  const providerStatusCounts = groupsToMap(rawContext.providerTaskCounts);
  const requesterPostedTotal = Object.values(requesterStatusCounts).reduce((sum, count) => sum + count, 0);
  const providerAssignedTotal = Object.values(providerStatusCounts).reduce((sum, count) => sum + count, 0);

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
    },
    roleCapabilities: {
      isRequester: role === 'REQUESTER' || role === 'CLIENT',
      isProvider: role === 'PROVIDER',
      isAdmin: role === 'ADMIN',
    },
    requesterStats: {
      tasksPostedTotal: requesterPostedTotal,
      completedTasks: sumGroupedStatuses(rawContext.requesterTaskCounts, COMPLETED_TASK_STATUSES),
      pendingTasks: sumGroupedStatuses(rawContext.requesterTaskCounts, PENDING_TASK_STATUSES),
      cancelledTasks: Number(requesterStatusCounts.CANCELLED || 0),
      byStatus: requesterStatusCounts,
    },
    providerStats: {
      assignedTasksTotal: providerAssignedTotal,
      completedTasks: sumGroupedStatuses(rawContext.providerTaskCounts, COMPLETED_TASK_STATUSES),
      pendingTasks: sumGroupedStatuses(rawContext.providerTaskCounts, PENDING_TASK_STATUSES),
      cancelledTasks: Number(providerStatusCounts.CANCELLED || 0),
      byStatus: providerStatusCounts,
    },
    accountStats: {
      savedTasks: Number(rawContext.savedTasksCount || 0),
      notificationsTotal: Number(rawContext.totalNotificationsCount || 0),
      unreadNotifications: Number(rawContext.unreadNotificationsCount || 0),
    },
    taskDatesAndBudgets: {
      recentRequesterTasks: summarizeTaskSnapshots(rawContext.recentRequesterTasks),
      recentProviderTasks: summarizeTaskSnapshots(rawContext.recentProviderTasks),
      requesterBudgetOutstanding: {
        totalBudget: toMoney(rawContext?.requesterBudgetAggregates?._sum?.budget),
        escrowAmount: toMoney(rawContext?.requesterBudgetAggregates?._sum?.escrowAmount),
      },
      providerWorkInProgressValue: {
        totalBudget: toMoney(rawContext?.providerBudgetAggregates?._sum?.budget),
        escrowAmount: toMoney(rawContext?.providerBudgetAggregates?._sum?.escrowAmount),
      },
    },
    paymentStats: {
      asPayer: {
        transactions: Number(rawContext?.payerPayments?._count?._all || 0),
        totalAmount: toMoney(rawContext?.payerPayments?._sum?.totalAmount ?? rawContext?.payerPayments?._sum?.amount),
        escrowHeldAmount: toMoney(rawContext?.payerPayments?._sum?.escrowHeldAmount),
        platformFeeAmount: toMoney(rawContext?.payerPayments?._sum?.platformFeeAmount),
      },
      asProvider: {
        transactions: Number(rawContext?.providerPayments?._count?._all || 0),
        grossAmount: toMoney(rawContext?.providerPayments?._sum?.amount),
        payoutAmount: toMoney(rawContext?.providerPayments?._sum?.providerPayoutAmount),
      },
    },
  };
}

function buildScopedSystemPrompt(currentUserContext) {
  return `${CONNECTMYTASK_SYSTEM_PROMPT}

CURRENT AUTHENTICATED USER CONTEXT:
\`\`\`json
${JSON.stringify(currentUserContext, null, 2)}
\`\`\`

Important interpretation note:
- This app context may include task budgets, escrow amounts, payment totals, and task dates for the authenticated user.
- Unless the context explicitly contains a true account balance, do not describe any value as a wallet balance.
- If the user asks about "budget left", answer using their own outstanding task budgets / escrow-related amounts from the context and explain what that number represents.

Answer using only this authenticated user's context and general ConnectMyTask product knowledge.`;
}

function asksAboutAnotherUser(message) {
  const text = String(message || '').toLowerCase();
  const patterns = [
    /\banother user\b/,
    /\bother user\b/,
    /\bother people\b/,
    /\bsomeone else\b/,
    /\buser(?:name)?\s+[a-z0-9_.-]+\b/,
    /\bprovider\s+[a-z0-9_.-]+\b/,
    /\brequester\s+[a-z0-9_.-]+\b/,
    /\btheir account\b/,
    /\bhis account\b/,
    /\bher account\b/,
  ];

  return patterns.some((pattern) => pattern.test(text));
}

async function requestAssistantReply(systemPrompt, input) {
  if (!env.GEMINI_API_KEY) {
    const err = new Error('Gemini is not configured. Missing GEMINI_API_KEY');
    err.statusCode = 500;
    throw err;
  }

  const fallbackModels = String(env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash')
    .split(',')
    .map((item) => item.trim())
    .filter((model) => model && !model.startsWith('gemini-1.5'));
  const modelsToTry = [env.GEMINI_MODEL, ...fallbackModels.filter((model) => model !== env.GEMINI_MODEL)];
  let lastProviderMessage = '';
  let lastStatus = 0;
  const requestDeadline = Date.now() + 65000;

  for (const model of modelsToTry) {
    const remainingMs = requestDeadline - Date.now();
    if (remainingMs <= 0) {
      lastProviderMessage = 'Gemini request time budget expired';
      lastStatus = 504;
      break;
    }

    let response;
    try {
      response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/interactions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            model,
            input,
            system_instruction: systemPrompt,
            generation_config: {
              temperature: 0.4,
              max_output_tokens: 512,
              thinking_level: 'low',
            },
            store: false,
          }),
          signal: AbortSignal.timeout(Math.min(50000, remainingMs)),
        }
      );
    } catch (error) {
      lastProviderMessage = error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? 'Gemini request timed out'
        : String(error?.message || 'Gemini network request failed');
      lastStatus = 504;
      // eslint-disable-next-line no-console
      console.warn(`[chat] Gemini request failed (model=${model}): ${lastProviderMessage}`);
      continue;
    }

    const data = await response.json().catch(() => ({}));
    const status = String(data?.status || '').trim().toLowerCase();
    if (response.ok) {
      const reply = (Array.isArray(data?.steps) ? data.steps : [])
        .filter((step) => step?.type === 'model_output')
        .flatMap((step) => (Array.isArray(step.content) ? step.content : []))
        .filter((content) => content?.type === 'text')
        .map((content) => String(content.text || '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();

      if (status && status !== 'completed') {
        lastProviderMessage = `Gemini returned an incomplete response (status=${status})`;
        lastStatus = 502;
        // eslint-disable-next-line no-console
        console.warn(`[chat] Gemini response was incomplete (model=${model}, status=${status})`);
        continue;
      }

      if (!reply) {
        const err = new Error('Gemini returned an empty response');
        err.statusCode = 502;
        throw err;
      }

      return reply;
    }

    const providerMessage = String(data?.error?.message || response.statusText || '').trim();
    const lower = providerMessage.toLowerCase();
    const isDemandError =
      response.status === 429 ||
      response.status === 503 ||
      lower.includes('quota') ||
      lower.includes('rate limit') ||
      lower.includes('resource exhausted') ||
      lower.includes('high demand');

    lastProviderMessage = providerMessage;
    lastStatus = response.status;
    // eslint-disable-next-line no-console
    console.warn(
      `[chat] Gemini request failed (model=${model}, status=${response.status}):`,
      providerMessage
    );

    if (!isDemandError) {
      break;
    }
  }

  let message = 'AI assistant is temporarily unavailable. Please try again shortly.';
  const lower = String(lastProviderMessage || '').toLowerCase();
  if (lastStatus === 429 && (lower.includes('per day') || lower.includes('daily limit') || lower.includes('daily quota'))) {
    message = 'The Gemini daily request limit has been reached for the available models. Please try again after the quota resets or use a model with available quota.';
  } else if (
    lastStatus === 429 ||
    lastStatus === 503 ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource exhausted') ||
    lower.includes('high demand')
  ) {
    message = 'The AI service is temporarily busy due to Gemini usage limits or high demand. Please try again in a moment.';
  } else if (lastStatus === 504) {
    message = 'Gemini took too long to respond. Please try again shortly.';
  } else if (lower.includes('api key') || lower.includes('permission') || lower.includes('access not configured')) {
    message = 'The AI assistant is not configured correctly right now. Please check the Gemini API key and model access.';
  } else if (lower.includes('token') || lower.includes('too large') || lower.includes('payload')) {
    message = 'The AI request was too large to process. I reduced the chat context, but please try a shorter question or clear old chat messages.';
  } else if (lastProviderMessage) {
    message = `AI assistant error: ${lastProviderMessage}`;
  }

  const err = new Error(message);
  err.statusCode = 502;
  throw err;
}

async function sendChat(payload, currentUser) {
  if (asksAboutAnotherUser(payload.message)) {
    return {
      reply:
        'I can only help with the account and activity of the currently signed-in user. I cannot access or share private information about other users.',
    };
  }

  let rawContext;
  try {
    rawContext = await chatRepository.getChatUserContext(currentUser.id);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    const databaseFailure =
      error?.code === 'P1001' ||
      error?.code === 'P1002' ||
      error?.code === 'P1008' ||
      error?.code === 'P1017' ||
      error?.code === 'P2024' ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ECONNRESET' ||
      error?.code === 'ETIMEDOUT' ||
      message.includes('timed out') ||
      message.includes('timeout') ||
      message.includes('can\'t reach database server') ||
      message.includes('database connection') ||
      message.includes('connection refused') ||
      message.includes('connection reset');

    if (databaseFailure) {
      const err = new Error('The database is temporarily unavailable. Please try again shortly.');
      err.statusCode = 503;
      throw err;
    }

    throw error;
  }

  const currentUserContext = buildCurrentUserContext(rawContext);
  const systemPrompt = buildScopedSystemPrompt(currentUserContext);
  const input = toGeminiInput(payload);
  const reply = await requestAssistantReply(systemPrompt, input);

  const safeHistory = Array.isArray(payload.history) ? payload.history : [];
  const currentMessage = String(payload.message || '').trim();
  let currentTurnStart = -1;
  for (let index = safeHistory.length - 1; index >= 0; index -= 1) {
    const item = safeHistory[index];
    if (item?.role === 'user' && String(item.content || '').trim() === currentMessage) {
      currentTurnStart = index;
      break;
    }
  }

  const currentTurn = currentTurnStart >= 0
    ? safeHistory.slice(currentTurnStart)
    : [{ role: 'user', content: currentMessage }];
  const persistedTurn = currentTurn
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map((item) => ({ role: item.role, content: item.content }));
  persistedTurn.push({ role: 'assistant', content: reply });

  await chatRepository.appendChatMessagesForUser(currentUser.id, persistedTurn);

  return {
    reply,
  };
}

async function getChatHistory(userId) {
  return chatRepository.getChatHistoryForUser(userId);
}

async function clearChatHistory(userId) {
  await chatRepository.clearChatHistoryForUser(userId);
}

module.exports = {
  sendChat,
  getChatHistory,
  clearChatHistory,
};
