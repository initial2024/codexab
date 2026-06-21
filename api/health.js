function setCors(res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Requested-With"
  );
  res.setHeader("Cache-Control", "no-store");
}

function normalizeBaseUrl(input: string) {
  return String(input || "").trim().replace(/\/+$/, "");
}

export default function handler(req: any, res: any) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      success: false,
      error: "Method Not Allowed",
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

    service: "codexab-base-backend",
    projectType: "base-extract-backend",
    version: "selfhost-base-v1",
    runtime: "vercel-node",
    time: new Date().toISOString(),

    capabilities: {
      health: true,
      chatProxy: true,
      parse: true,
      renderParse: hasDeepBackend,
      modelCheck: enableModelCheck,
    },

    endpoints: {
      health: "/api/health",
      chatProxy: "/api/chat/proxy",
      parse: "/api/parse",
      renderParse: hasDeepBackend ? "/api/render-parse" : null,
      modelCheck: enableModelCheck ? "/api/model-check" : null,
    },

    deepBackend: {
      enabled: hasDeepBackend,
      baseUrl: hasDeepBackend ? deepParseBaseUrl : null,
      note: hasDeepBackend
        ? "Deep parse requests are forwarded to the configured deep backend."
        : "DEEP_PARSE_BASE_URL is not configured, so /api/render-parse is unavailable.",
    },

    costNotice: {
      basicDiagnostics:
        "基础诊断不会请求 AI 模型，因此不消耗模型 token，但可能产生云端函数调用、带宽、运行时长和目标站请求成本。",
      aiDiagnostics:
        "AI 中转测试和模型可信度检测会发起真实模型请求，可能消耗 token、余额或中转站额度。",
    },

    warning:
      "This is a self-hosted compatible backend. Diagnostics are only for configuration checking and do not guarantee all websites, models, or upstream providers will work.",
  });
}
