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
  res.setHeader("X-Proxy-Mode", "task-status");
  res.setHeader("X-Proxy-Version", "lingche-final-task-status");
}

function normalizeBaseUrl(input) {
  return String(input || "").trim().replace(/\/+$/, "");
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

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
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
    input.statusUrl,
    input.taskStatusUrl,
    input.url,
    input.targetUrl
  );

  if (direct) {
    return {
      targetUrl: direct.replace("{task_id}", encodeURIComponent(taskId)),
      taskId,
    };
  }

  const baseUrl = normalizeBaseUrl(
    input.apiUrl || input.baseUrl || input.baseURL || ""
  );

  let path = firstString(
    input.statusPath,
    input.path,
    input.endpoint,
    "/tasks/{task_id}"
  );

  if (!taskId) {
    return {
      targetUrl: "",
      taskId,
    };
  }

  if (!path.includes("{task_id}")) {
    if (!path.startsWith("/")) path = `/${path}`;
    path = `${path.replace(/\/+$/, "")}/${encodeURIComponent(taskId)}`;
  } else {
    path = path.replace("{task_id}", encodeURIComponent(taskId));
  }

  if (!path.startsWith("/")) path = `/${path}`;

  if (!baseUrl) {
    return {
      targetUrl: "",
      taskId,
    };
  }

  return {
    targetUrl: `${baseUrl}${path}`,
    taskId,
  };
}

function buildHeaders(input) {
  const headers = {};

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

function normalizeStatus(json) {
  const data0 = Array.isArray(json?.data) ? json.data[0] : null;

  const status = firstString(
    json?.status,
    json?.state,
    json?.task_status,
    json?.phase,
    data0?.status,
    data0?.state,
    data0?.task_status
  );

  const videoUrl = firstString(
    json?.video_url,
    json?.videoUrl,
    json?.url,
    json?.output_url,
    json?.download_url,
    json?.downloadUrl,
    data0?.video_url,
    data0?.url,
    data0?.output_url,
    data0?.download_url
  );

  const imageUrl = firstString(
    json?.image_url,
    json?.imageUrl,
    data0?.image_url,
    data0?.url
  );

  const progressRaw =
    json?.progress ??
    json?.percent ??
    json?.percentage ??
    data0?.progress ??
    data0?.percent ??
    null;

  const progress =
    typeof progressRaw === "number"
      ? progressRaw
      : Number.isFinite(Number(progressRaw))
      ? Number(progressRaw)
      : null;

  const lower = status.toLowerCase();

  const succeeded =
    Boolean(videoUrl || imageUrl) ||
    ["succeeded", "success", "completed", "complete", "done", "finished"].includes(
      lower
    );

  const failed = ["failed", "error", "cancelled", "canceled"].includes(lower);

  return {
    status: status || (succeeded ? "succeeded" : "unknown"),
    progress,
    succeeded,
    failed,
    videoUrl,
    downloadUrl: videoUrl,
    imageUrl,
  };
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET" && !req.query?.taskId && !req.query?.task_id) {
    return res.status(200).json({
      ok: true,
      success: true,
      service: "lingche-task-status",
      endpoint: "/api/task-status",
      methods: ["GET", "POST"],
      supports: {
        taskId: true,
        statusUrl: true,
        videoUrl: true,
        imageUrl: true,
      },
    });
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      ok: false,
      success: false,
      error: "Method Not Allowed",
      allow: ["GET", "POST", "OPTIONS"],
    });
  }

  try {
    const input = req.method === "GET" ? req.query || {} : req.body || {};
    const { targetUrl, taskId } = buildTargetUrl(input);

    if (!targetUrl) {
      return res.status(400).json({
        ok: false,
        success: false,
        error:
          "缺少任务状态地址。请传入 statusUrl，或传入 apiUrl/baseUrl + statusPath + taskId。",
      });
    }

    if (!hostAllowed(targetUrl)) {
      return res.status(403).json({
        ok: false,
        success: false,
        error: "Task status host is not allowed",
        targetUrl,
        allowAnyHttpsTask: ALLOW_ANY_HTTPS_TASK,
        allowedTaskHosts: ALLOWED_TASK_HOSTS,
      });
    }

    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: buildHeaders(input),
      redirect: "follow",
    });

    const text = await upstream.text();

    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!json) {
      return res.status(upstream.status).json({
        ok: upstream.ok,
        success: upstream.ok,
        status: upstream.status,
        taskId,
        targetUrl,
        rawText: text.slice(0, 4000),
      });
    }

    return res.status(upstream.status).json({
      ok: upstream.ok,
      success: upstream.ok,
      httpStatus: upstream.status,
      taskId,
      targetUrl,
      ...normalizeStatus(json),
      raw: json,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      success: false,
      error: error?.message || String(error),
    });
  }
}
