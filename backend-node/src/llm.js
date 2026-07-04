// LLM services using YOUR OWN Anthropic API key (Claude for reasoning + vision OCR).
const Anthropic = require("@anthropic-ai/sdk");
const { PA_REASONING_SYSTEM_PROMPT, OCR_EXTRACTION_PROMPT } = require("./prompts");

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

function splitDataUrl(b64) {
  // returns { media_type, data }
  if (b64 && b64.startsWith("data:") && b64.includes(",")) {
    const [header, data] = b64.split(",", 2);
    const m = header.match(/data:(.*?);base64/);
    return { media_type: m ? m[1] : "image/jpeg", data };
  }
  return { media_type: "image/jpeg", data: b64 };
}

function textFromResponse(resp) {
  return (resp.content || []).map((b) => b.text || "").join("");
}

async function extractDocuments(imagesB64) {
  if (!imagesB64 || imagesB64.length === 0) throw new Error("No images provided");
  const content = [
    { type: "text", text: "Extract the structured JSON from these prior-authorization documents. Return JSON only." },
    ...imagesB64.filter(Boolean).map((b) => {
      const { media_type, data } = splitDataUrl(b);
      return { type: "image", source: { type: "base64", media_type, data } };
    }),
  ];
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: OCR_EXTRACTION_PROMPT,
    messages: [{ role: "user", content }],
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
