export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
    responseLimit: false,
  },
};

const DEFAULT_AI_TARGET =
  process.env.DEFAULT_AI_TARGET || "https://api.openai.com/v1/chat/completions";

const DEFAULT_AI_BASE_URL =
  process.env.DEFAULT_AI_BASE_URL || "https://api.openai.com/v1";

const ALLOWED_TARGET_HOSTS = (
  process.env.ALLOWED_TARGET_HOSTS ||
  [
    "integrate.api.nvidia.com",
    "api.openai.com",
    "api.deepseek.com",
    "api2.jiushi.xin",
    "api.jiushi.xin",
    "new.sharedchat.cc",
    "api.siliconflow.cn",
    "dashscope.aliyuncs.com",
    "api.moonshot.cn",
    "open.bigmodel.cn",
    "api.minimax.chat",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const ALLOW_ANY_HTTPS_TARGET = process.env.ALLOW_ANY_HTTPS_TARGET === "true";
const PROXY_TOKEN = process.env.PROXY_TOKEN || "";

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
  "content-length",
]);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,HEAD");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "X-Proxy-Token",
      "X-API-Key",
      "x-api-key",
      "Anthropic-Version",
      "anthropic-version",
      "OpenAI-Organization",
      "OpenAI-Project",
    ].join(", ")
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "Content-Type",
      "Content-Disposition",
      "X-Selfhost-Proxy",
      "X-Proxy-Mode",
      "X-Proxy-Version",
      "X-Upstream-Target",
      "X-Upstream-Status",
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-backend");
  res.setHeader("X-Proxy-Version", "lingche-chat-proxy-safe-final");
}

function sendJson(res, statusCode, data) {
  res.status(statusCode);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(data, null, 2));
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

function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

function normalizeEndpoint(input) {
  const endpoint = String(input || "/chat/completions").trim();
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

function ensureHttpsUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeTargetUrl(targetUrl) {
  const fixed = ensureHttpsUrl(targetUrl);

  try {
    const parsedUrl = new URL(fixed);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (hostname === "new.sharedchat.cc") {
      if (pathname === "/" || pathname === "" || pathname === "/codex" || pathname === "/codex/") {
        return `${parsedUrl.origin}/codex/responses`;
      }

      if (pathname.includes("/v1/chat/completions")) {
        return `${parsedUrl.origin}/codex/responses`;
      }
    }

    return parsedUrl.toString();
  } catch {
    return fixed;
  }
}

function looksLikeFullEndpoint(urlString) {
  try {
    const url = new URL(ensureHttpsUrl(urlString));
    const p = url.pathname.toLowerCase();

    return (
      p.endsWith("/chat/completions") ||
      p.endsWith("/responses") ||
      p.endsWith("/codex/responses") ||
      p.endsWith("/messages") ||
      p.endsWith("/images/generations") ||
      p.endsWith("/audio/speech") ||
      p.endsWith("/audio/transcriptions") ||
      p.endsWith("/embeddings") ||
      p.includes("/v1/chat/completions")
    );
  } catch {
    return false;
  }
}

function buildTargetUrlFromBody(body) {
  const explicit = body.apiUrl || body.url || body.targetUrl;

  if (explicit) {
    const normalized = normalizeTargetUrl(String(explicit));

    if (looksLikeFullEndpoint(normalized)) {
      return normalized;
    }

    const endpoint = normalizeEndpoint(body.endpoint || "/chat/completions");
    return normalizeTargetUrl(`${normalizeBaseUrl(normalized)}${endpoint}`);
  }

  const baseUrl = normalizeBaseUrl(
    body.baseUrl ||
      body.apiBaseUrl ||
      process.env.DEFAULT_AI_BASE_URL ||
      DEFAULT_AI_BASE_URL
  );

  const endpoint = normalizeEndpoint(body.endpoint || "/chat/completions");

  if (looksLikeFullEndpoint(baseUrl)) {
    return normalizeTargetUrl(baseUrl);
  }

  if (baseUrl) {
    return normalizeTargetUrl(`${baseUrl}${endpoint}`);
  }

  return normalizeTargetUrl(DEFAULT_AI_TARGET);
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

function isAllowedTargetUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);

    if (url.protocol !== "https:") return false;
    if (isPrivateOrLocalUrl(targetUrl)) return false;
    if (ALLOW_ANY_HTTPS_TARGET) return true;

    return ALLOWED_TARGET_HOSTS.some((allowed) =>
      hostMatchesAllowed(url.hostname, allowed)
    );
  } catch {
    return false;
  }
}

function checkProxyToken(req) {
  if (!PROXY_TOKEN) return true;

  const token = req.headers["x-proxy-token"];
  if (Array.isArray(token)) return token.includes(PROXY_TOKEN);
  return token === PROXY_TOKEN;
}

function buildModelPayload(body) {
  if (
    body.body &&
    typeof body.body === "object" &&
    !Array.isArray(body.body)
  ) {
    return { ...body.body };
  }

  const finalBody = { ...body };

  delete finalBody.apiUrl;
  delete finalBody.url;
  delete finalBody.targetUrl;
  delete finalBody.baseUrl;
  delete finalBody.apiBaseUrl;
  delete finalBody.endpoint;
  delete finalBody.apiKey;
  delete finalBody.upstreamApiKey;
  delete finalBody.cloudBaseUrl;
  delete finalBody.headers;
  delete finalBody.body;
  delete finalBody.proxyToken;

  return finalBody;
}

function normalizePayloadForTarget(payload, targetUrl) {
  try {
    const url = new URL(targetUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    const finalPayload = { ...payload };

    const isResponsesLike =
      pathname.endsWith("/responses") ||
      pathname.includes("/codex/responses");

    if (isResponsesLike) {
      if (finalPayload.messages && !finalPayload.input) {
        finalPayload.input = finalPayload.messages;
        delete finalPayload.messages;
      }

      if (finalPayload.max_tokens && !finalPayload.max_output_tokens) {
        finalPayload.max_output_tokens = finalPayload.max_tokens;
        delete finalPayload.max_tokens;
      }
    }

    if (
      hostname === "new.sharedchat.cc" &&
      pathname.includes("/codex/responses")
    ) {
      if (finalPayload.stream === undefined) {
        finalPayload.stream = false;
      }
    }

    return finalPayload;
  } catch {
    return payload;
  }
}

function buildForwardHeaders(req, body, targetUrl) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (body.headers && typeof body.headers === "object") {
    for (const [key, value] of Object.entries(body.headers)) {
      if (!key || value == null) continue;

      const lower = key.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === "content-type") continue;
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
    headers.Authorization = authHeader;
  }

  const envKey = process.env.UPSTREAM_API_KEY || "";
  const bodyKey = body.apiKey || body.upstreamApiKey || "";
  const finalKey = envKey || bodyKey;

  if (finalKey) {
    try {
      const host = new URL(targetUrl).hostname.toLowerCase();

      if (host === "api.anthropic.com") {
        delete headers.Authorization;

        if (!headers["x-api-key"] && !headers["X-API-Key"]) {
          headers["x-api-key"] = finalKey;
        }

        if (!headers["anthropic-version"] && !headers["Anthropic-Version"]) {
          headers["anthropic-version"] = "2023-06-01";
        }
      } else if (!headers.Authorization) {
        headers.Authorization = `Bearer ${finalKey}`;
      }
    } catch {
      if (!headers.Authorization) {
        headers.Authorization = `Bearer ${finalKey}`;
      }
    }
  }

  return headers;
}

function copyResponseHeaders(upstream, res) {
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "content-length") continue;
    if (lower === "content-encoding") continue;
    if (lower.startsWith("access-control-")) continue;

    try {
      res.setHeader(key, value);
    } catch {
      // ignore
    }
  }
}

async function sendUpstreamResponse(upstream, res, targetUrl) {
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const contentTypeLower = contentType.toLowerCase();
  const contentDisposition = upstream.headers.get("content-disposition") || "";
  const server = upstream.headers.get("server") || "";
  const cfRay = upstream.headers.get("cf-ray") || "";

  if (contentTypeLower.includes("text/html")) {
    const html = await upstream.text();

    return sendJson(res, upstream.status, {
      ok: false,
      success: false,
      error:
        "上游返回了 HTML，不是 API JSON/图片/文件。可能是地址错误、鉴权失败或被 WAF 拦截。",
      upstreamStatus: upstream.status,
      targetUrl,
      contentType,
      server,
      cfRay,
      preview: html.slice(0, 1000),
    });
  }

  const arrayBuffer = await upstream.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  res.status(upstream.status);
  res.setHeader("X-Upstream-Target", targetUrl);
  res.setHeader("X-Upstream-Status", String(upstream.status));
  copyResponseHeaders(upstream, res);

  if (!res.getHeader("Content-Type")) {
    res.setHeader("Content-Type", contentType);
  }

  if (contentTypeLower.includes("text/event-stream")) {
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
  }

  return res.end(buffer);
}

function sendProxyHealth(res) {
  return sendJson(res, 200, {
    ok: true,
    success: true,
    status: "ok",
    ready: true,
    service: "lingche-vercel-ai-proxy",
    type: "ai-proxy",
    endpoint: "/api/chat/proxy",
    methods: ["GET", "POST", "OPTIONS", "HEAD"],
    supports: {
      json: true,
      sse: true,
      binaryImage: true,
      binaryFile: true,
      base64ImageJson: true,
      imageUrlJson: true,
      htmlGuard: true,
      safeArrayBufferForward: true,
    },
    upstreamDefault: DEFAULT_AI_TARGET,
    allowedHosts: ALLOWED_TARGET_HOSTS,
    allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
    time: new Date().toISOString(),
  });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    return sendProxyHealth(res);
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      success: false,
      error: "Method Not Allowed. Use POST /api/chat/proxy.",
    });
  }

  if (!checkProxyToken(req)) {
    return sendJson(res, 401, {
      ok: false,
      success: false,
      error: "Invalid proxy token.",
    });
  }

  try {
    const body = await readRequestBody(req);

    let targetUrl = buildTargetUrlFromBody(body);

    if (!targetUrl) {
      return sendJson(res, 400, {
        ok: false,
        success: false,
        error: "API地址未填写，请在设置中配置真实 API URL。",
      });
    }

    targetUrl = normalizeTargetUrl(targetUrl);

    if (!isAllowedTargetUrl(targetUrl)) {
      return sendJson(res, 403, {
        ok: false,
        success: false,
        error: "Target host is not allowed",
        targetUrl,
        allowedHosts: ALLOWED_TARGET_HOSTS,
        allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
        hint:
          "如果使用第三方 API，请把它的域名加入 ALLOWED_TARGET_HOSTS，或设置 ALLOW_ANY_HTTPS_TARGET=true。",
      });
    }

    let finalBody = buildModelPayload(body);
    finalBody = normalizePayloadForTarget(finalBody, targetUrl);

    const headersToSend = buildForwardHeaders(req, body, targetUrl);

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: headersToSend,
      body: JSON.stringify(finalBody),
    });

    return await sendUpstreamResponse(upstream, res, targetUrl);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      success: false,
      error: error?.message || String(error),
      hint:
        "api/chat/proxy.js 已进入 catch。请检查 API URL、API Key、模型名、上游域名白名单，以及 Vercel 函数日志。",
    });
  }
}
