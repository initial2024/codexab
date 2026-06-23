import {
  setCors,
  normalizeTargetUrl,
  isAllowedTargetUrl,
  buildModelPayload,
  buildForwardHeaders,
  isBinaryResponseContentType,
  copyUpstreamHeaders,
  sendBinaryResponse,
  sendTextOrJsonResponse
} from '../_utils.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    },
    responseLimit: false
  }
};

function sendHealth(res) {
  return res.status(200).json({
    ok: true,
    success: true,
    status: 'ok',
    ready: true,
    service: 'lingche-vercel-ai-proxy',
    endpoint: '/api/chat/proxy',
    methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
    supports: {
      json: true,
      sse: true,
      binaryImage: true,
      binaryFile: true,
      htmlGuard: true
    },
    time: new Date().toISOString()
  });
}

async function pipeSseResponse(upstream, res) {
  res.status(upstream.status);
  copyUpstreamHeaders(upstream.headers, res, {
    keepContentType: true,
    keepDisposition: true
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  if (!upstream.body) {
    return res.end();
  }

  const reader = upstream.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }

  return res.end();
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'HEAD') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return sendHealth(res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'use POST /api/chat/proxy'
    });
  }

  try {
    const body = req.body || {};

    let targetUrl = body.apiUrl || body.url || body.targetUrl;

    if (!targetUrl) {
      return res.status(400).json({
        ok: false,
        error: 'API地址未填写，请在设置中配置真实 API URL。'
      });
    }

    targetUrl = normalizeTargetUrl(String(targetUrl));

    if (!isAllowedTargetUrl(targetUrl)) {
      return res.status(403).json({
        ok: false,
        error: `Target host is not allowed: ${targetUrl}`,
        hint: '如果你使用第三方中转站，请把它的域名加入 ALLOWED_TARGET_HOSTS，或在后端允许该 HTTPS 目标。'
      });
    }

    const finalBody = buildModelPayload(body);

    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: buildForwardHeaders(body, req, true),
      body: JSON.stringify(finalBody)
    });

    const contentType = upstream.headers.get('content-type') || '';
    const contentDisposition = upstream.headers.get('content-disposition') || '';
    const server = upstream.headers.get('server') || '';
    const cfRay = upstream.headers.get('cf-ray') || '';

    if (contentType.toLowerCase().includes('text/html')) {
      const html = await upstream.text();

      return res.status(upstream.status).json({
        ok: false,
        error: '上游返回了 HTML，不是 API JSON/图片/文件。可能是地址错误、鉴权失败或被 WAF 拦截。',
        upstreamStatus: upstream.status,
        contentType,
        server,
        cfRay,
        preview: html.slice(0, 1000)
      });
    }

    if (contentType.toLowerCase().includes('text/event-stream')) {
      return await pipeSseResponse(upstream, res);
    }

    if (isBinaryResponseContentType(contentType, contentDisposition)) {
      return await sendBinaryResponse(upstream, res);
    }

    return await sendTextOrJsonResponse(upstream, res);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
}
