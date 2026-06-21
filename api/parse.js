export default async function handler(req, res) {
  // 跨域头支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url || '';

  // 解析请求体
  let body = {};
  if (req.method === 'POST') {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    } catch (e) {
      body = {};
    }
  }

  // 路由 1: /api/parse (网页嗅探与深度提取提取器，完美运行)
  if (path.includes('/api/parse')) {
    const { url: targetUrl } = body;
    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'Missing url' });
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,*/*',
          'Referer': targetUrl,
        },
        redirect: 'follow',
      });

      const contentType = response.headers.get('content-type') || '';
      
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return res.status(200).json({ success: true, data, url: targetUrl });
      }

      const html = await response.text();
      return res.status(200).json({ success: true, html, url: targetUrl });

    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // 路由 2: /api/chat/proxy (已优化，兼容两组协议)
  if (path.includes('/api/chat/proxy')) {
    // 1. 判断并获取要请求的大模型真正 API URL
    const targetUrl = body.apiUrl || body.url || 'https://new.sharedchat.cc/codex/responses';
    
    // 2. 解包正文：如果是在应用中通过代理发起，真正的数据存在 body.body 中，否则直接使用 body
    const realBody = body.body || body;
    
    // 3. 动态提取 Authorization 令牌
    let authHeader = req.headers['authorization'] || '';
    if (!authHeader && body.apiKey) {
      authHeader = `Bearer ${body.apiKey}`;
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify(realBody), // 仅发送有效的大模型对话载荷
      });

      const data = await response.text();
      res.status(response.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  // 默认路由
  res.status(200).json({
    status: 'running',
    endpoints: ['/api/parse', '/api/chat/proxy'],
  });
}
