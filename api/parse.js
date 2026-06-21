export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

const PARSE_VERSION = 'parse-url-clean-deep-probe-v4-20260621';

const DEFAULT_MAX_PAGES = 5;
const DEFAULT_MAX_PROBES = 25;

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
  return res.end(
    JSON.stringify(
      {
        parseVersion: PARSE_VERSION,
        ...data,
      },
      null,
      2
    )
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

  if (!/^https?:\/\//i.test(value) && /^www\./i.test(value)) {
    return `https://${value}`;
  }

  if (!/^https?:\/\//i.test(value) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) {
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

function normalizeBool(value, defaultValue = false) {
  if (value === true) return true;
  if (value === false) return false;

  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;
  }

  return defaultValue;
}

function normalizeNumber(value, defaultValue, min, max) {
  const n = Number(value);

  if (!Number.isFinite(n)) return defaultValue;

  return Math.max(min, Math.min(max, Math.floor(n)));
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
    'mpd',
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

function getExtensionFromName(name) {
  const clean = String(name || '')
    .split('?')[0]
    .split('#')[0]
    .trim()
    .toLowerCase();

  if (!clean.includes('.')) return '';

  return clean.split('.').pop() || '';
}

function getExtension(resourceUrl) {
  try {
    const u = new URL(resourceUrl);
    const pathname = decodeURIComponent(u.pathname || '');
    const last = pathname.split('/').pop() || '';
    let ext = getExtensionFromName(last);

    if (ext) return ext;

    const possibleParams = ['filename', 'file', 'name', 'download'];

    for (const p of possibleParams) {
      const value = u.searchParams.get(p);
      ext = getExtensionFromName(value);
      if (ext) return ext;
    }

    return '';
  } catch {
    return '';
  }
}

function extensionToType(ext) {
  const e = String(ext || '').toLowerCase();

  for (const [type, exts] of Object.entries(EXT_MAP)) {
    if (exts.includes(e)) return type;
  }

  return 'unknown';
}

function contentTypeToExt(contentType) {
  const ct = String(contentType || '').toLowerCase().split(';')[0].trim();

  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/x-icon': 'ico',

    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/mp2t': 'ts',
    'application/vnd.apple.mpegurl': 'm3u8',
    'application/x-mpegurl': 'm3u8',
    'application/dash+xml': 'mpd',

    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',

    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/zip': 'zip',
    'application/vnd.rar': 'rar',
    'application/x-7z-compressed': '7z',
  };

  if (map[ct]) return map[ct];

  if (ct.startsWith('image/')) return '';
  if (ct.startsWith('video/')) return '';
  if (ct.startsWith('audio/')) return '';

  return '';
}

function contentTypeToType(contentType) {
  const ct = String(contentType || '').toLowerCase();

  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('audio/')) return 'audio';

  if (
    ct.includes('pdf') ||
    ct.includes('word') ||
    ct.includes('excel') ||
    ct.includes('spreadsheet') ||
    ct.includes('powerpoint') ||
    ct.includes('presentation') ||
    ct.includes('zip') ||
    ct.includes('rar') ||
    ct.includes('7z') ||
    ct.includes('octet-stream')
  ) {
    return 'document';
  }

  return 'unknown';
}

function classifyResource(resourceUrl, probeInfo = null) {
  const urlExt = getExtension(resourceUrl);
  let ext = urlExt;
  let type = extensionToType(ext);

  if (type !== 'unknown') {
    return {
      type,
      ext,
    };
  }

  if (probeInfo) {
    const probeExt =
      probeInfo.ext ||
      getExtensionFromName(probeInfo.fileName) ||
      contentTypeToExt(probeInfo.contentType);

    const probeType =
      extensionToType(probeExt) !== 'unknown'
        ? extensionToType(probeExt)
        : contentTypeToType(probeInfo.contentType);

    ext = probeExt || ext;
    type = probeType || type;
  }

  return {
    type: type || 'unknown',
    ext: ext || '',
  };
}

function getFileName(resourceUrl, probeInfo = null) {
  if (probeInfo?.fileName) {
    return probeInfo.fileName;
  }

  try {
    const url = new URL(resourceUrl);
    const pathname = decodeURIComponent(url.pathname || '');
    const last = pathname.split('/').pop();

    if (last && last.includes('.')) {
      return last;
    }

    return 'resource';
  } catch {
    return 'resource';
  }
}

function guessMimeType(type, ext, probeInfo = null) {
  if (probeInfo?.contentType) {
    return probeInfo.contentType;
  }

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
    mpd: 'application/dash+xml',
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

  let cleaned = String(rawUrl)
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/');

  if (
    !cleaned ||
    cleaned.startsWith('data:') ||
    cleaned.startsWith('javascript:') ||
    cleaned.startsWith('mailto:') ||
    cleaned.startsWith('tel:') ||
    cleaned.startsWith('#') ||
    cleaned.startsWith('blob:')
  ) {
    return null;
  }

  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractSrcsetUrls(srcset, baseUrl) {
  const urls = [];

  const parts = String(srcset || '').split(',');

  for (const part of parts) {
    const first = part.trim().split(/\s+/)[0];

    const abs = absolutizeUrl(first, baseUrl);
    if (abs) urls.push(abs);
  }

  return urls;
}

function extractResourceUrls(html, baseUrl) {
  const urls = new Set();

  const attrRegex =
    /\b(?:src|href|data-src|data-original|data-url|data-href|poster|content|download)=["']([^"']+)["']/gi;

  let match;

  while ((match = attrRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[1], baseUrl);
    if (abs) urls.add(abs);
  }

  const srcsetRegex = /\b(?:srcset|data-srcset)=["']([^"']+)["']/gi;

  while ((match = srcsetRegex.exec(html)) !== null) {
    const srcsetUrls = extractSrcsetUrls(match[1], baseUrl);

    for (const u of srcsetUrls) {
      urls.add(u);
    }
  }

  const cssUrlRegex = /url\(["']?([^"')]+)["']?\)/gi;

  while ((match = cssUrlRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[1], baseUrl);
    if (abs) urls.add(abs);
  }

  const unescapedHtml = String(html || '').replace(/\\\//g, '/');

  const absoluteUrlRegex = /https?:\/\/[^\s"'<>\\)]+/gi;

  while ((match = absoluteUrlRegex.exec(unescapedHtml)) !== null) {
    const abs = absolutizeUrl(match[0], baseUrl);
    if (abs) urls.add(abs);
  }

  return [...urls];
}

function getSameOriginPageLinks(html, baseUrl, options = {}) {
  const maxPages = normalizeNumber(options.maxPages, DEFAULT_MAX_PAGES, 1, 20);
  const sameOrigin = normalizeBool(options.sameOrigin, true);
  const links = new Set();

  const pageExtBlocklist = new Set([
    ...EXT_MAP.image,
    ...EXT_MAP.video,
    ...EXT_MAP.audio,
    ...EXT_MAP.document,
    'css',
    'js',
    'json',
    'xml',
    'ico',
    'svg',
    'woff',
    'woff2',
    'ttf',
    'eot',
  ]);

  const linkRegex = /\bhref=["']([^"']+)["']/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const abs = absolutizeUrl(match[1], baseUrl);
    if (!abs) continue;

    try {
      const base = new URL(baseUrl);
      const u = new URL(abs);

      if (sameOrigin && u.origin !== base.origin) {
        continue;
      }

      const ext = getExtension(abs);
      if (ext && pageExtBlocklist.has(ext)) {
        continue;
      }

      links.add(abs);
    } catch {
      // ignore
    }
  }

  return [...links].slice(0, maxPages);
}

function parseFileNameFromContentDisposition(disposition) {
  const value = String(disposition || '');

  const starMatch = value.match(/filename\*\s*=\s*([^']*)''([^;]+)/i);
  if (starMatch?.[2]) {
    try {
      return decodeURIComponent(starMatch[2].trim().replace(/^["']|["']$/g, ''));
    } catch {
      return starMatch[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  const normalMatch = value.match(/filename\s*=\s*([^;]+)/i);
  if (normalMatch?.[1]) {
    return normalMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  return '';
}

function probeFromHeaders(resourceUrl, status, headers) {
  const contentType = headers.get('content-type') || '';
  const contentLength = headers.get('content-length') || '';
  const disposition = headers.get('content-disposition') || '';
  const fileName = parseFileNameFromContentDisposition(disposition);
  const ext =
    getExtensionFromName(fileName) ||
    getExtension(resourceUrl) ||
    contentTypeToExt(contentType);

  return {
    ok: status >= 200 && status < 400,
    status,
    contentType,
    contentLength,
    disposition,
    fileName,
    ext,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probeResource(resourceUrl) {
  try {
    const resp = await fetchWithTimeout(
      resourceUrl,
      {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
          Accept: '*/*',
        },
      },
      7000
    );

    return probeFromHeaders(resourceUrl, resp.status, resp.headers);
  } catch {
    return null;
  }
}

async function probeCandidateResources(urls, options = {}) {
  const shouldProbe = normalizeBool(options.probe, false);

  if (!shouldProbe) {
    return new Map();
  }

  const maxProbes = normalizeNumber(
    options.maxProbes,
    DEFAULT_MAX_PROBES,
    1,
    50
  );

  const candidates = [];

  for (const u of urls) {
    const info = classifyResource(u);

    if (info.type === 'unknown' || !info.ext) {
      candidates.push(u);
    }

    if (candidates.length >= maxProbes) break;
  }

  const probeMap = new Map();

  for (const u of candidates) {
    const info = await probeResource(u);
    if (info) {
      probeMap.set(u, info);
    }
  }

  return probeMap;
}

function filterResources(urls, options = {}) {
  const targetTypes = typeCodeToNames(options.types);
  const allowedExts = collectAllowedExts(options);
  const keyword = String(options.keyword || '').trim().toLowerCase();
  const probeMap = options.probeMap || new Map();

  const items = [];

  for (const resourceUrl of urls) {
    const probeInfo = probeMap.get(resourceUrl) || null;
    const info = classifyResource(resourceUrl, probeInfo);

    if (info.type === 'unknown') {
      continue;
    }

    if (targetTypes.length > 0 && !targetTypes.includes(info.type)) {
      continue;
    }

    if (allowedExts.length > 0 && !allowedExts.includes(info.ext)) {
      continue;
    }

    if (keyword && !resourceUrl.toLowerCase().includes(keyword)) {
      continue;
    }

    const fileName = getFileName(resourceUrl, probeInfo);
    const mimeType = guessMimeType(info.type, info.ext, probeInfo);

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

      size: probeInfo?.contentLength ? Number(probeInfo.contentLength) : null,
      sizeText: probeInfo?.contentLength
        ? `${probeInfo.contentLength} bytes`
        : '未知大小',

      selected: false,
      checked: false,

      probe: probeInfo
        ? {
            status: probeInfo.status,
            contentType: probeInfo.contentType,
            contentLength: probeInfo.contentLength,
            disposition: probeInfo.disposition,
          }
        : undefined,
    });
  }

  return items;
}

async function fetchPageHtml(pageUrl) {
  const resp = await fetchWithTimeout(
    pageUrl,
    {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    },
    12000
  );

  const contentType = resp.headers.get('content-type') || '';
  const isHtml =
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml+xml') ||
    contentType.includes('application/xml') ||
    contentType === '';

  if (!isHtml) {
    return {
      status: resp.status,
      ok: resp.ok,
      contentType,
      html: '',
      directResource: true,
      probeInfo: probeFromHeaders(pageUrl, resp.status, resp.headers),
    };
  }

  const html = await resp.text();

  return {
    status: resp.status,
    ok: resp.ok,
    contentType,
    html,
    directResource: false,
    probeInfo: probeFromHeaders(pageUrl, resp.status, resp.headers),
  };
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
          deep:
            'POST /api/parse with JSON body: { "url": "https://example.com", "mode": "extract", "deep": true, "probe": true, "maxPages": 5 }',
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
      deep: req.query?.deep,
      probe: req.query?.probe,
      sameOrigin: req.query?.sameOrigin,
      maxPages: req.query?.maxPages,
      maxProbes: req.query?.maxProbes,
    });
  }

  if (req.method === 'POST') {
    const body = await readRequestBody(req);

    if (!body.url) {
      return sendJson(req, res, 400, {
        ok: false,
        success: false,
        status: 'error',
        error: 'Missing target url parameter',
      });
    }

    return handleParse(req, res, body);
  }

  return sendJson(req, res, 405, {
    ok: false,
    success: false,
    status: 'error',
    error: 'Method Not Allowed',
  });
}

async function handleParse(req, res, options) {
  const rawInputUrl = options.url;
  const targetUrl = cleanInputUrl(rawInputUrl);

  console.log('[parse] rawInputUrl:', rawInputUrl);
  console.log('[parse] cleanedTargetUrl:', targetUrl);

  try {
    const parsedUrl = new URL(targetUrl);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return sendJson(req, res, 400, {
        ok: false,
        success: false,
        status: 'error',
        error: 'Invalid url protocol',
        inputUrl: rawInputUrl,
        cleanedUrl: targetUrl,
      });
    }

    if (isPrivateOrLocalUrl(targetUrl)) {
      return sendJson(req, res, 403, {
        ok: false,
        success: false,
        status: 'error',
        error: 'Private or local url is not allowed',
        inputUrl: rawInputUrl,
        cleanedUrl: targetUrl,
      });
    }

    const shouldExtract =
      options.mode === 'extract' ||
      options.extract === true ||
      options.keyword ||
      normalizeTypes(options.types).length > 0 ||
      collectAllowedExts(options).length > 0 ||
      normalizeBool(options.deep, false) ||
      normalizeBool(options.probe, false);

    const page = await fetchPageHtml(targetUrl);

    if (!shouldExtract && !page.directResource) {
      res.statusCode = page.status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Parse-Mode', 'html');
      return res.end(page.html);
    }

    let allUrls = [];
    const probeMap = new Map();

    if (page.directResource) {
      allUrls.push(targetUrl);

      if (page.probeInfo) {
        probeMap.set(targetUrl, page.probeInfo);
      }
    } else {
      allUrls.push(...extractResourceUrls(page.html, targetUrl));
    }

    const deep = normalizeBool(options.deep, false);

    let pagesScanned = 1;
    let deepLinks = [];

    if (deep && !page.directResource) {
      const maxPages = normalizeNumber(
        options.maxPages,
        DEFAULT_MAX_PAGES,
        1,
        20
      );

      deepLinks = getSameOriginPageLinks(page.html, targetUrl, {
        maxPages,
        sameOrigin: options.sameOrigin,
      });

      for (const pageUrl of deepLinks) {
        try {
          const child = await fetchPageHtml(pageUrl);
          pagesScanned += 1;

          if (child.directResource) {
            allUrls.push(pageUrl);

            if (child.probeInfo) {
              probeMap.set(pageUrl, child.probeInfo);
            }
          } else {
            allUrls.push(...extractResourceUrls(child.html, pageUrl));
          }
        } catch {
          // 单个子页面失败不影响主流程
        }
      }
    }

    allUrls = [...new Set(allUrls)];

    const extraProbeMap = await probeCandidateResources(allUrls, {
      probe: options.probe,
      maxProbes: options.maxProbes,
    });

    for (const [key, value] of extraProbeMap.entries()) {
      probeMap.set(key, value);
    }

    const items = filterResources(allUrls, {
      types: options.types,
      keyword: options.keyword,
      exts: options.exts,
      extensions: options.extensions,
      fileExts: options.fileExts,
      subtype: options.subtype,
      fileKind: options.fileKind,
      kind: options.kind,
      intent: options.intent,
      probeMap,
    });

    return sendJson(req, res, page.status, {
      ok: page.ok,
      success: page.ok,
      status: page.ok ? 'ok' : 'upstream_error',

      mode: 'extract',
      targetUrl,
      inputUrl: rawInputUrl,
      cleanedUrl: targetUrl,

      upstreamStatus: page.status,
      upstreamContentType: page.contentType,

      filters: {
        types: normalizeTypes(options.types),
        resolvedTypes: typeCodeToNames(options.types),
        exts: collectAllowedExts(options),
        keyword: options.keyword || '',
        subtype: options.subtype || '',
        fileKind: options.fileKind || '',
        kind: options.kind || '',
        intent: options.intent || '',
        deep: normalizeBool(options.deep, false),
        probe: normalizeBool(options.probe, false),
        sameOrigin: normalizeBool(options.sameOrigin, true),
        maxPages: normalizeNumber(
          options.maxPages,
          DEFAULT_MAX_PAGES,
          1,
          20
        ),
      },

      count: items.length,
      total: items.length,
      files: items,
      items,
      resources: items,
      data: items,

      debug: {
        parseVersion: PARSE_VERSION,
        inputUrl: rawInputUrl,
        cleanedUrl: targetUrl,
        directResource: page.directResource,
        totalUrlsFound: allUrls.length,
        pagesScanned,
        deepLinks,
        probedCount: probeMap.size,
        htmlPreview:
          items.length === 0 && !page.directResource
            ? page.html.slice(0, 800)
            : undefined,
      },
    });
  } catch (error) {
    return sendJson(req, res, 500, {
      ok: false,
      success: false,
      status: 'error',
      error: error.message || 'Parse request failed',
      debug: {
        parseVersion: PARSE_VERSION,
        inputUrl: rawInputUrl,
        cleanedUrl: targetUrl,
      },
    });
  }
}
