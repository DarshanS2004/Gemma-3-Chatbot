from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

import requests

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "was",
    "what",
    "when",
    "where",
    "who",
    "why",
    "with",
    "you",
}


def tokenize(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9]+", text.lower()) if token not in STOPWORDS]


def relevance_score(query: str, text: str) -> float:
    query_tokens = tokenize(query)
    text_tokens = tokenize(text)
    if not query_tokens or not text_tokens:
        return 0.0

    query_counts = Counter(query_tokens)
    text_counts = Counter(text_tokens)
    overlap = sum(min(query_counts[token], text_counts[token]) for token in query_counts)
    exact_phrase_bonus = 1.5 if query.lower() in text.lower() else 0.0
    density_bonus = overlap / math.sqrt(len(text_tokens))
    return overlap + density_bonus + exact_phrase_bonus


def retrieve_relevant_chunks(
    query: str, knowledge_chunks: list[dict[str, str]], limit: int = 4
) -> list[dict[str, str]]:
    scored = []
    for chunk in knowledge_chunks:
        score = relevance_score(query, chunk.get("text", ""))
        if score > 0:
            scored.append({**chunk, "score": score})
    return sorted(scored, key=lambda item: item["score"], reverse=True)[:limit]


def search_chat_history(
    query: str, conversations: list[dict[str, Any]], limit: int = 8
) -> list[dict[str, Any]]:
    hits = []
    for conversation in conversations:
        for message in conversation.get("messages", []):
            content = message.get("content", "")
            score = relevance_score(query, content)
            if score <= 0:
                continue
            hits.append(
                {
                    "chat_id": conversation["id"],
                    "chat_title": conversation.get("title", "New chat"),
                    "role": message.get("role", "assistant"),
                    "content": content,
                    "score": score,
                }
            )
    return sorted(hits, key=lambda item: item["score"], reverse=True)[:limit]


def _flatten_duckduckgo_topics(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    flattened: list[dict[str, str]] = []
    for item in items:
        if "Topics" in item:
            flattened.extend(_flatten_duckduckgo_topics(item["Topics"]))
            continue
        text = item.get("Text")
        url = item.get("FirstURL")
        if text and url:
            flattened.append({"title": text.split(" - ")[0], "snippet": text, "url": url})
    return flattened


def search_web(query: str, max_results: int = 5, timeout: int = 10) -> list[dict[str, str]]:
    try:
        response = requests.get(
            "https://api.duckduckgo.com/",
            params={
                "q": query,
                "format": "json",
                "no_html": 1,
                "no_redirect": 1,
                "skip_disambig": 0,
            },
            timeout=timeout,
            headers={"User-Agent": "Gemma3Chatbot/1.0"},
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError):
        return []

    results: list[dict[str, str]] = []
    if data.get("AbstractText"):
        results.append(
            {
                "title": data.get("Heading") or query,
                "snippet": data["AbstractText"],
                "url": data.get("AbstractURL") or "",
            }
        )

    results.extend(_flatten_duckduckgo_topics(data.get("RelatedTopics", [])))
    unique_results = []
    seen_urls: set[str] = set()
    for result in results:
        url = result.get("url", "")
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        unique_results.append(result)
        if len(unique_results) >= max_results:
            break
    return unique_results
