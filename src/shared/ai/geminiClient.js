const { env } = require('../../config/env');

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const PRIMARY_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODELS = ['gemini-3.6-flash'];
const TRANSIENT_STATUSES = new Set([429, 503]);
const RETRY_DELAYS_MS = [150, 300];
const REQUEST_TIMEOUT_MS = 5500;
const TOTAL_TIMEOUT_MS = 12000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

async function requestModel(model, body, deadline) {
  let lastError;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return { error: lastError || buildError('Gemini request timed out', { providerStatus: 504 }) };
    }

    try {
      const response = await fetch(
        `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': env.GEMINI_API_KEY,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remainingMs)),
        }
      );
      const data = await response.json().catch(() => ({}));

      if (response.ok) return { data, model };

      lastError = buildError(data?.error?.message || response.statusText, {
        providerStatus: response.status,
        providerCode: data?.error?.status,
        model,
      });

      const exhaustedDailyQuota = response.status === 429
        && /quota exceeded|per day limit exceeded/i.test(data?.error?.message || '');

      if (
        !TRANSIENT_STATUSES.has(response.status)
        || exhaustedDailyQuota
        || attempt === RETRY_DELAYS_MS.length
      ) {
        break;
      }

      await wait(Math.min(RETRY_DELAYS_MS[attempt], Math.max(0, deadline - Date.now())));
    } catch (error) {
      lastError = buildError(
        error?.name === 'TimeoutError' ? 'Gemini request timed out' : 'Gemini request failed',
        { providerStatus: 504, model, cause: error }
      );
      break;
    }
  }

  return { error: lastError };
}

async function generateContent(body) {
  if (!env.GEMINI_API_KEY) {
    throw buildError('Gemini is not configured. Missing GEMINI_API_KEY', { statusCode: 500 });
  }

  const models = [...new Set([PRIMARY_MODEL, ...FALLBACK_MODELS, env.GEMINI_MODEL].filter(Boolean))];
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let lastError;

  for (const model of models) {
    const result = await requestModel(model, body, deadline);
    if (result.data) return result;
    lastError = result.error;

    // Authentication and request-format failures are not model-capacity issues.
    if ([400, 401, 403].includes(lastError?.providerStatus)) {
      throw lastError;
    }
  }

  throw lastError || buildError('Gemini is temporarily unavailable', { providerStatus: 503 });
}

module.exports = {
  generateContent,
};
