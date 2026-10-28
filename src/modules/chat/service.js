const { generateContent } = require('../../shared/ai/geminiClient');

const CONNECTMYTASK_SYSTEM_PROMPT =
  'You are the ConnectMyTask AI Assistant. You help users understand and use the ConnectMyTask platform, including task posting, bidding, requester/provider workflows, task progress, saved tasks, notifications, and payment flow. Keep answers concise, friendly, helpful, and complete. Usually answer in fewer than 250 words. If a question is outside the platform domain, politely say that you can only help with ConnectMyTask-related support.';

function toGeminiContents(payload) {
  const safeHistory = Array.isArray(payload.history) ? payload.history : [];

  // Keep only the latest turns to keep latency/cost stable.
  const recentHistory = safeHistory.slice(-10);

  return [
    ...recentHistory.map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    })),
    {
      role: 'user',
      parts: [{ text: payload.message }],
    },
  ];
}

async function requestAssistantReply(contents) {
  let data;
  try {
    ({ data } = await generateContent({
        systemInstruction: {
          parts: [{ text: CONNECTMYTASK_SYSTEM_PROMPT }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: 1200,
        },
      }));
  } catch (providerError) {
    // eslint-disable-next-line no-console
    console.warn('[chat] Gemini request failed:', providerError.message);
    const err = new Error('AI assistant is temporarily unavailable. Please try again shortly.');
    err.statusCode = [429, 503, 504].includes(providerError.providerStatus) ? 503 : 502;
    throw err;
  }

  const parts = Array.isArray(data?.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts
    : [];
  const finishReason = data?.candidates?.[0]?.finishReason;

  if (finishReason === 'MAX_TOKENS') {
    const err = new Error('AI assistant could not complete the response. Please try again.');
    err.statusCode = 503;
    throw err;
  }
  const reply = parts
    .map((part) => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  if (!reply) {
    const err = new Error('Gemini returned an empty response');
    err.statusCode = 502;
    throw err;
  }

  return reply;
}

async function sendChat(payload) {
  const contents = toGeminiContents(payload);
  const reply = await requestAssistantReply(contents);

  return {
    reply,
  };
}

module.exports = {
  sendChat,
};
