export const config = {
  api: {
    bodyParser: {
      sizeLimit: "5mb",
    },
    responseLimit: false,
  },
};

const DEFAULT_ALLOWED_HOSTS = [
  "integrate.api.nvidia.com",
  "api.openai.com",
  "api.deepseek.com",
  "api2.jiushi.xin",
  "api.jiushi.xin",
];

const ALLOW_ANY_HTTPS_TASK =
  process.env.ALLOW_ANY_HTTPS_TASK === "true" ||
  process.env.ALLOW_ANY_HTTPS_TARGET === "true";

const ALLOWED_TASK_HOSTS = (
  process.env.ALLOWED_TASK_HOSTS ||
  process.env.ALLOWED_TARGET_HOSTS ||
  DEFAULT_ALLOWED_HOSTS.join(",")
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, x-api-key, X-Requested-With"
  );
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Selfhost-Proxy", "true");
  res.setHeader("X-Proxy-Mode", "task-cancel");
  res.setHeader("X-Proxy-Version", "lingche-final-task-cancel");
}

function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function hostAllowed(targetUrl) {
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "https:") return false;

    const host = url.hostname.toLowerCase();

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      host.startsWith("169.254.")
    ) {
      return false;
    }

    if (ALLOW_ANY_HTTPS_TASK) return true;

    return ALLOWED_TASK_HOSTS.some((allowed) => {
      if (host === allowed) return true;
      if (allowed.startsWith("*.")) return host.endsWith(allowed.slice(1));
      if (allowed.startsWith(".")) return host.endsWith(allowed);
      return false;
    });
  } catch {
    return false;
  }
}

function buildTargetUrl(input) {
  const taskId = firstString(
    input.taskId,
    input.task_id,
    input.jobId,
    input.job_id,
    input.id
  );

  const direct = firstString(
    input.cancelUrl,
    input.taskCancelUrl,
    input.url,
    input.targetUrl
  );

  if (direct) {
    return {
      targetUrl: direct.replace("{task_id}", encodeURIComponent(taskId)),
      taskId,
      hasRemoteCancel: true,
    };
  }

  const baseUrl = normalizeBaseUrl(
    input.apiUrl || input.baseUrl || input.baseURL || ""
  );

  let path = firstString(
    input.cancelPath,
    input.path,
    input.endpoint,
    ""
  );

  if (!path) {
    return {
      targetUrl: "",
      taskId,
      hasRemoteCancel: false,
    };
  }

  if (!taskId) {
    return {
      targetUrl: "",
      taskId,
      hasRemoteCancel: false,
    };
  }

  if (!path.includes("{task_id}")) {
    if (!path.startsWith("/")) path = `/${path}`;
    path = `${path.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}/cancel`;
  } else {
    path = path.replace("{task_id}", encodeURIComponent(taskId));
  }

  if (!path.startsWith("/")) path = `/${path}`;

  if (!baseUrl) {
    return {
      targetUrl: "",
      taskId,
      hasRemoteCancel: false,
    };
  }

  return {
    targetUrl: `${baseUrl}${path}`,
    taskId,
    hasRemoteCancel: true,
  };
}

function buildHeaders(input) {
  const headers = {
    "Content-Type": "application/json",
  };

  if (input.headers && typeof input.headers === "object") {
    for (const [key, value] of Object.entries(input.headers)) {
      if (!key || value == null) continue;
      if (key.toLowerCase() === "host") continue;
      if (key.toLowerCase() === "content-length") continue;
      headers[key] = String(value);
    }
  }

  const apiKey =
    input.apiKey ||
    input.key ||
    input.token ||
    process.env.UPSTREAM_API_KEY ||
    "";

  if (apiKey && !headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      success: true,
      service: "lingche-task-cancel",
      endpoint: "/api/task-cancel",
      methods: ["POST"],
      note:
        "If upstream cancelUrl/cancelPath is not provided, this endpoint returns localOnly=true.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      success: false,
      error: "Method Not Allowed",
      allow: ["GET", "POST", "OPTIONS"],
    });
  }

  try {
    const input = req.body || {};
    const { targetUrl, taskId, hasRemoteCancel } = buildTargetUrl(input);

    if (!hasRemoteCancel || !targetUrl) {
      return res.status(200).json({
        ok: true,
        success: true,
        localOnly: true,
        taskId,
        message:
          "上游未提供取消接口，已执行本地取消确认。前端应停止轮询并标记任务已取消。",
      });
    }

    if (!hostAllowed(targetUrl)) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Task cancel host is not allowed",
        targetUrl,
        allowAnyHttpsTask: ALLOW_ANY_HTTPS_TASK,
        allowedTaskHosts: ALLOWED_TASK_HOSTS,
      });
    }

    const method = String(input.method || "POST").toUpperCase();

    const upstream = await fetch(targetUrl, {
      method,
      headers: buildHeaders(input),
      body: method === "GET" ? undefined : JSON.stringify(input.payload || {}),
      redirect: "follow",
    });

    const text = await upstream.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return res.status(upstream.status).json({
      ok: upstream.ok,
      success: upstream.ok,
      httpStatus: upstream.status,
      taskId,
      targetUrl,
      raw: json || null,
      rawText: json ? undefined : text.slice(0, 4000),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      success: false,
      error: error?.message || String(error),
    });
  }
}
