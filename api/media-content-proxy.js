export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const PROXY_VERSION = "lingche-media-content-proxy-v42-compatible-from-v34.2";

const DEFAULT_ALLOWED_MEDIA_HOSTS = [
  "integrate.api.nvidia.com",
  "api.openai.com",
  "api.deepseek.com",
  "api2.jiushi.xin",
  "api.jiushi.xin",
  "new.sharedchat.cc",
];

const ALLOWED_MEDIA_HOSTS = (
  process.env.ALLOWED_MEDIA_HOSTS ||
  DEFAULT_ALLOWED_MEDIA_HOSTS.join(",")
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ALLOW_ANY_HTTPS_MEDIA = process.env.ALLOW_ANY_HTTPS_MEDIA === "true";
const ALLOW_HTTP_MEDIA = process.env.ALLOW_HTTP_MEDIA === "true";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function setCors(res, extra = {}) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "Range",
      "If-Range",
      "X-Requested-With",
      "X-Proxy-Token",
      "X-API-Key",
      "x-api-key",
      "X-Request-ID",
      "X-Lingche-Client",
      "X-Lingche-Experiment",
    ].join(", ")
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "Content-Type",
      "Content-Length",
      "Content-Disposition",
      "Accept-Ranges",
      "Content-Range",
      "ETag",
      "Last-Modified",
      "X-Selfhost-Proxy",
      "X-Proxy-Mode",
      "X-Proxy-Version",
      "X-Upstream-Status",
      "X-Upstream-Target",
      "X-Lingche-Duration-Ms",
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-media-proxy");
  res.setHeader("X-Proxy-Version", PROXY_VERSION);

  for (const [key, value] of Object.entries(extra)) {
    res.setHeader(key, value);
  }
}

function sendJson(res, statusCode, data) {
  setCors(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(data, null, 2));
}

function ensureUrl(input) {
  const raw = String(input || "").trim();

  if (!raw) return "";

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw}`;
}

function isPrivateOrLocalUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const host = url.hostname.toLowerCase();

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local")
    ) {
      return true;
    }

    if (
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.")
    ) {
      return true;
    }

    const parts = host.split(".").map(Number);

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

function hostMatchesAllowed(hostname, allowedHost) {
  const host = hostname.toLowerCase();
  const allowed = allowedHost.toLowerCase();

  if (host === allowed) return true;

  if (allowed.startsWith("*.")) {
    return host.endsWith(allowed.slice(1));
  }

  if (allowed.startsWith(".")) {
    return host.endsWith(allowed);
  }

  return false;
}

function isAllowedMediaUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);

    if (url.protocol !== "https:" && !(ALLOW_HTTP_MEDIA && url.protocol === "http:")) {
      return false;
    }

    if (isPrivateOrLocalUrl(targetUrl)) {
      return false;
    }

    if (ALLOW_ANY_HTTPS_MEDIA && url.protocol === "https:") {
      return true;
    }

    return ALLOWED_MEDIA_HOSTS.some((allowed) =>
      hostMatchesAllowed(url.hostname, allowed)
    );
  } catch {
    return false;
  }
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function readRequestBody(req) {
  if (req.body) return safeJsonParse(req.body, {});

  try {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    return safeJsonParse(raw, {});
  } catch {
    return {};
  }
}

function getTargetUrlFromQuery(req) {
  const rawUrl = req.url || "";
  const base = `https://${req.headers.host || "localhost"}`;
  const parsed = new URL(rawUrl, base);

  return (
    parsed.searchParams.get("url") ||
    parsed.searchParams.get("u") ||
    parsed.searchParams.get("mediaUrl") ||
    parsed.searchParams.get("fileUrl") ||
    parsed.searchParams.get("downloadUrl") ||
    parsed.searchParams.get("videoUrl") ||
    parsed.searchParams.get("imageUrl") ||
    ""
  );
}

function pickTargetFromBody(body) {
  return (
    body.url ||
    body.u ||
    body.mediaUrl ||
    body.fileUrl ||
    body.downloadUrl ||
    body.videoUrl ||
    body.imageUrl ||
    ""
  );
}

function buildForwardHeaders(req, body = {}) {
  const headers = {};

  const range = req.headers.range || req.headers.Range;

  if (range) {
    headers.Range = Array.isArray(range) ? range[0] : range;
  }

  const ifRange = req.headers["if-range"] || req.headers["If-Range"];

  if (ifRange) {
    headers["If-Range"] = Array.isArray(ifRange) ? ifRange[0] : ifRange;
  }

  const userAgent = req.headers["user-agent"];

  if (userAgent) {
    headers["User-Agent"] = Array.isArray(userAgent)
      ? userAgent[0]
      : userAgent;
  } else {
    headers["User-Agent"] = "Lingche-Media-Proxy/42";
  }

  headers.Accept = req.headers.accept || "*/*";

  if (req.headers.referer) {
    headers.Referer = Array.isArray(req.headers.referer)
      ? req.headers.referer[0]
      : req.headers.referer;
  }

  if (body.headers && typeof body.headers === "object") {
    for (const [key, value] of Object.entries(body.headers)) {
      if (!key || value == null) continue;

      const lower = key.toLowerCase();

      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === "content-length") continue;

      headers[key] = String(value);
    }
  }

  const authHeader =
    body.headers?.Authorization ||
    body.headers?.authorization ||
    req.headers.authorization ||
    "";

  if (authHeader) {
    headers.Authorization = Array.isArray(authHeader)
      ? authHeader[0]
      : authHeader;
  }

  const envKey = process.env.UPSTREAM_API_KEY || "";
  const bodyKey = body.apiKey || body.upstreamApiKey || "";
  const finalKey = envKey || bodyKey;

  if (finalKey && !headers.Authorization) {
    headers.Authorization = `Bearer ${finalKey}`;
  }

  return headers;
}

function copyResponseHeaders(upstream, res) {
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower.startsWith("access-control-")) continue;

    try {
      res.setHeader(key, value);
    } catch {
      // ignore invalid header
    }
  }
}

function sendHealth(res) {
  return sendJson(res, 200, {
    ok: true,
    success: true,
    status: "ok",
    ready: true,
    service: "lingche-media-content-proxy",
    endpoint: "/api/media-content-proxy",
    version: PROXY_VERSION,
    methods: ["GET", "HEAD", "POST", "OPTIONS"],
    supports: {
      image: true,
      video: true,
      audio: true,
      file: true,
      range: true,
      partialContent: true,
      contentDisposition: true,
      authForward: true,
      binaryStream: true,
      htmlGuard: true,
    },
    usage: {
      get: "/api/media-content-proxy?url=https%3A%2F%2Fexample.com%2Fvideo.mp4",
      post: {
        url: "https://example.com/video.mp4",
        headers: {
          Authorization: "Bearer xxx",
        },
      },
    },
    allowedMediaHosts: ALLOWED_MEDIA_HOSTS,
    allowAnyHttpsMedia: ALLOW_ANY_HTTPS_MEDIA,
    allowHttpMedia: ALLOW_HTTP_MEDIA,
    time: new Date().toISOString(),
  });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "HEAD" && !getTargetUrlFromQuery(req)) {
    return res.status(200).end();
  }

  if (req.method === "GET" && !getTargetUrlFromQuery(req)) {
    return sendHealth(res);
  }

  if (!["GET", "HEAD", "POST"].includes(req.method)) {
    return sendJson(res, 405, {
      ok: false,
      success: false,
      error: "Method Not Allowed. Use GET/HEAD/POST /api/media-content-proxy.",
    });
  }

  try {
    const body = req.method === "POST" ? await readRequestBody(req) : {};

    const rawTarget =
      req.method === "POST" ? pickTargetFromBody(body) : getTargetUrlFromQuery(req);

    const targetUrl = ensureUrl(rawTarget);

    if (!targetUrl) {
      return sendJson(res, 400, {
        ok: false,
        success: false,
        error: "缺少媒体 URL。请传入 url / mediaUrl / fileUrl / downloadUrl。",
      });
    }

    if (!isAllowedMediaUrl(targetUrl)) {
      return sendJson(res, 403, {
        ok: false,
        success: false,
        error: "Media host is not allowed",
        targetUrl,
        allowedMediaHosts: ALLOWED_MEDIA_HOSTS,
        allowAnyHttpsMedia: ALLOW_ANY_HTTPS_MEDIA,
        hint:
          "如果视频/图片来自第三方 CDN，请把域名加入 ALLOWED_MEDIA_HOSTS，或测试时设置 ALLOW_ANY_HTTPS_MEDIA=true。",
      });
    }

    const started = Date.now();

    const upstream = await fetch(targetUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: buildForwardHeaders(req, body),
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";
    const contentTypeLower = contentType.toLowerCase();
    const server = upstream.headers.get("server") || "";
    const cfRay = upstream.headers.get("cf-ray") || "";

    if (contentTypeLower.includes("text/html")) {
      const preview =
        req.method === "HEAD" ? "" : (await upstream.text()).slice(0, 1000);

      return sendJson(res, upstream.status, {
        ok: false,
        success: false,
        error:
          "媒体地址返回 HTML，不是图片/视频/文件。可能是链接过期、鉴权失败、被防盗链拦截或地址不是直链。",
        upstreamStatus: upstream.status,
        targetUrl,
        contentType,
        server,
        cfRay,
        preview,
      });
    }

    setCors(res);
    res.status(upstream.status);
    res.setHeader("X-Upstream-Target", targetUrl);
    res.setHeader("X-Upstream-Status", String(upstream.status));
    res.setHeader("X-Lingche-Duration-Ms", String(Date.now() - started));
    res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");

    copyResponseHeaders(upstream, res);

    if (req.method === "HEAD") {
      return res.end();
    }

    const arrayBuffer = await upstream.arrayBuffer();
    return res.end(Buffer.from(arrayBuffer));
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      success: false,
      error: error?.message || String(error),
      hint:
        "media-content-proxy 处理失败。请检查媒体 URL、白名单、鉴权、Range 请求和上游 CDN 状态。",
    });
  }
}
