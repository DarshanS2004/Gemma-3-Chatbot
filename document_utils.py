from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any

from docx import Document
from PIL import Image
from pypdf import PdfReader

TEXT_EXTENSIONS = {".txt", ".md", ".py", ".json", ".csv", ".tsv", ".log"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def extract_text_from_upload(uploaded_file: Any) -> str:
    suffix = Path(uploaded_file.name).suffix.lower()
    file_bytes = uploaded_file.getvalue()

    if suffix == ".pdf":
        reader = PdfReader(io.BytesIO(file_bytes))
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n".join(pages).strip()

    if suffix == ".docx":
        document = Document(io.BytesIO(file_bytes))
        lines = [paragraph.text for paragraph in document.paragraphs if paragraph.text]
        return "\n".join(lines).strip()

    if suffix == ".csv":
        decoded = file_bytes.decode("utf-8", errors="ignore")
        rows = csv.reader(io.StringIO(decoded))
        return "\n".join(", ".join(cell for cell in row if cell) for row in rows).strip()

    if suffix == ".tsv":
        decoded = file_bytes.decode("utf-8", errors="ignore")
        rows = csv.reader(io.StringIO(decoded), delimiter="\t")
        return "\n".join(", ".join(cell for cell in row if cell) for row in rows).strip()

    if suffix == ".json":
        decoded = file_bytes.decode("utf-8", errors="ignore")
        try:
            data = json.loads(decoded)
            return json.dumps(data, indent=2, ensure_ascii=True)
        except json.JSONDecodeError:
            return decoded.strip()

    if suffix in TEXT_EXTENSIONS:
        return file_bytes.decode("utf-8", errors="ignore").strip()

    raise ValueError(f"Unsupported document type: {suffix or uploaded_file.name}")


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 180) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []

    chunks: list[str] = []
    start = 0
    text_length = len(cleaned)
    while start < text_length:
        end = min(text_length, start + chunk_size)
        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= text_length:
            break
        start = max(end - overlap, start + 1)
    return chunks


def build_knowledge_chunks(uploaded_files: list[Any]) -> list[dict[str, str]]:
    chunks: list[dict[str, str]] = []
    for uploaded_file in uploaded_files:
        text = extract_text_from_upload(uploaded_file)
        for index, chunk in enumerate(chunk_text(text), start=1):
            chunks.append(
                {
                    "source_name": uploaded_file.name,
                    "chunk_id": f"{uploaded_file.name}-{index}",
                    "text": chunk,
                }
            )
    return chunks


def normalize_image(uploaded_file: Any) -> dict[str, Any]:
    file_bytes = uploaded_file.getvalue()
    image = Image.open(io.BytesIO(file_bytes))
    image.load()
    image_format = (image.format or "PNG").lower()

    if image_format not in {"png", "jpeg", "webp", "gif"}:
        buffer = io.BytesIO()
        image.convert("RGB").save(buffer, format="PNG")
        file_bytes = buffer.getvalue()
        image_format = "png"

    return {
        "name": uploaded_file.name,
        "format": image_format,
        "bytes": file_bytes,
        "size": image.size,
    }
