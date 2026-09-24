"""Manual ChatGPT Plus hand-off helpers for application-led lead discovery.

This module never calls OpenAI.  It creates a transparent prompt that the user
can paste into ChatGPT Plus and validates the JSON/CSV pasted back into Zhiwu
OS.  Imported companies are only unverified crawl seeds.
"""
from __future__ import annotations

import csv
import ipaddress
import io
import json
from typing import Any
from urllib.parse import urlparse

FORMAT_VERSION = "zhiwu-os-chatgpt-discovery/v1"
MAX_MANUAL_COMPANIES = 100


def _text(value: Any, limit: int = 3000) -> str:
    return str(value or "").strip()[:limit]


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
    if parsed.scheme not in {"http", "https"} or not host or host in {"localhost", "0.0.0.0", "::1"} or host.endswith(".local"):
        return False
    try:
        address = ipaddress.ip_address(host)
        return not (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved)
    except ValueError:
        return True


def _urls(value: Any) -> list[str]:
    if isinstance(value, list):
        raw = value
    else:
        text = str(value or "").strip()
        if text.startswith("["):
            try:
                decoded = json.loads(text)
                raw = decoded if isinstance(decoded, list) else [text]
            except json.JSONDecodeError:
                raw = text.replace("\n", "|").replace(";", "|").split("|")
        else:
            raw = text.replace("\n", "|").replace(";", "|").split("|")
    result: list[str] = []
    for item in raw:
        url = _text(item, 2000)
        if url and public_http_url(url) and url not in result:
            result.append(url)
    return result[:12]


def _score(value: Any) -> int:
    try:
        return max(0, min(100, int(float(str(value or 0)))))
    except (TypeError, ValueError):
        return 0


def parse_manual_plus_candidates(raw_text: str, *, expected_task_id: str) -> list[dict[str, Any]]:
    """Parse and strictly validate a ChatGPT Plus JSON or CSV response."""
    raw = str(raw_text or "").strip()
    if not raw:
        raise ValueError("请粘贴 ChatGPT 返回的 JSON 或 CSV。")
    if len(raw.encode("utf-8")) > 2 * 1024 * 1024:
        raise ValueError("粘贴内容不能超过 2 MB。")

    rows: list[dict[str, Any]]
    if raw.startswith(("{", "[")):
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"JSON 无法解析：第 {exc.lineno} 行第 {exc.colno} 列。") from exc
        if isinstance(decoded, dict):
            returned_task_id = _text(decoded.get("task_id"), 100)
            if returned_task_id and returned_task_id != expected_task_id:
                raise ValueError("返回结果属于另一个客户发现任务，已阻止混入当前产品。")
            rows = decoded.get("companies") or []
        else:
            rows = decoded
        if not isinstance(rows, list):
            raise ValueError("JSON 必须包含 companies 数组。")
    else:
        reader = csv.DictReader(io.StringIO(raw.lstrip("\ufeff")))
        if not reader.fieldnames:
            raise ValueError("CSV 缺少标题行。")
        rows = list(reader)

    if len(rows) > MAX_MANUAL_COMPANIES:
        raise ValueError(f"一次最多导入 {MAX_MANUAL_COMPANIES} 家候选公司。")

    companies: list[dict[str, Any]] = []
    seen_domains: set[str] = set()
    skipped = 0
    for row in rows:
        if not isinstance(row, dict):
            skipped += 1
            continue
        website = _text(row.get("official_website") or row.get("website") or row.get("website_url"), 2000)
        domain = canonical_domain(website)
        company_name = _text(row.get("company_name") or row.get("company"), 300)
        source_urls = _urls(row.get("source_urls") or row.get("source_url"))
        if website and public_http_url(website) and website not in source_urls:
            source_urls.insert(0, website)
        if not company_name or not domain or not public_http_url(website) or not source_urls or domain in seen_domains:
            skipped += 1
            continue
        seen_domains.add(domain)
        companies.append({
            "company_name": company_name,
            "official_website": website,
            "root_domain": domain,
            "country": _text(row.get("country"), 100) or None,
            "company_type": _text(row.get("company_type"), 300) or None,
            "suggested_lead_layer": _text(row.get("lead_layer"), 80) or "待判定",
            "suggested_score": _score(row.get("match_score")),
            "matching_reason": _text(row.get("matching_reason"), 2000),
            "product_evidence": _text(row.get("product_evidence"), 2000),
            "source_urls": source_urls,
            "public_email": _text(row.get("public_email") or row.get("email"), 320) or None,
            "public_phone": _text(row.get("public_phone") or row.get("phone"), 100) or None,
            "contact_department": _text(row.get("contact_department"), 300) or None,
            "pending_confirmation": _text(row.get("pending_confirmation"), 1500),
        })
    if not companies:
        suffix = f"（另有 {skipped} 行因缺少公司名、公开官网或来源链接被跳过）" if skipped else ""
        raise ValueError(f"没有可导入的候选公司。每行必须有 company_name、official_website 和 source_urls。{suffix}")
    return companies


def build_manual_plus_prompt(task: dict[str, Any], queries: list[dict[str, Any]], leads: list[dict[str, Any]]) -> str:
    """Build a self-contained, review-first prompt for the user's Plus chat."""
    applications = []
    for item in task.get("application_snapshot") or []:
        applications.append({
            "application_name": item.get("application_name"),
            "description": item.get("description"),
            "substrate_or_object": item.get("substrate_or_object"),
            "material_function": item.get("material_function"),
            "tds_evidence": item.get("evidence_excerpt"),
            "target_company_types": item.get("target_company_types") or [],
            "official_business_evidence_required": item.get("official_business_evidence"),
            "exclusion_notes": item.get("exclusion_notes"),
            "search_terms": item.get("search_terms") or [],
            "local_search_terms": item.get("local_search_terms") or [],
        })
    current_candidates = [{
        "company_name": lead.get("company_name"),
        "official_website": lead.get("official_website") or lead.get("official_homepage_url") or lead.get("website"),
        "country": lead.get("country"),
        "current_layer": lead.get("lead_layer"),
        "current_evidence": lead.get("product_evidence_summary") or lead.get("verification_conclusion"),
        "source_urls": lead.get("source_urls") or [],
    } for lead in leads[:100]]
    context = {
        "task_id": task.get("id"),
        "task_name": task.get("task_name"),
        "target_region": task.get("target_region") or "全球",
        "candidate_limit": min(int(task.get("candidate_limit") or 20), MAX_MANUAL_COMPANIES),
        "confirmed_applications": applications,
        "prepared_search_terms": [row.get("query_text") for row in queries if row.get("query_text")],
        "existing_candidates_to_avoid": current_candidates,
    }
    schema = {
        "format_version": FORMAT_VERSION,
        "task_id": task.get("id"),
        "companies": [{
            "company_name": "公司法定或官网名称",
            "official_website": "https://公司官网",
            "country": "国家",
            "company_type": "下游制造商/加工商的具体类型",
            "lead_layer": "直接需求候选|间接应用链|排除|待判定",
            "match_score": 0,
            "matching_reason": "为什么该企业可能实际使用该应用材料",
            "product_evidence": "官网公开页面上的产品、工艺或业务证据摘要",
            "source_urls": ["https://官网证据页"],
            "public_email": "官网公开业务邮箱或空字符串",
            "public_phone": "官网公开业务电话或空字符串",
            "contact_department": "采购/技术/R&D/销售或空字符串",
            "pending_confirmation": "仍需由爬虫或人工确认的事项",
        }],
    }
    return f"""你正在协助 Zhiwu OS 做应用导向的 B2B 客户发现。请根据下方任务，实际研究候选企业；不要只给搜索词或搜索链接。

目标流程：TDS 已确认应用 → 搜索可能实际使用该材料的公司 → 核实公司官网与具体业务 → 找官网公开的联系人/部门/邮箱/电话 → 输出候选清单。

硬性规则：
1. 只找需求端或实际下游应用企业。排除原料供应商、同类包衣剂供应商、贸易商、协会、媒体、目录页和搜索结果页；除非官网能证明该企业自己生产相应下游制品。
2. 每家公司必须有可访问的公司官网 official_website，source_urls 至少包含一个该公司官网上的业务/产品证据页。不要把目录页当官网。
3. 不得编造公司、业务证据或联系方式。只填写官网公开的业务联系方式；个人邮箱、私人号码和登录后数据不得采集。
4. 匹配只是候选，不代表企业已经采购、批准或使用本产品。无法确认时写入 pending_confirmation。
5. 不要根据内部牌号搜索。公司名称和域名去重，并避开 existing_candidates_to_avoid。
6. 最多输出 {context['candidate_limit']} 家。优先证据充分的企业。
7. 最终只返回一个合法 JSON 对象，不要 Markdown、解释或代码围栏。格式必须与 OUTPUT_SCHEMA 一致，task_id 不得修改。

TASK_CONTEXT:
{json.dumps(context, ensure_ascii=False, indent=2)}

OUTPUT_SCHEMA:
{json.dumps(schema, ensure_ascii=False, indent=2)}
"""
