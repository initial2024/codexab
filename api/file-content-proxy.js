import mediaProxyHandler from "./media-content-proxy.js";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default async function handler(req, res) {
  res.setHeader("X-Lingche-File-Content-Proxy", "true");
  return mediaProxyHandler(req, res);
}
