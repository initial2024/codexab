export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

const HEALTH_VERSION = "lingche-health-v42.6-hobby-safe-from-v34.2";
const FRONTEND_TARGET = "4.2.6+";

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

  const companionWOrigin = normalizeBaseUrl(
    process.env.PUBLIC_GATEWAY_ORIGIN ||
      process.env.W_BACKEND_ORIGIN ||
      ""
  );

  const hasDeepBackend = Boolean(deepParseBaseUrl);
  const hasCompanionW = Boolean(companionWOrigin);

  const allowAnyHttpsTarget = boolEnv("ALLOW_ANY_HTTPS_TARGET", false);
  const allowAnyHttpsMedia = boolEnv("ALLOW_ANY_HTTPS_MEDIA", false);
  const allowHttpMedia = boolEnv("ALLOW_HTTP_MEDIA", false);

  const allowAnyHttpsTask =
    boolEnv("ALLOW_ANY_HTTPS_TASK", false) ||
    boolEnv("ALLOW_ANY_HTTPS_TARGET", false);

  const enableImageGenerate = boolEnv("ENABLE_IMAGE_GENERATE", true);
  const enableVideoGenerate = boolEnv("ENABLE_VIDEO_GENERATE", true);
  const enableTaskApi = boolEnv("ENABLE_TASK_API", true);

  const mediaProxyEndpoint = "/api/media-content-proxy";

  const wEndpoints = {
    multimediaProxy: "/api/multimedia/proxy",
    multimediaTest: "/api/multimedia/test",
    genericApiProxy: "/api/generic-api/proxy",

    imageGenerate: "/api/image-generate",
    videoGenerate: "/api/video-generate",
    audioGenerate: "/api/audio-generate",

    repairProxy: "/api/repair/proxy",
    repairTest: "/api/repair/test",
    repairTaskQuery: "/api/repair/task-query",
    repairResultQuery: "/api/repair/result-query",
  };

  const capabilities = {
    health: true,
    tokenFreeHealthCheck: true,

    role: "V_PARSE_MEDIA_DOWNLOAD",

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
    fileContentProxyViaMediaProxy: true,

    renderParse: false,
    renderParseFallback: true,
    deepParse: hasDeepBackend,

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
    videoPreviewViaMediaProxy: true,

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

    multimediaConfigWizard: true,
    multimediaTemplateConfig: true,
    multimediaDocParseConfig: true,
    multimediaStaticConfigCheck: true,

    multimediaRealConfigTestViaW: true,
    genericMultimediaProxyViaW: true,

    imageGenerationProxyViaW: true,
    videoGenerationProxyViaW: true,
    audioGenerationProxyViaW: true,

    repairModelConfig: true,
    repairModelIndependent: true,
    repairConfigWizard: true,
    repairRealConfigTestViaW: true,
    repairProxyViaW: true,
    repairTaskQueryViaW: true,
    repairResultQueryViaW: true,

    localRepairProxy: false,
    localGenericMultimediaProxy: false,

    downloadCenterRepair: true,
    localLightRepairPlan: true,
    aiRepairAnalysis: true,
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

    fileContentProxy: mediaProxyEndpoint,
    fileContentProxyNote:
      "Hobby-safe: fileContentProxy is handled by /api/media-content-proxy.",

    renderParse: null,
    renderParseNote:
      "Hobby-safe: no local /api/render-parse function. Use DEEP_PARSE_BASE_URL if deep parse is needed.",

    deepParse: hasDeepBackend ? deepParseBaseUrl : null,

    mediaContentProxy: mediaProxyEndpoint,
    mediaProxy: mediaProxyEndpoint,
    videoProxy: mediaProxyEndpoint,
    videoPreview: mediaProxyEndpoint,
    videoPreviewNote:
      "Hobby-safe: videoPreview is handled by /api/media-content-proxy.",

    imageGenerate: enableImageGenerate ? "/api/image-generate" : null,
    videoGenerate: enableVideoGenerate ? "/api/video-generate" : null,

    taskStatus: enableTaskApi ? "/api/task-status" : null,
    taskCancel: enableTaskApi ? "/api/task-cancel" : null,

    multimediaProxy: null,
    multimediaTest: null,
    genericApiProxy: null,

    repairProxy: null,
    repairTest: null,
    repairTaskQuery: null,
    repairResultQuery: null,

    companionWOrigin: hasCompanionW ? companionWOrigin : null,
    companionWEndpoints: wEndpoints,

    wMultimediaProxy: wEndpoints.multimediaProxy,
    wMultimediaTest: wEndpoints.multimediaTest,
    wGenericApiProxy: wEndpoints.genericApiProxy,

    wImageGenerate: wEndpoints.imageGenerate,
    wVideoGenerate: wEndpoints.videoGenerate,
    wAudioGenerate: wEndpoints.audioGenerate,

    wRepairProxy: wEndpoints.repairProxy,
    wRepairTest: wEndpoints.repairTest,
    wRepairTaskQuery: wEndpoints.repairTaskQuery,
    wRepairResultQuery: wEndpoints.repairResultQuery,
  };

  const activeFunctionBudget = {
    plan: "Vercel Hobby",
    maxServerlessFunctions: 12,
    recommendedFunctions: [
      "api/health.js",
      "api/chat/proxy.js",
      "api/model-check.js",
      "api/parse.js",
      "api/file/parse.js",
      "api/media-content-proxy.js",
      "api/image-generate.js",
      "api/video-generate.js",
      "api/task-status.js",
      "api/task-cancel.js",
      "api/header-echo.js",
      "api/request-echo.js",
    ],
    shouldNotCreateInThisProject: [
      "api/video-preview.js",
      "api/file-content-proxy.js",
      "api/render-parse.js",
      "api/_utils.js",
      "api/multimedia/proxy.js",
      "api/repair/proxy.js",
      "api/audio-generate.js",
      "api/image-repair.js",
      "api/video-repair.js",
      "api/audio-repair.js",
      "api/file-repair.js",
    ],
    v42_6Rule:
      "V42.6 multimedia/repair real proxy should be handled by Cloudflare Worker, not by adding more Vercel functions.",
  };

  return res.status(200).json({
    ok: true,
    success: true,
    status: "ok",
    ready: true,

    service: "lingche-vercel-backend",
    name: "lingche-v-backend",
    projectType: "file-parse-media-download-backend",

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
    fileContentProxyViaMediaProxy: capabilities.fileContentProxyViaMediaProxy,

    renderParse: capabilities.renderParse,
    deepParse: capabilities.deepParse,

    mediaContentProxy: capabilities.mediaContentProxy,
    mediaProxy: capabilities.mediaProxy,
    videoProxy: capabilities.videoProxy,
    videoPreview: capabilities.videoPreview,
    videoPreviewViaMediaProxy: capabilities.videoPreviewViaMediaProxy,

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

    multimediaConfigWizard: capabilities.multimediaConfigWizard,
    multimediaStaticConfigCheck: capabilities.multimediaStaticConfigCheck,
    multimediaRealConfigTestViaW: capabilities.multimediaRealConfigTestViaW,
    genericMultimediaProxyViaW: capabilities.genericMultimediaProxyViaW,

    repairModelConfig: capabilities.repairModelConfig,
    repairModelIndependent: capabilities.repairModelIndependent,
    repairProxyViaW: capabilities.repairProxyViaW,
    repairTaskQueryViaW: capabilities.repairTaskQueryViaW,

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

    functionBudget: activeFunctionBudget,

    chain: {
      app: "Android App",
      publicGateway: hasCompanionW ? companionWOrigin : "Cloudflare Worker / W backend",
      gatewayLayer: "Cloudflare Worker",
      backendLayer: "Vercel",
      upstream: "Real AI API / Media CDN / Repair API",
    },

    envHints: {
      companionWOrigin: hasCompanionW ? companionWOrigin : null,
      hasCompanionW,

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
      hasCompanionW,

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
      "This health endpoint is upgraded from V34.2 media-compatible backend to V42.6 declaration.",
      "This file is self-contained and does not import _utils.js.",
      "This version is Vercel Hobby safe: no extra video-preview/file-content-proxy/render-parse/multimedia/repair functions are required.",
      "V backend handles parse, fileParse, mediaContentProxy, download preview and Range transport.",
      "W backend handles chat proxy, model check, multimedia config real test, generic multimedia proxy and repair proxy.",
      "videoPreview is handled by /api/media-content-proxy.",
      "fileContentProxy is handled by /api/media-content-proxy.",
      "local renderParse function is disabled to avoid exceeding Vercel Hobby function limit.",
      "If deep parse is needed, configure DEEP_PARSE_BASE_URL as an external deep backend.",
      "V42.6 multimedia and repair proxy should use Cloudflare Worker routes such as /api/multimedia/proxy and /api/repair/proxy.",
      "Repair model configuration is independent from chat model configuration.",
      "Static config wizard does not consume quota; real config test should be confirmed by the user because it may consume token or API quota.",
    ],
  });
}
