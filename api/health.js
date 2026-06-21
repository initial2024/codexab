export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Proxy-Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    success: true,
    status: 'ok',
    ready: true,
    service: 'codexab-vercel-proxy',
    type: 'vercel-proxy',
    endpoints: {
      health: '/api/health',
      chatProxy: '/api/chat/proxy',
      parse: '/api/parse'
    },
    time: new Date().toISOString()
  });
}
