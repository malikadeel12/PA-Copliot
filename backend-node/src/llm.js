// OCR via Google Document AI + reasoning/output via Anthropic Claude.
const Anthropic = require("@anthropic-ai/sdk");
const { PA_REASONING_SYSTEM_PROMPT, OCR_EXTRACTION_PROMPT } = require("./prompts");
const docai = require("./docai");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
const EXTRACTION_MODEL = process.env.ANTHROPIC_EXTRACTION_MODEL || MODEL;

function client() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: "https://api.anthropic.com",
    // Use Node's native fetch on Render instead of the legacy node-fetch shim
    // bundled by older SDK versions. Retry transient network failures.
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

// 1) Google Document AI OCRs the uploaded documents → raw text.
// 2) Claude structures that text into the extraction JSON schema.
async function extractDocuments(imagesB64) {
  if (!imagesB64 || imagesB64.length === 0) throw new Error("No images provided");
  let ocrText;
  try {
    ocrText = await docai.ocrImages(imagesB64);
  } catch (error) {
    console.error("Document AI stage failed:", error.message, error.cause?.code || "");
    throw error;
  }
  // Blur/unclear guard: too little readable text means the photo is unusable.
  if (!ocrText || ocrText.replace(/[^A-Za-z0-9]/g, "").length < 25) {
    const err = new Error("Unclear document: insufficient readable text");
    err.code = "UNCLEAR";
    throw err;
  }
  const userText =
    "OCR TEXT extracted from the prior-authorization documents (patient ID, insurance card, clinical/order doc):\n\n" +
    ocrText +
    "\n\nStructure this into the required JSON. Return JSON only.";
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
    // Compact JSON avoids paying for formatting whitespace on every request.
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

module.exports = { extractDocuments, runReasoning };
