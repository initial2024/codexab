export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

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
  res.setHeader("X-Proxy-Version", "lingche-health-final-from-v18");
}

function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
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

  const allowAnyHttpsTarget = process.env.ALLOW_ANY_HTTPS_TARGET === "true";
  const allowAnyHttpsMedia = process.env.ALLOW_ANY_HTTPS_MEDIA === "true";
  const allowAnyHttpsTask =
    process.env.ALLOW_ANY_HTTPS_TASK === "true" ||
    process.env.ALLOW_ANY_HTTPS_TARGET === "true";

  return res.status(200).json({
    ok: true,
    success: true,
    status: "ok",
    ready: true,

    service: "lingche-vercel-backend",
    projectType: "ai-cloud-proxy-file-media-task-backend",
    version: "lingche-health-final-from-v18",
    runtime: "vercel-serverless",
    time: new Date().toISOString(),

    health: true,

    chatProxy: true,
    aiProxy: true,
    cloudProxy: true,

    modelCheck: true,
    fullModelCheck: true,
    lightweightModelCheck: true,
    modelCredibilityCheck: true,

    parse: true,
    fileParse: true,
    fileContentProxy: true,
    renderParse: hasDeepBackend,

    mediaContentProxy: true,
    mediaProxy: true,
    videoProxy: true,
    videoTransport: true,
    imageTransport: true,
    audioTransport: true,
    rangeRequest: true,
    partialContent: true,

    imageGenerate: true,
    videoGenerate: true,
    taskStatus: true,
    taskCancel: true,
    backgroundTask: true,
    resumableTask: true,
    cancellableTask: true,

    capabilities: {
      health: true,

      chatProxy: true,
      aiProxy: true,
      cloudProxy: true,

      modelCheck: true,
      fullModelCheck: true,
      lightweightModelCheck: true,
      modelCredibilityCheck: true,

      parse: true,
      fileParse: true,
      fileContentProxy: true,
      renderParse: hasDeepBackend,

      sse: true,
      binaryImage: true,
      binaryFile: true,
      base64Image: true,
      imageUrl: true,
      fileIdProxy: true,

      mediaContentProxy: true,
      mediaProxy: true,
      videoProxy: true,
      videoTransport: true,
      imageTransport: true,
      audioTransport: true,
      rangeRequest: true,
      partialContent: true,

      imageGenerate: true,
      videoGenerate: true,
      taskStatus: true,
      taskCancel: true,
      backgroundTask: true,
      resumableTask: true,
      cancellableTask: true,
    },

    supports: {
      health: true,

      chatProxy: true,
      aiProxy: true,
      cloudProxy: true,

      modelCheck: true,
      fullModelCheck: true,
      lightweightModelCheck: true,
      modelCredibilityCheck: true,

      parse: true,
      fileParse: true,
      fileContentProxy: true,
      renderParse: hasDeepBackend,

      sse: true,
      binaryImage: true,
      binaryFile: true,
      base64Image: true,
      imageUrl: true,
      fileIdProxy: true,

      mediaContentProxy: true,
      mediaProxy: true,
      videoProxy: true,
      videoTransport: true,
      imageTransport: true,
      audioTransport: true,
      rangeRequest: true,
      partialContent: true,

      imageGenerate: true,
      videoGenerate: true,
      taskStatus: true,
      taskCancel: true,
      backgroundTask: true,
      resumableTask: true,
      cancellableTask: true,
    },

    endpoints: {
      health: "/api/health",

      chatProxy: "/api/chat/proxy",
      aiProxy: "/api/chat/proxy",
      cloudProxy: "/api/chat/proxy",

      modelCheck: "/api/model-check",
      fullModelCheck: "/api/model-check",
      lightweightModelCheck: "/api/model-check",

      parse: "/api/parse",
      fileParse: "/api/file/parse",
      fileContentProxy: "/api/file-content-proxy",
      renderParse: hasDeepBackend ? "/api/render-parse" : null,

      mediaContentProxy: "/api/media-content-proxy",
      mediaProxy: "/api/media-content-proxy",
      videoProxy: "/api/media-content-proxy",

      imageGenerate: "/api/image-generate",
      videoGenerate: "/api/video-generate",
      taskStatus: "/api/task-status",
      taskCancel: "/api/task-cancel",
    },

    routes: {
      health: "/api/health",

      chatProxy: "/api/chat/proxy",
      aiProxy: "/api/chat/proxy",
      cloudProxy: "/api/chat/proxy",

      modelCheck: "/api/model-check",
      fullModelCheck: "/api/model-check",
      lightweightModelCheck: "/api/model-check",

      parse: "/api/parse",
      fileParse: "/api/file/parse",
      fileContentProxy: "/api/file-content-proxy",
      renderParse: hasDeepBackend ? "/api/render-parse" : null,

      mediaContentProxy: "/api/media-content-proxy",
      mediaProxy: "/api/media-content-proxy",
      videoProxy: "/api/media-content-proxy",

      imageGenerate: "/api/image-generate",
      videoGenerate: "/api/video-generate",
      taskStatus: "/api/task-status",
      taskCancel: "/api/task-cancel",
    },

    chain: {
      app: "Android App",
      publicGateway: "https://feiling.ccwu.cc",
      gatewayLayer: "Cloudflare Worker",
      backendLayer: "Vercel",
      upstream: "Real AI API / Media CDN",
    },

    env: {
      hasDeepParseBaseUrl: hasDeepBackend,
      hasAllowedTargetHosts: Boolean(process.env.ALLOWED_TARGET_HOSTS),
      allowAnyHttpsTarget,
      hasAllowedMediaHosts: Boolean(process.env.ALLOWED_MEDIA_HOSTS),
      allowAnyHttpsMedia,
      hasAllowedTaskHosts: Boolean(process.env.ALLOWED_TASK_HOSTS),
      allowAnyHttpsTask,
    },

    notes: [
      "This backend is upgraded from v18 media-compatible backend.",
      "chatProxy remains at /api/chat/proxy.",
      "modelCheck remains at /api/model-check.",
      "mediaContentProxy remains at /api/media-content-proxy.",
      "imageGenerate is available at /api/image-generate.",
      "videoGenerate is available at /api/video-generate.",
      "taskStatus is available at /api/task-status.",
      "taskCancel is available at /api/task-cancel.",
      "Background execution itself is mainly handled by Android Foreground Service / WorkManager.",
      "For large videos, prefer video_url/download_url and media-content-proxy Range transport.",
    ],
  });
}
