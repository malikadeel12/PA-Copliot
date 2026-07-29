// Google Cloud Document AI — OCR text extraction from uploaded document
// images / PDFs, with local fallbacks for plain text and Word documents.
const path = require("path");
const fs = require("fs");
const mammoth = require("mammoth");
const { DocumentProcessorServiceClient } = require("@google-cloud/documentai").v1;

const LOCATION = process.env.DOCUMENT_AI_LOCATION || "us";
const PROCESSOR_ID = process.env.DOCUMENT_AI_PROCESSOR_ID || "";

let _client = null;
let _projectId = null;

function client() {
  if (_client) return _client;
  const apiEndpoint = `${LOCATION}-documentai.googleapis.com`;
  const inline = process.env.GCP_SERVICE_ACCOUNT_JSON;

  if (inline) {
    let sa;
    try {
      sa = JSON.parse(inline.trim());
    } catch (error) {
      throw new Error(`GCP_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
    }
    if (!sa.project_id || !sa.client_email || !sa.private_key) {
      throw new Error("GCP_SERVICE_ACCOUNT_JSON is missing project_id, client_email, or private_key");
    }
    sa.private_key = (sa.private_key || "").replace(/\\n/g, "\n");
    _projectId = sa.project_id;
    _client = new DocumentProcessorServiceClient({
      projectId: sa.project_id,
      credentials: { client_email: sa.client_email, private_key: sa.private_key },
      apiEndpoint,
      // Render can intermittently fail to establish the default gRPC channel.
      // Google's supported HTTP fallback avoids that transport dependency.
      fallback: true,
    });
  } else {
    const keyFile = process.env.GCP_KEY_FILE
      ? path.resolve(__dirname, "..", process.env.GCP_KEY_FILE)
      : path.join(__dirname, "..", "gcp-service-account.json");

    if (!fs.existsSync(keyFile)) {
      throw new Error(
        `GCP Service Account credentials missing. Provide GCP_SERVICE_ACCOUNT_JSON env variable or place file at ${keyFile}`
      );
    }

    // eslint-disable-next-line import/no-dynamic-require, global-require
    const sa = require(keyFile);
    _projectId = sa.project_id;
    _client = new DocumentProcessorServiceClient({ keyFilename: keyFile, apiEndpoint, fallback: true });
  }
  return _client;
}

function splitDataUrl(b64) {
  if (b64 && b64.startsWith("data:") && b64.includes(",")) {
    const [header, data] = b64.split(",", 2);
    const m = header.match(/data:(.*?);base64/);
    return { mimeType: m ? m[1] : "image/jpeg", content: data };
  }
  return { mimeType: "image/jpeg", content: b64 };
}

function isConfigured() {
  const hasLocalFile = fs.existsSync(
    process.env.GCP_KEY_FILE
      ? path.resolve(__dirname, "..", process.env.GCP_KEY_FILE)
      : path.join(__dirname, "..", "gcp-service-account.json")
  );

  return (
    Boolean(PROCESSOR_ID) &&
    Boolean(process.env.GCP_SERVICE_ACCOUNT_JSON || hasLocalFile)
  );
}

// Decode a base64 string (data URL or raw) into a Buffer.
function decodeBase64(input) {
  const { content } = splitDataUrl(input);
  return Buffer.from(content, "base64");
}

// Plain-text parser — used when no Document AI processor is configured
// for the format (DOCX, TXT) or when the user uploaded a .txt directly.
function normalizeText(s) {
  return (s || "").replace(/\r\n/g, "\n").trim();
}

async function extractTextFile(file) {
  const buf = decodeBase64(file.content);
  const text = normalizeText(buf.toString("utf8"));
  return text;
}

async function extractDocxFile(file) {
  const buf = decodeBase64(file.content);
  // mammoth extracts raw text from .docx without needing Microsoft Word.
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return normalizeText(value);
}

async function ocrBinaryWithDocAi(file) {
  if (!PROCESSOR_ID) throw new Error("DOCUMENT_AI_PROCESSOR_ID env var is not set");
  const c = client();
  const name = `projects/${_projectId}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;
  const { mimeType, content } = splitDataUrl(file.content);
  try {
    const [result] = await c.processDocument(
      { name, rawDocument: { content, mimeType } },
      { timeout: 90000 },
    );
    return (result.document && result.document.text) || "";
  } catch (error) {
    const wrapped = new Error(`Google Document AI request failed: ${error.message}`);
    wrapped.code = "DOCUMENT_AI_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }
}

// File shape: { section?: "id"|"insurance"|"clinical", filename: string,
//                mimeType: string, content: string (base64 or data URL) }
// Returns: { section, filename, mimeType, text } per file, in input order.
async function extractFiles(files) {
  const out = [];
  for (const file of (files || []).filter(Boolean)) {
    const mime = (file.mimeType || "").toLowerCase();
    let text = "";
    if (mime === "application/pdf" || mime.startsWith("image/")) {
      text = await ocrBinaryWithDocAi(file);
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mime === "application/msword" ||
      /\.docx?$/i.test(file.filename || "")
    ) {
      text = await extractDocxFile(file);
    } else if (mime === "text/plain" || mime === "text/markdown" || mime.startsWith("text/")) {
      text = await extractTextFile(file);
    } else {
      // Unknown type — try as plain text rather than hard-failing.
      text = await extractTextFile(file);
    }
    out.push({
      section: file.section || null,
      filename: file.filename || "document",
      mimeType: mime || "application/octet-stream",
      text: (text || "").trim(),
    });
  }
  return out;
}

// Format extracted files into a single text blob for the structuring LLM,
// tagged by section + filename so the model can attribute fields correctly.
function filesToOcrText(perFile) {
  const blocks = perFile.map((f) => {
    const tag = f.section ? `[Section: ${f.section}] ` : "";
    return `----- ${tag}File: ${f.filename} (${f.mimeType}) -----\n${f.text}`;
  });
  return blocks.join("\n\n");
}

// Backwards-compat shim: original single-image callers can still call this.
async function ocrImages(imagesB64) {
  const files = (imagesB64 || []).filter(Boolean).map((b64, i) => {
    const { mimeType } = splitDataUrl(b64);
    return { filename: `image-${i + 1}`, mimeType, content: b64 };
  });
  const perFile = await extractFiles(files);
  return filesToOcrText(perFile);
}

module.exports = { ocrImages, extractFiles, filesToOcrText, isConfigured };
