from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

DATA_DIR = Path("data")
CHAT_STORE = DATA_DIR / "conversations.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_conversation(title: str = "New chat") -> dict[str, Any]:
    timestamp = utc_now()
    return {
        "id": str(uuid4()),
        "title": title,
        "created_at": timestamp,
        "updated_at": timestamp,
        "messages": [],
        "knowledge_chunks": [],
    }


def ensure_store() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not CHAT_STORE.exists():
        CHAT_STORE.write_text("[]", encoding="utf-8")


def load_conversations() -> list[dict[str, Any]]:
    ensure_store()
    try:
        conversations = json.loads(CHAT_STORE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        conversations = []
    normalized: list[dict[str, Any]] = []
    for item in conversations:
        if not isinstance(item, dict) or "id" not in item:
            continue
        normalized.append(
            {
                "id": item.get("id", str(uuid4())),
                "title": item.get("title", "New chat"),
                "created_at": item.get("created_at", utc_now()),
                "updated_at": item.get("updated_at", utc_now()),
                "messages": item.get("messages", []),
                "knowledge_chunks": item.get("knowledge_chunks", []),
            }
        )
    return normalized


def save_conversations(conversations: list[dict[str, Any]]) -> None:
    ensure_store()
    CHAT_STORE.write_text(
        json.dumps(conversations, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )


def clone_conversations(conversations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return deepcopy(conversations)


def find_conversation(
    conversations: list[dict[str, Any]], chat_id: str
) -> dict[str, Any] | None:
    for conversation in conversations:
        if conversation["id"] == chat_id:
            return conversation
    return None


def touch_conversation(conversation: dict[str, Any]) -> None:
    conversation["updated_at"] = utc_now()


def title_from_prompt(prompt: str) -> str:
    compact = " ".join(prompt.split())
    if not compact:
        return "New chat"
    if len(compact) <= 48:
        return compact
    return f"{compact[:45].rstrip()}..."
