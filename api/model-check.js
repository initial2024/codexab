export const config = {
  api: {
    bodyParser: true,
    responseLimit: false,
  },
};

const DEFAULT_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 60000);

const ALLOW_ANY_HTTPS_TARGET =
  process.env.ALLOW_ANY_HTTPS_TARGET === "true";

const ALLOWED_TARGET_HOSTS = (
  process.env.ALLOWED_TARGET_HOSTS ||
  process.env.ALLOWED_UPSTREAM_HOSTS ||
  [
    "api.openai.com",
    "api.deepseek.com",
    "integrate.api.nvidia.com",
    "api.siliconflow.cn",
    "dashscope.aliyuncs.com",
    "api.moonshot.cn",
    "open.bigmodel.cn",
    "api.minimax.chat",
    "api2.jiushi.xin",
    "new.sharedchat.cc",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Model-Check", "true");
  res.setHeader("X-Model-Check-Version", "provider-aware-v3-debug-final");
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(data, null, 2));
}

function safeBody(req) {
  const body = req.body || {};

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }

  return body;
}

function cleanTargetUrl(input) {
  let value = String(input || "")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();

  value = value.replace(/^["'`]+|["'`]+$/g, "").trim();

  value = value
    .replace(
      /^((Button|按钮|Label|标签|URL|Url|url|链接|地址|接口|目标|API Base URL|Api Base URL|apiBaseUrl)\s*[:：]\s*)+/i,
      ""
    )
    .trim();

  value = value
    .replace(
      /\b(Button|按钮|Label|标签|URL|Url|url|链接|地址|接口|目标|API Base URL|Api Base URL|apiBaseUrl)\s*[:：]\s*/gi,
      ""
    )
    .trim();

  const httpsMatch = value.match(/https?:\/\/[^\s"'`<>]+/i);

  if (httpsMatch) {
    value = httpsMatch[0].trim();
  } else {
    const domainMatch = value.match(
      /([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?(?:\/[^\s"'`<>]*)?)/i
    );

    if (domainMatch) {
      value = domainMatch[1].trim();
    }
  }

  value = value.replace(/[),.;，。；]+$/g, "").trim();

  if (!value) return "";

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  return value;
}

function normalizeBaseUrl(input) {
  const cleaned = cleanTargetUrl(input);

  if (!cleaned) return "";

  try {
    const url = new URL(cleaned);
    const host = url.hostname.toLowerCase();

    let pathname = url.pathname || "";

    pathname = pathname
      .replace(/\/v1\/chat\/completions\/models\/?$/i, "/v1")
      .replace(/\/v1\/chat\/completions\/chat\/completions\/?$/i, "/v1")
      .replace(/\/chat\/completions\/models\/?$/i, "")
      .replace(/\/chat\/completions\/chat\/completions\/?$/i, "")
      .replace(/\/chat\/completions\/?$/i, "")
      .replace(/\/models\/?$/i, "")
      .replace(/\/responses\/?$/i, "")
      .replace(/\/codex\/responses\/?$/i, "");

    url.pathname = pathname || "/";

    if (
      ["api.openai.com", "api.deepseek.com", "integrate.api.nvidia.com"].includes(host) &&
      (url.pathname === "/" || url.pathname === "")
    ) {
      url.pathname = "/v1";
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return cleaned.replace(/\/+$/, "");
  }
}

function isPrivateOrLocalUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    const host = url.hostname.toLowerCase();

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".local")
    ) {
      return true;
    }

    if (
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.")
    ) {
      return true;
    }

    const parts = host.split(".").map(Number);

    if (
      parts.length === 4 &&
      parts.every((n) => Number.isInteger(n)) &&
      parts[0] === 172 &&
      parts[1] >= 16 &&
      parts[1] <= 31
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function validateBaseUrl(input) {
  const baseUrl = normalizeBaseUrl(input);

  if (!baseUrl) {
    throw new Error("缺少 API Base URL");
  }

  let parsed;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("API Base URL 格式不正确");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("API Base URL 只允许 https");
  }

  if (isPrivateOrLocalUrl(baseUrl)) {
    throw new Error("禁止请求 localhost、内网地址或本地地址");
  }

  if (
    !ALLOW_ANY_HTTPS_TARGET &&
    !ALLOWED_TARGET_HOSTS.includes(parsed.hostname.toLowerCase())
  ) {
    throw new Error(
      `当前上游域名 ${parsed.hostname} 不在 ALLOWED_TARGET_HOSTS 白名单中`
    );
  }

  return baseUrl;
}

function buildChatCompletionsUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

function buildModelsUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

function maskKey(key) {
  if (!key) return "";
  if (key.length <= 12) return "***";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function getApiKeyInfo(req, body) {
  const envKey =
    typeof process.env.UPSTREAM_API_KEY === "string"
      ? process.env.UPSTREAM_API_KEY.trim()
      : "";

  const authHeader = req.headers.authorization || "";
  const headerKey = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  const bodyKey =
    typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  if (envKey) {
    return {
      apiKey: envKey,
      hasApiKey: true,
      apiKeySource: "env",
      apiKeyMasked: maskKey(envKey),
    };
  }

  if (headerKey) {
    return {
      apiKey: headerKey,
      hasApiKey: true,
      apiKeySource: "authorization",
      apiKeyMasked: maskKey(headerKey),
    };
  }

  if (bodyKey) {
    return {
      apiKey: bodyKey,
      hasApiKey: true,
      apiKeySource: "body",
      apiKeyMasked: maskKey(bodyKey),
    };
  }

  return {
    apiKey: "",
    hasApiKey: false,
    apiKeySource: "missing",
    apiKeyMasked: "",
  };
}

function getReceivedBaseUrl(body) {
  return (
    body?.baseUrl ||
    body?.apiBaseUrl ||
    body?.url ||
    process.env.DEFAULT_AI_BASE_URL ||
    null
  );
}

function safeNormalizeBaseUrlForDebug(value) {
  try {
    if (!value) return null;
    return normalizeBaseUrl(value);
  } catch {
    return null;
  }
}

function buildRequestDebug(req, body, options = {}) {
  const receivedBaseUrl = getReceivedBaseUrl(body);

  const normalizedBaseUrl =
    options.normalizedBaseUrl ||
    safeNormalizeBaseUrlForDebug(receivedBaseUrl);

  const model =
    options.model ||
    body?.model ||
    process.env.DEFAULT_AI_MODEL ||
    null;

  const level = options.level || body?.level || null;

  const apiKeyInfo =
    options.apiKeyInfo ||
    getApiKeyInfo(req, body);

  return {
    receivedBaseUrl,
    normalizedBaseUrl,
    model,
    level,
    hasApiKey: apiKeyInfo.hasApiKey,
    apiKeySource: apiKeyInfo.apiKeySource,
    apiKeyMasked: apiKeyInfo.apiKeyMasked,
    expectedModelsUrl: normalizedBaseUrl
      ? `${normalizedBaseUrl}/models`
      : null,
    expectedChatUrl: normalizedBaseUrl
      ? `${normalizedBaseUrl}/chat/completions`
      : null,
  };
}

function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    contentType,
    text,
    json,
  };
}

function getChoiceText(data) {
  const messageContent = data?.choices?.[0]?.message?.content;
  const textContent = data?.choices?.[0]?.text;

  if (typeof messageContent === "string") return messageContent;
  if (typeof textContent === "string") return textContent;

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .join("");
  }

  return "";
}

async function checkModels(baseUrl, apiKey, model) {
  const url = buildModelsUrl(baseUrl);

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: buildHeaders(apiKey),
    });

    const { json, text, contentType } = await readResponse(response);

    const models = Array.isArray(json?.data)
      ? json.data.map((item) => item?.id).filter(Boolean)
      : [];

    return {
      ok: response.ok,
      supported: response.ok && Array.isArray(json?.data),
      status: response.status,
      requestUrl: url,
      contentType,
      modelListed: models.includes(model),
      count: models.length,
      sample: models.slice(0, 30),
      error: response.ok ? null : json?.error || json || text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      supported: false,
      modelListed: false,
      requestUrl: url,
      error: String(error?.message || error),
    };
  }
}

async function checkShortChat(baseUrl, apiKey, model) {
  const url = buildChatCompletionsUrl(baseUrl);
  const started = Date.now();

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 12,
        messages: [
          {
            role: "user",
            content: "Reply with exactly one word: OK",
          },
        ],
      }),
    });

    const { json, text, contentType } = await readResponse(response);
    const latencyMs = Date.now() - started;

    const content = json ? getChoiceText(json) : "";
    const returnedModel = json?.model || "";

    return {
      ok: response.ok,
      status: response.status,
      requestUrl: url,
      latencyMs,
      contentType,
      returnedModel,
      modelMatched: returnedModel ? returnedModel === model : null,
      hasUsage: Boolean(json?.usage),
      usage: json?.usage || null,
      contentPreview: String(content || text || "").slice(0, 200),
      error: response.ok ? null : json?.error || json || text.slice(0, 800),
    };
  } catch (error) {
    return {
      ok: false,
      requestUrl: url,
      latencyMs: Date.now() - started,
      error: String(error?.message || error),
    };
  }
}

async function checkStream(baseUrl, apiKey, model) {
  const url = buildChatCompletionsUrl(baseUrl);

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 20,
        stream: true,
        messages: [
          {
            role: "user",
            content: "Reply with OK.",
          },
        ],
      }),
    });

    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      const { json, text } = await readResponse(response);

      return {
        ok: false,
        supported: false,
        status: response.status,
        requestUrl: url,
        contentType,
        error: json?.error || json || text.slice(0, 500),
      };
    }

    const supported =
      contentType.toLowerCase().includes("text/event-stream") ||
      Boolean(response.body);

    if (response.body) {
      try {
        await response.body.cancel();
      } catch {}
    }

    return {
      ok: true,
      supported,
      status: response.status,
      requestUrl: url,
      contentType,
    };
  } catch (error) {
    return {
      ok: false,
      supported: false,
      requestUrl: url,
      error: String(error?.message || error),
    };
  }
}

async function checkJsonMode(baseUrl, apiKey, model) {
  const url = buildChatCompletionsUrl(baseUrl);

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 50,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: 'Return JSON only: {"ok": true}',
          },
        ],
      }),
    });

    const { json, text, contentType } = await readResponse(response);
    const content = json ? getChoiceText(json) : text;

    let validJson = false;

    try {
      JSON.parse(content);
      validJson = true;
    } catch {
      validJson = false;
    }

    return {
      ok: response.ok,
      supported: response.ok && validJson,
      status: response.status,
      requestUrl: url,
      contentType,
      validJson,
      contentPreview: String(content).slice(0, 200),
      error: response.ok ? null : json?.error || json || text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      supported: false,
      requestUrl: url,
      error: String(error?.message || error),
    };
  }
}

async function checkTools(baseUrl, apiKey, model) {
  const url = buildChatCompletionsUrl(baseUrl);

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 80,
        tools: [
          {
            type: "function",
            function: {
              name: "get_test_value",
              description: "Return a test value",
              parameters: {
                type: "object",
                properties: {
                  value: {
                    type: "string",
                    description: "test value",
                  },
                },
                required: ["value"],
              },
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: {
            name: "get_test_value",
          },
        },
        messages: [
          {
            role: "user",
            content: "Call the tool with value equal to ok.",
          },
        ],
      }),
    });

    const { json, text, contentType } = await readResponse(response);

    const toolCalls = json?.choices?.[0]?.message?.tool_calls;

    return {
      ok: response.ok,
      supported: response.ok && Array.isArray(toolCalls) && toolCalls.length > 0,
      status: response.status,
      requestUrl: url,
      contentType,
      toolCallsCount: Array.isArray(toolCalls) ? toolCalls.length : 0,
      error: response.ok ? null : json?.error || json || text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      supported: false,
      requestUrl: url,
      error: String(error?.message || error),
    };
  }
}

async function checkLongOutput(baseUrl, apiKey, model) {
  const url = buildChatCompletionsUrl(baseUrl);

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 220,
        messages: [
          {
            role: "user",
            content:
              "Write 8 short numbered lines about API diagnostics. Keep each line concise.",
          },
        ],
      }),
    });

    const { json, text, contentType } = await readResponse(response);
    const content = json ? getChoiceText(json) : text;

    return {
      ok: response.ok,
      status: response.status,
      requestUrl: url,
      contentType,
      hasLongEnoughOutput: String(content).length >= 120,
      contentLength: String(content).length,
      usage: json?.usage || null,
      error: response.ok ? null : json?.error || json || text.slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      requestUrl: url,
      error: String(error?.message || error),
    };
  }
}

function inferProvider(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();

    if (host === "api.openai.com") return "openai";
    if (host === "api.deepseek.com") return "deepseek";
    if (host === "integrate.api.nvidia.com") return "nvidia";

    if (
      host.includes("moonshot") ||
      host.includes("bigmodel") ||
      host.includes("minimax") ||
      host.includes("dashscope") ||
      host.includes("siliconflow")
    ) {
      return "openaiCompatibleOfficial";
    }

    if (
      host.includes("anthropic.com") ||
      host.includes("generativelanguage.googleapis.com")
    ) {
      return "nativeProvider";
    }

    return "thirdPartyProxy";
  } catch {
    return "unknown";
  }
}

const PROVIDER_PROFILES = {
  openai: {
    label: "OpenAI 官方",
    strictModelMatch: true,
    requireUsage: true,
    toolsCore: true,
    jsonCore: true,
    streamCore: true,
    allowModelAlias: false,
    cannotProveOrigin: false,
    unsupportedByChatCompletions: false,
  },

  deepseek: {
    label: "DeepSeek 官方",
    strictModelMatch: false,
    requireUsage: false,
    toolsCore: false,
    jsonCore: false,
    streamCore: false,
    allowModelAlias: true,
    cannotProveOrigin: false,
    unsupportedByChatCompletions: false,
  },

  nvidia: {
    label: "NVIDIA NIM OpenAI-compatible 接口",
    strictModelMatch: false,
    requireUsage: false,
    toolsCore: false,
    jsonCore: false,
    streamCore: false,
    allowModelAlias: true,
    cannotProveOrigin: false,
    unsupportedByChatCompletions: false,
  },

  openaiCompatibleOfficial: {
    label: "官方 OpenAI-compatible 接口",
    strictModelMatch: false,
    requireUsage: false,
    toolsCore: false,
    jsonCore: false,
    streamCore: false,
    allowModelAlias: true,
    cannotProveOrigin: false,
    unsupportedByChatCompletions: false,
  },

  thirdPartyProxy: {
    label: "第三方中转站",
    strictModelMatch: false,
    requireUsage: false,
    toolsCore: false,
    jsonCore: false,
    streamCore: false,
    allowModelAlias: true,
    cannotProveOrigin: true,
    unsupportedByChatCompletions: false,
  },

  nativeProvider: {
    label: "原生接口 Provider",
    strictModelMatch: false,
    requireUsage: false,
    toolsCore: false,
    jsonCore: false,
    streamCore: false,
    allowModelAlias: true,
    cannotProveOrigin: false,
    unsupportedByChatCompletions: true,
  },

  unknown: {
    label: "未知接口",
    strictModelMatch: false,
    requireUsage: false,
    toolsCore: false,
    jsonCore: false,
    streamCore: false,
    allowModelAlias: true,
    cannotProveOrigin: true,
    unsupportedByChatCompletions: false,
  },
};

function hasUsefulContent(checks) {
  return Boolean(
    checks.shortChat?.contentPreview &&
      String(checks.shortChat.contentPreview).trim()
  );
}

function buildVerdict(score) {
  if (score >= 85) {
    return {
      verdict: "高可信",
      level: "high_confidence",
    };
  }

  if (score >= 70) {
    return {
      verdict: "基本可信",
      level: "likely_valid",
    };
  }

  if (score >= 50) {
    return {
      verdict: "疑似受限",
      level: "possibly_limited",
    };
  }

  if (score >= 30) {
    return {
      verdict: "疑似降级",
      level: "likely_degraded",
    };
  }

  return {
    verdict: "无法验证",
    level: "unverified",
  };
}

function scoreChecks(level, checks, baseUrl) {
  const provider = inferProvider(baseUrl);
  const profile = PROVIDER_PROFILES[provider] || PROVIDER_PROFILES.unknown;

  let score = 0;
  const flags = [];
  const warnings = [];

  if (profile.unsupportedByChatCompletions) {
    return {
      score: 0,
      verdict: "接口类型不兼容当前检测器",
      level: "unsupported_provider_api",
      provider,
      providerLabel: profile.label,
      flags,
      warnings: [
        "当前上游更像原生 Provider 接口，不一定兼容 /chat/completions。",
        "检测失败不代表该 API 不可信，只代表当前检测器不适配该接口类型。",
        "如需检测，请使用该 Provider 的 OpenAI-compatible 网关，或单独实现该 Provider 的检测适配器。",
      ],
    };
  }

  const shortChatOk = checks.shortChat?.ok === true;
  const contentOk = hasUsefulContent(checks);

  if (!shortChatOk) {
    return {
      score: 0,
      verdict: "无法验证",
      level: "unverified",
      provider,
      providerLabel: profile.label,
      flags,
      warnings: [
        "基础聊天请求失败，因此无法判断模型可信度。",
        checks.shortChat?.status
          ? `上游状态码：${checks.shortChat.status}`
          : "未获得有效上游状态码。",
        checks.shortChat?.error
          ? `上游错误：${JSON.stringify(checks.shortChat.error).slice(0, 500)}`
          : "请检查 API Key、Base URL、模型名称、余额和白名单配置。",
      ],
    };
  }

  score += 40;
  flags.push("基础聊天请求成功");

  if (contentOk) {
    score += 15;
    flags.push("模型返回了有效内容");
  } else {
    warnings.push("基础请求成功，但未检测到明确文本内容。");
  }

  if (checks.models?.supported) {
    score += 10;
    flags.push("/models 接口可访问");
  } else {
    warnings.push("/models 接口不可用或不兼容。");
  }

  if (checks.models?.modelListed) {
    score += 10;
    flags.push("目标模型出现在 /models 列表中");
  } else if (checks.models?.supported) {
    if (profile.allowModelAlias) {
      warnings.push(
        "目标模型未与 /models 返回值完全匹配，可能是模型别名、版本映射或中转站改写，不直接判为不可信。"
      );
    } else {
      warnings.push("目标模型未出现在 /models 列表中。");
    }
  }

  if (checks.shortChat?.modelMatched === true) {
    score += 5;
    flags.push("返回 model 字段与请求模型一致");
  } else if (checks.shortChat?.modelMatched === false) {
    if (profile.strictModelMatch) {
      warnings.push("返回 model 字段与请求模型不一致，需警惕模型替换或降级。");
    } else {
      score += 2;
      warnings.push(
        "返回 model 字段与请求模型不完全一致，可能是模型别名、版本映射或中转站改写。"
      );
    }
  } else {
    warnings.push("无法确认返回 model 字段是否一致。");
  }

  if (checks.shortChat?.hasUsage) {
    score += 5;
    flags.push("usage 字段存在");
  } else {
    if (profile.requireUsage) {
      warnings.push("usage 字段缺失，OpenAI 官方接口下需要关注。");
    } else {
      warnings.push("usage 字段缺失，但该 Provider 下不作为硬性失败依据。");
    }
  }

  if (level !== "light") {
    if (checks.stream?.supported) {
      score += profile.streamCore ? 8 : 5;
      flags.push("stream 流式输出支持");
    } else {
      warnings.push("stream 流式输出未通过或未验证。");
    }

    if (checks.jsonMode?.supported) {
      score += profile.jsonCore ? 8 : 4;
      flags.push("JSON mode 支持");
    } else if (profile.jsonCore) {
      warnings.push("JSON mode 未通过。");
    } else {
      warnings.push("JSON mode 未通过，但当前 Provider 下不作为核心可信度硬性指标。");
    }

    if (checks.tools?.supported) {
      score += profile.toolsCore ? 8 : 4;
      flags.push("tools / function calling 支持");
    } else if (profile.toolsCore) {
      warnings.push("tools / function calling 未通过。");
    } else {
      warnings.push("tools / function calling 未通过，但当前 Provider 下不作为核心可信度硬性指标。");
    }
  } else {
    warnings.push("轻量检测未验证 stream、JSON mode 和 tools 能力。");
  }

  if (level === "deep") {
    if (checks.longOutput?.ok && checks.longOutput?.hasLongEnoughOutput) {
      score += 5;
      flags.push("长输出探针通过");
    } else {
      warnings.push("长输出探针未通过或未验证。");
    }
  }

  if (profile.cannotProveOrigin) {
    warnings.push(
      "当前上游疑似第三方中转或未知接口。即使检测通过，也不能证明真实上游来源。"
    );
  }

  score = Math.max(0, Math.min(100, score));

  const verdictInfo = buildVerdict(score);

  return {
    score,
    verdict: verdictInfo.verdict,
    level: verdictInfo.level,
    provider,
    providerLabel: profile.label,
    flags,
    warnings,
  };
}

function inferApiType(checks) {
  if (checks.shortChat?.ok && checks.stream?.supported && checks.tools?.supported) {
    return {
      type: "openai-compatible",
      confidence: 0.86,
    };
  }

  if (checks.shortChat?.ok) {
    return {
      type: "partial-openai-compatible",
      confidence: 0.65,
    };
  }

  return {
    type: "unknown",
    confidence: 0.2,
  };
}

function inferModelType(checks) {
  const features = [];

  if (checks.shortChat?.ok) features.push("text");
  if (checks.stream?.supported) features.push("stream");
  if (checks.jsonMode?.supported) features.push("json");
  if (checks.tools?.supported) features.push("tools");

  let type = "unknown";

  if (features.includes("tools")) {
    type = "tool-capable";
  } else if (features.includes("text")) {
    type = "text-capable";
  }

  return {
    type,
    features,
  };
}

function collectUsage(checks) {
  const items = [];

  if (checks.shortChat?.usage) {
    items.push({
      check: "shortChat",
      usage: checks.shortChat.usage,
    });
  }

  if (checks.longOutput?.usage) {
    items.push({
      check: "longOutput",
      usage: checks.longOutput.usage,
    });
  }

  let totalTokens = 0;

  for (const item of items) {
    const value = item.usage?.total_tokens || item.usage?.totalTokens || 0;
    totalTokens += Number(value || 0);
  }

  return {
    available: items.length > 0,
    totalTokens: totalTokens || null,
    items,
  };
}

function buildExecutionPlan(level) {
  if (level === "light") {
    return {
      expectedExternalRequests: [
        "GET /models",
        "POST /chat/completions",
      ],
      note:
        "light 模式只应产生 1 次 GET /models 和 1 次 POST /chat/completions。",
    };
  }

  if (level === "standard") {
    return {
      expectedExternalRequests: [
        "GET /models",
        "POST /chat/completions shortChat",
        "POST /chat/completions stream",
        "POST /chat/completions jsonMode",
        "POST /chat/completions tools",
      ],
    };
  }

  return {
    expectedExternalRequests: [
      "GET /models",
      "POST /chat/completions shortChat",
      "POST /chat/completions stream",
      "POST /chat/completions jsonMode",
      "POST /chat/completions tools",
      "POST /chat/completions longOutput",
    ],
  };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      service: "model-check",
      version: "provider-aware-v3-debug-final",
      levels: ["light", "standard", "deep"],
      defaultLevel: "light",
      rules: {
        light: "GET /models + POST /chat/completions only",
        standard: "GET /models + shortChat + stream + JSON mode + tools",
        deep: "standard checks + long output probe",
      },
      warning:
        "模型检测会发起真实模型请求，可能消耗 token、余额或中转站额度。检测结果仅供参考，不能作为模型来源的绝对证明。",
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, {
      ok: false,
      error: "Method Not Allowed",
    });
  }

  const body = safeBody(req);

  try {
    if (process.env.ENABLE_MODEL_CHECK === "false") {
      return sendJson(res, 403, {
        ok: false,
        error: "当前后端未启用模型可信度检测",
        requestDebug: buildRequestDebug(req, body),
      });
    }

    const receivedBaseUrl = getReceivedBaseUrl(body);
    const baseUrl = validateBaseUrl(receivedBaseUrl);

    const model = String(
      body.model || process.env.DEFAULT_AI_MODEL || ""
    ).trim();

    const level = ["light", "standard", "deep"].includes(body.level)
      ? body.level
      : "light";

    const apiKeyInfo = getApiKeyInfo(req, body);
    const apiKey = apiKeyInfo.apiKey;

    if (!model) {
      return sendJson(res, 400, {
        ok: false,
        error: "缺少模型名称",
        requestDebug: buildRequestDebug(req, body, {
          normalizedBaseUrl: baseUrl,
          model,
          level,
          apiKeyInfo,
        }),
      });
    }

    if (!apiKey) {
      return sendJson(res, 401, {
        ok: false,
        error:
          "缺少 API Key。请在 Authorization 中传入 Bearer Key，或在请求体 apiKey 字段中传入，或在云端环境变量 UPSTREAM_API_KEY 中配置。",
        requestDebug: buildRequestDebug(req, body, {
          normalizedBaseUrl: baseUrl,
          model,
          level,
          apiKeyInfo,
        }),
      });
    }

    const debugInfo = buildRequestDebug(req, body, {
      normalizedBaseUrl: baseUrl,
      model,
      level,
      apiKeyInfo,
    });

    console.log("[model-check-debug]", {
      requestDebug: debugInfo,
    });

    const checks = {};

    checks.models = await checkModels(baseUrl, apiKey, model);
    checks.shortChat = await checkShortChat(baseUrl, apiKey, model);

    if (level === "standard" || level === "deep") {
      checks.stream = await checkStream(baseUrl, apiKey, model);
      checks.jsonMode = await checkJsonMode(baseUrl, apiKey, model);
      checks.tools = await checkTools(baseUrl, apiKey, model);
    } else {
      checks.stream = null;
      checks.jsonMode = null;
      checks.tools = null;
    }

    if (level === "deep") {
      checks.longOutput = await checkLongOutput(baseUrl, apiKey, model);
    } else {
      checks.longOutput = null;
    }

    const purity = scoreChecks(level, checks, baseUrl);
    const apiType = inferApiType(checks);
    const modelType = inferModelType(checks);
    const usageSummary = collectUsage(checks);
    const executionPlan = buildExecutionPlan(level);

    return sendJson(res, 200, {
      ok: true,
      service: "model-check",
      version: "provider-aware-v3-debug-final",
      level,
      requestDebug: debugInfo,
      target: {
        baseUrl,
        model,
      },
      apiType,
      modelType,
      purity,
      checks,
      usageSummary,
      executionPlan,
      security: {
        apiKeySource: apiKeyInfo.apiKeySource,
        apiKeyMasked: apiKeyInfo.apiKeyMasked,
        allowedHosts: ALLOWED_TARGET_HOSTS,
        allowAnyHttpsTarget: ALLOW_ANY_HTTPS_TARGET,
      },
      costWarning:
        "本次检测已发起真实模型请求，可能消耗 token、余额或中转站额度。",
      disclaimer:
        "检测结果仅基于接口行为、返回字段和能力探针，不能作为模型真实来源的绝对证明。第三方中转站可能伪造模型字段或动态切换模型。",
      time: new Date().toISOString(),
    });
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      error: String(error?.message || error),
      requestDebug: buildRequestDebug(req, body),
      disclaimer:
        "检测失败不一定代表模型不可用，也可能是 Base URL、API Key、模型名、网络、白名单或中转站兼容性问题。",
    });
  }
      }
