"""Server-only IMAP reader for Zhiwu OS Mail Center.

Credentials stay in the Docker environment. This module never exposes IMAP
credentials or raw mailbox access through the browser API.
"""
from __future__ import annotations

import imaplib
import logging
import os
import re
import time
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

import httpx

from app.main import settings

logger = logging.getLogger("zhiwu.mail_sync")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


def _text(message: Any) -> str:
    """Return the first plain-text part without changing the stored content."""
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_type() == "text/plain" and part.get_content_disposition() != "attachment":
                return part.get_content() or ""
        for part in message.walk():
            if part.get_content_type() == "text/html" and part.get_content_disposition() != "attachment":
                return part.get_content() or ""
        return ""
    return message.get_content() or ""


def _category(subject: str, content: str) -> str:
    """Classify business mail with transparent keyword rules, never AI inference."""
    value = f"{subject} {content}".lower()
    if re.search(r"\b(pi|payment|remittance|invoice|bank slip)\b", value):
        return "payment"
    if re.search(r"\b(sample|specimen)\b", value):
        return "sample"
    if re.search(r"\b(quote|quotation|price|offer)\b", value):
        return "quotation"
    if re.search(r"\b(test|technical|tds|coa|performance|specification)\b", value):
        return "technical"
    return "customer_inquiry"


def _received_at(value: str | None) -> str:
    try:
        result = parsedate_to_datetime(value or "")
        if result.tzinfo is None:
            result = result.replace(tzinfo=timezone.utc)
        return result.astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, IndexError):
        return datetime.now(timezone.utc).isoformat()


class MailStore:
    def __init__(self) -> None:
        self.cfg = settings()
        self.headers = {
            "apikey": self.cfg.supabase_service_role_key,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def request(self, method: str, path: str, payload: Any = None, prefer: str | None = None) -> Any:
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        with httpx.Client(timeout=20) as client:
            response = client.request(method, f"{self.cfg.supabase_url}/rest/v1/{path}", headers=headers, json=payload)
        response.raise_for_status()
        return response.json() if response.content else None

    def update_sync(self, status: str, total_synced: int = 0, error: str | None = None) -> None:
        owner = self.cfg.mail_owner_user_id
        if not owner:
            return
        self.request(
            "POST",
            "email_sync?on_conflict=user_id",
            {
                "user_id": owner,
                "last_sync_time": datetime.now(timezone.utc).isoformat(),
                "total_synced": total_synced,
                "status": status,
                "last_error": error,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            "resolution=merge-duplicates,return=minimal",
        )


def sync_once() -> dict[str, int]:
    cfg = settings()
    required = (cfg.mail_host, cfg.mail_username, cfg.mail_password, cfg.mail_owner_user_id)
    if not all(required):
        logger.warning("IMAP sync is not configured; waiting for server-only MAIL_* variables")
        return {"processed": 0, "saved": 0}

    store = MailStore()
    store.update_sync("Running")
    try:
        customers = store.request("GET", f"customers?user_id=eq.{cfg.mail_owner_user_id}&select=id,email") or []
        mappings = store.request("GET", f"customer_email_mappings?user_id=eq.{cfg.mail_owner_user_id}&select=customer_id,email_address") or []
        projects = store.request("GET", f"projects?user_id=eq.{cfg.mail_owner_user_id}&select=id,customer_id,product_id&order=created_at.desc") or []
        customer_by_email = {str(row.get("email", "")).lower(): row["id"] for row in customers}
        customer_by_email.update({str(row.get("email_address", "")).lower(): row["customer_id"] for row in mappings})
        project_by_customer: dict[str, dict[str, str | None]] = {}
        for project in projects:
            project_by_customer.setdefault(project["customer_id"], {"id": project["id"], "product_id": project.get("product_id")})

        with imaplib.IMAP4_SSL(cfg.mail_host, cfg.mail_port) as mailbox:
            mailbox.login(cfg.mail_username, cfg.mail_password)
            mailbox.select(cfg.mail_folder, readonly=True)
            result, data = mailbox.uid("search", None, "ALL")
            if result != "OK":
                raise RuntimeError("Unable to list IMAP messages")
            uids = data[0].split()[-cfg.mail_sync_max_messages :]
            saved = 0
            for uid in reversed(uids):
                result, parts = mailbox.uid("fetch", uid, "(RFC822)")
                if result != "OK" or not parts or not parts[0]:
                    continue
                raw = parts[0][1]
                if not isinstance(raw, bytes):
                    continue
                message = BytesParser(policy=policy.default).parsebytes(raw)
                sender_name, sender = parseaddr(message.get("From", ""))
                sender = sender.lower()
                customer_id = customer_by_email.get(sender)
                content = _text(message)
                project = project_by_customer.get(customer_id or "", {})
                message_id = message.get("Message-ID") or f"imap-{uid.decode(errors='ignore')}"
                payload = {
                    "user_id": cfg.mail_owner_user_id,
                    "message_id": message_id,
                    "sender": sender or message.get("From", "未知发件人"),
                    "receiver": message.get("To", ""),
                    "sender_name": sender_name or None,
                    "subject": message.get("Subject", "(无主题)"),
                    "content_preview": " ".join(content.split())[:280],
                    "content_text": content,
                    "received_at": _received_at(message.get("Date")),
                    "attachment_count": sum(1 for part in message.walk() if part.get_content_disposition() == "attachment"),
                    "customer_id": customer_id,
                    "project_id": project.get("id"),
                    "product_id": project.get("product_id"),
                    "category": _category(message.get("Subject", ""), content),
                    "status": "linked" if customer_id else "new_lead",
                }
                created = store.request("POST", "emails?on_conflict=user_id,message_id", payload, "resolution=ignore-duplicates,return=representation") or []
                saved += len(created)
        store.update_sync("Success", saved)
        logger.info("Mail sync finished: processed=%s saved=%s", len(uids), saved)
        return {"processed": len(uids), "saved": saved}
    except Exception as exc:
        logger.exception("Mail sync failed")
        store.update_sync("Error", 0, str(exc)[:500])
        raise


def main() -> None:
    interval = settings().mail_sync_interval_seconds
    while True:
        try:
            sync_once()
        except Exception:
            pass
        time.sleep(interval)


if __name__ == "__main__":
    main()
