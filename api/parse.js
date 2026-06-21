const DEFAULT_AI_TARGET = 'https://new.sharedchat.cc/codex/responses';

const ALLOWED_TARGET_HOSTS = (
  process.env.ALLOWED_TARGET_HOSTS ||
  [
    'new.sharedchat.cc',
    'api.openai.com',
    'api.deepseek.com',
    'api.siliconflow.cn',
    'dashscope.aliyuncs.com',
    'api.moonshot.cn',
    'open.bigmodel.cn',
    'api.minimax.chat',
    'api.anthropic.com',
    'generativelanguage.googleapis.com'
  ].join(',')
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 是否允许任意 HTTPS 目标。
// 私人测试可以在 Vercel 环境变量里设置：ALLOW_ANY_HTTPS_TARGET=true
const ALLOW_ANY_HTTPS_TARGET =
  process.env.ALLOW_ANY_HTTPS_TARGET === 'true';

function isAllowedTargetUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);

    // 只允许 HTTPS
    if (url.protocol !== 'https:') {
      return false;
    }

    // 禁止本地和内网地址，防止 SSRF
    if (isPrivateOrLocalUrl(targetUrl)) {
      return false;
    }

    // 私人模式：允许任意 HTTPS 大模型地址
    if (ALLOW_ANY_HTTPS_TARGET) {
      return true;
    }

    // 默认模式：只允许白名单
    return ALLOWED_TARGET_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}
