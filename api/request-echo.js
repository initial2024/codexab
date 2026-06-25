import {
  handleOptions,
  sendJson,
  readBody,
  clientIp,
  randomizedHeaders,
  normalizeUrl,
} from "./_utils.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  const body = req.method === "POST" ? await readBody(req) : {};
  const generatedHeaders = randomizedHeaders(body.extraHeaders || {});

  const result = {
    ok: true,
    endpoint: "/api/request-echo",
    serverTime: new Date().toISOString(),
    clientIpSeenByVercel: clientIp(req),
    generatedHeaders,
    verification: {
      attempted: false,
      success: false,
      message: "未填写 echoUrl 或未确认 confirm=true，因此未发起外部验证请求。",
    },
  };

  if (body.echoUrl && body.confirm === true) {
    try {
      const echoUrl = normalizeUrl(body.echoUrl, { allowHttp: false });
      const started = Date.now();

      const upstream = await fetch(echoUrl.toString(), {
        method: "GET",
        headers: generatedHeaders,
      });

      const raw = await upstream.text();

      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {}

      result.verification = {
        attempted: true,
        success: upstream.ok,
        status: upstream.status,
        durationMs: Date.now() - started,
        responseContentType: upstream.headers.get("content-type") || "",
        responsePreview: raw.slice(0, 2000),
        parsedJson: parsed,
        possibleEgressIp:
          parsed?.origin ||
          parsed?.ip ||
          parsed?.clientIp ||
          parsed?.client_ip ||
          "无法确认",
      };
    } catch (err) {
      result.verification = {
        attempted: true,
        success: false,
        message: err?.message || String(err),
      };
    }
  }

  sendJson(res, result);
}
