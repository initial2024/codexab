import formidable from "formidable";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import XLSX from "xlsx";
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";

export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_TEXT_LENGTH = 200000;

const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".html",
  ".htm",
  ".xml",
  ".log",
  ".docx",
  ".pdf",
  ".xlsx",
  ".xls",
  ".pptx",
];

const UNSUPPORTED_EXTENSIONS = [
  ".doc",
  ".ppt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
];

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      success: true,
      service: "file-parse",
      version: "vercel-file-parse-v1",
      route: "/api/file/parse",
      method: "POST multipart/form-data",
      fieldName: "file",
      maxFileSizeMB: 15,
      supported: SUPPORTED_EXTENSIONS,
      unsupported: UNSUPPORTED_EXTENSIONS,
      note:
        "该接口负责把常见文档解析为纯文本，不负责 AI 聊天、模型检测或网页资源提取。",
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

  let uploadedFile = null;

  try {
    uploadedFile = await readMultipartFile(req);

    const filename = sanitizeFilename(
      uploadedFile.originalFilename ||
        uploadedFile.newFilename ||
        "uploaded-file"
    );

    const ext = getExtension(filename);
    const mimeType = uploadedFile.mimetype || "application/octet-stream";
    const size = Number(uploadedFile.size || 0);

    if (!ext) {
      return res.status(400).json({
        ok: false,
        success: false,
        error: "无法识别文件扩展名",
        filename,
        ext,
        mimeType,
        suggestion:
          "请上传带有明确扩展名的文件，例如 .txt、.docx、.pdf、.xlsx、.pptx。",
      });
    }

    if (size > MAX_FILE_SIZE) {
      return res.status(413).json({
        ok: false,
        success: false,
        error: "文件过大",
        filename,
        ext,
        mimeType,
        size,
        maxFileSizeMB: 15,
        suggestion: "请压缩文件，或拆分后再上传。",
      });
    }

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return res.status(415).json({
        ok: false,
        success: false,
        error: "暂不支持该文件类型",
        filename,
        ext,
        mimeType,
        supported: SUPPORTED_EXTENSIONS,
        unsupported: UNSUPPORTED_EXTENSIONS,
        suggestion:
          ext === ".doc" || ext === ".ppt"
            ? "老式 .doc/.ppt 二进制格式暂不支持，请另存为 .docx/.pptx 后上传。"
            : "请转换为 .txt、.md、.docx、.pdf、.xlsx 或 .pptx 后上传。",
      });
    }

    const buffer = await fs.readFile(uploadedFile.filepath);
    const parsed = await parseBufferByExtension(buffer, ext, filename);

    const normalizedText = normalizeText(parsed.text || "");
    const limited = limitText(normalizedText, MAX_TEXT_LENGTH);
    const warning = buildWarning(ext, parsed.warning, limited.truncated);

    return res.status(200).json({
      ok: true,
      success: true,
      service: "file-parse",
      version: "vercel-file-parse-v1",
      filename,
      ext,
      mimeType,
      size,
      length: limited.text.length,
      originalLength: normalizedText.length,
      truncated: limited.truncated,
      text: limited.text,

      // 兼容不同前端读取字段
      content: limited.text,
      result: limited.text,
      data: {
        text: limited.text,
        content: limited.text,
      },

      warning,
      meta: parsed.meta || {},
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      success: false,
      error: "文件解析失败",
      detail: String(error?.message || error),
      suggestion:
        "请确认文件未损坏、未加密，且不是扫描版图片 PDF。也可以将内容复制为纯文本后再上传。",
    });
  } finally {
    if (uploadedFile?.filepath) {
      try {
        await fs.unlink(uploadedFile.filepath);
      } catch {}
    }
  }
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,Authorization,X-Requested-With"
  );
  res.setHeader("Cache-Control", "no-store");
}

async function readMultipartFile(req) {
  const form = formidable({
    multiples: false,
    maxFileSize: MAX_FILE_SIZE,
    keepExtensions: true,
    allowEmptyFiles: false,
  });

  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      const fileValue = files.file;
      const file = Array.isArray(fileValue) ? fileValue[0] : fileValue;

      if (!file) {
        reject(new Error("缺少 multipart/form-data 字段 file"));
        return;
      }

      resolve(file);
    });
  });
}

function sanitizeFilename(filename) {
  return String(filename || "uploaded-file")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getExtension(filename) {
  return path.extname(String(filename || "")).toLowerCase();
}

async function parseBufferByExtension(buffer, ext, filename) {
  if ([".txt", ".md", ".csv", ".log"].includes(ext)) {
    return parsePlainText(buffer);
  }

  if (ext === ".json") {
    return parseJson(buffer);
  }

  if ([".html", ".htm"].includes(ext)) {
    return parseHtml(buffer);
  }

  if (ext === ".xml") {
    return parseXml(buffer);
  }

  if (ext === ".docx") {
    return parseDocx(buffer);
  }

  if (ext === ".pdf") {
    return parsePdf(buffer);
  }

  if (ext === ".xlsx" || ext === ".xls") {
    return parseSpreadsheet(buffer, filename);
  }

  if (ext === ".pptx") {
    return parsePptx(buffer);
  }

  throw new Error(`暂不支持文件类型：${ext}`);
}

function parsePlainText(buffer) {
  const text = bufferToUtf8(buffer);

  return {
    text,
    warning: null,
    meta: {
      parser: "plain-text",
    },
  };
}

function parseJson(buffer) {
  const raw = bufferToUtf8(buffer);

  try {
    const data = JSON.parse(raw);

    return {
      text: JSON.stringify(data, null, 2),
      warning: null,
      meta: {
        parser: "json",
        validJson: true,
      },
    };
  } catch {
    return {
      text: raw,
      warning: "JSON 解析失败，已按普通文本返回。",
      meta: {
        parser: "json",
        validJson: false,
      },
    };
  }
}

function parseHtml(buffer) {
  const raw = bufferToUtf8(buffer);

  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return {
    text,
    warning: "HTML 已去除标签，仅返回可见文本的近似结果。",
    meta: {
      parser: "html-strip-tags",
    },
  };
}

function parseXml(buffer) {
  const raw = bufferToUtf8(buffer);

  return {
    text: raw,
    warning: null,
    meta: {
      parser: "xml-raw-text",
    },
  };
}

async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });

  const messages = Array.isArray(result.messages) ? result.messages : [];

  return {
    text: result.value || "",
    warning:
      messages.length > 0
        ? messages.map((item) => item.message || String(item)).join("; ")
        : null,
    meta: {
      parser: "mammoth",
      messages,
    },
  };
}

async function parsePdf(buffer) {
  const result = await pdfParse(buffer);
  const text = result.text || "";

  return {
    text,
    warning:
      text.trim().length === 0
        ? "PDF 未提取到文本。该文件可能是扫描版 PDF、图片型 PDF 或加密 PDF。"
        : null,
    meta: {
      parser: "pdf-parse",
      pages: result.numpages || null,
      info: result.info || null,
    },
  };
}

function parseSpreadsheet(buffer, filename) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
  });

  const parts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const csv = XLSX.utils.sheet_to_csv(sheet, {
      FS: "\t",
      RS: "\n",
      blankrows: false,
    });

    parts.push(`## Sheet: ${sheetName}\n${csv.trim()}`);
  }

  return {
    text: parts.join("\n\n"),
    warning: null,
    meta: {
      parser: "xlsx",
      filename,
      sheetCount: workbook.SheetNames.length,
      sheets: workbook.SheetNames,
    },
  };
}

async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(compareSlideNames);

  const parts = [];

  for (const slideName of slideFiles) {
    const xml = await zip.files[slideName].async("string");
    const slideNumber = extractSlideNumber(slideName);
    const texts = extractPptxTextFromXml(xml);

    parts.push(`## Slide ${slideNumber}\n${texts.join("\n")}`);
  }

  const text = parts.join("\n\n");

  return {
    text,
    warning:
      text.trim().length === 0
        ? "PPTX 未提取到文本，可能主要由图片、图表或嵌入对象组成。"
        : "PPTX 仅提取幻灯片中的可见文本，不保留图片、版式和动画。",
    meta: {
      parser: "pptx-jszip",
      slideCount: slideFiles.length,
    },
  };
}

function extractPptxTextFromXml(xml) {
  const results = [];
  const regex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/gi;

  let match;

  while ((match = regex.exec(xml)) !== null) {
    const value = decodeXmlEntities(match[1]).trim();

    if (value) {
      results.push(value);
    }
  }

  return results;
}

function compareSlideNames(a, b) {
  return extractSlideNumber(a) - extractSlideNumber(b);
}

function extractSlideNumber(name) {
  const match = String(name).match(/slide(\d+)\.xml$/i);
  return match ? Number(match[1]) : 0;
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      try {
        return String.fromCharCode(Number(code));
      } catch {
        return _;
      }
    });
}

function bufferToUtf8(buffer) {
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function limitText(text, maxLength) {
  if (text.length <= maxLength) {
    return {
      text,
      truncated: false,
    };
  }

  return {
    text:
      text.slice(0, maxLength) +
      "\n\n[内容过长，已截断。请拆分文件或缩小范围后重试。]",
    truncated: true,
  };
}

function buildWarning(ext, parserWarning, truncated) {
  const warnings = [];

  if (parserWarning) {
    warnings.push(parserWarning);
  }

  if (truncated) {
    warnings.push("文本超过最大返回长度，已截断。");
  }

  if (ext === ".pdf") {
    warnings.push("PDF 只能提取文本层；扫描版 PDF 需要 OCR，当前接口不处理 OCR。");
  }

  if (ext === ".pptx") {
    warnings.push("PPTX 仅提取文本，不保留图片、版式和动画。");
  }

  return warnings.length > 0 ? warnings.join(" ") : null;
                                 }
