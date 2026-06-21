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

function cleanInputUrl(input) {
  if (!input) return '';

  let value = String(input).trim();

  value = value
    .replace(/^Button:\s*/i, '')
    .replace(/^URL:\s*/i, '')
    .replace(/^Link:\s*/i, '')
    .replace(/^链接:\s*/i, '')
    .replace(/^网址:\s*/i, '')
    .replace(/^目标:\s*/i, '')
    .trim();

  const fullUrlMatch = value.match(/https?:\/\/[^\s"'<>]+/i);
  if (fullUrlMatch) {
    return fullUrlMatch[0].trim();
  }

  const domainMatch = value.match(
    /(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>]*)?/i
  );

  if (domainMatch) {
    value = domainMatch[0].trim();
  }

  if (/^www\./i.test(value)) {
    return `https://${value}`;
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) {
    return `https://${value}`;
  }

  return value;
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

function normalizeExts(exts) {
  if (!exts) return [];

  if (Array.isArray(exts)) {
    return exts
      .map(String)
      .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean);
  }

  if (typeof exts === 'string') {
    return exts
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean);
  }

  return [];
}

function subtypeToExts(subtype) {
  const s = String(subtype || '').trim().toLowerCase();

  const map = {
    word: ['doc', 'docx'],
    doc: ['doc', 'docx'],
    docx: ['doc', 'docx'],
    文档: ['doc', 'docx'],
    word文档: ['doc', 'docx'],

    pdf: ['pdf'],

    excel: ['xls', 'xlsx', 'csv'],
    xls: ['xls', 'xlsx', 'csv'],
    xlsx: ['xls', 'xlsx', 'csv'],
    表格: ['xls', 'xlsx', 'csv'],

    ppt: ['ppt', 'pptx'],
    powerpoint: ['ppt', 'pptx'],
    演示文稿: ['ppt', 'pptx'],

    archive: ['zip', 'rar', '7z'],
    zip: ['zip', 'rar', '7z'],
    压缩包: ['zip', 'rar', '7z'],

    app: ['apk', 'exe', 'dmg', 'pkg'],
    installer: ['apk', 'exe', 'dmg', 'pkg'],
    安装包: ['apk', 'exe', 'dmg', 'pkg'],
  };

  return map[s] || [];
}

function collectAllowedExts(options = {}) {
  const result = [
    ...normalizeExts(options.exts),
    ...normalizeExts(options.extensions),
    ...normalizeExts(options.fileExts),
    ...subtypeToExts(options.subtype),
    ...subtypeToExts(options.fileKind),
    ...subtypeToExts(options.kind),
    ...subtypeToExts(options.intent),
  ];

  return [...new Set(result)];
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

function getFileName(resourceUrl) {
  try {
    const url = new URL(resourceUrl);
    const pathname = url.pathname;
    const last = pathname.split('/').pop();

    if (last && last.includes('.')) {
      return decodeURIComponent(last);
    }

    return 'resource';
  } catch {
    return 'resource';
  }
}

function guessMimeType(type, ext) {
  const e = String(ext || '').toLowerCase();

  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    avif: 'image/avif',
    ico: 'image/x-icon',

    mp4: 'video/mp4',
    m3u8: 'application/vnd.apple.mpegurl',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    flv: 'video/x-flv',
    ts: 'video/mp2t',
    m4v: 'video/x-m4v',

    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    opus: 'audio/opus',

    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    apk: 'application/vnd.android.package-archive',
    exe: 'application/vnd.microsoft.portable-executable',
    dmg: 'application/x-apple-diskimage',
    pkg: 'application/octet-stream',
  };

  if (map[e]) return map[e];

  if (type === 'image') return 'image/*';
  if (type === 'video') return 'video/*';
  if (type === 'audio') return 'audio/*';

  return 'application/octet-stream';
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
  const allowedExts = collectAllowedExts(options);
  const keyword = String(options.keyword || '').trim().toLowerCase();

  const items = [];

  for (const resourceUrl of urls) {
    const info = classifyResource(resourceUrl);

    if (targetTypes.length > 0 && !targetTypes.includes(info.type)) {
      continue;
    }

    if (allowedExts.length > 0 && !allowedExts.includes(info.ext)) {
      continue;
    }

    if (keyword && !resourceUrl.toLowerCase().includes(keyword)) {
      continue;
    }

    if (info.type === 'unknown' && targetTypes.length > 0) {
      continue;
    }

    const fileName = getFileName(resourceUrl);
    const mimeType = guessMimeType(info.type, info.ext);

    items.push({
      id: Buffer.from(resourceUrl).toString('base64url'),

      type: info.type,
      category: info.type,
      fileType: info.type,

      ext: info.ext,
      extension: info.ext,

      name: fileName,
      title: fileName,
      filename: fileName,
      fileName: fileName,

      url: resourceUrl,
      href: resourceUrl,
      src: resourceUrl,
      link: resourceUrl,
      downloadUrl: resourceUrl,
      previewUrl: resourceUrl,
      originalUrl: resourceUrl,
      directUrl: resourceUrl,

      mime: mimeType,
      mimeType,
      contentType: mimeType,

      size: null,
      sizeText: '未知大小',
      selected: false,
      checked: false,
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
          word:
            'POST /api/parse with JSON body: { "url": "https://example.com", "mode": "extract", "types": [2], "exts": ["doc", "docx"], "subtype": "word" }',
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
      exts: req.query?.exts,
      extensions: req.query?.extensions,
      fileExts: req.query?.fileExts,
      subtype: req.query?.subtype,
      fileKind: req.query?.fileKind,
      kind: req.query?.kind,
      intent: req.query?.intent,
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
  const targetUrl = cleanInputUrl(options.url);

  try {
    const parsedUrl = new URL(targetUrl);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return sendJson(req, res, 400, {
        ok: false,
        error: 'Invalid url protocol',
        targetUrl,
      });
    }

    if (isPrivateOrLocalUrl(targetUrl)) {
      return sendJson(req, res, 403, {
        ok: false,
        error: 'Private or local url is not allowed',
        targetUrl,
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
      normalizeTypes(options.types).length > 0 ||
      collectAllowedExts(options).length > 0;

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
      exts: options.exts,
      extensions: options.extensions,
      fileExts: options.fileExts,
      subtype: options.subtype,
      fileKind: options.fileKind,
      kind: options.kind,
      intent: options.intent,
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
        exts: collectAllowedExts(options),
        keyword: options.keyword || '',
        subtype: options.subtype || '',
        fileKind: options.fileKind || '',
        kind: options.kind || '',
        intent: options.intent || '',
      },

      count: items.length,
      total: items.length,
      files: items,
      items,
      resources: items,
      data: items,

      debug: {
        inputUrl: options.url,
        cleanedUrl: targetUrl,
        totalUrlsFound: urls.length,
        htmlPreview:
          items.length === 0 ? html.slice(0, 800) : undefined,
      },
    });
  } catch (error) {
    return sendJson(req, res, 500, {
      ok: false,
      success: false,
      status: 'error',
      error: error.message || 'Parse request failed',
      debug: {
        inputUrl: options.url,
        cleanedUrl: targetUrl,
      },
    });
  }
    }
