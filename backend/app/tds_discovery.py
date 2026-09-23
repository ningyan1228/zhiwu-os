"""TDS-first, evidence-preserving helpers for customer discovery.

The parser is deliberately conservative.  It only proposes an application
when an uploaded document contains an application/use marker.  It never turns
an internal grade, a product name, or a guessed performance claim into an
application.  Users can add or confirm applications separately.
"""
from __future__ import annotations

import hashlib
import re
import zipfile
from dataclasses import dataclass
from io import BytesIO
from xml.etree import ElementTree


@dataclass(frozen=True)
class ParsedTds:
    text: str
    pages: list[str]
    status: str
    error: str | None = None


def parse_tds_upload(filename: str, content: bytes) -> ParsedTds:
    suffix = filename.rsplit(".", 1)[-1].casefold() if "." in filename else ""
    if suffix == "pdf":
        try:
            from pypdf import PdfReader
            pages = [(page.extract_text() or "").strip() for page in PdfReader(BytesIO(content)).pages]
        except Exception as exc:  # The user gets an explicit parse state, not sample data.
            return ParsedTds("", [], "解析失败", f"PDF 文本层无法读取：{type(exc).__name__}")
        text = "\n\n".join(page for page in pages if page)
        if len(re.sub(r"\s+", "", text)) < 80:
            return ParsedTds(text, pages, "需要 OCR", "该 PDF 未提供足够的可复制文本；请上传 OCR 版，或手动添加应用。")
        return ParsedTds(text, pages, "已解析")
    if suffix == "docx":
        try:
            with zipfile.ZipFile(BytesIO(content)) as archive:
                xml = archive.read("word/document.xml")
            root = ElementTree.fromstring(xml)
            paragraphs = []
            namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
            for paragraph in root.iter(f"{namespace}p"):
                value = "".join(node.text or "" for node in paragraph.iter(f"{namespace}t")).strip()
                if value:
                    paragraphs.append(value)
            text = "\n".join(paragraphs)
        except Exception as exc:
            return ParsedTds("", [], "解析失败", f"DOCX 无法读取：{type(exc).__name__}")
        if len(re.sub(r"\s+", "", text)) < 40:
            return ParsedTds(text, [text] if text else [], "解析失败", "DOCX 中没有可用于识别应用的文本。")
        return ParsedTds(text, [text], "已解析")
    return ParsedTds("", [], "解析失败", "仅支持 PDF 或 DOCX 格式。")


def content_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _compact(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" -–—:：;；,，")


def extract_explicit_applications(pages: list[str]) -> list[dict[str, object]]:
    """Return only document-backed application proposals, with page evidence."""
    marker = re.compile(
        r"(?:applications?|end[- ]uses?|recommended\s+(?:for|use)|suitable\s+(?:for|use)|used\s+(?:for|in)|"
        r"用途|适用(?:于|范围)|推荐用于|应用领域)", re.I,
    )
    seen: set[str] = set()
    found: list[dict[str, object]] = []
    for page_number, page in enumerate(pages, start=1):
        lines = [_compact(line) for line in page.splitlines() if _compact(line)]
        for index, line in enumerate(lines):
            if not marker.search(line):
                continue
            # Prefer the marked line.  A short following bullet is included
            # only as supporting text, never as an independently invented use.
            evidence = line
            if len(evidence) < 36 and index + 1 < len(lines) and len(lines[index + 1]) <= 240:
                evidence = f"{evidence} {lines[index + 1]}"
            cleaned = marker.sub("", evidence, count=1)
            cleaned = _compact(cleaned)
            if not cleaned or len(cleaned) < 3:
                continue
            # A heading can contain several applications.  Keep the original
            # evidence on every card so the user can split/edit with context.
            pieces = [piece.strip() for piece in re.split(r"[;；•·]|\s{2,}", cleaned) if len(piece.strip()) >= 3]
            for piece in pieces[:6]:
                key = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", piece.casefold())
                if not key or key in seen:
                    continue
                seen.add(key)
                found.append({
                    "application_name": piece[:180],
                    "description": "从 TDS 应用/用途原文提取，需用户确认后才可用于客户发现。",
                    "evidence_excerpt": evidence[:1800],
                    "evidence_page": page_number,
                    "evidence_status": "TDS明确",
                })
                if len(found) >= 20:
                    return found
    return found


def application_search_terms(application: dict[str, object], region: str | None) -> list[str]:
    """Build transparent, application-led query strings without product grades."""
    name = str(application.get("application_name") or "").strip()
    company_types = [str(value).strip() for value in application.get("target_company_types", []) if str(value).strip()]
    process = str(application.get("process_conditions") or "").strip()
    location = str(region or "").strip()
    if not name:
        return []
    nouns = company_types[:3] or ["manufacturer", "producer", "converter"]
    terms = [f'"{name}" {noun} {location}'.strip() for noun in nouns]
    if process:
        terms.append(f'"{name}" "{process}" {location}'.strip())
    terms.append(f'"{name}" "exhibitor list" filetype:pdf {location}'.strip())
    return list(dict.fromkeys(term for term in terms if term))
