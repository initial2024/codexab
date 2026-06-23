function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,HEAD");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Proxy-Token",
      "X-API-Key",
      "x-api-key"
    ].join(", ")
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "X-Selfhost-Proxy",
      "X-Proxy-Mode",
      "X-Proxy-Version",
      "X-Upstream-Status",
      "X-Upstream-Target"
    ].join(", ")
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "vercel-backend");
  res.setHeader("X-Proxy-Version", "lingche-backend-v10-health");
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

  const enableModelCheck = process.env.ENABLE_MODEL_CHECK !== "false";
  const hasDeepBackend = Boolean(deepParseBaseUrl);

  return res.status(200).json({
    ok: true,
    success: true,
    status: "ok",
    ready: true,

    service: "lingche-vercel-backend",
    projectType: "ai-cloud-proxy-and-file-backend",
    version: "lingche-v10-health-stable",
    runtime: "vercel-serverless",
    time: new Date().toISOString(),

    chain: {
      app: "Android App",
      publicGateway: "https://feiling.ccwu.cc",
      gatewayLayer: "Cloudflare Worker",
      backendLayer: "Vercel",
      upstream: "Real AI API"
    },

    capabilities: {
      health: true,
      chatProxy: true,
      parse: true,
      renderParse: hasDeepBackend,
      modelCheck: enableModelCheck,

      fileParse: true,
      fileContentProxy: true,

      sse: true,
      binaryImage: true,
      binaryFile: true,
      base64Image: true,
      imageUrl: true,
      fileIdProxy: true
    },

    endpoints: {
      health: "/api/health",
      chatProxy: "/api/chat/proxy",
      parse: "/api/parse",
      renderParse: hasDeepBackend ? "/api/render-parse" : null,
      modelCheck: enableModelCheck ? "/api/model-check" : null,
      fileParse: "/api/file/parse",
      fileContentProxy: "/api/file-content-proxy"
    },

    routes: {
      health: "/api/health",
      chatProxy: "/api/chat/proxy",
      parse: "/api/parse",
      renderParse: hasDeepBackend ? "/api/render-parse" : null,
      modelCheck: enableModelCheck ? "/api/model-check" : null,
      fileParse: "/api/file/parse",
      fileContentProxy: "/api/file-content-proxy"
    },

    deepBackend: {
      enabled: hasDeepBackend,
      baseUrl: hasDeepBackend ? deepParseBaseUrl : null,
      note: hasDeepBackend
        ? "Deep parse requests are forwarded to the configured deep backend."
        : "DEEP_PARSE_BASE_URL is not configured, so deep render parse is unavailable."
    },

    notes: [
      "App should use https://feiling.ccwu.cc as the cloud backend address.",
      "Cloudflare Worker should forward /api/* requests to this Vercel backend.",
      "This health endpoint only proves the Vercel backend is alive after the request reaches it."
    ]
  });
}
