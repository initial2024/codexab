import {
  BACKEND_VERSION,
  FRONTEND_TARGET,
  handleOptions,
  sendJson,
  clientIp,
} from "./_utils.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  sendJson(res, {
    ok: true,
    name: "lingche-v-backend",
    backendVersion: BACKEND_VERSION,
    frontendTarget: FRONTEND_TARGET,
    time: new Date().toISOString(),
    ipVisibleToVercel: clientIp(req),
    capabilities: {
      role: "V_PARSE_MEDIA",
      fileParse: true,
      urlParse: true,
      renderParseFallback: true,
      mediaContentProxy: true,
      videoPreview: true,
      rangeRequest: true,
      partialContent: true,
      headerEcho: true,
      requestEcho: true,
      modelCheck: true,
      tokenFreeHealthCheck: true,
    },
    envHints: {
      allowAnyHttpsMedia: String(process.env.ALLOW_ANY_HTTPS_MEDIA || "false") === "true",
      hasAllowedMediaHosts: !!String(process.env.ALLOWED_MEDIA_HOSTS || "").trim(),
      allowHttpMedia: String(process.env.ALLOW_HTTP_MEDIA || "false") === "true",
    },
  });
}
