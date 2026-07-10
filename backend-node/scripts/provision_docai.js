// One-off: find or create a Document OCR processor and print its ID.
const path = require("path");
const { DocumentProcessorServiceClient } = require("@google-cloud/documentai").v1;

const LOCATION = process.env.DOCUMENT_AI_LOCATION || "us";
const keyFile = path.join(__dirname, "..", "gcp-service-account.json");
const sa = require(keyFile);
const projectId = sa.project_id;
const apiEndpoint = `${LOCATION}-documentai.googleapis.com`;
const client = new DocumentProcessorServiceClient({ keyFilename: keyFile, apiEndpoint });

(async () => {
  const parent = `projects/${projectId}/locations/${LOCATION}`;
  try {
    const [existing] = await client.listProcessors({ parent });
    const ocr = existing.find((p) => p.type === "OCR_PROCESSOR") || existing[0];
    if (ocr) {
      console.log("FOUND_PROCESSOR", ocr.name.split("/").pop(), "| type:", ocr.type, "| state:", ocr.state);
      return;
    }
    console.log("No processors found — creating a Document OCR processor…");
    const [created] = await client.createProcessor({
      parent,
      processor: { type: "OCR_PROCESSOR", displayName: "PA Copilot Document OCR" },
    });
    console.log("CREATED_PROCESSOR", created.name.split("/").pop(), "| type:", created.type, "| state:", created.state);
  } catch (e) {
    console.log("ERROR_CODE", e.code, "MSG", e.message);
  }
})();
