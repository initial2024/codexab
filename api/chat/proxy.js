import { Readable } from 'node:stream';

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

const DEFAULT_AI_TARGET = 'https://new.sharedchat.cc/codex/responses';

const ALLOWED_TARGET_HOSTS = (
  process.env.ALLOWED_TARGET_HOSTS ||
  [
    'new.sharedchat.cc',
    'api.openai.com',
    'api.deepseek.com',
    'api.siliconflow.cn',
    'dashscope.aliyuncs.com',
    'api.moonshot.cn',
    'open.bigmodel.cn',
    'api.minimax.chat',
    'api.anthropic.com',
    'generativelanguage.googleapis.com',
  ].join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOW_ANY_HTTPS_TARGET =
  process.env.ALLOW_ANY_HTTPS_TARGET === 'true';

const PROXY_TOKEN = process.env.PROXY_TOKEN || '';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader(
    'Access-Control-Allow-Headers',
    [
      'Content-Type',
      'Authorization',
      'X-Proxy-Token',
      'X-API-Key',
      'x-api-key',
      'Anthropic-Version',
      'anthropic-version',
      'OpenAI-Organization',
      'OpenAI-Project',
    ].join(', ')
  );
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(data, null, 2));
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function readRequestBody(req) {
  if (req.body) {
    return safeJsonParse(req.body, {});
  }

  try {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const raw = Buffer.concat(chunks).toString('utf8');
    return safeJsonParse(raw, {});
  } catch {
    return {};
  }
}

function isPrivateOrLocalUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const host = url.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local')
    ) {
      return true;
    }

    if (
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.')
    ) {
      return true;
    }

    const parts = host.split('.').map(Number);

    if (
      parts.length === 4 &&
      parts.every((n) => Number.isInteger(n)) &&
      parts[0] === 172 &&
      parts[1] >= 16 &&
      parts[1] <= 31
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function isAllowedTargetUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);

    if (url.protocol !== 'https:') {
      return false;
    }

    if (isPrivateOrLocalUrl(targetUrl)) {
      return false;
    }

    if (ALLOW_ANY_HTTPS_TARGET) {
      return true;
    }

    return ALLOWED_TARGET_HOSTS.includes(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function checkProxyToken(req) {
  if (!PROXY_TOKEN) return true;

  const token = req.headers['x-proxy-token'];

  if (Array.isArray(token)) {
    return token.includes(PROXY_TOKEN);
  }

  return token === PROXY_TOKEN;
}

function normalizeTargetUrl(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathOrig = parsedUrl.pathname.toLowerCase();

    if (hostname === 'new.sharedchat.cc') {
      if (pathOrig === '/' || pathOrig === '') {
        return `${parsedUrl.origin}/codex/responses`;
      }

      if (pathOrig === '/codex' || pathOrig === '/codex/') {
        return `${parsedUrl.origin}/codex/responses`;
      }

      if (pathOrig.includes('/v1/chat/completions')) {
        return `${parsedUrl.origin}/codex/responses`;
      }
    }

    return targetUrl;
  } catch {
    return targetUrl;
  }
}

function buildModelPayload(body) {
  if (
    body.body &&
    typeof body.body === 'object' &&
    !Array.isArray(body.body)
  ) {
    return { ...body.body };
  }

  const finalBody = { ...body };

  delete finalBody.apiUrl;
  delete finalBody.apiKey;
  delete finalBody.headers;
  delete finalBody.url;
  delete finalBody.body;

  return finalBody;
}

function normalizePayloadForTarget(payload, targetUrl) {
  try {
    const url = new URL(targetUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    const finalPayload = { ...payload };

    if (
      hostname === 'new.sharedchat.cc' &&
      pathname.includes('/codex/responses')
    ) {
      if (finalPayload.messages && !finalPayload.input) {
        finalPayload.input = finalPayload.messages;
        delete finalPayload.messages;
      }

      if (
        finalPayload.max_tokens &&
        !finalPayload.max_output_tokens
      ) {
        finalPayload.max_output_tokens = finalPayload.max_tokens;
        delete finalPayload.max_tokens;
      }
    }

    return finalPayload;
  } catch {
    return payload;
  }
}

function buildUpstreamHeaders(req, body, targetUrl) {
  const headersToSend = {
    'Content-Type': 'application/json',
  };

  if (body.headers && typeof body.headers === 'object') {
    for (const [key, value] of Object.entries(body.headers)) {
      if (!key || value == null) continue;

      const lower = key.toLowerCase();

      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === 'content-type') continue;

      headersToSend[key] = String(value);
    }
  }

  const authHeader =
    body.headers?.Authorization ||
    body.headers?.authorization ||
    req.headers.authorization ||
    '';

  if (authHeader) {
    headersToSend.Authorization = authHeader;
  }

  if (body.apiKey) {
    try {
      const host = new URL(targetUrl).hostname.toLowerCase();

      if (host === 'api.anthropic.com') {
        if (!headersToSend['x-api-key'] && !headersToSend['X-API-Key']) {
          headersToSend['x-api-key'] = body.apiKey;
        }

        if (
          !headersToSend['anthropic-version'] &&
          !headersToSend['Anthropic-Version']
        ) {
          headersToSend['anthropic-version'] = '2023-06-01';
        }
      } else if (!headersToSend.Authorization) {
        headersToSend.Authorization = `Bearer ${body.apiKey}`;
      }
    } catch {
      if (!headersToSend.Authorization) {
        headersToSend.Authorization = `Bearer ${body.apiKey}`;
      }
    }
  }

  return headersToSend;
}

async function sendUpstreamResponse(res, upstream, targetUrl) {
  const contentType =
    upstream.headers.get('content-type') ||
    'application/json; charset=utf-8';

  const contentTypeLower = contentType.toLowerCase();
  const server = upstream.headers.get('server') || '';
  const cfRay = upstream.headers.get('cf-ray') || '';

  if (contentTypeLower.includes('text/html')) {
    const html = await upstream.text();

    return sendJson(res, upstream.status, {
      ok: false,
      error: 'Upstream returned HTML instead of API JSON/SSE.',
      upstreamStatus: upstream.status,
      targetUrl,
      contentType,
      server,
      cfRay,
      likelyReason:
        upstream.status === 403 ||
        server.toLowerCase().includes('cloudflare') ||
        cfRay
          ? 'Likely blocked by Cloudflare/WAF, or the upstream does not allow cloud/serverless IP access.'
          : 'Likely wrong API endpoint. Check whether the request should go to /codex/responses or /v1/chat/completions.',
      preview: html.slice(0, 1000),
    });
  }

  res.statusCode = upstream.status;
  res.setHeader('Content-Type', contentType);

  if (contentTypeLower.includes('text/event-stream')) {
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
  }

  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === 'content-type') continue;
    if (lower === 'content-encoding') continue;
    if (lower.startsWith('access-control-')) continue;

    try {
      res.setHeader(key, value);
    } catch {
      // 忽略无法设置的响应头
    }
  }

  if (!upstream.body) {
    return res.end();
  }

  return new Promise((resolve, reject) => {
    const nodeStream = Readable.fromWeb(upstream.body);

    nodeStream.on('error', reject);
    res.on('finish', resolve);
    res.on('error', reject);

    nodeStream.pipe(res);
  });
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'HEAD') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      success: true,
      status: 'ok',
      ready: true,
      service: 'codexab-ai-proxy',
      type: 'ai-proxy',
      endpoint: '/api/chat/proxy',
      methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
      upstreamDefault: DEFAULT_AI_TARGET,
      time: new Date().toISOString(),
    });
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, {
      ok: false,
      error: 'Method Not Allowed',
    });
  }

  if (!checkProxyToken(req)) {
    return sendJson(res, 401, {
      ok: false,
      error: 'Invalid proxy token',
    });
  }

  const body = await readRequestBody(req);

  let targetUrl = body.apiUrl || body.url || DEFAULT_AI_TARGET;
  targetUrl = normalizeTargetUrl(targetUrl);

  if (!isAllowedTargetUrl(targetUrl)) {
    return sendJson(res, 403, {
      ok: false,
      error: 'Target host is not allowed',
      targetUrl,
      allowedHosts: ALLOWED_TARGET_HOSTS,
      allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
    });
  }

  let finalBody = buildModelPayload(body);
  finalBody = normalizePayloadForTarget(finalBody, targetUrl);

  const headersToSend = buildUpstreamHeaders(req, body, targetUrl);

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: headersToSend,
      body: JSON.stringify(finalBody),
    });

    return await sendUpstreamResponse(res, upstream, targetUrl);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error.message || 'Proxy request failed',
      targetUrl,
    });
  }
}
