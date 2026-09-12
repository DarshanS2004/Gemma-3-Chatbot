from __future__ import annotations

import os
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_file

from artifact_utils import (
    asset_path,
    build_file_generation_prompt,
    detect_file_request,
    infer_file_format,
    save_generated_file,
)
from bedrock_chat import (
    DEFAULT_MODEL_ID,
    DEFAULT_REGION,
    stream_bedrock_response,
)
from document_utils import build_knowledge_chunks, normalize_image
from search_utils import retrieve_relevant_chunks, search_chat_history, search_web
from storage import (
    find_conversation,
    load_conversations,
    new_conversation,
    save_conversations,
    title_from_prompt,
    touch_conversation,
)

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
PENDING_IMAGES: dict[str, list[dict[str, Any]]] = {}


def infer_user_name() -> str:
    raw = os.getenv("USERNAME") or Path.home().name or "Darshan"
    cleaned = raw.replace(".", " ").replace("_", " ").strip()
    normalized = cleaned.title() if cleaned else "Darshan"
    if normalized.lower() in {"darsh", "darshan"}:
        return "Darshan"
    return normalized


def default_settings() -> dict[str, Any]:
    return {
        "region": os.getenv("AWS_REGION", DEFAULT_REGION),
        "model_id": os.getenv("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID),
        "access_key": os.getenv("AWS_ACCESS_KEY_ID", ""),
        "secret_key": os.getenv("AWS_SECRET_ACCESS_KEY", ""),
        "session_token": os.getenv("AWS_SESSION_TOKEN", ""),
        "enable_web_search": True,
        "temperature": 0.4,
        "max_tokens": 1400,
    }


def load_store() -> list[dict[str, Any]]:
    conversations = load_conversations()
    if conversations:
        return conversations
    starter = new_conversation()
    save_conversations([starter])
    return [starter]


def save_store(conversations: list[dict[str, Any]]) -> None:
    save_conversations(deepcopy(conversations))


def conversation_summary(conversation: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": conversation["id"],
        "title": conversation.get("title", "New chat"),
        "updated_at": conversation.get("updated_at"),
        "message_count": len(conversation.get("messages", [])),
    }


def serialize_conversation(conversation: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": conversation["id"],
        "title": conversation.get("title", "New chat"),
        "created_at": conversation.get("created_at"),
        "updated_at": conversation.get("updated_at"),
        "messages": conversation.get("messages", []),
        "knowledge_chunks": conversation.get("knowledge_chunks", []),
    }


def merged_settings(payload: dict[str, Any] | None) -> dict[str, Any]:
    merged = default_settings()
    if not payload:
        return merged

    for key in ("region", "model_id", "access_key", "secret_key", "session_token"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            merged[key] = value.strip()

    merged["enable_web_search"] = bool(payload.get("enable_web_search", merged["enable_web_search"]))
    try:
        merged["temperature"] = float(payload.get("temperature", merged["temperature"]))
    except (TypeError, ValueError):
        pass
    try:
        merged["max_tokens"] = int(payload.get("max_tokens", merged["max_tokens"]))
    except (TypeError, ValueError):
        pass
    return merged


def build_context(
    query: str,
    conversation: dict[str, Any],
    settings: dict[str, Any],
) -> tuple[str, list[dict[str, str]]]:
    local_chunks = retrieve_relevant_chunks(query, conversation.get("knowledge_chunks", []), limit=4)
    web_results = search_web(query, max_results=4) if settings.get("enable_web_search") else []

    sections: list[str] = []
    sources: list[dict[str, str]] = []

    if local_chunks:
        local_text = "\n\n".join(
            f"Source: {chunk['source_name']}\nExcerpt: {chunk['text']}" for chunk in local_chunks
        )
        sections.append("Uploaded file context:\n" + local_text)
        sources.extend(
            {
                "title": chunk["source_name"],
                "snippet": chunk["text"][:220] + ("..." if len(chunk["text"]) > 220 else ""),
                "url": "",
            }
            for chunk in local_chunks
        )

    if web_results:
        web_text = "\n\n".join(
            f"Title: {result['title']}\nSnippet: {result['snippet']}\nURL: {result['url']}"
            for result in web_results
        )
        sections.append("Live web search results:\n" + web_text)
        sources.extend(web_results)

    return "\n\n".join(sections), sources


def collect_bedrock_answer(
    *,
    conversation: dict[str, Any],
    prompt: str,
    settings: dict[str, Any],
    image_payloads: list[dict[str, Any]] | None = None,
) -> tuple[str, list[dict[str, str]]]:
    context_text, sources = build_context(prompt, conversation, settings)
    prior_messages = conversation.get("messages", [])[:-1]
    try:
        stream = stream_bedrock_response(
            model_id=settings["model_id"],
            region_name=settings["region"],
            access_key_id=settings["access_key"] or None,
            secret_access_key=settings["secret_key"] or None,
            session_token=settings["session_token"] or None,
            prior_messages=prior_messages,
            prompt=prompt,
            context_text=context_text,
            image_payloads=image_payloads or [],
            temperature=settings["temperature"],
            max_tokens=settings["max_tokens"],
        )
        response_text = "".join(token for token in stream)
        return response_text, sources
    except Exception as exc:
        return (
            "I could not reach Amazon Bedrock for this request. "
            f"Please verify the AWS region, model access, and credentials. Details: {exc}",
            sources,
        )


def collect_structured_file_content(
    *,
    conversation: dict[str, Any],
    user_prompt: str,
    file_format: str,
    settings: dict[str, Any],
) -> str:
    file_prompt = build_file_generation_prompt(user_prompt, file_format)
    response_text, _ = collect_bedrock_answer(
        conversation=conversation,
        prompt=file_prompt,
        settings=settings,
        image_payloads=[],
    )
    if response_text.startswith("I could not reach Amazon Bedrock"):
        raise RuntimeError(response_text)
    return response_text


def classify_request(display_prompt: str, mode: str | None) -> dict[str, str] | None:
    file_format = infer_file_format(display_prompt)
    if file_format and detect_file_request(display_prompt):
        return {"type": "file", "format": file_format}

    return None


class UploadAdapter:
    def __init__(self, filename: str, content: bytes):
        self.name = filename
        self._content = content

    def getvalue(self) -> bytes:
        return self._content


@app.route("/")
def index():
    return render_template("index.html", user_name=infer_user_name())


@app.get("/api/bootstrap")
def bootstrap():
    conversations = load_store()
    active = conversations[0]["id"] if conversations else None
    settings = default_settings()
    return jsonify(
        {
            "user_name": infer_user_name(),
            "conversations": [conversation_summary(item) for item in conversations],
            "active_chat_id": active,
            "settings": settings,
        }
    )


@app.get("/api/conversations")
def list_conversations():
    conversations = load_store()
    return jsonify([conversation_summary(item) for item in conversations])


@app.get("/api/conversations/<chat_id>")
def get_conversation(chat_id: str):
    conversations = load_store()
    conversation = find_conversation(conversations, chat_id)
    if conversation is None:
        return jsonify({"error": "Conversation not found"}), 404
    return jsonify(serialize_conversation(conversation))


@app.get("/api/assets/<asset_kind>/<path:filename>")
def get_generated_asset(asset_kind: str, filename: str):
    if asset_kind not in {"images", "files"}:
        return jsonify({"error": "Asset type not supported"}), 404
    try:
        path = asset_path(asset_kind, unquote(filename))
    except FileNotFoundError:
        return jsonify({"error": "Asset not found"}), 404

    as_attachment = request.args.get("download") == "1"
    return send_file(path, as_attachment=as_attachment, download_name=path.name)


@app.patch("/api/conversations/<chat_id>")
def update_conversation(chat_id: str):
    conversations = load_store()
    conversation = find_conversation(conversations, chat_id)
    if conversation is None:
        return jsonify({"error": "Conversation not found"}), 404

    payload = request.get_json(force=True) or {}
    title = (payload.get("title") or "").strip()
    if title:
        conversation["title"] = title
        touch_conversation(conversation)
        save_store(conversations)

    return jsonify(serialize_conversation(conversation))


@app.post("/api/conversations")
def create_conversation():
    conversations = load_store()
    conversation = new_conversation()
    conversations.insert(0, conversation)
    save_store(conversations)
    return jsonify(serialize_conversation(conversation)), 201


@app.delete("/api/conversations/<chat_id>")
def remove_conversation(chat_id: str):
    conversations = load_store()
    filtered = [item for item in conversations if item["id"] != chat_id]
    if not filtered:
        filtered = [new_conversation()]
    save_store(filtered)
    return jsonify(
        {
            "deleted": chat_id,
            "conversations": [conversation_summary(item) for item in filtered],
            "active_chat_id": filtered[0]["id"],
        }
    )


@app.delete("/api/conversations/<chat_id>/messages/<int:message_index>")
def remove_message(chat_id: str, message_index: int):
    conversations = load_store()
    conversation = find_conversation(conversations, chat_id)
    if conversation is None:
        return jsonify({"error": "Conversation not found"}), 404
    if 0 <= message_index < len(conversation.get("messages", [])):
        conversation["messages"].pop(message_index)
        touch_conversation(conversation)
        save_store(conversations)
    return jsonify(serialize_conversation(conversation))


@app.post("/api/conversations/<chat_id>/upload")
def upload_assets(chat_id: str):
    conversations = load_store()
    conversation = find_conversation(conversations, chat_id)
    if conversation is None:
        return jsonify({"error": "Conversation not found"}), 404

    document_files = []
    image_files = []
    for file in request.files.getlist("documents"):
        if file and file.filename:
            document_files.append(UploadAdapter(file.filename, file.read()))
    for file in request.files.getlist("images"):
        if file and file.filename:
            image_files.append(UploadAdapter(file.filename, file.read()))

    added_chunks = []
    added_images = 0
    if document_files:
        added_chunks = build_knowledge_chunks(document_files)
        conversation["knowledge_chunks"].extend(added_chunks)
    if image_files:
        pending = PENDING_IMAGES.setdefault(chat_id, [])
        pending.extend(normalize_image(image_file) for image_file in image_files)
        added_images = len(image_files)

    touch_conversation(conversation)
    save_store(conversations)
    return jsonify(
        {
            "chat_id": chat_id,
            "knowledge_chunks": len(conversation.get("knowledge_chunks", [])),
            "added_chunks": len(added_chunks),
            "added_images": added_images,
        }
    )


@app.post("/api/chat")
def chat():
    payload = request.get_json(force=True)
    prompt = (payload.get("prompt") or "").strip()
    display_prompt = (payload.get("display_prompt") or prompt).strip()
    mode = (payload.get("mode") or "").strip().lower() or None
    if not prompt:
        return jsonify({"error": "Prompt is required"}), 400

    conversations = load_store()
    chat_id = payload.get("chat_id")
    conversation = find_conversation(conversations, chat_id) if chat_id else None
    if conversation is None:
        conversation = new_conversation()
        conversations.insert(0, conversation)

    replace_user_index = payload.get("replace_user_index")
    if replace_user_index is not None:
        try:
            replace_user_index = int(replace_user_index)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid replace index"}), 400
        messages = conversation.get("messages", [])
        if not (0 <= replace_user_index < len(messages)):
            return jsonify({"error": "Replace index out of range"}), 400
        if messages[replace_user_index].get("role") != "user":
            return jsonify({"error": "Replace index must reference a user message"}), 400
        conversation["messages"] = messages[:replace_user_index]

    settings = merged_settings(payload.get("settings"))
    user_message = {
        "role": "user",
        "content": display_prompt or prompt,
        "model_content": prompt,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "attachments": [],
    }
    conversation["messages"].append(user_message)
    if conversation["title"] == "New chat" or replace_user_index == 0:
        conversation["title"] = title_from_prompt(display_prompt or prompt)
    touch_conversation(conversation)
    save_store(conversations)

    request_kind = classify_request(display_prompt or prompt, mode)
    pending_images = PENDING_IMAGES.get(conversation["id"], [])

    try:
        if request_kind and request_kind["type"] == "file":
            file_format = request_kind["format"]
            file_content = collect_structured_file_content(
                conversation=conversation,
                user_prompt=display_prompt or prompt,
                file_format=file_format,
                settings=settings,
            )
            saved_file = save_generated_file(display_prompt or prompt, file_format, file_content)
            assistant_message = {
                "role": "assistant",
                "content": f"Your {file_format.upper()} file is ready to download.",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "sources": [],
                "generated_files": [saved_file],
            }
        else:
            assistant_text, sources = collect_bedrock_answer(
                conversation=conversation,
                prompt=prompt,
                settings=settings,
                image_payloads=pending_images,
            )
            assistant_message = {
                "role": "assistant",
                "content": assistant_text,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "sources": sources,
            }
    except Exception as exc:
        assistant_message = {
            "role": "assistant",
            "content": (
                "I could not complete that generation request right now. "
                f"Please verify the model access, credentials, and prompt. Details: {exc}"
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "sources": [],
        }
    conversation["messages"].append(assistant_message)
    touch_conversation(conversation)
    save_store(conversations)
    PENDING_IMAGES[conversation["id"]] = []

    return jsonify(
        {
            "chat": serialize_conversation(conversation),
            "conversations": [conversation_summary(item) for item in conversations],
        }
    )


@app.post("/api/history-search")
def history_search():
    payload = request.get_json(force=True)
    query = (payload.get("query") or "").strip()
    conversations = load_store()
    if not query:
        return jsonify([])
    return jsonify(search_chat_history(query, conversations, limit=20))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8501, debug=False)
