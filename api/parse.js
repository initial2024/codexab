export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

function setCors(req, res) {
  const origin = req.headers.origin || '*';

  if (origin === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  const requestHeaders =
    req.headers['access-control-request-headers'] ||
    'Content-Type, Authorization, X-Requested-With, X-API-Key, x-api-key, Cache-Control, Pragma';

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', requestHeaders);
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Type, Content-Length, X-Parse-Mode'
  );
}

function sendJson(req, res, statusCode, data) {
  setCors(req, res);
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

function normalizeTypes(types) {
  if (!types) return [];

  if (Array.isArray(types)) {
    return types.map(String).map((s) => s.trim()).filter(Boolean);
  }

  if (typeof types === 'string') {
    return types
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return [];
}

const EXT_MAP = {
  image: [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'gif',
    'bmp',
    'svg',
    'avif',
    'ico',
  ],
  video: [
    'mp4',
    'm3u8',
    'mov',
    'avi',
    'mkv',
    'webm',
    'flv',
    'ts',
    'm4v',
  ],
  audio: [
    'mp3',
    'wav',
    'flac',
    'aac',
    'ogg',
    'm4a',
    'opus',
  ],
  document: [
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'txt',
    'csv',
    'zip',
    'rar',
    '7z',
    'apk',
    'exe',
    'dmg',
    'pkg',
  ],
};

function typeCodeToNames(types) {
  const normalized = normalizeTypes(types);
  const result = new Set();

  for (const t of normalized) {
    const lower = t.toLowerCase();

    if (t === '1' || lower === 'image' || lower === 'images') {
      result.add('image');
    }

    if (t === '4' || lower === 'video' || lower === 'videos') {
      result.add('video');
    }

    if (t === '5' || lower === 'audio' || lower === 'audios') {
      result.add('audio');
    }

    if (
      t === '2' ||
      lower === 'document' ||
      lower === 'documents' ||
      lower === 'file' ||
      lower === 'files' ||
      lower === 'other'
    ) {
      result.add('document');
    }
  }

  return [...result];
}

function getExtension(resourceUrl) {
  try {
    const u = new URL(resourceUrl);
    const pathname = u.pathname.toLowerCase();
    const last = pathname.split('/').pop() || '';
    const clean = last.split('?')[0].split('#')[0];

    if (!clean.includes('.')) return '';

    return clean.split('.').pop() || '';
  } catch {
    return '';
  }
}

function classifyResource(resourceUrl) {
  const ext = getExtension(resourceUrl);

  for (const [type, exts] of Object.entries(EXT_MAP)) {
    if (exts.includes(ext)) {
      return {
        type,
        ext,
      };
    }
  }

  return {
    type: 'unknown',
    ext,
  };
}

function absolutizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return null;

  const cleaned = String(rawUrl)
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/&amp;/g, '&');

  if (
    !cleaned ||
    cleaned.startsWith('data:') ||
    cleaned.startsWith('javascript:') ||
    cleaned.startsWith('mailto:') ||
    cleaned.startsWith('tel:') ||
    cleaned.startsWith('#')
  ) {
    return null;
  }

  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractResourceUrls(html, baseUrl) {
  const urls = new Set();

  const attrRegex =
    /\b(?:src|href|data-src|data-original|data-url|poster|content)=["']([^"']+)["']/gi;

  let match;

  while ((match = attrRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[1], baseUrl);
    if (abs) urls.add(abs);
  }

  const cssUrlRegex = /url\(["']?([^"')]+)["']?\)/gi;

  while ((match = cssUrlRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[1], baseUrl);
    if (abs) urls.add(abs);
  }

  const absoluteUrlRegex = /https?:\/\/[^\s"'<>\\)]+/gi;

  while ((match = absoluteUrlRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[0], baseUrl);
    if (abs) urls.add(abs);
  }

  return [...urls];
}

function filterResources(urls, options = {}) {
  const targetTypes = typeCodeToNames(options.types);
  const keyword = String(options.keyword || '').trim().toLowerCase();

  const items = [];

  for (const resourceUrl of urls) {
    const info = classifyResource(resourceUrl);

    if (targetTypes.length > 0 && !targetTypes.includes(info.type)) {
      continue;
    }

    if (keyword && !resourceUrl.toLowerCase().includes(keyword)) {
      continue;
    }

    if (info.type === 'unknown' && targetTypes.length > 0) {
      continue;
    }

    items.push({
      type: info.type,
      ext: info.ext,
      url: resourceUrl,
    });
  }

  return items;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'HEAD') {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method === 'GET') {
    const targetUrl = req.query?.url;

    if (!targetUrl) {
      return sendJson(req, res, 200, {
        ok: true,
        success: true,
        status: 'ok',
        ready: true,
        service: 'codexab-parse',
        endpoint: '/api/parse',
        methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
        usage: {
          html: 'POST /api/parse with JSON body: { "url": "https://example.com" }',
          extract:
            'POST /api/parse with JSON body: { "url": "https://example.com", "mode": "extract", "types": [4], "keyword": "mp4" }',
          typeCodes: {
            1: 'image',
            2: 'document/other',
            4: 'video',
            5: 'audio',
          },
        },
        time: new Date().toISOString(),
      });
    }

    return handleParse(req, res, {
      url: targetUrl,
      types: req.query?.types,
      keyword: req.query?.keyword,
      mode: req.query?.mode,
    });
  }

  if (req.method === 'POST') {
    const body = await readRequestBody(req);

    if (!body.url) {
      return sendJson(req, res, 400, {
        ok: false,
        error: 'Missing target url parameter',
      });
    }

    return handleParse(req, res, body);
  }

  return sendJson(req, res, 405, {
    ok: false,
    error: 'Method Not Allowed',
  });
}

async function handleParse(req, res, options) {
  const targetUrl = options.url;

  try {
    const parsedUrl = new URL(targetUrl);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return sendJson(req, res, 400, {
        ok: false,
        error: 'Invalid url protocol',
      });
    }

    if (isPrivateOrLocalUrl(targetUrl)) {
      return sendJson(req, res, 403, {
        ok: false,
        error: 'Private or local url is not allowed',
      });
    }

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const contentType = upstream.headers.get('content-type') || '';
    const server = upstream.headers.get('server') || '';
    const cfRay = upstream.headers.get('cf-ray') || '';

    const html = await upstream.text();

    const shouldExtract =
      options.mode === 'extract' ||
      options.extract === true ||
      options.keyword ||
      normalizeTypes(options.types).length > 0;

    if (!shouldExtract) {
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Parse-Mode', 'html');
      return res.end(html);
    }

    const urls = extractResourceUrls(html, targetUrl);
    const items = filterResources(urls, {
      types: options.types,
      keyword: options.keyword,
    });

    return sendJson(req, res, upstream.status, {
      ok: upstream.ok,
      success: upstream.ok,
      status: upstream.ok ? 'ok' : 'upstream_error',
      mode: 'extract',
      targetUrl,
      upstreamStatus: upstream.status,
      upstreamContentType: contentType,
      server,
      cfRay,
      filters: {
        types: normalizeTypes(options.types),
        resolvedTypes: typeCodeToNames(options.types),
        keyword: options.keyword || '',
      },
      count: items.length,
      items,
      debug: {
        totalUrlsFound: urls.length,
        htmlPreview:
          items.length === 0 ? html.slice(0, 500) : undefined,
      },
    });
  } catch (error) {
    return sendJson(req, res, 500, {
      ok: false,
      success: false,
      status: 'error',
      error: error.message || 'Parse request failed',
    });
  }
}
