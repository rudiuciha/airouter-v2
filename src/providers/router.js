const { read, appendLog, incrementStats, checkRateLimit, recordRateLimit } = require('../utils/storage');
const { rtkCompress } = require('../utils/rtk');
const { callProvider } = require('./adapter');

/**
 * routeRequest
 * - Resolves provider from model prefix (e.g. "or/deepseek-chat:free")
 * - Applies RTK compression
 * - Checks rate limits before trying each provider
 * - Tries providers in fallback order
 * - Returns { res (axios response), provider, model, savedChars }
 */
async function routeRequest(requestedModel, body, stream = false) {
  const config = read('config') || {};
  const providers = read('providers') || [];

  // RTK compression
  let savedChars = 0;
  if (config.settings?.rtkEnabled !== false) {
    const result = rtkCompress(body.messages);
    body = { ...body, messages: result.messages };
    savedChars = result.savedChars;
    if (result.savedChars > 0 && result.hits.length) {
      appendLog({ level:'info', tag:'RTK', msg:`Compressed ${result.hits.length} block(s) — saved ~${Math.round(result.savedChars/4)} tokens` });
    }
  }

  // Caveman mode
  if (config.settings?.cavemanMode) {
    body = injectCavemanPrompt(body, config.settings.cavemanLevel || 2);
  }

  // Resolve model prefix → provider
  const { provider: preferred, modelName } = resolveModel(requestedModel, providers);

  // Build fallback chain
  const chain = buildChain(providers, preferred);

  if (!chain.length) {
    throw Object.assign(new Error('No providers configured. Add at least one API key in the dashboard.'), { status: 503 });
  }

  let lastError = null;
  const attempted = new Set();

  for (const provider of chain) {
    const model = (preferred && provider.id === preferred.id ? modelName : null) || provider.defaultModel;

    // Skip if already attempted
    if (attempted.has(provider.id)) continue;
    attempted.add(provider.id);

    // Check rate limit BEFORE trying
    const rlCheck = checkRateLimit(provider);
    if (!rlCheck.allowed) {
      appendLog({
        level: 'warn',
        tag: 'RATE_LIMIT',
        provider: provider.id,
        msg: `${provider.name} skipped — ${rlCheck.reason} limit reached (${rlCheck.current.rpm || 0}/${rlCheck.limit.rpm || '?'} rpm)`,
      });
      continue; // Skip to next provider
    }

    const start = Date.now();
    try {
      const res = await callProvider(provider, { ...body, model }, stream);
      const latency = Date.now() - start;

      // Count tokens
      let tokensIn = 0, tokensOut = 0;
      if (!stream && res.data?.usage) {
        tokensIn  = res.data.usage.prompt_tokens || 0;
        tokensOut = res.data.usage.completion_tokens || 0;
      } else {
        tokensIn = estimateTokens(body.messages);
      }
      const cost = ((tokensIn * (provider.priceIn||0) + tokensOut * (provider.priceOut||0)) / 1_000_000);

      // Record rate limit usage
      recordRateLimit(provider.id, tokensIn, tokensOut);

      incrementStats(provider.id, tokensIn, tokensOut, Math.floor(savedChars/4), cost);
      appendLog({ level:'ok', tag:'ROUTE', provider: provider.id, model, latencyMs: latency, tokensIn, tokensOut, msg:`→ ${provider.prefix}/${model}  ${latency}ms` });

      return { res, provider, model, savedChars };

    } catch (err) {
      lastError = err;
      const status = err.response?.status || err.status;
      const latency = Date.now() - start;

      appendLog({
        level: status === 429 ? 'warn' : 'err',
        tag:   status === 429 ? 'QUOTA' : 'ERROR',
        provider: provider.id,
        msg: `${provider.name} failed (${status || err.code || 'ERR'}) — ${err.message?.slice(0,120)}`,
      });

      // On 429, record that we hit the limit
      if (status === 429) {
        recordRateLimit(provider.id, 0, 0);
      }

      // Only fall to next provider on retriable errors
      const retriable = [429, 503, 502, 500, 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'];
      const code = status || err.code;
      if (!retriable.includes(code)) throw err;
    }
  }

  throw lastError || new Error('All providers exhausted');
}

/** "or/deepseek-chat:free" → { provider: openrouter, modelName: "deepseek/deepseek-chat:free" } */
function resolveModel(modelStr, providers) {
  if (!modelStr || modelStr === 'auto') return { provider: null, modelName: null };

  const slash = modelStr.indexOf('/');
  if (slash === -1) {
    // No prefix: search by model name
    for (const p of providers) {
      if (p.models?.includes(modelStr)) return { provider: p, modelName: modelStr };
    }
    return { provider: null, modelName: modelStr };
  }

  const prefix = modelStr.slice(0, slash);
  const model  = modelStr.slice(slash + 1);
  const prov   = providers.find(p => p.prefix === prefix) || null;
  return { provider: prov, modelName: model };
}

/** Preferred first, then rest sorted by: free > paid, tier asc */
function buildChain(providers, preferred) {
  const usable = providers.filter(p => p.enabled && p.apiKey && p.apiKey.length > 4);
  const sorted = [...usable].sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    return a.tier - b.tier;
  });
  if (!preferred) return sorted;
  return [preferred, ...sorted.filter(p => p.id !== preferred.id)];
}

function injectCavemanPrompt(body, level) {
  const terse = ['','Be concise.','Be brief. No prose.','Ultra-terse. Code only when asked.','One-word answers when possible.','Minimal. Direct. No filler.'];
  const inject = terse[Math.min(level, terse.length-1)];
  if (!inject) return body;
  const msgs = [...(body.messages || [])];
  const si = msgs.findIndex(m => m.role === 'system');
  if (si >= 0) msgs[si] = { ...msgs[si], content: inject + '\n' + msgs[si].content };
  else msgs.unshift({ role:'system', content: inject });
  return { ...body, messages: msgs };
}

function estimateTokens(messages) {
  if (!messages) return 0;
  return Math.ceil(messages.map(m => typeof m.content==='string'?m.content:JSON.stringify(m.content||'')).join(' ').length / 4);
}

module.exports = { routeRequest };
