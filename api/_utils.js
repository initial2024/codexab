export const BACKEND_VERSION = "v42-compatible-final-v";
export const FRONTEND_TARGET = "4.2.0+";

export function cors(res, extra = {}) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, X-Request-ID, Range, X-Lingche-Client, X-Lingche-Experiment",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Type, Content-Length, Content-Range, Accept-Ranges, X-Lingche-Duration-Ms, X-Lingche-Proxy-Status",
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  for (const [k, v] of Object.entries(extra)) {
    res.setHeader(k, v);
  }
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    cors(res);
    res.status(204).end();
    return true;
  }
  return false;
}

export function sendJson(res, data, status = 200) {
  cors(res, { "Content-Type": "application/json; charset=utf-8" });
  res.status(status).send(JSON.stringify(data, null, 2));
}

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return { raw: req.body };
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

export function safeHeaders(headers) {
  const out = {};

  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();

    if (["authorization", "cookie", "x-api-key"].includes(key)) {
      out[k] = "[redacted]";
    } else {
      out[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    }
  }

  return out;
}

export function normalizeUrl(raw, { allowHttp = false } = {}) {
  const value = String(raw || "").trim();
  if (!value) throw new Error("缺少 url 参数。");

  const url = new URL(value);

  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("只允许 https URL；如需 http，请显式设置 ALLOW_HTTP_MEDIA=true。");
  }

  return url;
}

export function hostAllowed(url, env = process.env) {
  const allowAny = String(env.ALLOW_ANY_HTTPS_MEDIA || "false") === "true";
  if (allowAny) return true;

  const raw = String(env.ALLOWED_MEDIA_HOSTS || "").trim();
  if (!raw) return false;

  const host = url.hostname.toLowerCase();

  return raw
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith("*.")) return host.endsWith(rule.slice(1));
      return host === rule;
    });
}

export function randomId(prefix = "lc") {
  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function randomizedHeaders(seed = {}) {
  const langs = [
    "zh-CN,zh;q=0.9,en;q=0.7",
    "zh-CN,zh;q=0.8",
    "en-US,en;q=0.9,zh-CN;q=0.6",
  ];

  const accepts = [
    "application/json, text/plain, */*",
    "application/json,*/*",
    "application/json;charset=utf-8, */*;q=0.8",
  ];

  return {
    Accept: accepts[Math.floor(Math.random() * accepts.length)],
    "Accept-Language": langs[Math.floor(Math.random() * langs.length)],
    "X-Request-ID": randomId("lingche"),
    "X-Lingche-Experiment": "header-randomization-v1",
    ...seed,
  };
}

export function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractTitle(html) {
  const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 200) : "";
}
