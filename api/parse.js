export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

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

  const { url: targetUrl, types, keyword, useSiteSearch, deepExtract, includeRecommendations } = body;

  if (!targetUrl) {
    return res.status(400).json({ success: false, error: 'Missing url parameter' });
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': targetUrl,
    'Connection': 'keep-alive',
  };

  const host = new URL(targetUrl).hostname;
  if (host.includes('bilibili.com')) {
    headers['Referer'] = 'https://search.bilibili.com/';
  } else if (host.includes('douyin.com')) {
    headers['Referer'] = 'https://www.douyin.com/';
  }

  try {
    const response = await fetch(targetUrl, { method: 'GET', headers, redirect: 'follow' });
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return res.status(200).json({
        success: true, data, url: targetUrl, types: types || [6],
        keyword: keyword || '', useSiteSearch: useSiteSearch || false,
        deepExtract: deepExtract || false, includeRecommendations: includeRecommendations || false,
        fetchedAt: new Date().toISOString(),
      });
    }

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

    return res.status(200).json({
      success: true, html, title, url: targetUrl, types: types || [6],
      keyword: keyword || '', useSiteSearch: useSiteSearch || false,
      deepExtract: deepExtract || false, includeRecommendations: includeRecommendations || false,
      fetchedAt: new Date().toISOString(),
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message, url: targetUrl });
  }
}
