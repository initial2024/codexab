export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
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

function normalizeTypes(types) {
  if (!types) return [];

  if (Array.isArray(types)) {
    return types.map(String);
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
    if (t === '1' || t.toLowerCase() === 'image') {
      result.add('image');
    }

    if (t === '4' || t.toLowerCase() === 'video') {
      result.add('video');
    }

    if (t === '5' || t.toLowerCase() === 'audio') {
      result.add('audio');
    }

    if (
      t === '2' ||
      t.toLowerCase() === 'document' ||
      t.toLowerCase() === 'other'
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

  const cleaned = rawUrl
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/&amp;/g, '&');

  if (
    cleaned.startsWith('data:') ||
    cleaned.startsWith('javascript:') ||
    cleaned.startsWith('mailto:') ||
    cleaned.startsWith('tel:')
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
    /\b(?:src|href|data-src|data-original|poster)=["']([^"']+)["']/gi;

  let match;

  while ((match = attrRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[1], baseUrl);
    if (abs) urls.add(abs);
  }

  const absoluteUrlRegex =
    /https?:\/\/[^\s"'<>\\)]+/gi;

  while ((match = absoluteUrlRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[0], baseUrl);
    if (abs) urls.add(abs);
  }

  return [...urls];
}

function filterResources(urls, options = {}) {
  const targetTypes = typeCodeToNames(options.types);
  const keyword = String(options.keyword || '')
    .trim()
    .toLowerCase();

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
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const targetUrl = req.query?.url;

    if (!targetUrl) {
      return sendJson(res, 200, {
        ok: true,
        service: 'codexab-parse',
        usage: {
          html: 'POST /api/parse with { "url": "https://example.com" }',
          filtered:
            'POST /api/parse with { "url": "https://example.com", "types": [4], "keyword": "mp4" }',
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
      return sendJson(res, 400, {
        error: 'Missing target url parameter',
      });
    }

    return handleParse(req, res, body);
  }

  return sendJson(res, 405, {
    error: 'Method Not Allowed',
  });
}

async function handleParse(req, res, options) {
  const targetUrl = options.url;

  try {
    const parsedUrl = new URL(targetUrl);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return sendJson(res, 400, {
        error: 'Invalid url protocol',
      });
    }

    if (isPrivateOrLocalUrl(targetUrl)) {
      return sendJson(res, 403, {
        error: 'Private or local url is not allowed',
      });
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const contentType =
      response.headers.get('content-type') || '';

    const html = await response.text();

    const shouldExtract =
      options.mode === 'extract' ||
      options.keyword ||
      normalizeTypes(options.types).length > 0;

    if (!shouldExtract) {
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }

    const urls = extractResourceUrls(html, targetUrl);
    const items = filterResources(urls, {
      types: options.types,
      keyword: options.keyword,
    });

    return sendJson(res, response.status, {
      ok: response.ok,
      mode: 'extract',
      targetUrl,
      upstreamStatus: response.status,
      upstreamContentType: contentType,
      filters: {
        types: normalizeTypes(options.types),
        keyword: options.keyword || '',
      },
      count: items.length,
      items,
    });
  } catch (error) {
    return sendJson(res, 500, {
      error: error.message || 'Parse request failed',
    });
  }
}
