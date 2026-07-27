// Google Cloud Document AI — OCR text extraction from uploaded document images/PDFs.
const path = require("path");
const fs = require("fs");
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

// Runs Document AI OCR on each image and returns the combined recognized text.
async function ocrImages(imagesB64) {
  if (!PROCESSOR_ID) throw new Error("DOCUMENT_AI_PROCESSOR_ID env var is not set");
  const c = client();
  const name = `projects/${_projectId}/locations/${LOCATION}/processors/${PROCESSOR_ID}`;
  const texts = [];
  for (const b of (imagesB64 || []).filter(Boolean)) {
    const { mimeType, content } = splitDataUrl(b);
    try {
      const [result] = await c.processDocument(
        { name, rawDocument: { content, mimeType } },
        { timeout: 90000 },
      );
      texts.push((result.document && result.document.text) || "");
    } catch (error) {
      const wrapped = new Error(`Google Document AI request failed: ${error.message}`);
      wrapped.code = "DOCUMENT_AI_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }
  return texts.join("\n\n----- NEXT DOCUMENT -----\n\n");
}

module.exports = { ocrImages, isConfigured };
