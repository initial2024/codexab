import { handleOptions, sendJson, clientIp, safeHeaders } from "./_utils.js";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  return sendJson(res, {
    ok: true,
    success: true,
    endpoint: "/api/header-echo",
    method: req.method,
    serverTime: new Date().toISOString(),
    clientIpSeenByVercel: clientIp(req),
    headersSeenByVercel: safeHeaders(req.headers),
  });
}
