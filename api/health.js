export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const HEALTH_VERSION = "lingche-health-v42-compatible-from-v34.2";
const FRONTEND_TARGET = "4.2.0+";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
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
      "Range",
      "If-Range",
    ].join(", ")
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "X-Selfhost-Proxy",
      "X-Proxy-Mode",
      "X-Proxy-Version",
      "X-Lingche-Backend-Version",
      "Content-Type",
      "Content-Length",
      "Content-Disposition",
      "Accept-Ranges",
      "Content-Range",
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-backend");
  res.setHeader("X-Proxy-Version", HEALTH_VERSION);
  res.setHeader("X-Lingche-Backend-Version", HEALTH_VERSION);
}

function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(",")[0].trim();
  }

  return req.socket?.remoteAddress || "unknown";
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
}

export default function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      success: false,
      error: "Method Not Allowed",
      allow: ["GET", "HEAD", "OPTIONS"],
    });
  }

  const deepParseBaseUrl = normalizeBaseUrl(
    process.env.DEEP_PARSE_BASE_URL || ""
  );

  const hasDeepBackend = Boolean(deepParseBaseUrl);

  const allowAnyHttpsTarget = boolEnv("ALLOW_ANY_HTTPS_TARGET", false);
  const allowAnyHttpsMedia = boolEnv("ALLOW_ANY_HTTPS_MEDIA", false);
  const allowHttpMedia = boolEnv("ALLOW_HTTP_MEDIA", false);

  const allowAnyHttpsTask =
    boolEnv("ALLOW_ANY_HTTPS_TASK", false) ||
    boolEnv("ALLOW_ANY_HTTPS_TARGET", false);

  const enableImageGenerate = boolEnv("ENABLE_IMAGE_GENERATE", true);
  const enableVideoGenerate = boolEnv("ENABLE_VIDEO_GENERATE", true);
  const enableTaskApi = boolEnv("ENABLE_TASK_API", true);

  const capabilities = {
    health: true,
    tokenFreeHealthCheck: true,

    chatProxy: true,
    aiProxy: true,
    cloudProxy: true,

    headerEcho: true,
    requestEcho: true,
    requestHeaderRandomization: true,

    modelCheck: true,
    fullModelCheck: true,
    lightweightModelCheck: true,
    modelCredibilityCheck: true,

    parse: true,
    urlParse: true,
    fileParse: true,
    fileContentProxy: true,

    renderParse: hasDeepBackend,
    renderParseFallback: true,
    deepParse: hasDeepBackend,

    role: "V_PARSE_MEDIA",

    sse: true,
    binaryImage: true,
    binaryFile: true,
    base64Image: true,
    imageUrl: true,
    fileIdProxy: true,

    mediaContentProxy: true,
    mediaProxy: true,
    videoProxy: true,
    videoPreview: true,

    videoTransport: true,
    imageTransport: true,
    audioTransport: true,

    rangeRequest: true,
    partialContent: true,

    imageGenerate: enableImageGenerate,
    videoGenerate: enableVideoGenerate,

    taskStatus: enableTaskApi,
    taskCancel: enableTaskApi,
    backgroundTask: enableTaskApi,
    resumableTask: enableTaskApi,
    cancellableTask: enableTaskApi,
  };

  const endpoints = {
    health: "/api/health",

    chatProxy: "/api/chat/proxy",
    aiProxy: "/api/chat/proxy",
    cloudProxy: "/api/chat/proxy",

    headerEcho: "/api/header-echo",
    requestEcho: "/api/request-echo",

    modelCheck: "/api/model-check",
    fullModelCheck: "/api/model-check",
    lightweightModelCheck: "/api/model-check",

    parse: "/api/parse",
    fileParse: "/api/file/parse",
    fileContentProxy: "/api/file-content-proxy",

    renderParse: hasDeepBackend ? "/api/render-parse" : null,
    deepParse: hasDeepBackend ? deepParseBaseUrl : null,

    mediaContentProxy: "/api/media-content-proxy",
    mediaProxy: "/api/media-content-proxy",
    videoProxy: "/api/media-content-proxy",
    videoPreview: "/api/video-preview",

    imageGenerate: enableImageGenerate ? "/api/image-generate" : null,
    videoGenerate: enableVideoGenerate ? "/api/video-generate" : null,

    taskStatus: enableTaskApi ? "/api/task-status" : null,
    taskCancel: enableTaskApi ? "/api/task-cancel" : null,
  };

  return res.status(200).json({
    ok: true,
    success: true,
    status: "ok",
    ready: true,

    service: "lingche-vercel-backend",
    name: "lingche-v-backend",
    projectType: "ai-cloud-proxy-file-media-task-backend",

    version: HEALTH_VERSION,
    backendVersion: HEALTH_VERSION,
    frontendTarget: FRONTEND_TARGET,

    runtime: "vercel-serverless",
    time: new Date().toISOString(),

    health: true,

    chatProxy: capabilities.chatProxy,
    aiProxy: capabilities.aiProxy,
    cloudProxy: capabilities.cloudProxy,

    headerEcho: capabilities.headerEcho,
    requestEcho: capabilities.requestEcho,

    modelCheck: capabilities.modelCheck,
    fullModelCheck: capabilities.fullModelCheck,
    lightweightModelCheck: capabilities.lightweightModelCheck,
    modelCredibilityCheck: capabilities.modelCredibilityCheck,

    parse: capabilities.parse,
    fileParse: capabilities.fileParse,
    fileContentProxy: capabilities.fileContentProxy,
    renderParse: capabilities.renderParse,

    mediaContentProxy: capabilities.mediaContentProxy,
    mediaProxy: capabilities.mediaProxy,
    videoProxy: capabilities.videoProxy,
    videoPreview: capabilities.videoPreview,

    videoTransport: capabilities.videoTransport,
    imageTransport: capabilities.imageTransport,
    audioTransport: capabilities.audioTransport,

    rangeRequest: capabilities.rangeRequest,
    partialContent: capabilities.partialContent,

    imageGenerate: capabilities.imageGenerate,
    videoGenerate: capabilities.videoGenerate,

    taskStatus: capabilities.taskStatus,
    taskCancel: capabilities.taskCancel,
    backgroundTask: capabilities.backgroundTask,
    resumableTask: capabilities.resumableTask,
    cancellableTask: capabilities.cancellableTask,

    ipVisibleToVercel: clientIp(req),

    capabilities,

    supports: {
      ...capabilities,
    },

    endpoints,

    routes: {
      ...endpoints,
      tokenFreeHealthCheck: true,
    },

    chain: {
      app: "Android App",
      publicGateway: "https://feiling.ccwu.cc",
      gatewayLayer: "Cloudflare Worker",
      backendLayer: "Vercel",
      upstream: "Real AI API / Media CDN",
    },

    envHints: {
      deepParseBaseUrl: hasDeepBackend ? deepParseBaseUrl : null,
      hasDeepParseBaseUrl: hasDeepBackend,

      allowAnyHttpsTarget,
      hasAllowedTargetHosts: Boolean(process.env.ALLOWED_TARGET_HOSTS),

      allowAnyHttpsMedia,
      allowHttpMedia,
      hasAllowedMediaHosts: Boolean(process.env.ALLOWED_MEDIA_HOSTS),

      allowAnyHttpsTask,
      hasAllowedTaskHosts: Boolean(process.env.ALLOWED_TASK_HOSTS),

      enableImageGenerate,
      enableVideoGenerate,
      enableTaskApi,
    },

    env: {
      hasDeepParseBaseUrl: hasDeepBackend,

      hasAllowedTargetHosts: Boolean(process.env.ALLOWED_TARGET_HOSTS),
      allowAnyHttpsTarget,

      hasAllowedMediaHosts: Boolean(process.env.ALLOWED_MEDIA_HOSTS),
      allowAnyHttpsMedia,
      allowHttpMedia,

      hasAllowedTaskHosts: Boolean(process.env.ALLOWED_TASK_HOSTS),
      allowAnyHttpsTask,

      enableImageGenerate,
      enableVideoGenerate,
      enableTaskApi,
    },

    notes: [
      "This health endpoint is upgraded from V34.2 media-compatible backend.",
      "This file is self-contained and does not import _utils.js.",
      "chatProxy remains at /api/chat/proxy.",
      "modelCheck remains at /api/model-check.",
      "headerEcho is available at /api/header-echo.",
      "requestEcho is available at /api/request-echo.",
      "parse remains at /api/parse.",
      "fileParse remains at /api/file/parse.",
      "mediaContentProxy remains at /api/media-content-proxy.",
      "videoPreview is available at /api/video-preview.",
      "Range transport and 206 Partial Content are declared for media proxy support.",
      "renderParse is only true when DEEP_PARSE_BASE_URL is configured.",
      "imageGenerate/videoGenerate/task APIs are declared according to ENABLE_IMAGE_GENERATE, ENABLE_VIDEO_GENERATE and ENABLE_TASK_API.",
      "Background execution itself is mainly handled by Android Foreground Service / WorkManager.",
      "For large videos, prefer video_url/download_url and media-content-proxy Range transport.",
    ],
  });
}
