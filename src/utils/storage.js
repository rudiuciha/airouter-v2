const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DATA_DIR = process.env.DATA_DIR || './data';
const FILES = {
  config:    path.join(DATA_DIR, 'config.json'),
  providers: path.join(DATA_DIR, 'providers.json'),
  stats:     path.join(DATA_DIR, 'stats.json'),
  logs:      path.join(DATA_DIR, 'logs.json'),
  'api-keys': path.join(DATA_DIR, 'api-keys.json'),
  'rate-limits': path.join(DATA_DIR, 'rate-limits.json'),
};

function initData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(FILES.config)) {
    const hash = bcrypt.hashSync(process.env.INITIAL_PASSWORD || 'admin123', 10);
    write('config', {
      passwordHash: hash,
      jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex'),
      settings: {
        rtkEnabled: true,
        cavemanMode: false,
        cavemanLevel: 2,
        autoFallback: true,
        oauthAutoRefresh: true,
        logRequests: true,
        proxyAuthRequired: true,
      },
    });
  } else {
    // Ensure jwtSecret is set
    const config = read('config');
    if (!config.jwtSecret || config.jwtSecret === 'changeme') {
      config.jwtSecret = crypto.randomBytes(32).toString('hex');
      write('config', config);
    }
  }

  if (!fs.existsSync(FILES.providers)) {
    write('providers', buildDefaultProviders());
  } else {
    // Merge env keys into existing providers on startup
    const existing = read('providers') || [];
    const updated = mergeEnvKeys(existing);
    write('providers', updated);
  }

  if (!fs.existsSync(FILES.stats)) {
    write('stats', { totalRequests:0, totalTokensIn:0, totalTokensOut:0, totalSaved:0, costUSD:0, byProvider:{}, hourly:[] });
  }
  if (!fs.existsSync(FILES.logs)) write('logs', []);
  if (!fs.existsSync(FILES['api-keys'])) write('api-keys', []);
  if (!fs.existsSync(FILES['rate-limits'])) write('rate-limits', {});
}

/** Sync env API keys into provider records */
function mergeEnvKeys(providers) {
  const envMap = {
    openrouter: process.env.OPENROUTER_API_KEY,
    gemini:     process.env.GEMINI_API_KEY,
    groq:       process.env.GROQ_API_KEY,
    cerebras:   process.env.CEREBRAS_API_KEY,
    github:     process.env.GITHUB_TOKEN,
    nvidia:     process.env.NVIDIA_API_KEY,
    anthropic:  process.env.ANTHROPIC_API_KEY,
    openai:     process.env.OPENAI_API_KEY,
    deepseek:   process.env.DEEPSEEK_API_KEY,
    glm:        process.env.GLM_API_KEY,
    kimi:       process.env.KIMI_API_KEY,
    together:   process.env.TOGETHER_API_KEY,
    qwen:       process.env.QWEN_API_KEY,
  };
  return providers.map(p => {
    const envKey = envMap[p.id];
    if (envKey && envKey.length > 4) return { ...p, apiKey: envKey };
    return p;
  });
}

function buildDefaultProviders() {
  return [
    // ── TIER 1: Free, quality ──
    {
      id: 'openrouter', name: 'OpenRouter', prefix: 'or', tier: 1,
      enabled: true, free: true,
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY || '',
      models: [
        'deepseek/deepseek-chat-v3-0324:free',
        'deepseek/deepseek-r1:free',
        'meta-llama/llama-3.3-70b-instruct:free',
        'qwen/qwen3-235b-a22b:free',
        'mistralai/mistral-7b-instruct:free',
        'google/gemma-3-27b-it:free',
        'openrouter/auto',
      ],
      defaultModel: 'openrouter/auto',
      priceIn: 0.0, priceOut: 0.0,
      signupUrl: 'https://openrouter.ai',
      notes: 'No credit card. 200 req/day free. 35+ models.',
      rateLimits: { rpm: 20, tpm: 200000 },  // free tier limits
    },
    {
      id: 'gemini', name: 'Gemini (Google)', prefix: 'gm', tier: 1,
      enabled: true, free: true,
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: process.env.GEMINI_API_KEY || '',
      models: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
      defaultModel: 'gemini-2.0-flash',
      priceIn: 0.0, priceOut: 0.0,
      signupUrl: 'https://aistudio.google.com',
      notes: 'No credit card. 1500 req/day free.',
      rateLimits: { rpm: 15, tpm: 1000000 },  // generous free tier
    },
    {
      id: 'groq', name: 'Groq', prefix: 'gq', tier: 1,
      enabled: true, free: true,
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: process.env.GROQ_API_KEY || '',
      models: ['llama-3.3-70b-versatile', 'llama-4-scout-17b-16e-instruct', 'qwen3-32b', 'kimi-k2-instruct', 'deepseek-r1-distill-llama-70b'],
      defaultModel: 'llama-3.3-70b-versatile',
      priceIn: 0.0, priceOut: 0.0,
      signupUrl: 'https://console.groq.com',
      notes: 'No credit card. 30 RPM free. Fastest inference.',
      rateLimits: { rpm: 30, tpm: 131072 },
    },
    {
      id: 'cerebras', name: 'Cerebras', prefix: 'cb', tier: 1,
      enabled: true, free: true,
      baseUrl: 'https://api.cerebras.ai/v1',
      apiKey: process.env.CEREBRAS_API_KEY || '',
      models: ['llama3.1-70b', 'llama3.1-8b', 'qwen-3-32b'],
      defaultModel: 'llama3.1-70b',
      priceIn: 0.0, priceOut: 0.0,
      signupUrl: 'https://cloud.cerebras.ai',
      notes: 'No credit card. 60K tokens/min free.',
      rateLimits: { rpm: 30, tpm: 60000 },
    },
    {
      id: 'github', name: 'GitHub Models', prefix: 'gh', tier: 1,
      enabled: true, free: true,
      baseUrl: 'https://models.inference.ai.azure.com',
      apiKey: process.env.GITHUB_TOKEN || '',
      models: ['gpt-4o', 'gpt-4o-mini', 'Meta-Llama-3.3-70B-Instruct', 'Phi-4', 'mistral-large-2411'],
      defaultModel: 'gpt-4o-mini',
      priceIn: 0.0, priceOut: 0.0,
      signupUrl: 'https://github.com/marketplace/models',
      notes: 'Free for all GitHub users. 45+ models.',
      rateLimits: { rpm: 15, tpm: 150000 },
    },
    {
      id: 'nvidia', name: 'NVIDIA NIM', prefix: 'nv', tier: 1,
      enabled: true, free: true,
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      apiKey: process.env.NVIDIA_API_KEY || '',
      models: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen3-235b-a22b', 'mistralai/mixtral-8x22b-instruct-v0.1'],
      defaultModel: 'meta/llama-3.3-70b-instruct',
      priceIn: 0.0, priceOut: 0.0,
      signupUrl: 'https://build.nvidia.com',
      notes: 'No credit card. 40 RPM, no daily token cap.',
      rateLimits: { rpm: 40, tpm: 80000 },
    },
    // ── TIER 2: Paid but cheap ──
    {
      id: 'anthropic', name: 'Claude (Anthropic)', prefix: 'cc', tier: 2,
      enabled: true, free: false,
      baseUrl: 'https://api.anthropic.com',
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
      defaultModel: 'claude-sonnet-4-5',
      priceIn: 3.0, priceOut: 15.0,
      signupUrl: 'https://console.anthropic.com',
      notes: '$5 free trial on signup.',
      rateLimits: { rpm: 50, tpm: 100000 },
    },
    {
      id: 'deepseek', name: 'DeepSeek', prefix: 'ds', tier: 2,
      enabled: true, free: false,
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      defaultModel: 'deepseek-chat',
      priceIn: 0.014, priceOut: 0.028,
      signupUrl: 'https://platform.deepseek.com',
      notes: '5M free tokens on signup.',
      rateLimits: { rpm: 60, tpm: 100000 },
    },
    {
      id: 'glm', name: 'GLM-4 (Zhipu)', prefix: 'glm', tier: 2,
      enabled: true, free: false,
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: process.env.GLM_API_KEY || '',
      models: ['glm-4-flash', 'glm-4-air', 'glm-4'],
      defaultModel: 'glm-4-flash',
      priceIn: 0.01, priceOut: 0.01,
      signupUrl: 'https://open.bigmodel.cn',
      notes: 'China-based. Very cheap.',
      rateLimits: { rpm: 60, tpm: 100000 },
    },
    {
      id: 'openai', name: 'OpenAI', prefix: 'cx', tier: 2,
      enabled: false, free: false,
      baseUrl: 'https://api.openai.com',
      apiKey: process.env.OPENAI_API_KEY || '',
      models: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
      defaultModel: 'gpt-4o-mini',
      priceIn: 0.15, priceOut: 0.6,
      signupUrl: 'https://platform.openai.com',
      notes: 'No free tier. Use GitHub Models for free GPT.',
      rateLimits: { rpm: 500, tpm: 200000 },
    },
    {
      id: 'kimi', name: 'Kimi (Moonshot)', prefix: 'kr', tier: 3,
      enabled: false, free: false,
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: process.env.KIMI_API_KEY || '',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k'],
      defaultModel: 'moonshot-v1-8k',
      priceIn: 0.012, priceOut: 0.012,
      signupUrl: 'https://platform.moonshot.cn',
      notes: '',
      rateLimits: { rpm: 60, tpm: 100000 },
    },
    {
      id: 'together', name: 'Together AI', prefix: 'ta', tier: 3,
      enabled: false, free: false,
      baseUrl: 'https://api.together.xyz/v1',
      apiKey: process.env.TOGETHER_API_KEY || '',
      models: ['meta-llama/Llama-3-70b-chat-hf', 'mistralai/Mixtral-8x7B-Instruct-v0.1'],
      defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
      priceIn: 0.0009, priceOut: 0.0009,
      signupUrl: 'https://www.together.ai',
      notes: '$100 free signup credit.',
      rateLimits: { rpm: 60, tpm: 100000 },
    },
  ];
}

// ── Rate limit tracking ──────────────────────────────────────────
const _rateBuckets = {}; // { providerId: { minute: timestamp, requests: N, tokens: N } }

function checkRateLimit(provider) {
  const limits = provider.rateLimits;
  if (!limits) return { allowed: true };

  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  const bucket = _rateBuckets[provider.id];

  if (!bucket || bucket.minute !== currentMinute) {
    // New minute window — reset
    _rateBuckets[provider.id] = { minute: currentMinute, requests: 0, tokens: 0 };
    return { allowed: true };
  }

  const rpmExceeded = limits.rpm && bucket.requests >= limits.rpm;
  const tpmExceeded = limits.tpm && bucket.tokens >= limits.tpm;

  if (rpmExceeded || tpmExceeded) {
    const retryAfter = (currentMinute + 1) * 60000 - now;
    return {
      allowed: false,
      reason: rpmExceeded ? 'RPM' : 'TPM',
      retryAfterMs: retryAfter,
      current: { rpm: bucket.requests, tpm: bucket.tokens },
      limit: limits,
    };
  }

  return { allowed: true };
}

function recordRateLimit(providerId, tokensIn, tokensOut) {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  const bucket = _rateBuckets[providerId];

  if (!bucket || bucket.minute !== currentMinute) {
    _rateBuckets[providerId] = { minute: currentMinute, requests: 1, tokens: (tokensIn || 0) + (tokensOut || 0) };
  } else {
    bucket.requests++;
    bucket.tokens += (tokensIn || 0) + (tokensOut || 0);
  }
}

function getRateLimitStatus() {
  const now = Date.now();
  const currentMinute = Math.floor(now / 60000);
  const status = {};

  for (const [id, bucket] of Object.entries(_rateBuckets)) {
    if (bucket.minute === currentMinute) {
      status[id] = { rpm: bucket.requests, tokens: bucket.tokens };
    }
  }
  return status;
}

function read(key) {
  try { return JSON.parse(fs.readFileSync(FILES[key], 'utf8')); } catch { return null; }
}

function write(key, data) {
  const filePath = FILES[key] || path.join(DATA_DIR, `${key}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendLog(entry) {
  const logs = read('logs') || [];
  logs.unshift({ ...entry, ts: new Date().toISOString() });
  if (logs.length > 1000) logs.length = 1000;
  write('logs', logs);
}

function incrementStats(provider, tokensIn, tokensOut, savedTokens, costUSD) {
  const stats = read('stats') || {};
  stats.totalRequests = (stats.totalRequests || 0) + 1;
  stats.totalTokensIn = (stats.totalTokensIn || 0) + tokensIn;
  stats.totalTokensOut = (stats.totalTokensOut || 0) + tokensOut;
  stats.totalSaved = (stats.totalSaved || 0) + savedTokens;
  stats.costUSD = (stats.costUSD || 0) + costUSD;

  if (!stats.byProvider) stats.byProvider = {};
  if (!stats.byProvider[provider]) stats.byProvider[provider] = { requests:0, tokensIn:0, tokensOut:0, cost:0 };
  stats.byProvider[provider].requests++;
  stats.byProvider[provider].tokensIn += tokensIn;
  stats.byProvider[provider].tokensOut += tokensOut;
  stats.byProvider[provider].cost = (stats.byProvider[provider].cost || 0) + costUSD;

  if (!stats.hourly) stats.hourly = [];
  const hour = new Date().toISOString().slice(0, 13);
  const bucket = stats.hourly.find(b => b.hour === hour);
  if (bucket) { bucket.requests++; bucket.tokens += tokensIn + tokensOut; }
  else { stats.hourly.push({ hour, requests:1, tokens: tokensIn + tokensOut }); }
  if (stats.hourly.length > 168) stats.hourly.shift();

  write('stats', stats);
}

// ── API Key management ───────────────────────────────────────────

function generateApiKey(name) {
  const key = `air_${crypto.randomBytes(32).toString('hex')}`;
  const record = {
    id: crypto.randomUUID(),
    name: name || 'Unnamed Key',
    key,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    usageCount: 0,
  };
  const keys = read('api-keys') || [];
  keys.push(record);
  write('api-keys', keys);
  return record;
}

function listApiKeys() {
  const keys = read('api-keys') || [];
  return keys.map(k => ({
    id: k.id,
    name: k.name,
    keyPreview: k.key.slice(0, 7) + '...' + k.key.slice(-4),
    enabled: k.enabled,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    usageCount: k.usageCount || 0,
  }));
}

function deleteApiKey(id) {
  const keys = read('api-keys') || [];
  const filtered = keys.filter(k => k.id !== id);
  write('api-keys', filtered);
  return filtered.length < keys.length;
}

function toggleApiKey(id, enabled) {
  const keys = read('api-keys') || [];
  const key = keys.find(k => k.id === id);
  if (key) {
    key.enabled = enabled;
    write('api-keys', keys);
    return true;
  }
  return false;
}

module.exports = {
  initData, read, write, appendLog, incrementStats, mergeEnvKeys,
  checkRateLimit, recordRateLimit, getRateLimitStatus,
  generateApiKey, listApiKeys, deleteApiKey, toggleApiKey,
};
