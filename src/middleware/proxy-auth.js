const crypto = require('crypto');
const { read } = require('../utils/storage');

/**
 * Proxy auth middleware — validates Bearer token from API keys.
 * API keys are stored in data/api-keys.json.
 * 
 * Auth flow:
 *   1. Check Authorization: Bearer <key> header
 *   2. Look up key in api-keys.json
 *   3. If valid, attach key metadata to req
 *   4. If invalid or missing, return 401
 */
function proxyAuth(req, res, next) {
  // Allow /v1/models without auth (for dashboard/tool discovery)
  if (req.path === '/models') return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: {
        message: 'Missing API key. Send Authorization: Bearer <your-key>',
        type: 'authentication_error',
        code: 'missing_api_key',
      },
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token || token.length < 8) {
    return res.status(401).json({
      error: {
        message: 'Invalid API key format',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    });
  }

  const apiKeys = read('api-keys') || [];
  const keyRecord = apiKeys.find(k => {
    if (!k.enabled) return false;
    // Use constant-time comparison
    try {
      return crypto.timingSafeEqual(Buffer.from(k.key), Buffer.from(token));
    } catch {
      return k.key === token;
    }
  });

  if (!keyRecord) {
    return res.status(401).json({
      error: {
        message: 'Invalid API key',
        type: 'authentication_error',
        code: 'invalid_api_key',
      },
    });
  }

  // Update last used timestamp
  keyRecord.lastUsedAt = new Date().toISOString();
  keyRecord.usageCount = (keyRecord.usageCount || 0) + 1;
  const { write } = require('../utils/storage');
  write('api-keys', apiKeys);

  // Attach key info to request
  req.apiKey = {
    id: keyRecord.id,
    name: keyRecord.name,
    createdAt: keyRecord.createdAt,
  };

  next();
}

module.exports = { proxyAuth };
