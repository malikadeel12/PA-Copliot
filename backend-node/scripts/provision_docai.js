// Find or create Document AI processors for PA Copilot cost routing:
//   - OCR_PROCESSOR (Enterprise Document OCR) → Patient ID + clinical
//   - FORM_PARSER_PROCESSOR → insurance cards only
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
    const ocr = existing.find((p) => p.type === "OCR_PROCESSOR");
    const form = existing.find((p) => p.type === "FORM_PARSER_PROCESSOR");

    if (ocr) {
      console.log("OCR_PROCESSOR", ocr.name.split("/").pop(), "| state:", ocr.state);
    } else {
      console.log("Creating OCR_PROCESSOR…");
      const [created] = await client.createProcessor({
        parent,
        processor: { type: "OCR_PROCESSOR", displayName: "PA Copilot Enterprise OCR" },
      });
      console.log("CREATED OCR_PROCESSOR", created.name.split("/").pop());
    }

    if (form) {
      console.log("FORM_PARSER_PROCESSOR", form.name.split("/").pop(), "| state:", form.state);
    } else {
      console.log("Creating FORM_PARSER_PROCESSOR…");
      const [created] = await client.createProcessor({
        parent,
        processor: { type: "FORM_PARSER_PROCESSOR", displayName: "PA Copilot Insurance Form Parser" },
      });
      console.log("CREATED FORM_PARSER_PROCESSOR", created.name.split("/").pop());
    }

    console.log("\nSet in backend-node/.env:");
    console.log('DOCUMENT_AI_OCR_PROCESSOR_ID="<ocr id above>"');
    console.log('DOCUMENT_AI_FORM_PARSER_ID="<form parser id above>"');
  } catch (e) {
    console.log("ERROR_CODE", e.code, "MSG", e.message);
  }
})();
