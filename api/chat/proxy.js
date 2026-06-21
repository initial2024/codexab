import { Readable } from "node:stream";

export const config = {
  api: {
    bodyParser: true,
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
    "api.openai.com",
    "new.sharedchat.cc",
    "api.deepseek.com",
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

function setCors(req, res) {
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
      "X-Selfhost-Proxy",
      "X-Proxy-Mode",
      "X-Proxy-Version",
      "X-Upstream-Target",
      "X-Upstream-Status",
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "cloud");
  res.setHeader("X-Proxy-Version", "selfhost-chat-proxy-v3");
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
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
  if (req.body) {
    return safeJsonParse(req.body, {});
  }

  try {
    const chunks = [];

    for await (const chunk of req) {
      chunks.push(chunk);
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

function isAllowedTargetUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);

    if (url.protocol !== "https:") {
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

  const token = req.headers["x-proxy-token"];

  if (Array.isArray(token)) {
    return token.includes(PROXY_TOKEN);
  }

  return token === PROXY_TOKEN;
}

function looksLikeFullApiEndpoint(urlString) {
  try {
    const url = new URL(urlString);
    const pathname = url.pathname.toLowerCase();

    return (
      pathname.endsWith("/chat/completions") ||
      pathname.endsWith("/responses") ||
      pathname.endsWith("/codex/responses") ||
      pathname.includes("/v1/chat/completions")
    );
  } catch {
    return false;
  }
}

function buildTargetUrlFromBody(body) {
  const explicitTarget = body.apiUrl || body.url || body.targetUrl;

  if (explicitTarget) {
    return normalizeTargetUrl(String(explicitTarget));
  }

  const baseUrl = normalizeBaseUrl(
    body.baseUrl ||
      body.apiBaseUrl ||
      process.env.DEFAULT_AI_BASE_URL ||
      DEFAULT_AI_BASE_URL
  );

  const endpoint = normalizeEndpoint(body.endpoint || "/chat/completions");

  if (baseUrl) {
    if (looksLikeFullApiEndpoint(baseUrl)) {
      return normalizeTargetUrl(baseUrl);
    }

    return normalizeTargetUrl(`${baseUrl}${endpoint}`);
  }

  return normalizeTargetUrl(DEFAULT_AI_TARGET);
}

function normalizeTargetUrl(targetUrl) {
  try {
    const parsedUrl = new URL(targetUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    const pathOrig = parsedUrl.pathname.toLowerCase();

    if (hostname === "new.sharedchat.cc") {
      if (pathOrig === "/" || pathOrig === "") {
        return `${parsedUrl.origin}/codex/responses`;
      }

      if (pathOrig === "/codex" || pathOrig === "/codex/") {
        return `${parsedUrl.origin}/codex/responses`;
      }

      if (pathOrig.includes("/v1/chat/completions")) {
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

function buildUpstreamHeaders(req, body, targetUrl) {
  const headersToSend = {
    "Content-Type": "application/json",
  };

  if (body.headers && typeof body.headers === "object") {
    for (const [key, value] of Object.entries(body.headers)) {
      if (!key || value == null) continue;

      const lower = key.toLowerCase();

      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower === "content-type") continue;
      if (lower === "content-length") continue;

      headersToSend[key] = String(value);
    }
  }

  const authHeader =
    body.headers?.Authorization ||
    body.headers?.authorization ||
    req.headers.authorization ||
    "";

  if (authHeader) {
    headersToSend.Authorization = authHeader;
  }

  const envKey = process.env.UPSTREAM_API_KEY || "";
  const bodyKey = body.apiKey || body.upstreamApiKey || "";
  const finalKey = envKey || bodyKey;

  if (finalKey) {
    try {
      const host = new URL(targetUrl).hostname.toLowerCase();

      if (host === "api.anthropic.com") {
        delete headersToSend.Authorization;

        if (!headersToSend["x-api-key"] && !headersToSend["X-API-Key"]) {
          headersToSend["x-api-key"] = finalKey;
        }

        if (
          !headersToSend["anthropic-version"] &&
          !headersToSend["Anthropic-Version"]
        ) {
          headersToSend["anthropic-version"] = "2023-06-01";
        }
      } else if (!headersToSend.Authorization) {
        headersToSend.Authorization = `Bearer ${finalKey}`;
      }
    } catch {
      if (!headersToSend.Authorization) {
        headersToSend.Authorization = `Bearer ${finalKey}`;
      }
    }
  }

  return headersToSend;
}

async function sendUpstreamResponse(res, upstream, targetUrl) {
  const contentType =
    upstream.headers.get("content-type") || "application/json; charset=utf-8";

  const contentTypeLower = contentType.toLowerCase();
  const server = upstream.headers.get("server") || "";
  const cfRay = upstream.headers.get("cf-ray") || "";

  res.setHeader("X-Upstream-Target", targetUrl);
  res.setHeader("X-Upstream-Status", String(upstream.status));

  if (contentTypeLower.includes("text/html")) {
    const html = await upstream.text();

    return sendJson(res, upstream.status, {
      ok: false,
      error: "Upstream returned HTML instead of API JSON/SSE.",
      upstreamStatus: upstream.status,
      targetUrl,
      contentType,
      server,
      cfRay,
      likelyReason:
        upstream.status === 403 ||
        server.toLowerCase().includes("cloudflare") ||
        cfRay
          ? "Likely blocked by Cloudflare/WAF, or the upstream does not allow cloud/serverless IP access."
          : "Likely wrong API endpoint. Check whether the request should go to /v1/chat/completions, /v1/responses, or /codex/responses.",
      preview: html.slice(0, 1000),
    });
  }

  res.statusCode = upstream.status;
  res.setHeader("Content-Type", contentType);

  if (contentTypeLower.includes("text/event-stream")) {
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
  }

  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();

    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "content-type") continue;
    if (lower === "content-encoding") continue;
    if (lower.startsWith("access-control-")) continue;

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

    nodeStream.on("error", reject);
    res.on("finish", resolve);
    res.on("error", reject);

    nodeStream.pipe(res);
  });
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "HEAD") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      success: true,
      status: "ok",
      ready: true,
      service: "codexab-ai-proxy",
      type: "ai-proxy",
      endpoint: "/api/chat/proxy",
      methods: ["GET", "POST", "OPTIONS", "HEAD"],
      supportedRequestForms: [
        {
          mode: "full target",
          example: {
            apiUrl: "https://api.openai.com/v1/chat/completions",
          },
        },
        {
          mode: "baseUrl + endpoint",
          example: {
            baseUrl: "https://api.openai.com/v1",
            endpoint: "/chat/completions",
          },
        },
      ],
      upstreamDefault: DEFAULT_AI_TARGET,
      allowedHosts: ALLOWED_TARGET_HOSTS,
      allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
      time: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method Not Allowed",
    });
  }

  if (!checkProxyToken(req)) {
    return sendJson(res, 401, {
      ok: false,
      error: "Invalid proxy token",
    });
  }

  const body = await readRequestBody(req);

  let targetUrl = buildTargetUrlFromBody(body);

  if (!isAllowedTargetUrl(targetUrl)) {
    return sendJson(res, 403, {
      ok: false,
      error: "Target host is not allowed",
      targetUrl,
      allowedHosts: ALLOWED_TARGET_HOSTS,
      allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
      hint:
        "如果你使用第三方中转站，请把它的域名加入 ALLOWED_TARGET_HOSTS，或设置 ALLOW_ANY_HTTPS_TARGET=true。",
    });
  }

  let finalBody = buildModelPayload(body);
  finalBody = normalizePayloadForTarget(finalBody, targetUrl);

  const headersToSend = buildUpstreamHeaders(req, body, targetUrl);

  if (
    !headersToSend.Authorization &&
    !headersToSend["x-api-key"] &&
    !headersToSend["X-API-Key"]
  ) {
    return sendJson(res, 401, {
      ok: false,
      error:
        "Missing API key. 请在前端填写 API Key，或在云端环境变量 UPSTREAM_API_KEY 中配置。",
    });
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: headersToSend,
      body: JSON.stringify(finalBody),
    });

    return await sendUpstreamResponse(res, upstream, targetUrl);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: error?.message || "Proxy request failed",
      targetUrl,
      hint:
        "请检查 API Base URL、endpoint、API Key、模型名，以及中转站是否允许云端服务器访问。",
    });
  }
      }
