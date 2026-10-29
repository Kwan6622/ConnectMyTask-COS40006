const assert = require('node:assert/strict');
const test = require('node:test');

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODEL = 'gemini-flash-latest';

const { sendChat } = require('./service');

test('chat sends the Gemini key in a header instead of the request URL', async () => {
  const originalFetch = global.fetch;
  let requestUrl;
  let requestOptions;

  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'pong' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await sendChat({ message: 'ping', history: [] });
    assert.equal(result.reply, 'pong');
    assert.match(requestUrl, /models\/gemini-flash-latest:generateContent$/);
    assert.equal(new URL(requestUrl).searchParams.has('key'), false);
    assert.equal(requestOptions.headers['x-goog-api-key'], 'test-key');
    assert.equal(requestOptions.body.includes('"temperature"'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat retries transient failures and falls back to a supported model', async () => {
  const originalFetch = global.fetch;
  const requestUrls = [];

  global.fetch = async (url) => {
    requestUrls.push(String(url));
    if (String(url).includes('/gemini-flash-latest:')) {
      return new Response(JSON.stringify({
        error: { code: 503, status: 'UNAVAILABLE', message: 'High demand' },
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'fallback reply' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await sendChat({ message: 'ping', history: [] });
    assert.equal(result.reply, 'fallback reply');
    assert.equal(requestUrls.filter((url) => url.includes('/gemini-flash-latest:')).length, 3);
    assert.match(requestUrls.at(-1), /models\/gemini-2\.5-flash:generateContent$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat does not retry a daily quota error before trying the fallback model', async () => {
  const originalFetch = global.fetch;
  const requestUrls = [];

  global.fetch = async (url) => {
    requestUrls.push(String(url));
    if (String(url).includes('/gemini-flash-latest:')) {
      return new Response(JSON.stringify({
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          message: 'Quota exceeded: per day limit exceeded',
        },
      }), { status: 429, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'fallback reply' }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await sendChat({ message: 'ping', history: [] });
    assert.equal(result.reply, 'fallback reply');
    assert.equal(requestUrls.filter((url) => url.includes('/gemini-flash-latest:')).length, 1);
    assert.match(requestUrls.at(-1), /models\/gemini-2\.5-flash:generateContent$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat rejects a truncated Gemini response instead of displaying partial text', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => new Response(JSON.stringify({
    candidates: [{
      finishReason: 'MAX_TOKENS',
      content: { parts: [{ text: 'This answer stops' }] },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => sendChat({ message: 'ping', history: [] }),
      (error) => error.statusCode === 503
        && error.message === 'AI assistant could not complete the response. Please try again.'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('chat returns a friendly 503 after bounded transient retries are exhausted', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;

  global.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      error: { code: 503, status: 'UNAVAILABLE', message: 'High demand' },
    }), { status: 503, headers: { 'content-type': 'application/json' } });
  };

  try {
    await assert.rejects(
      () => sendChat({ message: 'ping', history: [] }),
      (error) => error.statusCode === 503
        && error.message === 'AI assistant is temporarily unavailable. Please try again shortly.'
    );
    assert.equal(requestCount, 9);
  } finally {
    global.fetch = originalFetch;
  }
});
