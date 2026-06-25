export const config = {
  api: {
    bodyParser: {
      sizeLimit: "10mb",
    },
    responseLimit: "10mb",
  },
};

const PARSE_VERSION = "lingche-parse-v42-compatible-from-v34.2";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,HEAD");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Proxy-Token",
      "X-API-Key",
      "x-api-key",
      "X-Request-ID",
      "X-Lingche-Client",
      "X-Lingche-Experiment",
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-parse");
  res.setHeader("X-Proxy-Version", PARSE_VERSION);
}

function sendJson(res, statusCode, data) {
  setCors(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(data, null, 2));
}

function normalizeTargetUrl(input) {
  let value = String(input || "").trim();

  if (!value) return "";

  value = value.replace(/^["'`]+|["'`]+$/g, "").trim();

  const match = value.match(/https?:\/\/[^\s"'`<>]+/i);

  if (match) {
    value = match[0];
  }

  value = value.replace(/[),.;，。；]+$/g, "").trim();

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  return value;
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

function validateUrl(input) {
  const targetUrl = normalizeTargetUrl(input);

  if (!targetUrl) {
    throw new Error("缺少 URL。");
  }

  const url = new URL(targetUrl);

  if (url.protocol !== "https:") {
    throw new Error("parse 只允许 https URL。");
  }

  if (isPrivateOrLocalUrl(targetUrl)) {
    throw new Error("禁止解析 localhost、内网地址或本地地址。");
  }

  return url;
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html) {
  const matched = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return matched ? stripHtml(matched[1]).slice(0, 200) : "";
}

function getUrlFromReq(req, body = {}) {
  const rawUrl = req.url || "";
  const base = `https://${req.headers.host || "localhost"}`;
  const parsed = new URL(rawUrl, base);

  return (
    parsed.searchParams.get("url") ||
    parsed.searchParams.get("u") ||
    body.url ||
    body.u ||
    body.targetUrl ||
    ""
  );
}

function safeText(input) {
  return String(input || "");
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  if (req.method === "GET" && !getUrlFromReq(req)) {
    return sendJson(res, 200, {
      ok: true,
      success: true,
      status: "ok",
      ready: true,
      service: "lingche-parse",
      endpoint: "/api/parse",
      version: PARSE_VERSION,
      methods: ["GET", "POST", "OPTIONS", "HEAD"],
      supports: {
        urlParse: true,
        textParse: true,
        htmlStrip: true,
        titleExtract: true,
        fetchFallback: true,
      },
      usage: {
        get: "/api/parse?url=https%3A%2F%2Fexample.com",
        postUrl: {
          url: "https://example.com",
        },
        postText: {
          title: "文本标题",
          text: "需要解析的文本",
        },
      },
      time: new Date().toISOString(),
    });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return sendJson(res, 405, {
      ok: false,
      success: false,
      error: "Method Not Allowed. Use GET/POST /api/parse.",
    });
  }

  try {
    const body = req.method === "POST" ? req.body || {} : {};

    if (!getUrlFromReq(req, body) && body.text) {
      const text = safeText(body.text);

      return sendJson(res, 200, {
        ok: true,
        success: true,
        source: "text",
        title: body.title || "用户文本",
        text,
        length: text.length,
        version: PARSE_VERSION,
      });
    }

    const target = getUrlFromReq(req, body);
    const url = validateUrl(target);

    const started = Date.now();

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "User-Agent": req.headers["user-agent"] || "Lingche-Parser/42",
        Accept: "text/html,text/plain,application/json,*/*",
      },
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";
    const raw = await upstream.text();

    const isHtml =
      contentType.toLowerCase().includes("html") ||
      /<html|<body|<title/i.test(raw.slice(0, 1000));

    const text = isHtml ? stripHtml(raw) : raw;
    const maxChars = Number(process.env.PARSE_MAX_CHARS || 200000);

    return sendJson(res, upstream.ok ? 200 : 502, {
      ok: upstream.ok,
      success: upstream.ok,
      status: upstream.status,
      source: "url",
      url: url.toString(),
      title: isHtml ? extractTitle(raw) : "",
      contentType,
      isHtml,
      text: text.slice(0, maxChars),
      length: text.length,
      truncated: text.length > maxChars,
      durationMs: Date.now() - started,
      version: PARSE_VERSION,
    });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      success: false,
      error: error?.message || String(error),
      hint:
        "parse 处理失败。请检查 URL 是否为 https、是否为公网地址、网页是否阻止服务器抓取。",
      version: PARSE_VERSION,
    });
  }
}
