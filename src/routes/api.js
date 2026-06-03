const express = require('express');
const { read, write, getRateLimitStatus, generateApiKey, listApiKeys, deleteApiKey, toggleApiKey } = require('../utils/storage');
const { callProvider } = require('../providers/adapter');

const router = express.Router();

// ── Status ──────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const providers = read('providers') || [];
  const stats     = read('stats')     || {};
  const rlStatus  = getRateLimitStatus();
  res.json({
    running: true,
    port:    process.env.PORT || 20130,
    version: '2.0.0',
    providers: {
      total:   providers.length,
      enabled: providers.filter(p => p.enabled && p.apiKey && p.apiKey.length > 4).length,
      free:    providers.filter(p => p.free && p.enabled && p.apiKey?.length > 4).length,
    },
    stats: { totalRequests: stats.totalRequests||0, totalTokens: (stats.totalTokensIn||0)+(stats.totalTokensOut||0) },
    rateLimits: rlStatus,
  });
});

// ── Settings ─────────────────────────────────────────────────────
router.get('/settings', (req, res) => res.json(read('config')?.settings || {}));
router.put('/settings', (req, res) => {
  const config = read('config');
  config.settings = { ...(config.settings||{}), ...req.body };
  write('config', config);
  res.json({ ok:true, settings: config.settings });
});

// ── Stats ────────────────────────────────────────────────────────
router.get('/stats', (req, res) => res.json(read('stats') || {}));
router.get('/stats/logs', (req, res) => {
  const logs  = read('logs') || [];
  const limit = Math.min(parseInt(req.query.limit)||100, 500);
  res.json(logs.slice(0, limit));
});

router.get('/usage/providers', (req, res) => {
  const providers = read('providers') || [];
  res.json({ providers: providers.map(p => ({ id: p.id, name: p.name })) });
});

router.get('/usage/request-details', (req, res) => {
  const logs = read('logs') || [];
  const page = Math.max(parseInt(req.query.page)||1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize)||20, 1), 100);
  const provider = (req.query.provider || '').trim();
  const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
  const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

  let rows = logs
    .filter(l => l.provider || l.model || l.tokensIn || l.tokensOut || l.latencyMs)
    .map((l, idx) => ({
      id: String(idx + 1),
      timestamp: l.ts || new Date().toISOString(),
      provider: l.provider || 'system',
      model: l.model || l.tag || 'unknown',
      status: l.level === 'err' ? 'error' : 'success',
      tokens: {
        prompt_tokens: l.tokensIn || 0,
        completion_tokens: l.tokensOut || 0,
      },
      latency: {
        ttft: l.latencyMs || 0,
        total: l.latencyMs || 0,
      },
      request: {
        tag: l.tag || '',
        message: l.msg || '',
      },
      response: {
        content: l.msg || '',
      },
    }));

  if (provider) rows = rows.filter(r => r.provider === provider);
  if (startDate && !isNaN(startDate)) rows = rows.filter(r => new Date(r.timestamp) >= startDate);
  if (endDate && !isNaN(endDate)) rows = rows.filter(r => new Date(r.timestamp) <= endDate);

  const totalItems = rows.length;
  const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
  const start = (page - 1) * pageSize;
  const details = rows.slice(start, start + pageSize);

  res.json({
    details,
    pagination: { page, pageSize, totalItems, totalPages }
  });
});

// ── Providers ────────────────────────────────────────────────────
router.get('/providers', (req, res) => {
  const providers = read('providers') || [];
  res.json(providers.map(p => ({
    ...p,
    apiKey: p.apiKey ? p.apiKey.slice(0,6) + '...' + p.apiKey.slice(-4) : '',
    hasKey: !!(p.apiKey && p.apiKey.length > 4),
  })));
});

router.put('/providers/:id', (req, res) => {
  const providers = read('providers') || [];
  const idx = providers.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error:'Not found' });
  const allowed = ['enabled','apiKey','tier','defaultModel','quotaTokens','rateLimits'];
  const update = {};
  for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];
  providers[idx] = { ...providers[idx], ...update };
  write('providers', providers);
  res.json({ ok:true });
});

router.post('/providers/:id/test', async (req, res) => {
  const providers = read('providers') || [];
  const provider  = providers.find(p => p.id === req.params.id);
  if (!provider)           return res.status(404).json({ error:'Not found' });
  if (!provider.apiKey)    return res.status(400).json({ error:'No API key' });
  try {
    const r = await callProvider(provider, {
      model: provider.defaultModel,
      messages: [{ role:'user', content:'Reply with exactly: OK' }],
      max_tokens: 20,
    }, false);
    const reply = r.data?.choices?.[0]?.message?.content || '?';
    res.json({ ok:true, message:`Connected — "${reply.slice(0,50)}"` });
  } catch (err) {
    res.status(400).json({ ok:false, message: err.response?.data?.error?.message || err.message });
  }
});

// ── API Keys ────────────────────────────────────────────────────
router.get('/api-keys', (req, res) => {
  res.json(listApiKeys());
});

router.post('/api-keys', (req, res) => {
  const { name } = req.body;
  if (!name || name.length < 1) {
    return res.status(400).json({ error:'Name required' });
  }
  const record = generateApiKey(name);
  res.json({
    id: record.id,
    name: record.name,
    key: record.key,  // Only shown on creation!
    keyPreview: record.key.slice(0, 7) + '...' + record.key.slice(-4),
    createdAt: record.createdAt,
  });
});

router.delete('/api-keys/:id', (req, res) => {
  if (deleteApiKey(req.params.id)) {
    res.json({ ok:true });
  } else {
    res.status(404).json({ error:'Not found' });
  }
});

router.put('/api-keys/:id', (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled === 'boolean' && toggleApiKey(req.params.id, enabled)) {
    res.json({ ok:true });
  } else {
    res.status(404).json({ error:'Not found' });
  }
});

// ── Free providers list (public — for onboarding) ─────────────────
router.get('/free-providers', (req, res) => {
  const providers = read('providers') || [];
  res.json(providers.filter(p => p.free).map(p => ({
    id: p.id, name: p.name, signupUrl: p.signupUrl, notes: p.notes, hasKey: !!(p.apiKey?.length > 4),
  })));
});

module.exports = router;
