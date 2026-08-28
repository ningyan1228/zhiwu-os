"""Compliant public-web lead discovery.

Only public pages are requested, one at a time.  Restricted platforms, pages
disallowed by robots.txt, private network targets, logins and paywalls are never
attempted.  Results are always saved as reviewable leads, never as CRM customers.
"""
from __future__ import annotations

import asyncio
import html
import ipaddress
import json
import re
import socket
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx

from .main import settings

RESTRICTED_HOSTS = {
    "linkedin.com", "facebook.com", "instagram.com", "whatsapp.com", "web.whatsapp.com",
    "mail.google.com", "outlook.live.com", "outlook.office.com", "mail.qq.com", "qiye.aliyun.com",
    # Search indexes are allowed for discovery only; their consumer/video/account
    # destinations are not business-company lead pages and must not be retained.
    "youtube.com", "youtu.be", "google.com", "play.google.com", "accounts.google.com",
    "wikipedia.org", "tiktok.com", "x.com", "twitter.com", "pinterest.com",
}
GENERIC_EMAIL_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "163.com", "qq.com"}
NON_EMAIL_FILE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".css", ".js", ".woff", ".pdf")
EMAIL_RE = re.compile(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", re.I)
PHONE_RE = re.compile(r"(?:\+?\d[\d\s().\-]{7,}\d)")
CONTACT_DEPARTMENTS = ("export sales", "sales", "purchasing", "procurement", "technical support", "r&d", "research and development", "product development", "packaging development", "quality", "regulatory")
IDENTITY_WORDS = ("manufacturer", "manufacturing", "factory", "producer", "brand owner", "converter", "processor", "formulator", "our company")
EXCLUDED_IDENTITY_WORDS = ("association", "exhibition", "trade show", "directory", "yellow pages", "media", "news", "training", "consulting", "distributor", "distribution", "trading company", "trader")
OFFICIAL_PAGE_HINTS = ("contact", "about", "company", "factory", "manufactur", "product", "application", "sustainab", "technology", "technical", "download", "tds", "sds")

# These are public association/member directories, not gated social or mailbox
# platforms.  They are only used as crawler entry points; each page and every
# linked company website still gets its own robots.txt check before fetching.
CURATED_PUBLIC_SEEDS = (
    {
        "url": "https://ifca.net.in/members.php",
        "countries": {"india"},
        "signals": {"packaging", "film", "barrier", "ppc", "pha", "cpp", "cpo", "pvdc", "coating"},
        "label": "印度软包装协会公开会员目录",
    },
    {
        "url": "https://ifibca.org/members/",
        "countries": {"india"},
        "signals": {"packaging", "film", "barrier", "ppc", "pha", "cpp", "cpo", "pvdc", "coating"},
        "label": "印度包装协会公开会员目录",
    },
    {
        "url": "https://nvc.nl/_members.php?entrant=2&order=city&ordermode=DESC",
        "countries": {"netherlands", "europe"},
        "signals": {"packaging", "film", "barrier", "ppc", "pha", "cpp", "cpo", "pvdc", "coating"},
        "label": "荷兰包装中心公开会员目录",
    },
    {
        "url": "https://scmap.org/members/memberlist/",
        "countries": {"philippines"},
        "signals": {"packaging", "film", "barrier", "ppc", "pha", "cpp", "cpo", "pvdc", "coating"},
        "label": "菲律宾制造商协会公开会员目录",
    },
)


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().strip(".")


def _blocked_host(host: str) -> bool:
    return any(host == blocked or host.endswith(f".{blocked}") for blocked in RESTRICTED_HOSTS)


def _is_public_url(url: str) -> tuple[bool, str]:
    parsed = urlparse(url)
    host = _host(url)
    if parsed.scheme not in {"http", "https"} or not host:
        return False, "不是公开 HTTP/HTTPS 网页"
    if _blocked_host(host):
        return False, "受限平台不在采集范围内"
    if host in {"localhost", "0.0.0.0", "::1"} or host.endswith(".local"):
        return False, "本地或私有网络地址不允许访问"
    try:
        if ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback:
            return False, "私有网络地址不允许访问"
    except ValueError:
        pass
    return True, ""


def _normalise_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript|svg).*?>.*?</\1>", " ", raw)
    raw = re.sub(r"(?is)<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def _meta(raw: str, key: str) -> str:
    pattern = rf"<meta[^>]+(?:property|name)=[\"']{re.escape(key)}[\"'][^>]+content=[\"']([^\"']+)"
    matched = re.search(pattern, raw, re.I)
    return html.unescape(matched.group(1)).strip() if matched else ""


def _page_title(raw: str) -> str:
    found = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    return re.sub(r"\s+", " ", html.unescape(found.group(1))).strip() if found else ""


def _company_name(raw: str, host: str) -> str:
    candidate = _meta(raw, "og:site_name") or _page_title(raw)
    candidate = re.split(r"\s+[|–—-]\s+", candidate, maxsplit=1)[0].strip()
    if not candidate or len(candidate) > 180:
        candidate = host.split(".")[0].replace("-", " ").title()
    return candidate[:200]


def _public_business_email(raw: str, host: str) -> str | None:
    for email in EMAIL_RE.findall(raw):
        value = email.lower().strip(".,;:)")
        local, _, domain = value.partition("@")
        if domain.endswith(NON_EMAIL_FILE_SUFFIXES):
            continue
        if local in {"noreply", "no-reply", "privacy", "abuse", "example", "placeholder"} or any(token in local for token in ("logo", "image", "asset", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".css", ".js")):
            continue
        if domain == host or domain.endswith(f".{host}") or local in {"info", "sales", "contact", "export", "marketing", "business", "bd", "enquiry", "inquiry"}:
            return value
        if domain not in GENERIC_EMAIL_DOMAINS and not domain.endswith((".gov", ".edu")):
            return value
    return None


def _public_phone(raw: str) -> str | None:
    for item in PHONE_RE.findall(raw):
        value = re.sub(r"\s+", " ", item).strip()
        # Dates, SVG coordinates and numeric identifiers often match a generic
        # telephone regex.  A strict record only accepts a recognisable public
        # business number with country/area formatting.
        if re.fullmatch(r"\d{4}[-/.]\d{1,2}[-/.]\d{1,2}", value) or "." in value:
            continue
        if not (value.startswith("+") or value.startswith("00") or "(" in value or "-" in value or " " in value):
            continue
        digits = re.sub(r"\D", "", value)
        if 8 <= len(digits) <= 18:
            return value
    return None


def _contact_department(text: str) -> str | None:
    lowered = text.casefold()
    for department in CONTACT_DEPARTMENTS:
        if department in lowered:
            return department.upper() if department == "r&d" else department.title()
    return None


def _company_type(text: str) -> tuple[str | None, str | None]:
    """Return an allowed business type or an explicit exclusion reason."""
    lowered = text.casefold()
    # A real manufacturer may mention distributors, trade shows or news pages.
    # Direct manufacturing evidence must take priority over those incidental words.
    if any(word in lowered for word in ("manufacturer", "manufacturing", "factory", "producer")):
        return "生产制造商", None
    if any(word in lowered for word in ("formulator", "formulation")):
        return "配方商", None
    if any(word in lowered for word in ("brand owner", "our brands", "consumer products")):
        return "品牌方/终端使用企业", None
    if any(word in lowered for word in ("converter", "processing", "processor")):
        return "加工厂/转换商", None
    if any(word in lowered for word in EXCLUDED_IDENTITY_WORDS):
        return None, "官网内容显示为协会、目录、媒体、贸易/分销或其他非目标企业"
    return None, "官网未确认生产商、配方商、加工厂、品牌方或终端使用企业身份"


def _official_subpage_urls(raw: str, base_url: str, limit: int = 6) -> list[str]:
    """Only follow likely evidence pages on the same official host."""
    host = _host(base_url)
    urls: list[str] = []
    for href in re.findall(r'''(?is)<a[^>]+href=["']([^"'#]+)''', raw):
        link = urljoin(base_url, html.unescape(href).strip())
        allowed, _ = _is_public_url(link)
        parsed = urlparse(link)
        if not allowed or _host(link) != host or link in urls:
            continue
        if any(hint in (parsed.path + "?" + parsed.query).casefold() for hint in OFFICIAL_PAGE_HINTS):
            urls.append(link)
        if len(urls) >= limit:
            break
    return urls


def _address_excerpt(text: str) -> str | None:
    found = re.search(r"(?is)(?:address|registered office|head office)\s*[:\-]?\s*([^.|]{18,260})", text)
    return re.sub(r"\s+", " ", found.group(1)).strip(" ,;:")[:300] if found else None


def _contains_terms(text: str, terms: list[str]) -> list[str]:
    lowered = text.casefold()
    return [term for term in terms if term and term.casefold() in lowered]


def _country_match(text: str, countries: list[str]) -> list[str]:
    lowered = text.casefold()
    matches: list[str] = []
    europe_terms = ("europe", "netherlands", "germany", "france", "italy", "spain", "belgium", "poland", "uk")
    for country in countries:
        if country.casefold() == "europe":
            if any(term in lowered for term in europe_terms): matches.append(country)
        elif country.casefold() in lowered:
            matches.append(country)
    return matches


async def _robots_allowed(client: httpx.AsyncClient, url: str, user_agent: str) -> tuple[bool, str]:
    parsed = urlparse(url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        response = await client.get(robots_url, headers={"User-Agent": user_agent}, follow_redirects=True)
    except httpx.HTTPError as exc:
        return False, f"无法读取 robots.txt：{exc.__class__.__name__}"
    if response.status_code in {401, 403}:
        return False, f"robots.txt 返回 {response.status_code}，跳过"
    if response.status_code == 404:
        return True, "robots.txt 不存在，按公开网页处理"
    if response.status_code >= 400:
        return False, f"robots.txt 返回 {response.status_code}，跳过"
    parser = RobotFileParser()
    parser.parse(response.text.splitlines())
    return (True, "robots.txt 允许") if parser.can_fetch(user_agent, url) else (False, "robots.txt 禁止访问")


async def _brave_search(client: httpx.AsyncClient, query: str, api_key: str, user_agent: str, limit: int) -> list[str]:
    """Use the provider's documented server-side API; no consumer-result scraping."""
    response = await client.get(
        "https://api.search.brave.com/res/v1/web/search",
        params={"q": query, "count": min(limit, 20), "safesearch": "moderate"},
        headers={"Accept": "application/json", "User-Agent": user_agent, "X-Subscription-Token": api_key},
    )
    if response.status_code >= 400:
        raise RuntimeError(f"官方搜索服务返回 {response.status_code}")
    links: list[str] = []
    for item in (response.json().get("web", {}).get("results", []) or []):
        link = str(item.get("url") or "").strip()
        allowed, _ = _is_public_url(link)
        if allowed and link not in links:
            links.append(link)
    return links


def _directory_links(raw: str, base_url: str, limit: int) -> list[str]:
    """Read public directory/exhibitor links from a supplied public page only."""
    links: list[str] = []
    for href in re.findall(r'''(?is)<a[^>]+href=["']([^"'#]+)''', raw):
        link = urljoin(base_url, html.unescape(href).strip())
        allowed, _ = _is_public_url(link)
        if allowed and link not in links and _host(link) != _host(base_url):
            links.append(link)
        if len(links) >= limit:
            break
    return links


class RestStore:
    """Small REST adapter usable with a signed-in user token or service role."""
    def __init__(self, token: str, service: bool = False):
        cfg = settings()
        self.base = cfg.supabase_url.rstrip("/")
        key = cfg.supabase_service_role_key if service else cfg.supabase_anon_key
        self.headers = {"apikey": key, "Authorization": token, "Content-Type": "application/json", "Prefer": "return=representation"}

    async def request(self, path: str, method: str = "GET", payload: Any = None) -> Any:
        # A slow public server should not hold the user's review queue hostage.
        # Eight seconds remains generous for normal company pages while keeping a
        # bounded manual run within a few minutes at the configured low rate.
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=5.0)) as client:
            response = await client.request(method, f"{self.base}/rest/v1/{path}", headers=self.headers, json=payload)
        if response.status_code >= 400:
            raise RuntimeError(f"Supabase {response.status_code}: {response.text[:300]}")
        return response.json() if response.content else None


async def _duplicates(store: RestStore, task: dict[str, Any], company: str, domain: str, email: str | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    customers = await store.request("customers?select=id,company_name,email,website&archived_at=is.null&import_reverted=eq.false&limit=500")
    suppliers = await store.request("suppliers?select=id,company_name,main_email,website&archived_at=is.null&import_reverted=eq.false&limit=500")
    def domain_of(value: str | None) -> str: return _host(value or "")
    company_key = company.casefold().strip()
    customer = next((row for row in customers if (email and (row.get("email") or "").casefold() == email.casefold()) or (domain and domain_of(row.get("website")) == domain) or (row.get("company_name") or "").casefold().strip() == company_key), None)
    supplier = next((row for row in suppliers if (email and (row.get("main_email") or "").casefold() == email.casefold()) or (domain and domain_of(row.get("website")) == domain) or (row.get("company_name") or "").casefold().strip() == company_key), None)
    return customer, supplier


def _score(task: dict[str, Any], text: str, website: str, email: str | None, company: str, duplicate: bool) -> tuple[int, list[str], list[str], list[str], str]:
    products = _contains_terms(text, task.get("product_keywords") or [])
    applications = _contains_terms(text, task.get("application_keywords") or [])
    countries = _country_match(text, task.get("target_countries") or [])
    score, reasons = 0, []
    if products: score += 30; reasons.append(f"命中目标产品关键词：{', '.join(products[:3])} (+30)")
    if applications: score += 25; reasons.append(f"命中目标应用关键词：{', '.join(applications[:3])} (+25)")
    if countries: score += 15; reasons.append(f"命中目标国家/地区：{', '.join(countries[:2])} (+15)")
    if website: score += 10; reasons.append("有独立官网 (+10)")
    if email or "contact" in text.casefold(): score += 10; reasons.append("有公开商务联系方式或联系页 (+10)")
    if any(word in text.casefold() for word in ("manufacturer", "manufacturing", "factory", "producer", "brand")):
        score += 10; reasons.append("页面显示为生产商或品牌方 (+10)")
    if duplicate: reasons.append("疑似已存在于 CRM 或供应商中心；仅供核验，不计入新线索")
    need = "可能与目标产品/应用相关，需人工查看官网确认采购或技术需求。"
    if products or applications:
        need = f"页面出现 {', '.join((products + applications)[:4])}；可能需要相关材料或技术方案，需人工确认。"
    return min(score, 100), reasons, products, applications, need


def _looks_like_company_page(text: str, email: str | None) -> bool:
    """Avoid treating videos, logins, articles and generic platforms as companies."""
    lowered = text.casefold()
    if email:
        return True
    business_signals = (
        "manufacturer", "manufacturing", "factory", "producer", "our company",
        "about us", "contact us", "get in touch", "packaging", "coating",
    )
    return any(signal in lowered for signal in business_signals)


def _curated_seed_urls(task: dict[str, Any]) -> list[tuple[str, str]]:
    """Select a small, relevant public-directory seed set for this task."""
    focus = " ".join(
        [task.get("task_name") or "", *(task.get("product_keywords") or []), *(task.get("application_keywords") or [])]
    ).casefold()
    countries = {str(value).casefold() for value in (task.get("target_countries") or [])}
    selected: list[tuple[str, str]] = []
    for seed in CURATED_PUBLIC_SEEDS:
        matches_focus = any(signal in focus for signal in seed["signals"])
        matches_country = not countries or bool(countries.intersection(seed["countries"]))
        if matches_focus and matches_country:
            selected.append((seed["url"], seed["label"]))
    return selected


async def run_task_once(store: RestStore, task: dict[str, Any], trigger: str = "manual") -> dict[str, Any]:
    """Sequential, bounded discovery run. Public index -> robots -> one public page."""
    cfg = settings()
    user_agent = getattr(cfg, "lead_discovery_user_agent", "ZhiwuOSLeadDiscovery/1.0 (+https://work.101921.xyz)")
    delay = max(float(getattr(cfg, "lead_discovery_delay_seconds", 1.0)), 0.5)
    run_rows = await store.request("lead_discovery_runs", "POST", {"user_id": task["user_id"], "task_id": task["id"], "trigger_type": trigger, "status": "运行中"})
    run = run_rows[0]
    log: list[str] = []
    inserted = skipped = discovered = 0
    try:
        product_terms = (task.get("product_keywords") or [task["task_name"]])[:3]
        app_terms = (task.get("application_keywords") or [""])[:2]
        countries = (task.get("target_countries") or [""])[:2]
        queries = []
        for index, product in enumerate(product_terms):
            app_term = app_terms[index % len(app_terms)]
            country = countries[index % len(countries)]
            queries.append(" ".join(part for part in (product, app_term, country) if part))
        limit = int(task.get("max_results") or 15)
        candidates: list[tuple[str, str]] = []
        source_urls = [(str(value).strip(), "自定义公开目录") for value in (task.get("source_urls") or []) if str(value).strip()]
        source_urls.extend((url, label) for url, label in _curated_seed_urls(task) if url not in [item[0] for item in source_urls])
        official_key = str(getattr(cfg, "brave_search_api_key", "") or "").strip()
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            if official_key:
                for query in queries:
                    try:
                        for candidate in await _brave_search(client, query, official_key, user_agent, limit):
                            if candidate not in [url for url, _ in candidates]:
                                candidates.append((candidate, "公开搜索结果"))
                            if len(candidates) >= limit:
                                break
                    except Exception as exc:
                        log.append(f"官方搜索“{query}”失败：{exc}")
                    if len(candidates) >= limit:
                        break
                    await asyncio.sleep(delay)
            elif not source_urls:
                log.append("未找到与该任务关键词/国家匹配的公开目录入口；为避免抓取不可靠的搜索页面，本次未发起搜索。")

            # User-supplied public exhibitor, association or business-directory
            # pages are a useful key-free source. We first inspect the directory
            # page itself, then only follow public outbound company links.
            for directory_url, directory_label in source_urls[:5]:
                allowed, reason = _is_public_url(directory_url)
                if not allowed:
                    skipped += 1; log.append(f"跳过目录 {directory_url}：{reason}"); continue
                robots_ok, robots_reason = await _robots_allowed(client, directory_url, user_agent)
                if not robots_ok:
                    skipped += 1; log.append(f"跳过目录 {directory_url}：{robots_reason}"); continue
                try:
                    response = await client.get(directory_url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"}, follow_redirects=True)
                    final_directory_url = str(response.url)
                    if response.status_code >= 400 or "html" not in response.headers.get("content-type", "").lower():
                        skipped += 1; log.append(f"跳过目录 {directory_url}：网页不可用或不是 HTML"); continue
                    for candidate in _directory_links(response.text[:1_000_000], final_directory_url, limit):
                        if candidate not in [url for url, _ in candidates]:
                            candidates.append((candidate, "行业目录"))
                        if len(candidates) >= limit:
                            break
                    log.append(f"读取公开目录：{directory_label}（{directory_url}）")
                except httpx.HTTPError as exc:
                    skipped += 1; log.append(f"跳过目录 {directory_url}：读取失败 {exc.__class__.__name__}")
                if len(candidates) >= limit:
                    break
                await asyncio.sleep(delay)

            for source_url, source_type in candidates[:limit]:
                allowed, reason = _is_public_url(source_url)
                if not allowed:
                    skipped += 1; log.append(f"跳过 {source_url}：{reason}"); continue
                robots_ok, robots_reason = await _robots_allowed(client, source_url, user_agent)
                if not robots_ok:
                    skipped += 1; log.append(f"跳过 {source_url}：{robots_reason}"); continue
                await asyncio.sleep(delay)
                try:
                    response = await client.get(source_url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"}, follow_redirects=True)
                    final_url = str(response.url)
                    final_allowed, final_reason = _is_public_url(final_url)
                    if response.status_code >= 400 or not final_allowed:
                        skipped += 1; log.append(f"跳过 {source_url}：{final_reason or f'网页返回 {response.status_code}'}"); continue
                    content_type = response.headers.get("content-type", "")
                    if "html" not in content_type.lower():
                        skipped += 1; log.append(f"跳过 {source_url}：不是 HTML 页面"); continue
                    raw = response.text[:1_000_000]
                except httpx.HTTPError as exc:
                    skipped += 1; log.append(f"跳过 {source_url}：读取失败 {exc.__class__.__name__}"); continue
                text = _normalise_text(raw)
                if len(text) < 80:
                    skipped += 1; log.append(f"跳过 {source_url}：公开页面内容不足"); continue
                host = _host(final_url)
                # A directory only discovers a name.  Strict verification then
                # visits same-domain About / Contact / Product evidence pages.
                pages: list[tuple[str, str, str]] = [(final_url, raw, text)]
                for subpage_url in _official_subpage_urls(raw, final_url):
                    robots_ok, _ = await _robots_allowed(client, subpage_url, user_agent)
                    if not robots_ok:
                        continue
                    try:
                        sub_response = await client.get(subpage_url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"}, follow_redirects=True)
                        if sub_response.status_code < 400 and "html" in sub_response.headers.get("content-type", "").lower() and _host(str(sub_response.url)) == host:
                            sub_raw = sub_response.text[:1_000_000]
                            pages.append((str(sub_response.url), sub_raw, _normalise_text(sub_raw)))
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(delay)

                combined_text = " ".join(page[2] for page in pages)
                company = _company_name(raw, host)
                company_type, identity_problem = _company_type(combined_text)
                email = phone = department = None
                email_source = phone_source = contact_source = evidence_url = None
                evidence_text = ""
                product_hits: list[str] = []
                application_hits: list[str] = []
                for page_url, page_raw, page_text in pages:
                    page_email = _public_business_email(page_raw, host)
                    page_phone = _public_phone(page_raw)
                    page_department = _contact_department(page_text)
                    if page_email and not email:
                        email, email_source = page_email, page_url
                    if page_phone and not phone:
                        phone, phone_source = page_phone, page_url
                    if page_department and not department:
                        department, contact_source = page_department, page_url
                    found_products = _contains_terms(page_text, task.get("product_keywords") or [])
                    found_applications = _contains_terms(page_text, task.get("application_keywords") or [])
                    if (found_products or found_applications) and not evidence_url:
                        product_hits, application_hits = found_products, found_applications
                        evidence_url, evidence_text = page_url, page_text
                if not contact_source and (email_source or phone_source):
                    contact_source = email_source or phone_source
                customer_dup, supplier_dup = await _duplicates(store, task, company, host, email)
                duplicate = bool(customer_dup or supplier_dup)
                score, reasons, _, _, need = _score(task, combined_text, f"{urlparse(final_url).scheme}://{host}", email, company, duplicate)
                missing: list[str] = []
                if identity_problem: missing.append(identity_problem)
                # Email and a switchboard alone do not pass the strict rule.
                # Until a named contact extractor is available, an explicit
                # business department is mandatory for the strict list.
                if not department: missing.append("缺公开联系人姓名或可联系业务部门")
                if not email: missing.append("缺公开业务邮箱")
                if not phone: missing.append("缺官方公开电话")
                if not evidence_url: missing.append("无产品或应用直接证据")
                if duplicate: missing.append("疑似与 CRM 或供应商中心重复")
                excluded = bool(identity_problem and any(word in identity_problem for word in ("协会", "目录", "媒体", "贸易/分销")))
                bucket = "排除名单" if excluded else ("严格客户名单" if not missing else "待补信息")
                matching_grade = "A" if product_hits else ("B" if application_hits else None)
                if bucket == "严格客户名单" and not matching_grade:
                    bucket, matching_grade = "待补信息", None
                    missing.append("无产品或应用直接证据")
                evidence_summary = ""
                if evidence_url:
                    terms = product_hits or application_hits
                    evidence_summary = f"官方页面出现：{', '.join(terms[:5])}。"
                    need = f"官方资料显示 {', '.join(terms[:5])}；需首轮确认具体材料、工艺与规格。"
                if excluded:
                    reasons.append("不属于可开发企业主体，已进入排除名单")
                elif missing:
                    reasons.append("未满足全部严格核验门槛，进入待补信息")
                else:
                    reasons.append("官网、业务身份、联系人/部门、邮箱、电话及产品/应用证据均已核验")
                if not _looks_like_company_page(combined_text, email):
                    skipped += 1; log.append(f"跳过 {source_url}：不是可确认的企业官网"); continue
                payload = {
                    "user_id": task["user_id"], "task_id": task["id"], "company_name": company, "website": f"{urlparse(final_url).scheme}://{host}", "website_domain": host,
                    "source_url": final_url, "source_type": source_type, "public_business_email": email, "public_business_phone": phone,
                    "discovered_product_keywords": product_hits, "discovered_application_keywords": application_hits, "possible_need": need,
                    "match_score": score, "score_reasons": reasons, "suspected_duplicate": duplicate,
                    "duplicate_customer_id": customer_dup.get("id") if customer_dup else None,
                    "duplicate_supplier_id": supplier_dup.get("id") if supplier_dup else None,
                    "robots_status": "allowed", "robots_reason": robots_reason,
                    "verification_bucket": bucket, "company_type": company_type, "official_homepage_url": f"{urlparse(final_url).scheme}://{host}", "company_source_url": final_url,
                    "contact_department": department, "contact_source_url": contact_source, "email_source_url": email_source, "phone_source_url": phone_source,
                    "email_domain_note": None if not email or _host(f"https://{email.split('@', 1)[1]}") == host else "邮箱域名与官网不同；需人工确认是否为集团统一或官方技术邮箱。",
                    "official_address": _address_excerpt(combined_text), "business_scope": company_type or "未公开，需通过首轮询盘确认",
                    "product_evidence_summary": evidence_summary or None, "product_evidence_url": evidence_url, "product_evidence_type": "官方产品/应用页面" if evidence_url else None,
                    "matching_grade": matching_grade, "recommended_contact_department": department or "Sales / Technical Support（待确认）",
                    "first_contact_questions": "请确认贵司相关产品/应用、现用材料、技术指标与采购对接部门。",
                    "verification_conclusion": "已通过严格客户核验。" if bucket == "严格客户名单" else (identity_problem if excluded else "真实企业线索，但尚未满足全部严格客户门槛。"),
                    "missing_requirements": missing, "verified_at": datetime.now(timezone.utc).isoformat(),
                }
                known = await store.request(f"customer_leads?user_id=eq.{task['user_id']}&select=id,source_url,website_domain,company_name,public_business_email&limit=500")
                company_key = re.sub(r"[^a-z0-9]", "", company.casefold())
                existing = [row for row in known if row.get("source_url") == final_url or row.get("website_domain") == host or (company_key and re.sub(r"[^a-z0-9]", "", str(row.get("company_name") or "").casefold()) == company_key) or (email and str(row.get("public_business_email") or "").casefold() == email.casefold())]
                if existing:
                    await store.request(f"customer_leads?id=eq.{existing[0]['id']}", "PATCH", payload)
                    log.append(f"更新已发现线索：{company}")
                else:
                    await store.request("customer_leads", "POST", payload)
                    inserted += 1; log.append(f"加入待审核：{company}")
                discovered += 1
                await asyncio.sleep(delay)
        result_status = "成功" if discovered else "跳过"
        await store.request(f"lead_discovery_runs?id=eq.{run['id']}", "PATCH", {"status": result_status, "finished_at": datetime.now(timezone.utc).isoformat(), "discovered_count": discovered, "inserted_count": inserted, "skipped_count": skipped, "run_log": log[:100]})
        await store.request(f"lead_search_tasks?id=eq.{task['id']}", "PATCH", {"last_run_at": datetime.now(timezone.utc).isoformat(), "last_run_status": result_status, "last_error": None})
        return {"run_id": run["id"], "status": result_status, "discovered_count": discovered, "inserted_count": inserted, "skipped_count": skipped, "log": log}
    except Exception as exc:
        message = str(exc)[:1000]
        await store.request(f"lead_discovery_runs?id=eq.{run['id']}", "PATCH", {"status": "失败", "finished_at": datetime.now(timezone.utc).isoformat(), "discovered_count": discovered, "inserted_count": inserted, "skipped_count": skipped, "error_message": message, "run_log": log[:100]})
        await store.request(f"lead_search_tasks?id=eq.{task['id']}", "PATCH", {"last_run_at": datetime.now(timezone.utc).isoformat(), "last_run_status": "失败", "last_error": message})
        raise


async def run_daily_loop() -> None:
    """Server-side timer. It only runs tasks explicitly enabled by their owner."""
    cfg = settings()
    token = f"Bearer {cfg.supabase_service_role_key}"
    store = RestStore(token, service=True)
    while True:
        now = datetime.now().astimezone()
        try:
            tasks = await store.request("lead_search_tasks?daily_enabled=eq.true&status=eq.%E5%90%AF%E7%94%A8&select=*&limit=100")
            today = now.date().isoformat()
            for task in tasks:
                scheduled = str(task.get("daily_run_time") or "08:30")[:5]
                already = await store.request(f"lead_discovery_runs?task_id=eq.{task['id']}&trigger_type=eq.daily&started_at=gte.{today}T00:00:00Z&select=id&limit=1")
                if not already and now.strftime("%H:%M") >= scheduled:
                    try: await run_task_once(store, task, "daily")
                    except Exception: pass
        except Exception:
            pass
        await asyncio.sleep(60)


if __name__ == "__main__":
    asyncio.run(run_daily_loop())
