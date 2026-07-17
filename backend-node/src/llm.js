// OCR via Google Document AI + reasoning/output via Anthropic Claude.
const Anthropic = require("@anthropic-ai/sdk");
const { PA_REASONING_SYSTEM_PROMPT, OCR_EXTRACTION_PROMPT } = require("./prompts");
const docai = require("./docai");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

// 1) Google Document AI OCRs the uploaded documents → raw text.
// 2) Claude structures that text into the extraction JSON schema.
async function extractDocuments(imagesB64) {
  if (!imagesB64 || imagesB64.length === 0) throw new Error("No images provided");
  const ocrText = await docai.ocrImages(imagesB64);
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
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: OCR_EXTRACTION_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  return parseJson(textFromResponse(resp));
}

async function runReasoning(payload) {
  const userText =
    "INPUT PAYLOAD:\n" + JSON.stringify(payload, null, 2) +
    "\n\nReturn ONLY the JSON object per the schema.";
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    system: PA_REASONING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  try {
    return parseJson(textFromResponse(resp));
  } catch {
    const retry = await client().messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: PA_REASONING_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userText },
        { role: "assistant", content: textFromResponse(resp) },
        { role: "user", content: "Your previous reply was not valid JSON. Return ONLY the JSON object, no prose, no code fences." },
      ],
    });
    return parseJson(textFromResponse(retry));
  }
}

module.exports = { extractDocuments, runReasoning };
