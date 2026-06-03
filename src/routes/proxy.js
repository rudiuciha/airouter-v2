const express = require('express');
const { routeRequest } = require('../providers/router');
const { read, getRateLimitStatus } = require('../utils/storage');
const { proxyAuth } = require('../middleware/proxy-auth');

const router = express.Router();

// ── Health check (no auth) ───────────────────────────────────────
router.get('/health', (_req, res) => {
  const providers = read('providers') || [];
  const enabled = providers.filter(p => p.enabled && p.apiKey && p.apiKey.length > 4);
  const rlStatus = getRateLimitStatus();

  res.json({
    status: 'ok',
    version: '2.0.0',
    uptime: Math.floor(process.uptime()),
    providers: {
      total: providers.length,
      enabled: enabled.length,
      active: enabled.filter(p => !rlStatus[p.id]).length, // not rate-limited
    },
    rateLimits: rlStatus,
  });
});

// ── GET /v1/models (no auth — for tool discovery) ────────────────
router.get('/models', (req, res) => {
  const providers = read('providers') || [];
  const models = [];
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models || []) {
      models.push({ id:`${p.prefix}/${m}`, object:'model', created:1700000000, owned_by:p.id, provider:p.name, tier:p.tier, free:p.free||false });
    }
  }
  res.json({ object:'list', data: models });
});

// ── POST /v1/chat/completions (auth required) ───────────────────
router.post('/chat/completions', proxyAuth, async (req, res) => {
  const body   = req.body;
  const model  = body.model || 'auto';
  const stream = body.stream === true;

  try {
    const { res: provRes, provider, model: resolvedModel, savedChars } = await routeRequest(model, body, stream);

    // ── Non-streaming ────────────────────────────────────────────
    if (!stream) {
      res.setHeader('X-AIRouter-Provider', provider.id);
      res.setHeader('X-AIRouter-Model',    resolvedModel);
      res.setHeader('X-AIRouter-RTK',      savedChars);
      if (req.apiKey) {
        res.setHeader('X-AIRouter-Key', req.apiKey.name);
      }
      return res.json(provRes.data);
    }

    // ── Streaming SSE ────────────────────────────────────────────
    res.setHeader('Content-Type',          'text/event-stream');
    res.setHeader('Cache-Control',         'no-cache');
    res.setHeader('Connection',            'keep-alive');
    res.setHeader('X-AIRouter-Provider',   provider.id);
    res.setHeader('X-AIRouter-Model',      resolvedModel);
    res.setHeader('X-AIRouter-RTK',        savedChars);
    if (req.apiKey) {
      res.setHeader('X-AIRouter-Key', req.apiKey.name);
    }
    res.flushHeaders();

    const upstream = provRes.data; // readable stream

    // Gemini SSE format — wrap into OpenAI-compatible SSE
    if (provider.id === 'gemini') {
      let buffer = '';
      upstream.on('data', chunk => {
        buffer += chunk.toString();
        // Gemini sends multiple JSON objects per chunk, split by newlines
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          // Extract the JSON data from Gemini's "data: {...}" format
          const jsonMatch = line.match(/data:\s*(\{.*\})/);
          if (jsonMatch) {
            try {
              const geminiData = JSON.parse(jsonMatch[1]);
              const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                const openaiChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: resolvedModel,
                  choices: [{
                    index: 0,
                    delta: { content: text },
                    finish_reason: geminiData.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : null,
                  }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              }
            } catch {
              // Pass through raw if parsing fails
              res.write(line + '\n\n');
            }
          }
        }
      });
      upstream.on('end', () => {
        // Flush remaining buffer
        if (buffer.trim()) {
          const jsonMatch = buffer.match(/data:\s*(\{.*\})/);
          if (jsonMatch) {
            try {
              const geminiData = JSON.parse(jsonMatch[1]);
              const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                const openaiChunk = {
                  id: `chatcmpl-${Date.now()}`,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: resolvedModel,
                  choices: [{
                    index: 0,
                    delta: { content: text },
                    finish_reason: 'stop',
                  }],
                };
                res.write(`data: ${JSON.stringify(openaiChunk)}\n\n`);
              }
            } catch {}
          }
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    } else {
      // OpenAI-compatible stream — pass through
      upstream.pipe(res);
      upstream.on('end',   () => { res.write('data: [DONE]\n\n'); res.end(); });
    }

    upstream.on('error', err => {
      console.error('Stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error:{ message:err.message } })}\n\n`);
      res.end();
    });

    req.on('close', () => upstream.destroy());

  } catch (err) {
    console.error('Proxy error:', err.message);
    const status = err.response?.status || err.status || 500;
    if (!res.headersSent) {
      res.status(status).json({ error:{ message: err.response?.data?.error?.message || err.message, type:'routing_error', code: status } });
    }
  }
});

// ── POST /v1/embeddings (auth required) ─────────────────────────
router.post('/embeddings', proxyAuth, async (req, res) => {
  try {
    const { res: r } = await routeRequest(req.body.model||'auto', req.body, false);
    res.json(r.data);
  } catch (err) {
    res.status(500).json({ error:{ message: err.message } });
  }
});

module.exports = router;
