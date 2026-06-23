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
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-backend");
  res.setHeader("X-Proxy-Version", "lingche-model-check-final");
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
      if (
        pathname === "/" ||
        pathname === "" ||
        pathname === "/codex" ||
        pathname === "/codex/"
      ) {
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

function extractTextFromResponse(data) {
  try {
    if (typeof data === "string") return data;

    const choiceText =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      data?.output_text ??
      data?.content?.[0]?.text ??
      data?.data?.[0]?.text;

    if (typeof choiceText === "string") return choiceText;

    if (Array.isArray(data?.output)) {
      const parts = [];
      for (const item of data.output) {
        if (typeof item?.content === "string") parts.push(item.content);
        if (Array.isArray(item?.content)) {
          for (const c of item.content) {
            if (typeof c?.text === "string") parts.push(c.text);
          }
        }
      }
      if (parts.length) return parts.join("\n");
    }

    return JSON.stringify(data);
  } catch {
    return "";
  }
}

function buildCheckPayload(body) {
  const model = body.model || body.aiModel || body.modelName;

  const prompt =
    body.prompt ||
    "只回复 OK，不要输出其他内容。This is a lightweight model check. Reply only OK.";

  const payload = {
    model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0,
    max_tokens: 8,
    stream: false,
  };

  if (body.max_tokens || body.maxTokens) {
    payload.max_tokens = Number(body.max_tokens || body.maxTokens) || 8;
  }

  return payload;
}

async function callModelOnce(req, body, targetUrl) {
  const payload = buildCheckPayload(body);
  const headers = buildForwardHeaders(req, body, targetUrl);

  const start = Date.now();

  const upstream = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const elapsedMs = Date.now() - start;
  const contentType = upstream.headers.get("content-type") || "";
  const text = await upstream.text();

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const responseText = extractTextFromResponse(parsed || text);

  return {
    ok: upstream.ok,
    success: upstream.ok,
    status: upstream.status,
    elapsedMs,
    contentType,
    responseText,
    raw: parsed || text.slice(0, 2000),
  };
}

function scoreModelCheck(result) {
  let score = 0;
  const reasons = [];

  if (result.ok) {
    score += 50;
    reasons.push("上游 HTTP 状态正常。");
  } else {
    reasons.push(`上游 HTTP 状态异常：${result.status}。`);
  }

  const text = String(result.responseText || "").trim();

  if (text) {
    score += 25;
    reasons.push("模型返回了可解析文本。");
  } else {
    reasons.push("模型没有返回可解析文本。");
  }

  if (/ok/i.test(text)) {
    score += 20;
    reasons.push("模型按要求返回 OK 或近似结果。");
  } else if (text.length > 0) {
    score += 10;
    reasons.push("模型有输出，但未严格按要求只回复 OK。");
  }

  if (result.elapsedMs > 0 && result.elapsedMs < 20000) {
    score += 5;
    reasons.push("响应耗时在可接受范围内。");
  }

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    level:
      score >= 90
        ? "high"
        : score >= 70
        ? "medium"
        : score >= 50
        ? "low"
        : "failed",
    reasons,
  };
}

function sendModelCheckHealth(res) {
  return sendJson(res, 200, {
    ok: true,
    success: true,
    status: "ok",
    ready: true,
    service: "lingche-model-check",
    endpoint: "/api/model-check",
    methods: ["GET", "POST", "OPTIONS", "HEAD"],
    supports: {
      modelCheck: true,
      fullModelCheck: true,
      lightweightModelCheck: true,
      cloudModelCheck: true,
    },
    notes: [
      "POST this endpoint with apiUrl/baseUrl, model and apiKey to run a small real model check.",
      "This endpoint may consume a small amount of upstream tokens.",
    ],
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
    return sendModelCheckHealth(res);
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      success: false,
      error: "Method Not Allowed. Use POST /api/model-check.",
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

    const targetUrl = normalizeTargetUrl(buildTargetUrlFromBody(body));

    if (!targetUrl) {
      return sendJson(res, 400, {
        ok: false,
        success: false,
        error: "API地址未填写，无法进行模型检测。",
      });
    }

    if (!isAllowedTargetUrl(targetUrl)) {
      return sendJson(res, 403, {
        ok: false,
        success: false,
        error: "Target host is not allowed",
        targetUrl,
        allowedHosts: ALLOWED_TARGET_HOSTS,
        allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
      });
    }

    const result = await callModelOnce(req, body, targetUrl);
    const credibility = scoreModelCheck(result);

    return sendJson(res, result.ok ? 200 : 502, {
      ok: result.ok,
      success: result.ok,
      status: result.status,
      targetUrl,
      model: body.model || body.aiModel || body.modelName || null,
      elapsedMs: result.elapsedMs,
      responseText: result.responseText,
      credibility,
      raw: result.raw,
      time: new Date().toISOString(),
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      success: false,
      error: error?.message || String(error),
      hint:
        "完整模型检测失败。请检查真实 API URL、API Key、模型名、Vercel 环境变量和上游服务状态。",
    });
  }
}
