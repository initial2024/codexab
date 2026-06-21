export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: 'codexab-vercel-proxy',
    endpoints: {
      health: '/api/health',
      chatProxy: '/api/chat/proxy',
      parse: '/api/parse',
    },
    time: new Date().toISOString(),
  });
}
