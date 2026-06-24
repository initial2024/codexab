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
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "video-generate");
  res.setHeader("X-Proxy-Version", "lingche-final-video-generate");
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
    body.videoGenerateUrl ||
    body.endpointUrl ||
    "";

  if (direct) return String(direct).trim();

  const baseUrl = normalizeBaseUrl(
    body.apiUrl || body.baseUrl || body.baseURL || ""
  );

  const path = ensurePath(
    body.path || body.endpoint || body.videoPath,
    "/video/generations"
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

  if (body.duration != null) payload.duration = body.duration;
  if (body.seconds != null) payload.seconds = body.seconds;
  if (body.size) payload.size = body.size;
  if (body.resolution) payload.resolution = body.resolution;
  if (body.aspectRatio) payload.aspect_ratio = body.aspectRatio;
  if (body.aspect_ratio) payload.aspect_ratio = body.aspect_ratio;
  if (body.image) payload.image = body.image;
  if (body.firstFrame) payload.image = body.firstFrame;
  if (body.first_frame) payload.first_frame = body.first_frame;

  return payload;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function normalizeVideoResult(json) {
  const data0 = Array.isArray(json?.data) ? json.data[0] : null;

  const taskId = firstString(
    json?.task_id,
    json?.taskId,
    json?.job_id,
    json?.jobId,
    json?.id,
    json?.request_id,
    json?.requestId,
    data0?.task_id,
    data0?.job_id,
    data0?.id
  );

  const status = firstString(
    json?.status,
    json?.state,
    json?.task_status,
    data0?.status,
    data0?.state
  );

  const videoUrl = firstString(
    json?.video_url,
    json?.videoUrl,
    json?.url,
    json?.output_url,
    json?.download_url,
    json?.downloadUrl,
    data0?.video_url,
    data0?.url,
    data0?.output_url,
    data0?.download_url
  );

  const thumbnailUrl = firstString(
    json?.thumbnail_url,
    json?.thumbnailUrl,
    json?.cover_url,
    data0?.thumbnail_url,
    data0?.cover_url
  );

  return {
    taskId,
    status,
    videoUrl,
    downloadUrl: videoUrl,
    thumbnailUrl,
    isAsync: Boolean(taskId && !videoUrl),
    isReady: Boolean(videoUrl),
  };
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
      service: "lingche-video-generate",
      endpoint: "/api/video-generate",
      methods: ["POST"],
      defaultPath: "/video/generations",
      supports: {
        taskId: true,
        videoUrl: true,
        downloadUrl: true,
        asyncTask: true,
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
        error: "缺少视频生成 API 地址。请传入 apiUrl/baseUrl 或 targetUrl。",
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
        targetUrl,
        contentType,
        rawText: text.slice(0, 4000),
      });
    }

    const normalized = normalizeVideoResult(json);

    return res.status(upstream.status).json({
      ok: upstream.ok,
      success: upstream.ok,
      status: upstream.status,
      targetUrl,
      ...normalized,
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
