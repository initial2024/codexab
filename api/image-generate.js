export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
    responseLimit: false,
  },
};

const DEFAULT_ALLOWED_HOSTS = [
  "integrate.api.nvidia.com",
  "api.openai.com",
  "api.deepseek.com",
  "api2.jiushi.xin",
  "api.jiushi.xin",
];

const ALLOW_ANY_HTTPS_TARGET = process.env.ALLOW_ANY_HTTPS_TARGET === "true";

const ALLOWED_TARGET_HOSTS = (
  process.env.ALLOWED_TARGET_HOSTS || DEFAULT_ALLOWED_HOSTS.join(",")
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, x-api-key, X-Requested-With"
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Type, Content-Length, Content-Disposition, X-Upstream-Status, X-Upstream-Target"
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "image-generate");
  res.setHeader("X-Proxy-Version", "lingche-final-image-generate");
}

function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

function ensurePath(input, fallback) {
  const value = String(input || "").trim();
  if (!value) return fallback;
  if (value.startsWith("/")) return value;
  return `/${value}`;
}

function buildTargetUrl(body) {
  const direct =
    body.targetUrl ||
    body.url ||
    body.imageGenerateUrl ||
    body.endpointUrl ||
    "";

  if (direct) return String(direct).trim();

  const baseUrl = normalizeBaseUrl(
    body.apiUrl || body.baseUrl || body.baseURL || ""
  );

  const path = ensurePath(
    body.path || body.endpoint || body.imagePath,
    "/images/generations"
  );

  if (!baseUrl) return "";

  return `${baseUrl}${path}`;
}

function hostAllowed(targetUrl) {
  try {
    const url = new URL(targetUrl);

    if (url.protocol !== "https:") return false;

    const host = url.hostname.toLowerCase();

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.")
    ) {
      return false;
    }

    if (ALLOW_ANY_HTTPS_TARGET) return true;

    return ALLOWED_TARGET_HOSTS.some((allowed) => {
      if (host === allowed) return true;
      if (allowed.startsWith("*.")) return host.endsWith(allowed.slice(1));
      if (allowed.startsWith(".")) return host.endsWith(allowed);
      return false;
    });
  } catch {
    return false;
  }
}

function buildHeaders(body) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (body.headers && typeof body.headers === "object") {
    for (const [key, value] of Object.entries(body.headers)) {
      if (!key || value == null) continue;
      if (key.toLowerCase() === "host") continue;
      if (key.toLowerCase() === "content-length") continue;
      headers[key] = String(value);
    }
  }

  const apiKey =
    body.apiKey ||
    body.key ||
    body.token ||
    process.env.UPSTREAM_API_KEY ||
    "";

  if (apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function buildPayload(body) {
  if (body.payload && typeof body.payload === "object") {
    return body.payload;
  }

  const payload = {
    model: body.model,
    prompt: body.prompt || body.text || "",
  };

  if (body.n != null) payload.n = body.n;
  if (body.size) payload.size = body.size;
  if (body.quality) payload.quality = body.quality;
  if (body.style) payload.style = body.style;
  if (body.response_format) payload.response_format = body.response_format;
  if (body.responseFormat) payload.response_format = body.responseFormat;

  if (body.negativePrompt) payload.negative_prompt = body.negativePrompt;
  if (body.image) payload.image = body.image;
  if (body.images) payload.images = body.images;

  return payload;
}

function extractImageAssets(json) {
  const assets = [];

  function pushAsset(value, type = "unknown") {
    if (!value || typeof value !== "string") return;

    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("data:image/") ||
      /^[A-Za-z0-9+/=]{200,}$/.test(value)
    ) {
      assets.push({
        type,
        url: value.startsWith("http") || value.startsWith("data:") ? value : null,
        base64: value.startsWith("http") || value.startsWith("data:") ? null : value,
      });
    }
  }

  const data = json?.data;

  if (Array.isArray(data)) {
    for (const item of data) {
      pushAsset(item?.url, "url");
      pushAsset(item?.image_url, "image_url");
      pushAsset(item?.download_url, "download_url");
      pushAsset(item?.b64_json, "b64_json");
      pushAsset(item?.base64, "base64");
      pushAsset(item?.data_url, "data_url");
      pushAsset(item?.inline_data?.data, "inline_data");
    }
  }

  pushAsset(json?.url, "url");
  pushAsset(json?.image_url, "image_url");
  pushAsset(json?.download_url, "download_url");
  pushAsset(json?.b64_json, "b64_json");
  pushAsset(json?.base64, "base64");
  pushAsset(json?.data_url, "data_url");
  pushAsset(json?.output_image, "output_image");
  pushAsset(json?.result, "result");

  return assets;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      success: true,
      service: "lingche-image-generate",
      endpoint: "/api/image-generate",
      methods: ["POST"],
      defaultPath: "/images/generations",
      supports: {
        url: true,
        base64: true,
        b64_json: true,
        dataUrl: true,
        binaryImage: true,
      },
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      success: false,
      error: "Method Not Allowed",
      allow: ["GET", "POST", "OPTIONS"],
    });
  }

  try {
    const body = req.body || {};
    const targetUrl = buildTargetUrl(body);

    if (!targetUrl) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "缺少图片生成 API 地址。请传入 apiUrl/baseUrl 或 targetUrl。",
      });
    }

    if (!hostAllowed(targetUrl)) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Target host is not allowed",
        targetUrl,
        allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
        allowedTargetHosts: ALLOWED_TARGET_HOSTS,
      });
    }

    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: buildHeaders(body),
      body: JSON.stringify(buildPayload(body)),
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "";
    res.setHeader("X-Upstream-Target", targetUrl);
    res.setHeader("X-Upstream-Status", String(upstream.status));

    if (contentType.toLowerCase().startsWith("image/")) {
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(buffer.length));
      return res.end(buffer);
    }

    const text = await upstream.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!json) {
      return res.status(upstream.status).json({
        ok: upstream.ok,
        success: upstream.ok,
        status: upstream.status,
        contentType,
        rawText: text.slice(0, 4000),
      });
    }

    return res.status(upstream.status).json({
      ok: upstream.ok,
      success: upstream.ok,
      status: upstream.status,
      targetUrl,
      contentType,
      assets: extractImageAssets(json),
      raw: json,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      success: false,
      error: error?.message || String(error),
    });
  }
}
