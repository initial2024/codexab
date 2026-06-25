import { handleOptions, sendJson, clientIp, safeHeaders } from "./_utils.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  sendJson(res, {
    ok: true,
    endpoint: "/api/header-echo",
    method: req.method,
    serverTime: new Date().toISOString(),
    clientIpSeenByVercel: clientIp(req),
    headersSeenByVercel: safeHeaders(req.headers),
  });
}
