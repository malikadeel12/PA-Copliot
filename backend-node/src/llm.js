// --- Change Summary ---
// What: DocAI + Claude extraction; Vision path for handwritten/low-clarity clinical notes.
// Why: Improve OCR accuracy on poor scans while keeping Form Parser off the cheap OCR path.
// Related: docai.js, prompts.js, POST /pa/capture

const Anthropic = require("@anthropic-ai/sdk");
const { PA_REASONING_SYSTEM_PROMPT, OCR_EXTRACTION_PROMPT } = require("./prompts");
const docai = require("./docai");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
const EXTRACTION_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL || MODEL;

function client() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com",
    fetch: globalThis.fetch,
    timeout: 90000,
    maxRetries: 4,
  });
}

function parseJson(text) {
  let t = (text || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(json)?/i, "").replace(/```$/g, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

function textFromResponse(resp) {
  return (resp.content || []).map((b) => b.text || "").join("");
}

function logUsage(stage, resp) {
  const usage = resp?.usage || {};
  console.log("Anthropic token usage:", {
    stage,
    model: resp?.model || (stage === "extraction" ? EXTRACTION_MODEL : MODEL),
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    cacheReadTokens: usage.cache_read_input_tokens || 0,
    cacheWriteTokens: usage.cache_creation_input_tokens || 0,
  });
}

function splitDataUrl(b64) {
  if (b64 && b64.startsWith("data:") && b64.includes(",")) {
    const [header, data] = b64.split(",", 2);
    const m = header.match(/data:(.*?);base64/);
    return { mimeType: m ? m[1] : "image/jpeg", content: data };
  }
  return { mimeType: "image/jpeg", content: b64 };
}

// Claude Vision: read handwritten / low-clarity clinical images that DocAI OCR missed.
async function visionExtractText(file) {
  const { mimeType, content } = splitDataUrl(file.content);
  // Claude image blocks only accept images — never coerce PDF bytes to JPEG.
  if (!mimeType.startsWith("image/")) {
    return file.text || "";
  }
  const mediaType = mimeType;
  const resp = await client().messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 2000,
    system:
      "You are a clinical OCR assistant. Transcribe ALL readable text from this " +
      "handwritten or low-clarity clinical document. Preserve structure. " +
      "Return plain text only — no JSON, no markdown fences.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: content },
          },
          {
            type: "text",
            text:
              `Section: ${file.section || "clinical"}. Filename: ${file.filename || "note"}. ` +
              "Transcribe every legible word, including handwritten notes, doses, ICD codes, and signatures.",
          },
        ],
      },
    ],
  });
  logUsage("vision-ocr", resp);
  return (textFromResponse(resp) || "").trim();
}

// 1) Google Document AI OCRs images/PDFs (OCR vs Form Parser by section).
// 2) Low-clarity clinical/ID images → Claude Vision re-read.
// 3) Claude structures the merged text into extraction JSON.
async function extractDocuments(files) {
  if (!files || files.length === 0) throw new Error("No files provided");
  let perFile;
  try {
    perFile = await docai.extractFiles(files);
  } catch (error) {
    console.error("Document AI stage failed:", error.message, error.cause?.code || "");
    throw error;
  }

  // --- Vision pipeline for handwritten / low-clarity non-insurance docs ---
  for (const f of perFile) {
    if (!f.needs_vision || !f.content) continue;
    if (f.section === "insurance") continue;
    try {
      const visionText = await visionExtractText(f);
      if (visionText && visionText.replace(/[^A-Za-z0-9]/g, "").length > (f.text || "").replace(/[^A-Za-z0-9]/g, "").length) {
        f.text = visionText;
        f.processor = `${f.processor}+claude_vision`;
      }
    } catch (e) {
      console.warn("Claude Vision OCR failed (keeping DocAI text):", e.message);
    }
  }

  const ocrText = docai.filesToOcrText(perFile);
  if (!ocrText || ocrText.replace(/[^A-Za-z0-9]/g, "").length < 25) {
    const err = new Error("Unclear document: insufficient readable text");
    err.code = "UNCLEAR";
    throw err;
  }
  const userText =
    "OCR / parsed TEXT extracted from the prior-authorization documents " +
    "(patient ID, insurance card, clinical/order doc; multiple files per section are allowed):\n\n" +
    ocrText +
    "\n\nStructure this into the required JSON. When the same field appears in " +
    "multiple files, prefer the most authoritative source " +
    "(insurance card for member/plan; clinical doc for diagnoses/prescriber). " +
    "Return JSON only.";
  let resp;
  try {
    resp = await client().messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 1600,
      system: OCR_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: userText }],
    });
  } catch (error) {
    console.error("Anthropic extraction stage failed:", {
      message: error.message,
      status: error.status || null,
      cause: error.cause?.message || null,
      code: error.cause?.code || error.code || null,
      model: EXTRACTION_MODEL,
    });
    const wrapped = new Error(`Anthropic extraction request failed: ${error.message}`);
    wrapped.code = "ANTHROPIC_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }
  logUsage("extraction", resp);
  return parseJson(textFromResponse(resp));
}

async function runReasoning(payload) {
  const userText =
    "INPUT PAYLOAD:\n" + JSON.stringify(payload) +
    "\n\nReturn ONLY the JSON object per the schema.";
  let resp;
  try {
    resp = await client().messages.create({
      model: MODEL,
      max_tokens: 6000,
      output_config: { effort: "low" },
      thinking: { type: "disabled" },
      system: PA_REASONING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    });
  } catch (error) {
    console.error("Anthropic reasoning request failed:", {
      message: error.message,
      status: error.status || null,
      cause: error.cause?.message || null,
      code: error.cause?.code || error.code || null,
      model: MODEL,
    });
    const wrapped = new Error(`Anthropic reasoning request failed: ${error.message}`);
    wrapped.code = "REASONING_API_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }
  logUsage("reasoning", resp);

  const firstText = textFromResponse(resp);
  try {
    return parseJson(firstText);
  } catch (firstParseError) {
    console.warn("Anthropic reasoning JSON retry:", {
      parseError: firstParseError.message,
      stopReason: resp.stop_reason || null,
      outputCharacters: firstText.length,
    });
    let retry;
    try {
      const retryMessages = resp.stop_reason === "max_tokens"
        ? [
          { role: "user", content: userText + "\n\nYour previous response exceeded the output limit. Generate a fresh, concise, complete JSON response and obey every length/count limit in the system prompt." },
        ]
        : [
          { role: "user", content: userText },
          { role: "assistant", content: firstText },
          { role: "user", content: "Repair your previous response. Return one complete valid JSON object matching the required schema. No prose and no markdown fences." },
        ];
      retry = await client().messages.create({
        model: MODEL,
        max_tokens: 6000,
        output_config: { effort: "low" },
        thinking: { type: "disabled" },
        system: PA_REASONING_SYSTEM_PROMPT,
        messages: retryMessages,
      });
      logUsage("reasoning-retry", retry);
    } catch (error) {
      console.error("Anthropic reasoning retry failed:", {
        message: error.message,
        status: error.status || null,
        cause: error.cause?.message || null,
        code: error.cause?.code || error.code || null,
      });
      const wrapped = new Error(`Anthropic reasoning retry failed: ${error.message}`);
      wrapped.code = "REASONING_API_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }

    const retryText = textFromResponse(retry);
    try {
      return parseJson(retryText);
    } catch (finalParseError) {
      console.error("Anthropic reasoning returned invalid JSON:", {
        parseError: finalParseError.message,
        stopReason: retry.stop_reason || null,
        outputCharacters: retryText.length,
      });
      const wrapped = new Error(`AI returned invalid JSON: ${finalParseError.message}`);
      wrapped.code = "REASONING_INVALID_JSON";
      throw wrapped;
    }
  }
}

module.exports = { extractDocuments, runReasoning, visionExtractText };
