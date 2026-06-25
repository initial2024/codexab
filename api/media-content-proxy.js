import {
  handleOptions,
  setCors,
  sendJson,
  normalizeUrl,
  isMediaHostAllowed,
} from "./_utils.js";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

function copyHeader(upstream, headers, name, outName = name) {
  const value = upstream.headers.get(name);
  if (value) headers[outName] = value;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (!["GET", "HEAD"].includes(req.method)) {
    return sendJson(
      res,
      {
        ok: false,
        success: false,
        error: "media-content-proxy 只支持 GET / HEAD。",
      },
      405
    );
  }

  try {
    const url = normalizeUrl(req.query.url, {
      allowHttp: process.env.ALLOW_HTTP_MEDIA === "true",
    });

    if (!isMediaHostAllowed(url)) {
      return sendJson(
        res,
        {
          ok: false,
          success: false,
          error:
            "媒体域名未允许。请设置 ALLOW_ANY_HTTPS_MEDIA=true，或把域名加入 ALLOWED_MEDIA_HOSTS。",
          host: url.hostname,
        },
        403
      );
    }

    const started = Date.now();

    const headers = {
      "User-Agent": req.headers["user-agent"] || "Lingche-Media-Proxy/42",
      Accept: req.headers.accept || "*/*",
    };

    if (req.headers.range) headers.Range = req.headers.range;
    if (req.headers.referer) headers.Referer = req.headers.referer;

    const upstream = await fetch(url.toString(), {
      method: req.method,
      headers,
      redirect: "follow",
    });

    const outHeaders = {
      "X-Lingche-Proxy-Status": String(upstream.status),
      "X-Lingche-Duration-Ms": String(Date.now() - started),
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      "Cache-Control": "public, max-age=300",
    };

    copyHeader(upstream, outHeaders, "content-type");
    copyHeader(upstream, outHeaders, "content-length");
    copyHeader(upstream, outHeaders, "content-range");
    copyHeader(upstream, outHeaders, "etag");
    copyHeader(upstream, outHeaders, "last-modified");

    setCors(res, outHeaders);

    res.status(upstream.status);

    if (req.method === "HEAD") {
      return res.end();
    }

    const arrayBuffer = await upstream.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    return sendJson(
      res,
      {
        ok: false,
        success: false,
        error: String(error?.message || error),
      },
      500
    );
  }
}
