function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Requested-With"
  );
  res.setHeader("Cache-Control", "no-store");
}

function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

export default function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      success: false,
      error: "Method Not Allowed",
      allow: ["GET", "OPTIONS"],
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

    service: "selfhost-cloud-backend",
    projectType: "base-extract-backend",
    version: "selfhost-base-v2-health-stable",
    runtime: "vercel-serverless",
    time: new Date().toISOString(),

    capabilities: {
      health: true,
      chatProxy: true,
      parse: true,
      renderParse: hasDeepBackend,
      modelCheck: enableModelCheck,

      // 现在还没加 /api/file/parse，所以这里先写 false
      fileParse: false,
    },

    endpoints: {
      health: "/api/health",
      chatProxy: "/api/chat/proxy",
      parse: "/api/parse",
      renderParse: hasDeepBackend ? "/api/render-parse" : null,
      modelCheck: enableModelCheck ? "/api/model-check" : null,

      // 现在还没加接口，所以这里先写 null
      fileParse: null,
    },

    routes: {
      health: "/api/health",
      chatProxy: "/api/chat/proxy",
      parse: "/api/parse",
      renderParse: hasDeepBackend ? "/api/render-parse" : null,
      modelCheck: enableModelCheck ? "/api/model-check" : null,
      fileParse: null,
    },

    deepBackend: {
      enabled: hasDeepBackend,
      baseUrl: hasDeepBackend ? deepParseBaseUrl : null,
      note: hasDeepBackend
        ? "Deep parse requests are forwarded to the configured deep backend."
        : "DEEP_PARSE_BASE_URL is not configured, so deep parse is unavailable.",
    },

    warning:
      "This is a self-hosted backend. File parse is not enabled in this deployment yet.",
  });
}
