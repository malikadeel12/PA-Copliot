"""LLM services: vision OCR extraction + consolidated Claude reasoning call.

Uses the Emergent universal LLM key via emergentintegrations.
"""
import os
import json
import uuid
import logging

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
from prompts import PA_REASONING_SYSTEM_PROMPT, OCR_EXTRACTION_PROMPT

logger = logging.getLogger(__name__)

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
OCR_MODEL = ("openai", "gpt-5.4")
REASONING_MODEL = ("anthropic", "claude-sonnet-4-6")


def _strip_data_url(b64: str) -> str:
    if not b64:
        return b64
    if b64.startswith("data:") and "," in b64:
        return b64.split(",", 1)[1]
    return b64


def _parse_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1] if text.count("```") >= 2 else text
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    text = text.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


async def extract_documents(images_b64: list[str]) -> dict:
    """Run vision OCR over the captured document images -> structured extracted_data."""
    if not images_b64:
        raise ValueError("No images provided")
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"ocr-{uuid.uuid4().hex[:12]}",
        system_message=OCR_EXTRACTION_PROMPT,
    ).with_model(*OCR_MODEL)

    contents = [ImageContent(image_base64=_strip_data_url(b)) for b in images_b64 if b]
    msg = UserMessage(
        text="Extract the structured JSON from these prior-authorization documents. Return JSON only.",
        file_contents=contents,
    )
    resp = await chat.send_message(msg)
    try:
        return _parse_json(resp)
    except Exception as e:
        logger.error(f"OCR JSON parse failed: {e}")
        raise ValueError("Could not parse extraction result")


async def run_reasoning(payload: dict) -> dict:
    """Single consolidated Claude call returning the 4-panel structured JSON."""
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"pa-{uuid.uuid4().hex[:12]}",
        system_message=PA_REASONING_SYSTEM_PROMPT,
    ).with_model(*REASONING_MODEL)

    user_text = "INPUT PAYLOAD:\n" + json.dumps(payload, indent=2) + "\n\nReturn ONLY the JSON object per the schema."
    resp = await chat.send_message(UserMessage(text=user_text))
    try:
        return _parse_json(resp)
    except Exception:
        # one corrective retry
        retry = await chat.send_message(UserMessage(
            text="Your previous reply was not valid JSON. Return ONLY the JSON object, no prose, no code fences."
        ))
        return _parse_json(retry)
