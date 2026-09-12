from __future__ import annotations

import os
from typing import Any, Generator

import boto3
from botocore.config import Config

DEFAULT_REGION = os.getenv("AWS_REGION", "us-east-1")
DEFAULT_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "google.gemma-3-12b-it")
SYSTEM_PROMPT = """You are Gemma 3 inside a polished, modern chatbot app.
Be helpful, accurate, and conversational.
If context from uploaded files or live web results is supplied, use it when relevant.
If the answer is uncertain, say what is uncertain instead of guessing.
"""


def make_bedrock_client(
    region_name: str,
    access_key_id: str | None = None,
    secret_access_key: str | None = None,
    session_token: str | None = None,
):
    kwargs: dict[str, Any] = {
        "service_name": "bedrock-runtime",
        "region_name": region_name or DEFAULT_REGION,
        "config": Config(read_timeout=300, retries={"max_attempts": 3, "mode": "standard"}),
    }
    if access_key_id and secret_access_key:
        kwargs["aws_access_key_id"] = access_key_id
        kwargs["aws_secret_access_key"] = secret_access_key
    if session_token:
        kwargs["aws_session_token"] = session_token
    return boto3.client(**kwargs)


def build_messages(
    prior_messages: list[dict[str, Any]],
    prompt: str,
    context_text: str = "",
    image_payloads: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for message in prior_messages[-12:]:
        role = message.get("role")
        content = (message.get("model_content") or message.get("content") or "").strip()
        if role not in {"user", "assistant"} or not content:
            continue
        messages.append({"role": role, "content": [{"text": content}]})

    prompt_parts = [prompt.strip()]
    if context_text.strip():
        prompt_parts.append(
            "Supplemental context:\n"
            f"{context_text.strip()}\n\n"
            "Use this context only when it helps answer the question."
        )
    full_prompt = "\n\n".join(part for part in prompt_parts if part)

    user_content: list[dict[str, Any]] = [{"text": full_prompt}]
    for image in image_payloads or []:
        user_content.append(
            {
                "image": {
                    "format": image["format"],
                    "source": {"bytes": image["bytes"]},
                }
            }
        )
    messages.append({"role": "user", "content": user_content})
    return messages


def stream_bedrock_response(
    *,
    model_id: str,
    region_name: str,
    access_key_id: str | None,
    secret_access_key: str | None,
    session_token: str | None,
    prior_messages: list[dict[str, Any]],
    prompt: str,
    context_text: str = "",
    image_payloads: list[dict[str, Any]] | None = None,
    temperature: float = 0.4,
    max_tokens: int = 1400,
) -> Generator[str, None, str]:
    client = make_bedrock_client(
        region_name=region_name,
        access_key_id=access_key_id,
        secret_access_key=secret_access_key,
        session_token=session_token,
    )
    response = client.converse_stream(
        modelId=model_id or DEFAULT_MODEL_ID,
        system=[{"text": SYSTEM_PROMPT}],
        messages=build_messages(prior_messages, prompt, context_text, image_payloads),
        inferenceConfig={
            "temperature": temperature,
            "maxTokens": max_tokens,
        },
    )

    full_text = ""
    for event in response["stream"]:
        delta = event.get("contentBlockDelta", {}).get("delta", {})
        token = delta.get("text")
        if not token:
            continue
        full_text += token
        yield token
    return full_text
