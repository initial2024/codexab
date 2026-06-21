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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    ].join(', ')
  );
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

    return ALLOWED_TARGET_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}

function checkProxyToken(req) {
  if (!PROXY_TOKEN) return true;

  const token = req.headers['x-proxy-token'];
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

function buildUpstreamHeaders(req, body) {
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
    (body.apiKey ? `Bearer ${body.apiKey}` : '');

  if (authHeader) {
    headersToSend.Authorization = authHeader;
  }

  return headersToSend;
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

async function sendUpstreamResponse(res, upstream) {
  res.statusCode = upstream.status;

  const contentType =
    upstream.headers.get('content-type') ||
    'application/json; charset=utf-8';

  res.setHeader('Content-Type', contentType);

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

  const currentUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = currentUrl.pathname;
  const body = await readRequestBody(req);

  if (pathname === '/api/parse') {
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method Not Allowed',
      });
    }

    const videoUrl = body.url;

    if (!videoUrl) {
      return res.status(400).json({
        error: 'Missing target url parameter',
      });
    }

    try {
      const parsedVideoUrl = new URL(videoUrl);

      if (!['http:', 'https:'].includes(parsedVideoUrl.protocol)) {
        return res.status(400).json({
          error: 'Invalid url protocol',
        });
      }

      if (isPrivateOrLocalUrl(videoUrl)) {
        return res.status(403).json({
          error: 'Private or local url is not allowed',
        });
      }

      const response = await fetch(videoUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const html = await response.text();

      res.statusCode = response.status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      return res.send(html);
    } catch (error) {
      return res.status(500).json({
        error: error.message || 'Parse request failed',
      });
    }
  }

  if (pathname === '/api/chat/proxy') {
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method Not Allowed',
      });
    }

    if (!checkProxyToken(req)) {
      return res.status(401).json({
        error: 'Invalid proxy token',
      });
    }

    let targetUrl = body.apiUrl || body.url || DEFAULT_AI_TARGET;
    targetUrl = normalizeTargetUrl(targetUrl);

    if (!isAllowedTargetUrl(targetUrl)) {
      return res.status(403).json({
        error: `Target host is not allowed: ${targetUrl}`,
      });
    }

    const finalBody = buildModelPayload(body);
    const headersToSend = buildUpstreamHeaders(req, body);

    try {
      const upstream = await fetch(targetUrl, {
        method: 'POST',
        headers: headersToSend,
        body: JSON.stringify(finalBody),
      });

      return await sendUpstreamResponse(res, upstream);
    } catch (error) {
      return res.status(500).json({
        error: error.message || 'Proxy request failed',
      });
    }
  }

  return res.status(404).json({
    error: 'Endpoint Not Found in Vercel Worker.',
  });
}
