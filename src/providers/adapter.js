const axios = require('axios');

/**
 * callProvider — dispatch ke provider yang benar
 * Returns: { data, stream } — stream adalah response axios jika stream=true
 */
async function callProvider(provider, body, stream = false) {
  switch (provider.id) {
    case 'anthropic': return callAnthropic(provider, body, stream);
    case 'gemini':    return callGemini(provider, body, stream);
    default:          return callOpenAICompat(provider, body, stream);
  }
}

// ── OpenAI-Compatible ────────────────────────────────────────────
// Covers: OpenRouter, Groq, Cerebras, GitHub Models, NVIDIA NIM,
//         DeepSeek, GLM, Kimi, Together, OpenAI, Qwen
async function callOpenAICompat(provider, body, stream) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.apiKey}`,
  };

  // OpenRouter needs extra headers for rankings/attribution
  if (provider.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/airouter/airouter';
    headers['X-Title'] = 'AIRouter';
  }

  const res = await axios.post(
    `${provider.baseUrl}/chat/completions`,
    { ...body, stream },
    {
      headers,
      timeout: 120_000,
      responseType: stream ? 'stream' : 'json',
      validateStatus: s => s < 600,
    }
  );

  if (!stream && res.data?.error) {
    const err = new Error(res.data.error.message || 'Provider error');
    err.status = res.status;
    throw err;
  }

  return res;
}

// ── Anthropic ────────────────────────────────────────────────────
async function callAnthropic(provider, body, stream) {
  const { messages, model, max_tokens, temperature } = body;

  let systemPrompt = '';
  const filtered = [];
  for (const m of messages) {
    if (m.role === 'system') { systemPrompt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content); }
    else filtered.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }

  const reqBody = {
    model: mapAnthropicModel(model),
    max_tokens: max_tokens || 8192,
    messages: filtered,
    ...(systemPrompt && { system: systemPrompt }),
    ...(temperature !== undefined && { temperature }),
    stream,
  };

  const res = await axios.post(
    `${provider.baseUrl}/v1/messages`,
    reqBody,
    {
      headers: {
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
      responseType: stream ? 'stream' : 'json',
    }
  );

  if (!stream) {
    // Wrap Anthropic response → OpenAI format for consistency downstream
    res.data = anthropicToOpenAI(res.data, model);
  }

  return res;
}

function anthropicToOpenAI(r, model) {
  return {
    id: r.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index:0, message:{ role:'assistant', content: r.content?.[0]?.text || '' }, finish_reason: r.stop_reason === 'end_turn' ? 'stop' : r.stop_reason }],
    usage: { prompt_tokens: r.usage?.input_tokens||0, completion_tokens: r.usage?.output_tokens||0, total_tokens: (r.usage?.input_tokens||0)+(r.usage?.output_tokens||0) },
  };
}

function mapAnthropicModel(m) {
  const map = {
    'claude-opus-4-5':    'claude-opus-4-5-20251101',
    'claude-sonnet-4-5':  'claude-sonnet-4-5-20251022',
    'claude-haiku-4-5':   'claude-haiku-4-5-20251001',
  };
  return map[m] || m;
}

// ── Gemini ───────────────────────────────────────────────────────
async function callGemini(provider, body, stream) {
  const { messages, model, max_tokens, temperature } = body;
  const gemModel = mapGeminiModel(model);

  const contents = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
  }));

  const sys = messages.find(m => m.role === 'system')?.content;
  const reqBody = {
    contents,
    ...(sys && { systemInstruction: { parts: [{ text: sys }] } }),
    generationConfig: { maxOutputTokens: max_tokens || 8192, ...(temperature !== undefined && { temperature }) },
  };

  const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const res = await axios.post(
    `${provider.baseUrl}/v1beta/models/${gemModel}:${action}&key=${provider.apiKey}`,
    reqBody,
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120_000,
      responseType: stream ? 'stream' : 'json',
    }
  );

  if (!stream) {
    res.data = geminiToOpenAI(res.data, model);
  }

  return res;
}

function geminiToOpenAI(r, model) {
  const c = r.candidates?.[0];
  const u = r.usageMetadata || {};
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index:0, message:{ role:'assistant', content: c?.content?.parts?.[0]?.text || '' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: u.promptTokenCount||0, completion_tokens: u.candidatesTokenCount||0, total_tokens: u.totalTokenCount||0 },
  };
}

function mapGeminiModel(m) {
  const map = { 'gemini-2.0-flash':'gemini-2.0-flash', 'gemini-1.5-pro':'gemini-1.5-pro', 'gemini-1.5-flash':'gemini-1.5-flash' };
  return map[m] || 'gemini-2.0-flash';
}

module.exports = { callProvider };
