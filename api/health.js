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
    ].join(", ")
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "X-Selfhost-Proxy",
      "X-Proxy-Mode",
      "X-Proxy-Version",
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-backend");
  res.setHeader("X-Proxy-Version", "lingche-health-ultra-compatible");
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

  return res.status(200).json({
    ok: true,
    success: true,
    status: "ok",
    ready: true,

    service: "lingche-vercel-backend",
    projectType: "ai-cloud-proxy-and-file-backend",
    version: "lingche-health-ultra-compatible",
    runtime: "vercel-serverless",
    time: new Date().toISOString(),

    /**
     * 兼容灵澈 App 可能直接读取顶层字段的情况
     */
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

    /**
     * 兼容读取 capabilities.xxx 的情况
     */
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
    },

    /**
     * 兼容读取 supports.xxx 的情况
     */
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
    },

    chain: {
      app: "Android App",
      publicGateway: "https://feiling.ccwu.cc",
      gatewayLayer: "Cloudflare Worker",
      backendLayer: "Vercel",
      upstream: "Real AI API",
    },

    env: {
      hasDeepParseBaseUrl: hasDeepBackend,
      hasAllowedTargetHosts: Boolean(process.env.ALLOWED_TARGET_HOSTS),
      allowAnyHttpsTarget,
    },

    notes: [
      "App should use https://feiling.ccwu.cc as W cloud backend address.",
      "Cloudflare Worker forwards /api/* requests to this Vercel backend.",
      "chatProxy is available at /api/chat/proxy.",
      "modelCheck is available at /api/model-check.",
      "fileParse is declared at /api/file/parse.",
      "fileContentProxy is declared at /api/file-content-proxy.",
    ],
  });
}
