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
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

import httpx

from app.main import is_internal_mail_address, settings

logger = logging.getLogger("zhiwu.mail_sync")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


@dataclass(frozen=True)
class MailboxRuntime:
    """A mailbox identity from Supabase paired with server-only IMAP variables."""
    id: str | None
    owner_user_id: str
    key: str
    label: str
    email_address: str | None
    host: str | None
    port: int
    username: str | None
    password: str | None
    folder: str


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


def _normalized(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def _resolve_customer(
    sender: str, sender_name: str | None, customer_by_email: dict[str, str], customer_by_contact: dict[str, str],
) -> str | None:
    """Use a saved address first, then a conservative CRM contact-name match.

    Contact matching is only a fallback for obvious sender names such as
    "Dileep Pathak" -> CRM contact "Dileep". It intentionally leaves unknown
    aliases (for example a generic colleague name) unlinked for user review.
    """
    if sender.lower() in customer_by_email:
        return customer_by_email[sender.lower()]
    normalized_sender = _normalized(sender_name)
    if not normalized_sender:
        return None
    for alias, customer_id in customer_by_contact.items():
        if len(alias) >= 4 and alias in normalized_sender:
            return customer_id
    return None


def _resolve_internal_forward_customer(
    receiver: str | None, subject: str | None, content: str | None,
    customer_by_email: dict[str, str], customer_by_contact: dict[str, str],
) -> str | None:
    """Resolve a colleague-forwarded message from the customer evidence it carries.

    A message sent by Zhiwu to Peter must not associate the address of either
    colleague with a customer.  It can, however, safely be linked when the
    forwarded message contains exactly one known customer email, contact name,
    or full company name.  Ambiguous messages intentionally remain unlinked.
    """
    value = " ".join(part for part in (receiver, subject, content) if part)
    email_hits = {
        customer_by_email[address.lower()]
        for address in re.findall(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", value, flags=re.IGNORECASE)
        if address.lower() in customer_by_email
    }
    if len(email_hits) == 1:
        return next(iter(email_hits))
    if len(email_hits) > 1:
        return None

    normalized_value = _normalized(value)
    contact_hits = {
        customer_id
        for alias, customer_id in customer_by_contact.items()
        if len(alias) >= 4 and alias in normalized_value
    }
    return next(iter(contact_hits)) if len(contact_hits) == 1 else None


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

    def update_sync(self, mailbox: MailboxRuntime, status: str, total_synced: int = 0, error: str | None = None) -> None:
        self.request(
            "POST",
            "email_sync?on_conflict=user_id",
            {
                "user_id": mailbox.owner_user_id,
                "mailbox_id": mailbox.id,
                "last_sync_time": datetime.now(timezone.utc).isoformat(),
                "total_synced": total_synced,
                "status": status,
                "last_error": error,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            "resolution=merge-duplicates,return=minimal",
        )


def _customer_lookup(store: MailStore, owner_id: str) -> tuple[dict[str, str], dict[str, str], dict[str, dict[str, str | None]], dict[str, str], dict[str, str]]:
    # CRM is a shared workspace. Mail itself remains private because every email
    # record is stored under the mailbox owner's user_id.
    customers = store.request("GET", "customers?import_reverted=eq.false&archived_at=is.null&select=id,email,contact_person,company_name,last_contact_date") or []
    # A customer may be owned by Zhiwu while Peter receives a forwarded thread.
    # The synchroniser runs server-side, so it can safely use workspace mappings
    # to identify that shared customer; it still never exposes another mailbox.
    mappings = store.request("GET", "customer_email_mappings?select=customer_id,email_address,contact_name") or []
    projects = store.request("GET", "projects?import_reverted=eq.false&archived_at=is.null&select=id,customer_id,product_id&order=created_at.desc") or []
    customer_by_email = {str(row.get("email", "")).lower(): row["id"] for row in customers if row.get("email")}
    customer_by_email.update({str(row.get("email_address", "")).lower(): row["customer_id"] for row in mappings if row.get("email_address")})
    customer_by_contact: dict[str, str] = {}
    for row in [*customers, *mappings]:
        contact = _normalized(row.get("contact_person") or row.get("contact_name"))
        if contact:
            customer_by_contact[contact] = row["id"] if row.get("id") else row["customer_id"]
            # Matching a meaningful individual name supports names with a surname
            # in the mailbox while avoiding a one/two-letter initial match.
            for token in re.findall(r"[a-z0-9]+", str(row.get("contact_person") or row.get("contact_name") or "").lower()):
                if len(token) >= 4:
                    customer_by_contact.setdefault(token, row["id"] if row.get("id") else row["customer_id"])
    for row in customers:
        company = _normalized(row.get("company_name"))
        if company:
            customer_by_contact.setdefault(company, row["id"])
    project_by_customer: dict[str, dict[str, str | None]] = {}
    for project in projects:
        project_by_customer.setdefault(project["customer_id"], {"id": project["id"], "product_id": project.get("product_id")})
    contact_name_by_customer = {row["id"]: str(row.get("contact_person") or "") for row in customers}
    last_contact_by_customer = {row["id"]: str(row.get("last_contact_date") or "") for row in customers}
    return customer_by_email, customer_by_contact, project_by_customer, contact_name_by_customer, last_contact_by_customer


def _remember_mapping(store: MailStore, owner_id: str, sender: str, customer_id: str, contact_name: str | None) -> None:
    if not sender or "@" not in sender:
        return
    store.request("POST", "customer_email_mappings?on_conflict=user_id,email_address", {
        "user_id": owner_id, "customer_id": customer_id, "email_address": sender.lower(), "contact_name": contact_name or None,
    }, "resolution=merge-duplicates,return=minimal")


def _record_linked_email_activity(
    store: MailStore, owner_id: str, email: dict[str, Any], customer_id: str,
    last_contact_by_customer: dict[str, str],
) -> bool:
    """Safely make a linked email visible in the customer's CRM history.

    The email id is the idempotency key: an IMAP sync can run repeatedly
    without creating duplicate followups.  This deliberately does not infer
    or overwrite sales stage, product, or next action from raw email text.
    """
    email_id = str(email.get("id") or "")
    if not email_id:
        return False
    received_date = str(email.get("received_at") or "")[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", received_date):
        received_date = datetime.now(timezone.utc).date().isoformat()
    existing = store.request("GET", f"followups?email_id=eq.{email_id}&select=id&limit=1") or []
    created = False
    if not existing:
        subject = str(email.get("subject") or "(无主题)")
        preview = str(email.get("content_preview") or "").strip()
        store.request("POST", "followups", {
            "user_id": owner_id,
            "customer_id": customer_id,
            "email_id": email_id,
            "date": received_date,
            "content": f"邮件自动归档：{subject}" + (f"\n{preview}" if preview else ""),
            "next_action": "已自动归档，按需人工跟进",
            "status": "Done",
        }, "return=minimal")
        created = True
    previous_date = last_contact_by_customer.get(customer_id, "")
    if not previous_date or received_date > previous_date:
        store.request("PATCH", f"customers?id=eq.{customer_id}", {"last_contact_date": received_date}, "return=minimal")
        last_contact_by_customer[customer_id] = received_date
    return created


_SYSTEM_SENDER_NAMES = {"alimail", "mail delivery subsystem", "mailer daemon", "postmaster", "system", "notification"}
_SYSTEM_LOCAL_PARTS = ("no-reply", "noreply", "do-not-reply", "mailer-daemon", "postmaster", "notification", "notice")
_PERSONAL_OR_SYSTEM_DOMAINS = {"gmail.com", "qq.com", "163.com", "126.com", "outlook.com", "hotmail.com", "mail.aliyun.com"}


def _looks_like_customer_lead(sender: str, sender_name: str | None, subject: str | None, content: str | None) -> bool:
    """Keep only credible business senders for automatic *pending* CRM records."""
    address = sender.strip().lower()
    if "@" not in address or is_internal_mail_address(address):
        return False
    local_part, domain = address.rsplit("@", 1)
    if local_part.startswith(_SYSTEM_LOCAL_PARTS) or _normalized(sender_name) in {_normalized(name) for name in _SYSTEM_SENDER_NAMES}:
        return False
    value = f"{subject or ''} {content or ''}".lower()
    business_words = re.search(r"\b(inquiry|enquiry|quotation|quote|price|sample|tds|coa|product|order|technical|coating|material|resin|yarn|fiber|film)\b", value)
    purchase_intent = re.search(r"\b(we (?:are|would|need|look)|looking to source|interested in|request for|please (?:quote|send|provide|advise)|could you (?:please )?(?:send|provide|advise)|would like to (?:buy|import)|need (?:a |an )?(?:quote|price|sample))\b", value)
    # New customers are created only from an identifiable business inquiry.
    # A corporate-looking domain alone is not evidence of a prospective buyer.
    return bool(business_words and purchase_intent and _normalized(sender_name))


def _pending_company_name(sender: str) -> str:
    domain = sender.rsplit("@", 1)[-1].lower()
    return f"待确认 · {domain}"


def _create_pending_customer_from_email(
    store: MailStore, owner_id: str, email: dict[str, Any],
    customer_by_email: dict[str, str], customer_by_contact: dict[str, str],
) -> str | None:
    """Create a review-only customer from a credible, unmatched email sender."""
    sender = str(email.get("sender") or "").strip().lower()
    sender_name = str(email.get("sender_name") or "").strip()
    if not _looks_like_customer_lead(sender, sender_name, email.get("subject"), email.get("content_text") or email.get("content_preview")):
        return None
    if sender in customer_by_email:
        return customer_by_email[sender]
    company_name = _pending_company_name(sender)
    existing_company = customer_by_contact.get(_normalized(company_name))
    if existing_company:
        customer_by_email[sender] = existing_company
        return existing_company
    local_part = sender.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
    customer_rows = store.request("POST", "customers", {
        "user_id": owner_id,
        "company_name": company_name,
        "country": "待确认",
        "contact_person": sender_name or local_part or "待确认",
        "email": sender,
        "customer_stage": "New",
        "priority": "MEDIUM",
        "status_label": "待确认客户（邮件自动建档）",
        "status_tone": "attention",
        "customer_tags": ["待确认客户", "邮件自动建档"],
        "customer_summary": f"由邮件自动筛选，待确认公司名称与业务价值。来源：{sender}",
        "notes": f"自动建档来源邮件：{email.get('subject') or '(无主题)'}",
    }) or []
    if not customer_rows:
        return None
    customer_id = str(customer_rows[0]["id"])
    customer_by_email[sender] = customer_id
    customer_by_contact[_normalized(company_name)] = customer_id
    if sender_name:
        normalized_name = _normalized(sender_name)
        if normalized_name:
            customer_by_contact[normalized_name] = customer_id
    _remember_mapping(store, owner_id, sender, customer_id, sender_name or None)
    return customer_id


def _reconcile_linked_email_activity(
    store: MailStore, owner_id: str, last_contact_by_customer: dict[str, str],
) -> int:
    """Backfill CRM history for emails that were linked before this feature."""
    rows = store.request(
        "GET",
        f"emails?user_id=eq.{owner_id}&customer_id=not.is.null&select=id,customer_id,received_at,subject,content_preview&limit=500",
    ) or []
    return sum(
        _record_linked_email_activity(store, owner_id, row, str(row["customer_id"]), last_contact_by_customer)
        for row in rows
        if row.get("customer_id")
    )


def _reconcile_existing_links(
    store: MailStore, owner_id: str, customer_by_email: dict[str, str], customer_by_contact: dict[str, str],
    project_by_customer: dict[str, dict[str, str | None]], contact_name_by_customer: dict[str, str],
    last_contact_by_customer: dict[str, str],
) -> int:
    """Backfill older synchronised mail after a customer mapping is added."""
    rows = store.request("GET", f"emails?user_id=eq.{owner_id}&customer_id=is.null&select=id,sender,sender_name,receiver,subject,content_text,content_preview,received_at,status&limit=500") or []
    linked = 0
    for row in rows:
        sender = str(row.get("sender") or "")
        customer_id = (
            _resolve_internal_forward_customer(
                row.get("receiver"), row.get("subject"), row.get("content_text") or row.get("content_preview"),
                customer_by_email, customer_by_contact,
            )
            if is_internal_mail_address(sender)
            else _resolve_customer(sender, row.get("sender_name"), customer_by_email, customer_by_contact)
        )
        if not customer_id:
            customer_id = _create_pending_customer_from_email(store, owner_id, row, customer_by_email, customer_by_contact)
        if not customer_id:
            continue
        project = project_by_customer.get(customer_id, {})
        store.request("PATCH", f"emails?id=eq.{row['id']}", {
            "customer_id": customer_id, "project_id": project.get("id"), "product_id": project.get("product_id"),
            "status": "linked" if row.get("status") in ("new_lead", "unread", None) else row.get("status"),
        })
        if not is_internal_mail_address(sender):
            _remember_mapping(store, owner_id, sender, customer_id, contact_name_by_customer.get(customer_id))
        _record_linked_email_activity(store, owner_id, row, customer_id, last_contact_by_customer)
        linked += 1
    return linked


def _mailbox_value(key: str, field: str, legacy: str | int | None = None) -> str | int | None:
    """Read dynamic per-member variables without keeping credentials in the database."""
    value = os.getenv(f"MAILBOX_{key.upper()}_{field}")
    return value if value not in (None, "") else legacy


def _configured_mailboxes(store: MailStore) -> list[MailboxRuntime]:
    cfg = settings()
    try:
        accounts = store.request("GET", "mailbox_accounts?is_active=eq.true&select=id,user_id,mailbox_key,label,email_address") or []
    except Exception:
        accounts = []
    result: list[MailboxRuntime] = []
    for account in accounts:
        key = str(account["mailbox_key"])
        host = _mailbox_value(key, "HOST", cfg.mail_host if key == "zhiwu" else None)
        port_value = _mailbox_value(key, "PORT", cfg.mail_port if key == "zhiwu" else 993)
        username = _mailbox_value(key, "USERNAME", cfg.mail_username if key == "zhiwu" else None)
        password = _mailbox_value(key, "PASSWORD", cfg.mail_password if key == "zhiwu" else None)
        folder = str(_mailbox_value(key, "FOLDER", cfg.mail_folder if key == "zhiwu" else "INBOX"))
        result.append(MailboxRuntime(
            id=account["id"], owner_user_id=account["user_id"], key=key, label=account["label"],
            email_address=account.get("email_address"), host=str(host) if host else None,
            port=int(port_value or 993), username=str(username) if username else None,
            password=str(password) if password else None, folder=folder,
        ))
    # Backward compatibility keeps Zhiwu's already deployed single-mailbox sync
    # working before the database migration creates mailbox_accounts.
    if not result and all((cfg.mail_host, cfg.mail_username, cfg.mail_password, cfg.mail_owner_user_id)):
        result.append(MailboxRuntime(
            id=None, owner_user_id=cfg.mail_owner_user_id or "", key="zhiwu", label="Zhiwu 的邮件中心",
            email_address=cfg.mail_username, host=cfg.mail_host, port=cfg.mail_port, username=cfg.mail_username,
            password=cfg.mail_password, folder=cfg.mail_folder,
        ))
    return result


def _sync_mailbox(store: MailStore, mailbox_config: MailboxRuntime) -> dict[str, int]:
    required = (mailbox_config.host, mailbox_config.username, mailbox_config.password, mailbox_config.owner_user_id)
    if not all(required):
        store.update_sync(mailbox_config, "Not configured")
        logger.info("Mailbox %s is awaiting server-only IMAP credentials", mailbox_config.key)
        return {"processed": 0, "saved": 0, "linked": 0}
    store.update_sync(mailbox_config, "Running")
    try:
        customer_by_email, customer_by_contact, project_by_customer, contact_name_by_customer, last_contact_by_customer = _customer_lookup(store, mailbox_config.owner_user_id)
        recovered = _reconcile_existing_links(
            store, mailbox_config.owner_user_id, customer_by_email, customer_by_contact,
            project_by_customer, contact_name_by_customer, last_contact_by_customer,
        )
        activity_backfilled = _reconcile_linked_email_activity(store, mailbox_config.owner_user_id, last_contact_by_customer)

        with imaplib.IMAP4_SSL(mailbox_config.host, mailbox_config.port) as mailbox:
            mailbox.login(mailbox_config.username, mailbox_config.password)
            mailbox.select(mailbox_config.folder, readonly=True)
            result, data = mailbox.uid("search", None, "ALL")
            if result != "OK":
                raise RuntimeError("Unable to list IMAP messages")
            uids = data[0].split()[-settings().mail_sync_max_messages :]
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
                content = _text(message)
                # A colleague's address is never treated as a customer address.
                # For forwarded threads, use the actual customer evidence inside
                # the message only when it identifies one customer uniquely.
                customer_id = (
                    _resolve_internal_forward_customer(
                        message.get("To", ""), message.get("Subject", ""), content,
                        customer_by_email, customer_by_contact,
                    )
                    if is_internal_mail_address(sender)
                    else _resolve_customer(sender, sender_name, customer_by_email, customer_by_contact)
                )
                if not customer_id:
                    customer_id = _create_pending_customer_from_email(
                        store, mailbox_config.owner_user_id,
                        {"sender": sender, "sender_name": sender_name, "subject": message.get("Subject", ""), "content_text": content},
                        customer_by_email, customer_by_contact,
                    )
                project = project_by_customer.get(customer_id or "", {})
                message_id = message.get("Message-ID") or f"imap-{uid.decode(errors='ignore')}"
                payload = {
                    "user_id": mailbox_config.owner_user_id,
                    "mailbox_id": mailbox_config.id,
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
                if customer_id and created:
                    _record_linked_email_activity(store, mailbox_config.owner_user_id, created[0], customer_id, last_contact_by_customer)
                if customer_id:
                    _remember_mapping(store, mailbox_config.owner_user_id, sender, customer_id, contact_name_by_customer.get(customer_id))
                saved += len(created)
        store.update_sync(mailbox_config, "Success", saved)
        logger.info("Mailbox %s sync finished: processed=%s saved=%s linked=%s crm_history=%s", mailbox_config.key, len(uids), saved, recovered, activity_backfilled)
        return {"processed": len(uids), "saved": saved, "linked": recovered}
    except Exception as exc:
        logger.exception("Mailbox %s sync failed", mailbox_config.key)
        store.update_sync(mailbox_config, "Error", 0, str(exc)[:500])
        return {"processed": 0, "saved": 0, "linked": 0}


def sync_once() -> dict[str, int]:
    store = MailStore()
    mailboxes = _configured_mailboxes(store)
    if not mailboxes:
        logger.warning("IMAP sync is not configured; waiting for server-only MAILBOX_* variables")
        return {"processed": 0, "saved": 0, "linked": 0}
    totals = {"processed": 0, "saved": 0, "linked": 0}
    for mailbox_config in mailboxes:
        result = _sync_mailbox(store, mailbox_config)
        for key in totals:
            totals[key] += result[key]
    return totals


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
