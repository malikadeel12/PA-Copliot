// --- Change Summary ---
// What: Dual Document AI routing — Enterprise OCR vs Form Parser by section.
// Why: Cut per-run OCR cost (~$0.04): cheap OCR for ID/clinical; Form Parser only for insurance cards.
// Related: llm.js extractDocuments, DOCUMENT_AI_* env vars, provision_docai.js
//
// Cost rule (business):
//   - Patient ID + clinical notes → Enterprise / Document OCR (~$0.0015/page)
//   - Insurance card → Form Parser (structured fields)
//   - Non-form / unknown → always fall back to Enterprise OCR

const path = require("path");
const fs = require("fs");
const mammoth = require("mammoth");
const { DocumentProcessorServiceClient } = require("@google-cloud/documentai").v1;

const LOCATION = process.env.DOCUMENT_AI_LOCATION || "us";
// Prefer dedicated OCR id; fall back to legacy DOCUMENT_AI_PROCESSOR_ID.
const OCR_PROCESSOR_ID =
  process.env.DOCUMENT_AI_OCR_PROCESSOR_ID ||
  process.env.DOCUMENT_AI_PROCESSOR_ID ||
  "";
const FORM_PARSER_ID = process.env.DOCUMENT_AI_FORM_PARSER_ID || "";

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
    Boolean(OCR_PROCESSOR_ID) &&
    Boolean(process.env.GCP_SERVICE_ACCOUNT_JSON || hasLocalFile)
  );
}

function decodeBase64(input) {
  const { content } = splitDataUrl(input);
  return Buffer.from(content, "base64");
}

function normalizeText(s) {
  return (s || "").replace(/\r\n/g, "\n").trim();
}

async function extractTextFile(file) {
  const buf = decodeBase64(file.content);
  return normalizeText(buf.toString("utf8"));
}

async function extractDocxFile(file) {
  const buf = decodeBase64(file.content);
  const { value } = await mammoth.extractRawText({ buffer: buf });
  return normalizeText(value);
}

// --- Processor selection ---
// Insurance cards benefit from Form Parser field extraction.
// Everything else (ID, clinical, unknown) uses cheaper Enterprise OCR.
function processorIdForSection(section) {
  if (section === "insurance" && FORM_PARSER_ID) return FORM_PARSER_ID;
  return OCR_PROCESSOR_ID;
}

// Document AI layouts expose text via textAnchor segments into document.text.
function layoutText(doc, layout) {
  const segments = layout?.textAnchor?.textSegments;
  if (!doc?.text || !segments?.length) return "";
  return segments
    .map((seg) => {
      const start = Number(seg.startIndex || 0);
      const end = Number(seg.endIndex || 0);
      return doc.text.slice(start, end);
    })
    .join("")
    .trim();
}

// Prefer Form Parser structured fields when present; always keep raw OCR text.
function textFromDocAiResult(result) {
  const doc = result?.document;
  if (!doc) return "";
  let text = doc.text || "";
  const fieldLines = [];
  for (const page of doc.pages || []) {
    for (const field of page.formFields || []) {
      const n = layoutText(doc, field.fieldName);
      const v = layoutText(doc, field.fieldValue);
      if (n || v) fieldLines.push(`${n || "Field"}: ${v || ""}`);
    }
  }
  if (fieldLines.length) {
    text = `${text}\n\n[Form fields]\n${fieldLines.join("\n")}`.trim();
  }
  return text;
}

async function ocrBinaryWithDocAi(file, processorId) {
  const pid = processorId || OCR_PROCESSOR_ID;
  if (!pid) throw new Error("DOCUMENT_AI_OCR_PROCESSOR_ID (or DOCUMENT_AI_PROCESSOR_ID) is not set");
  const c = client();
  const name = `projects/${_projectId}/locations/${LOCATION}/processors/${pid}`;
  const { mimeType, content } = splitDataUrl(file.content);
  try {
    const [result] = await c.processDocument(
      { name, rawDocument: { content, mimeType } },
      { timeout: 90000 },
    );
    return textFromDocAiResult(result);
  } catch (error) {
    const wrapped = new Error(`Google Document AI request failed: ${error.message}`);
    wrapped.code = "DOCUMENT_AI_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }
}

// Heuristic: sparse alphanumeric text OR junk-heavy OCR ⇒ route to Vision.
function isLowClarityText(text) {
  const raw = text || "";
  const alnum = raw.replace(/[^A-Za-z0-9]/g, "");
  if (alnum.length < 80) return true;
  // Lots of OCR garbage relative to real letters (common on handwriting).
  const letters = (raw.match(/[A-Za-z]/g) || []).length;
  if (alnum.length >= 80 && letters < 40) return true;
  return false;
}

// File shape: { section?: "id"|"insurance"|"clinical", filename, mimeType, content }
// Returns: { section, filename, mimeType, text, processor, low_clarity, needs_vision } per file.
async function extractFiles(files) {
  const out = [];
  for (const file of (files || []).filter(Boolean)) {
    const mime = (file.mimeType || "").toLowerCase();
    const section = file.section || null;
    let text = "";
    let processor = "local";
    let needsVision = Boolean(file.force_vision);

    if (mime === "application/pdf" || mime.startsWith("image/")) {
      const preferred = processorIdForSection(section);
      const usingFormParser = section === "insurance" && FORM_PARSER_ID && preferred === FORM_PARSER_ID;
      try {
        text = await ocrBinaryWithDocAi(file, preferred);
        processor = usingFormParser ? "form_parser" : "enterprise_ocr";
      } catch (err) {
        // If Form Parser fails on an insurance card, fall back to Enterprise OCR
        // so a misconfigured form processor never blocks the whole capture.
        if (usingFormParser) {
          console.warn("Form Parser failed — falling back to Enterprise OCR:", err.message);
          text = await ocrBinaryWithDocAi(file, OCR_PROCESSOR_ID);
          processor = "enterprise_ocr_fallback";
        } else {
          throw err;
        }
      }

      // Non-form documents with weak OCR text → Claude Vision pipeline.
      if (section !== "insurance" && (needsVision || isLowClarityText(text))) {
        needsVision = true;
      }
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mime === "application/msword" ||
      /\.docx?$/i.test(file.filename || "")
    ) {
      text = await extractDocxFile(file);
      processor = "mammoth";
    } else if (mime === "text/plain" || mime === "text/markdown" || mime.startsWith("text/")) {
      text = await extractTextFile(file);
      processor = "plaintext";
    } else {
      text = await extractTextFile(file);
      processor = "plaintext_fallback";
    }

    out.push({
      section,
      filename: file.filename || "document",
      mimeType: mime || "application/octet-stream",
      text: (text || "").trim(),
      processor,
      low_clarity: isLowClarityText(text),
      needs_vision: needsVision,
      // Keep original content so the vision path can re-read the image bytes.
      content: mime.startsWith("image/") || mime === "application/pdf" ? file.content : null,
    });
  }
  return out;
}

function filesToOcrText(perFile) {
  const blocks = perFile.map((f) => {
    const tag = f.section ? `[Section: ${f.section}] ` : "";
    const note = f.needs_vision ? " [vision-assisted]" : "";
    return `----- ${tag}File: ${f.filename} (${f.mimeType})${note} -----\n${f.text}`;
  });
  return blocks.join("\n\n");
}

async function ocrImages(imagesB64) {
  const files = (imagesB64 || []).filter(Boolean).map((b64, i) => {
    const { mimeType } = splitDataUrl(b64);
    return { filename: `image-${i + 1}`, mimeType, content: b64 };
  });
  const perFile = await extractFiles(files);
  return filesToOcrText(perFile);
}

module.exports = {
  ocrImages,
  extractFiles,
  filesToOcrText,
  isConfigured,
  isLowClarityText,
  processorIdForSection,
};
