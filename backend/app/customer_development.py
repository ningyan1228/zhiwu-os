"""Deterministic, review-first helpers for the customer-development workbench.

No browser automation, search scraping, e-mail delivery, or social messaging is
implemented here. The helpers only prepare manual research links, normalise
public-company inputs, score evidence that is already stored, and create drafts
that remain pending human approval.
"""
from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from urllib.parse import quote_plus, urlparse
from urllib.robotparser import RobotFileParser

import httpx


NL_FC_PU_CAMPAIGN = {
    "campaign_name": "Brazil｜NL-FC-PU｜控释肥包衣客户开发",
    "product_code": "NL-FC-PU",
    "product_name": "控释肥料专用包膜剂",
    "product_claim_text": "用于控释肥、包膜尿素和包膜 NPK 等肥料颗粒包膜工艺的液体包膜材料；具体适配、释放周期和试验条件须以双方技术确认与产品资料为准。",
    "product_claim_source": "用户提供：缓释肥料专用包膜剂产品介绍",
    "target_country": "Brazil",
    "target_company_types": ["coated fertilizer manufacturer", "controlled release urea producer", "specialty fertilizer blender", "urea importer/distributor"],
    "applications": ["polymer coated urea", "controlled release fertilizer", "coated NPK fertilizer", "fertilizer coating process"],
    "exclusion_terms": ["retail store", "farm shop", "association", "media", "news"],
    "daily_candidate_limit": 20,
}


def normalize_company_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def canonical_domain(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.hostname or "").casefold().strip(".")
    return host[4:] if host.startswith("www.") else host or None


def public_http_url(value: str | None) -> bool:
    parsed = urlparse(str(value or ""))
    host = (parsed.hostname or "").casefold()
    if not (parsed.scheme in {"http", "https"} and host):
        return False
    if host in {"localhost", "0.0.0.0", "::1"} or host.endswith(".local"):
        return False
    try:
        address = ipaddress.ip_address(host)
        return not (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved)
    except ValueError:
        return True


def html_text(raw: str) -> str:
    without_noise = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\\1>", " ", raw)
    return re.sub(r"\\s+", " ", re.sub(r"(?is)<[^>]+>", " ", without_noise)).strip()


def public_email(raw: str, domain: str | None) -> str | None:
    for item in re.findall(r"[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}", raw, re.I):
        email = item.casefold().strip(".,;:)")
        local, _, host = email.partition("@")
        if local in {"noreply", "no-reply", "privacy", "abuse"}:
            continue
        if domain and (host == domain or host.endswith(f".{domain}")):
            return email
        if local in {"sales", "export", "info", "contact", "business", "marketing"}:
            return email
    return None


async def robots_permit(client: httpx.AsyncClient, url: str, user_agent: str) -> tuple[bool, str]:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        response = await client.get(robots_url, headers={"User-Agent": user_agent})
    except httpx.HTTPError:
        return False, "robots.txt 无法读取，按合规规则不访问"
    if response.status_code in {401, 403}:
        return False, f"robots.txt 返回 {response.status_code}"
    if response.status_code >= 400:
        return True, "robots.txt 不存在，按默认允许访问"
    parser = RobotFileParser(); parser.parse(response.text.splitlines())
    return (True, "robots.txt 允许访问") if parser.can_fetch(user_agent, url) else (False, "robots.txt 禁止访问")


def nl_fc_pu_queries() -> list[tuple[str, str, str]]:
    """Search links are user-clicked research aids, never scraped by the app."""
    specs = [
        ('"controlled release urea" manufacturer Brazil', "web"),
        ('"coated fertilizer" producer Brazil', "web"),
        ('"fertilizer coating" company Brazil', "web"),
        ('"specialty fertilizer" blender Brazil', "web"),
        ('filetype:pdf "exhibitor list" fertilizer Brazil', "pdf_directory"),
        ('controlled release fertilizer manufacturer Brazil', "maps"),
    ]
    queries: list[tuple[str, str, str]] = []
    for text, kind in specs:
        target = "https://www.google.com/maps/search/" if kind == "maps" else "https://www.google.com/search?q="
        queries.append((text, kind, f"{target}{quote_plus(text)}"))
    return queries


def nl_fc_pu_application_terms() -> tuple[str, ...]:
    """Terms that can support an NL-FC-PU application fact on Brazil sites.

    Portuguese is intentionally included because the initial campaign is for
    Brazil. A hit creates evidence for human review; it is never a purchase
    intent or a reason to contact a company automatically.
    """
    return (
        "controlled release fertilizer", "controlled release urea",
        "coated fertilizer", "polymer coated urea", "fertilizer coating",
        "fertilizante de liberação controlada", "fertilizante revestido",
        "ureia revestida", "ureia protegida", "revestimento de fertilizante",
    )


@dataclass(frozen=True)
class DevelopmentScore:
    score: int
    reasons: list[str]


def score_lead(*, target_country: str, lead_country: str | None, evidence_roles: set[str], has_official_website: bool, has_public_contact: bool, duplicate: bool, rejected: bool) -> DevelopmentScore:
    """Evidence-only 35/25/15/15/10 ranking defined in the implementation plan."""
    if rejected:
        return DevelopmentScore(0, ["拒绝联系或屏蔽状态优先，未参与排序。"])
    score = 0
    reasons: list[str] = []
    if "应用或产品" in evidence_roles:
        score += 35; reasons.append("官网或来源文件有产品/应用证据 +35")
    if "客户身份" in evidence_roles:
        score += 25; reasons.append("有制造商、配方商或目标客户身份依据 +25")
    if lead_country and lead_country.casefold() == target_country.casefold():
        score += 15; reasons.append("国家与开发活动目标一致 +15")
    if has_official_website and has_public_contact:
        score += 15; reasons.append("有官网且有公开联系入口 +15")
    if "近期活动" in evidence_roles:
        score += 10; reasons.append("有近期相关活动证据 +10")
    if duplicate:
        reasons.append("疑似与现有 CRM 或同国家同名记录重复；保留人工确认，不自动合并。")
    return DevelopmentScore(score, reasons or ["尚无可计分证据。"])


def draft_email(*, company_name: str, company_fact: str, product_claim: str) -> tuple[str, str]:
    """Return a 80-130 word, non-sending review draft using supplied evidence only."""
    subject = f"Question about {company_name}'s controlled-release fertilizer program"
    body = (
        f"Dear [Name],\n\n"
        f"I noticed on your website that {company_fact.strip()}\n\n"
        f"We supply NL-FC-PU, {product_claim.strip()} "
        f"Because your team works in this area, may I ask which coated fertilizer products or coating process you are currently evaluating, and whether a technical trial is planned? "
        f"To make the discussion relevant, we would first need to understand your substrate, coating method and target nutrient-release profile. "
        f"If useful, I can share the relevant TDS and discuss a sample for evaluation.\n\n"
        f"Best regards,\n[Your name]"
    )
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'/-]*", body)
    if not 80 <= len(words) <= 130:
        raise ValueError("Draft must remain between 80 and 130 English words")
    return subject, body
