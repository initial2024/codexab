export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
    responseLimit: false,
  },
};

const PROXY_VERSION = "lingche-chat-proxy-v46.3-final-v";

const DEFAULT_AI_TARGET =
  process.env.DEFAULT_AI_TARGET || "https://api.openai.com/v1/chat/completions";

const DEFAULT_AI_BASE_URL =
  process.env.DEFAULT_AI_BASE_URL || "https://api.openai.com/v1";

const ALLOWED_TARGET_HOSTS = (
  process.env.ALLOWED_TARGET_HOSTS ||
  [
    "integrate.api.nvidia.com",
    "ai.api.nvidia.com",
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
    "openrouter.ai",
    "api.together.xyz",
    "api.groq.com",
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

const INTERNAL_BODY_KEYS = new Set([
  "apiUrl",
  "url",
  "targetUrl",
  "baseUrl",
  "apiBaseUrl",
  "endpoint",
  "apiKey",
  "upstreamApiKey",
  "cloudBaseUrl",
  "headers",
  "body",
  "payload",
  "proxyToken",
  "apiMode",
  "endpointMode",
  "nvidiaMode",
  "providerMode",
  "compatMode",
  "keepTools",
  "keepResponseFormat",
  "keepReasoningEffort",
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
      "X-Request-ID",
      "X-Lingche-Client",
      "X-Lingche-Experiment",
      "X-Lingche-Proxy-Mode",
      "X-Lingche-NVIDIA-Mode",
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
      "X-Lingche-Provider",
      "X-Lingche-Endpoint-Mode",
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-backend");
  res.setHeader("X-Proxy-Version", PROXY_VERSION);
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

    if (
      ["integrate.api.nvidia.com", "ai.api.nvidia.com", "api.openai.com", "api.deepseek.com"].includes(hostname) &&
      (parsedUrl.pathname === "/" || parsedUrl.pathname === "")
    ) {
      parsedUrl.pathname = "/v1/chat/completions";
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
    body.baseUrl || body.apiBaseUrl || process.env.DEFAULT_AI_BASE_URL || DEFAULT_AI_BASE_URL
  );

  const endpoint = normalizeEndpoint(
    body.endpoint ||
      (String(body.apiMode || body.endpointMode || "").toLowerCase().includes("response")
        ? "/responses"
        : "/chat/completions")
  );

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

    if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
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
  if (allowed.startsWith("*.")) return host.endsWith(allowed.slice(1));
  if (allowed.startsWith(".")) return host.endsWith(allowed);
  return false;
}

function isAllowedTargetUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);

    if (url.protocol !== "https:") return false;
    if (isPrivateOrLocalUrl(targetUrl)) return false;
    if (ALLOW_ANY_HTTPS_TARGET) return true;

    return ALLOWED_TARGET_HOSTS.some((allowed) => hostMatchesAllowed(url.hostname, allowed));
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

function cloneJsonSafe(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function removeUndefinedDeep(value) {
  if (Array.isArray(value)) return value.map(removeUndefinedDeep).filter((item) => item !== undefined);
  if (!isPlainObject(value)) return value === undefined ? undefined : value;

  const out = {};
  for (const [key, val] of Object.entries(value)) {
    const cleaned = removeUndefinedDeep(val);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

function buildModelPayload(body) {
  if (body.body && typeof body.body === "object" && !Array.isArray(body.body)) {
    return { ...body.body };
  }

  if (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    return { ...body.payload };
  }

  const finalBody = { ...body };

  for (const key of INTERNAL_BODY_KEYS) {
    delete finalBody[key];
  }

  if (finalBody.maxTokens !== undefined && finalBody.max_tokens === undefined) {
    finalBody.max_tokens = finalBody.maxTokens;
  }
  delete finalBody.maxTokens;

  return finalBody;
}

function detectProvider(targetUrl) {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (host === "integrate.api.nvidia.com" || host === "ai.api.nvidia.com") return "nvidia";
    if (host === "api.openai.com") return "openai";
    if (host === "api.deepseek.com" || host.includes("deepseek")) return "deepseek";
    if (host === "api.anthropic.com") return "anthropic";
    if (host.includes("generativelanguage.googleapis.com") || host.includes("gemini")) return "gemini";
    return "openai-compatible";
  } catch {
    return "openai-compatible";
  }
}

function inferEndpointMode(body, targetUrl) {
  const explicit = String(body.apiMode || body.endpointMode || body.mode || "").toLowerCase();
  if (explicit.includes("response")) return "responses";
  try {
    const p = new URL(targetUrl).pathname.toLowerCase();
    if (p.endsWith("/responses") || p.includes("/codex/responses")) return "responses";
  } catch {}
  return "chat-completions";
}

function normalizeMessagesForResponses(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m) => {
    if (!m || typeof m !== "object") return m;
    return {
      role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    };
  });
}

function getNvidiaMode(body) {
  const raw = String(body.nvidiaMode || body.providerMode || body.compatMode || "advanced").toLowerCase();
  if (["safe", "safe-chat", "minimal", "minimum"].includes(raw)) return "safe-chat";
  if (["pass", "passthrough", "full", "raw"].includes(raw)) return "passthrough";
  return "advanced";
}

function normalizeNvidiaPayload(payload, body, endpointMode) {
  const mode = getNvidiaMode(body);
  const next = { ...payload };

  if (endpointMode === "chat-completions") {
    if (next.max_tokens === undefined && next.max_completion_tokens !== undefined) {
      next.max_tokens = next.max_completion_tokens;
    }
    delete next.max_completion_tokens;
  }

  if (mode === "passthrough") return next;

  if (mode === "safe-chat") {
    return removeUndefinedDeep({
      model: next.model,
      ...(endpointMode === "responses" ? { input: next.input } : { messages: next.messages }),
      stream: next.stream,
      temperature: typeof next.temperature === "number" ? next.temperature : undefined,
      top_p: typeof next.top_p === "number" ? next.top_p : undefined,
      ...(endpointMode === "responses"
        ? { max_output_tokens: next.max_output_tokens }
        : { max_tokens: next.max_tokens || 1024 }),
    });
  }

  if (next.reasoning_effort !== undefined && body.keepReasoningEffort !== true) {
    delete next.reasoning_effort;
  }

  if (next.tools !== undefined && body.keepTools === false) {
    delete next.tools;
  }

  if (next.response_format !== undefined && body.keepResponseFormat === false) {
    delete next.response_format;
  }

  if (endpointMode === "chat-completions" && next.max_tokens === undefined) {
    next.max_tokens = 1024;
  }

  return next;
}

function normalizePayloadForTarget(payload, targetUrl, body = {}) {
  try {
    const url = new URL(targetUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    const provider = detectProvider(targetUrl);
    const endpointMode = inferEndpointMode(body, targetUrl);

    let finalPayload = removeUndefinedDeep(cloneJsonSafe(payload) || {});

    const isResponsesLike = endpointMode === "responses";

    if (isResponsesLike) {
      if (finalPayload.messages && finalPayload.input === undefined) {
        finalPayload.input = normalizeMessagesForResponses(finalPayload.messages);
      }

      delete finalPayload.messages;

      if (finalPayload.max_output_tokens === undefined) {
        if (finalPayload.max_completion_tokens !== undefined) {
          finalPayload.max_output_tokens = finalPayload.max_completion_tokens;
        } else if (finalPayload.max_tokens !== undefined) {
          finalPayload.max_output_tokens = finalPayload.max_tokens;
        }
      }

      delete finalPayload.max_tokens;
      delete finalPayload.max_completion_tokens;
    } else {
      if (!finalPayload.messages && Array.isArray(finalPayload.input)) {
        finalPayload.messages = finalPayload.input;
      }
      if (finalPayload.messages) delete finalPayload.input;
      delete finalPayload.max_output_tokens;
    }

    if (hostname === "new.sharedchat.cc" && pathname.includes("/codex/responses")) {
      if (finalPayload.stream === undefined) finalPayload.stream = false;
    }

    if (provider === "nvidia") {
      finalPayload = normalizeNvidiaPayload(finalPayload, body, endpointMode);
    }

    return removeUndefinedDeep(finalPayload);
  } catch {
    return payload;
  }
}

function buildForwardHeaders(req, body, targetUrl) {
  const headers = { "Content-Type": "application/json" };

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
    body.headers?.Authorization || body.headers?.authorization || req.headers.authorization || "";

  if (authHeader) headers.Authorization = authHeader;

  const envKey = process.env.UPSTREAM_API_KEY || "";
  const bodyKey = body.apiKey || body.upstreamApiKey || "";
  const finalKey = envKey || bodyKey;

  if (finalKey) {
    try {
      const host = new URL(targetUrl).hostname.toLowerCase();

      if (host === "api.anthropic.com") {
        delete headers.Authorization;

        if (!headers["x-api-key"] && !headers["X-API-Key"]) headers["x-api-key"] = finalKey;
        if (!headers["anthropic-version"] && !headers["Anthropic-Version"]) {
          headers["anthropic-version"] = "2023-06-01";
        }
      } else if (!headers.Authorization) {
        headers.Authorization = finalKey.startsWith("Bearer ") ? finalKey : `Bearer ${finalKey}`;
      }
    } catch {
      if (!headers.Authorization) headers.Authorization = `Bearer ${finalKey}`;
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
    } catch {}
  }
}

async function sendUpstreamResponse(upstream, res, targetUrl, provider, endpointMode) {
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const contentTypeLower = contentType.toLowerCase();
  const server = upstream.headers.get("server") || "";
  const cfRay = upstream.headers.get("cf-ray") || "";

  if (contentTypeLower.includes("text/html")) {
    const html = await upstream.text();
    return sendJson(res, upstream.status, {
      ok: false,
      success: false,
      error: "上游返回了 HTML，不是 API JSON/图片/文件。可能是地址错误、鉴权失败或被 WAF 拦截。",
      upstreamStatus: upstream.status,
      targetUrl,
      provider,
      endpointMode,
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
  res.setHeader("X-Lingche-Provider", provider);
  res.setHeader("X-Lingche-Endpoint-Mode", endpointMode);
  copyResponseHeaders(upstream, res);

  if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", contentType);

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
    version: PROXY_VERSION,
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
      chatCompletionsApi: true,
      responsesApi: true,
      tools: true,
      toolCalling: true,
      toolChoice: true,
      parallelToolCalls: true,
      responseFormat: true,
      structuredOutput: true,
      reasoningEffortPassthrough: true,
      nvidiaAdvanced: true,
      nvidiaModes: ["safe-chat", "advanced", "passthrough"],
      toolExecutionLoop: false,
    },
    upstreamDefault: DEFAULT_AI_TARGET,
    allowedHosts: ALLOWED_TARGET_HOSTS,
    allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
    time: new Date().toISOString(),
  });
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "HEAD") return res.status(200).end();
  if (req.method === "GET") return sendProxyHealth(res);

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      success: false,
      error: "Method Not Allowed. Use POST /api/chat/proxy.",
    });
  }

  if (!checkProxyToken(req)) {
    return sendJson(res, 401, { ok: false, success: false, error: "Invalid proxy token." });
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
        hint: "如果使用第三方 API，请把它的域名加入 ALLOWED_TARGET_HOSTS，或设置 ALLOW_ANY_HTTPS_TARGET=true。",
      });
    }

    const provider = detectProvider(targetUrl);
    const endpointMode = inferEndpointMode(body, targetUrl);

    let finalBody = buildModelPayload(body);
    finalBody = normalizePayloadForTarget(finalBody, targetUrl, body);

    const headersToSend = buildForwardHeaders(req, body, targetUrl);

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: headersToSend,
      body: JSON.stringify(finalBody),
    });

    return await sendUpstreamResponse(upstream, res, targetUrl, provider, endpointMode);
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      success: false,
      error: error?.message || String(error),
      hint: "api/chat/proxy.js 已进入 catch。请检查 API URL、API Key、模型名、上游域名白名单，以及 Vercel 函数日志。",
    });
  }
}
