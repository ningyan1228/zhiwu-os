"""Thin API gateway: browser credentials are verified with Supabase before data is proxied."""
import asyncio
from datetime import date, datetime, timedelta
import csv
from functools import lru_cache
from io import BytesIO
import hashlib
import json
import re
from typing import Any, Literal
from urllib.parse import quote, urlparse

import httpx
from openpyxl import Workbook
from openpyxl.styles import Font
from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from .strict_lead_import import import_cpph_strict_records
from .customer_development import NL_FC_PU_CAMPAIGN, canonical_domain, draft_email, html_text, nl_fc_pu_application_terms, nl_fc_pu_queries, normalize_company_name, public_email, public_http_url, robots_permit, score_lead
from .tds_discovery import application_search_terms, content_sha256, extract_explicit_applications, parse_tds_upload

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    allowed_origins: str = "http://localhost:5173"
    public_app_url: str = "https://ningyan1228.github.io/zhiwu-os/"
    mail_host: str | None = None
    mail_port: int = 993
    mail_username: str | None = None
    mail_password: str | None = None
    mail_folder: str = "INBOX"
    mail_owner_user_id: str | None = None
    mail_internal_addresses: str = ""
    mail_internal_domains: str = ""
    mail_sync_interval_seconds: int = 600
    mail_sync_max_messages: int = 100
    lead_discovery_user_agent: str = "ZhiwuOSLeadDiscovery/1.0 (+https://work.101921.xyz)"
    lead_discovery_delay_seconds: float = 1.0
    # Optional official search provider token. It is read only on the server and
    # must never be returned by an API endpoint or committed to the repository.
    brave_search_api_key: str | None = None
    # Optional OpenAI-compatible lead analysis.  It is strictly server-only;
    # the crawler retains its rules-only path when any setting is absent.
    ai_enabled: bool = False
    ai_base_url: str | None = None
    ai_api_key: str | None = None
    ai_model: str | None = None
    # SiliconFlow is the optional, server-side only provider for reviewed mail
    # summaries.  The browser never receives this key.
    siliconflow_api_key: str | None = None
    siliconflow_base_url: str = "https://api.siliconflow.cn/v1"
    siliconflow_model: str = "deepseek-ai/DeepSeek-V4-Flash"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache
def settings() -> Settings: return Settings()

app = FastAPI(title="Zhiwu OS API", version="0.1.0")
# Guards the short interval before a background discovery task writes its run
# row.  The database check below remains the cross-request source of truth.
ACTIVE_LEAD_TASKS: set[str] = set()
ACTIVE_APPLICATION_TASKS: set[str] = set()
LEAD_RUN_STALE_AFTER = timedelta(hours=6)
app.add_middleware(CORSMiddleware, allow_origins=settings().allowed_origins.split(","), allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class CustomerIn(BaseModel):
    company_name: str
    country: str
    contact_person: str
    email: str
    whatsapp: str | None = None
    product_interest: str | None = None
    customer_stage: str = "New"
    priority: str = "MEDIUM"
    application: str | None = None
    status_label: str | None = None
    status_tone: str | None = None
    next_followup_date: str | None = None
    notes: str | None = None
    website: str | None = None
    wechat: str | None = None
    industry: str | None = None
    customer_summary: str | None = None
    customer_background: str | None = None
    customer_need: str | None = None
    important_notes: str | None = None
    customer_value: int | None = Field(default=None, ge=1, le=5)
    customer_tags: list[str] | None = None
    next_action: list[str] | None = None

class LoginIn(BaseModel):
    email: str
    password: str

class PasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=128)

class RecoveryIn(BaseModel):
    email: str

class ProductIn(BaseModel):
    product_name: str
    product_code: str
    category: str | None = None
    application: str | None = None
    description: str | None = None
    notes: str | None = None
    technical_keywords: list[str] = []
    confirmed_applications: list[str] = []
    target_industries: list[str] = []
    target_company_types: list[str] = []
    exclusion_rules: list[str] = []
    evidence_urls: list[str] = []
    profile_status: Literal["草稿", "已确认"] = "草稿"

class FollowupIn(BaseModel):
    customer_id: str
    date: str
    content: str
    next_action: str | None = None
    status: str = "Open"

CommitmentStatus = Literal["已确认", "我方待办", "等待客户", "待核对", "已兑现"]
CommitmentParty = Literal["客户承诺", "我方承诺", "双方约定"]
CommitmentEvidenceType = Literal["微信手动记录", "邮件", "项目记录", "运单/物流", "付款凭证", "其他"]

class TradeCommitmentIn(BaseModel):
    customer_id: str
    project_id: str | None = None
    product_id: str | None = None
    title: str = Field(min_length=1, max_length=300)
    category: str = Field(default="其他", min_length=1, max_length=80)
    responsible_party: CommitmentParty
    status: CommitmentStatus = "待核对"
    due_date: str | None = None
    evidence_type: CommitmentEvidenceType = "其他"
    evidence_reference: str | None = Field(default=None, max_length=500)
    evidence_note: str = Field(min_length=1, max_length=4000)
    detail: str | None = Field(default=None, max_length=4000)
    next_action: str | None = Field(default=None, max_length=1000)
    create_task: bool = False

class TradeCommitmentUpdateIn(BaseModel):
    project_id: str | None = None
    product_id: str | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    category: str | None = Field(default=None, min_length=1, max_length=80)
    responsible_party: CommitmentParty | None = None
    status: CommitmentStatus | None = None
    due_date: str | None = None
    evidence_type: CommitmentEvidenceType | None = None
    evidence_reference: str | None = Field(default=None, max_length=500)
    evidence_note: str | None = Field(default=None, min_length=1, max_length=4000)
    detail: str | None = Field(default=None, max_length=4000)
    next_action: str | None = Field(default=None, max_length=1000)

class ProjectIn(BaseModel):
    customer_id: str
    project_name: str
    product_id: str | None = None
    application: str | None = None
    stage: str = "New Inquiry"
    notes: str | None = None

class ProjectUpdateIn(BaseModel):
    project_name: str
    product_id: str | None = None
    application: str | None = None
    stage: str = "New Inquiry"
    notes: str | None = None

class ProductCustomerRelationIn(BaseModel):
    customer_id: str

class QuoteIn(BaseModel):
    customer_id: str
    project_id: str | None = None
    product_id: str | None = None
    product_code: str | None = None
    product_name_snapshot: str | None = None
    specification: str | None = None
    packaging: str | None = None
    quantity: str = "待确认"
    quantity_unit: str | None = None
    unit_price: float | None = None
    amount: float | None = None
    currency: str = "USD"
    trade_term: str | None = None
    incoterm: str | None = None
    loading_port: str | None = None
    destination_port: str | None = None
    lead_time: str | None = None
    moq: str | None = None
    valid_until: str | None = None
    payment_terms: str | None = None
    status: str = "草稿"
    source_email_id: str | None = None
    source_evidence_summary: str | None = None
    manual_send_confirmed: bool = False
    manual_send_note: str | None = None
    internal_supplier_quote_refs: list[str] = []
    internal_technical_document_refs: list[str] = []
    internal_notes: str | None = None

class QuoteUpdateIn(BaseModel):
    project_id: str | None = None
    product_id: str | None = None
    product_code: str | None = None
    product_name_snapshot: str | None = None
    specification: str | None = None
    packaging: str | None = None
    quantity: str | None = None
    quantity_unit: str | None = None
    unit_price: float | None = None
    amount: float | None = None
    currency: str | None = None
    trade_term: str | None = None
    incoterm: str | None = None
    loading_port: str | None = None
    destination_port: str | None = None
    lead_time: str | None = None
    moq: str | None = None
    valid_until: str | None = None
    payment_terms: str | None = None
    status: str | None = None
    source_email_id: str | None = None
    source_evidence_summary: str | None = None
    manual_send_confirmed: bool = False
    manual_send_note: str | None = None
    internal_supplier_quote_refs: list[str] | None = None
    internal_technical_document_refs: list[str] | None = None
    internal_notes: str | None = None

SupplierStatus = Literal["待联系", "已询价", "等 TDS", "等报价", "等样品", "技术评估", "已合作", "暂停", "淘汰"]

class SupplierIn(BaseModel):
    company_name: str = Field(min_length=1, max_length=300)
    english_name: str | None = None
    country: str = "China"
    province: str | None = None
    city: str | None = None
    address: str | None = None
    website: str | None = None
    supplier_type: Literal["工厂", "贸易商", "待确认"] = "待确认"
    export_status: Literal["可出口", "不可出口", "待确认"] = "待确认"
    main_phone: str | None = None
    main_email: str | None = None
    wechat: str | None = None
    product_keywords: list[str] = []
    product_categories: list[str] = []
    supplier_tags: list[str] = []
    current_status: SupplierStatus = "待联系"
    last_contact_date: str | None = None
    next_action: str | None = None
    next_followup_date: str | None = None
    notes: str | None = None
    risk_notes: str | None = None

class SupplierUpdateIn(SupplierIn):
    pass

class SupplierContactIn(BaseModel):
    supplier_id: str
    name: str = Field(min_length=1, max_length=200)
    title: str | None = None
    mobile: str | None = None
    phone: str | None = None
    email: str | None = None
    wechat: str | None = None
    whatsapp: str | None = None
    responsible_products: str | None = None
    is_primary: bool = False
    notes: str | None = None

class SupplierProductIn(BaseModel):
    supplier_id: str
    product_name: str = Field(min_length=1, max_length=300)
    internal_keywords: list[str] = []
    nl_product_id: str | None = None
    nl_status: Literal["无 / 待确认", "已确认关联"] = "无 / 待确认"
    reference_model: str | None = None
    application: str | None = None
    technical_summary: str | None = None
    customizable: Literal["是", "否", "待确认"] = "待确认"
    sample_available: Literal["是", "否", "待确认"] = "待确认"
    capacity: str | None = None
    moq: str | None = None
    standard_lead_time: str | None = None
    packaging: str | None = None
    export_capacity: str = "待确认"
    notes: str | None = None

class SupplierFollowupIn(BaseModel):
    supplier_id: str
    supplier_project_link_id: str | None = None
    rfq_id: str | None = None
    date: str
    channel: Literal["邮件", "微信", "电话", "会议", "报价", "样品", "技术确认", "其他"] = "微信"
    content: str = Field(min_length=1, max_length=5000)
    conclusion: str | None = None
    next_action: str | None = None
    next_followup_date: str | None = None
    owner_name: str | None = None
    status: SupplierStatus = "待联系"
    create_task: bool = True

class SupplierProjectLinkIn(BaseModel):
    customer_id: str
    project_id: str
    supplier_id: str
    supplier_product_id: str | None = None
    customer_need: str | None = None
    reference_product: str | None = None
    match_status: Literal["待询价", "等资料", "技术评估", "已推荐", "已送样", "测试中", "已成交", "未匹配"] = "待询价"
    technical_match_notes: str | None = None
    quote_status: str | None = None
    sample_status: str | None = None
    current_risk: str | None = None
    next_action: str | None = None
    next_followup_date: str | None = None

class SupplierRfqIn(BaseModel):
    customer_id: str
    project_id: str
    supplier_id: str
    supplier_product_id: str | None = None
    demand_product: str = Field(min_length=1, max_length=300)
    reference_product: str | None = None
    end_application: str | None = None
    technical_requirements: str | None = None
    sample_quantity: str | None = None
    expected_monthly_usage: str | None = None
    expected_annual_usage: str | None = None
    destination_country: str | None = None
    requested_materials: list[str] | None = None
    status: Literal["草稿", "已发送", "供应商已回复", "技术评估", "关闭"] = "草稿"
    sent_date: str | None = None
    next_followup_date: str | None = None
    reply_content: str | None = None

class EmailStatusIn(BaseModel):
    status: Literal["unread", "new_lead", "linked", "followup_created", "completed"]

class EmailFollowupIn(BaseModel):
    content: str | None = Field(default=None, max_length=5000)
    next_action: str | None = Field(default=None, max_length=1000)

class EmailLinkIn(BaseModel):
    customer_id: str
    contact_name: str | None = Field(default=None, max_length=200)

class EmailCustomerCreateIn(CustomerIn):
    """Create a current-user customer from one reviewed mailbox message."""
    pass

class EmailCrmUpdateIn(BaseModel):
    customer_id: str
    project_id: str | None = None
    product_id: str | None = None
    customer_stage: str
    next_action: str = Field(min_length=1, max_length=1000)
    followup_date: str
    notes: str = Field(min_length=1, max_length=5000)
    create_task: bool = False
    task_date: str | None = None

class MailAiFactCardStatusIn(BaseModel):
    status: Literal["待审核", "已忽略"]
    review_note: str | None = Field(default=None, max_length=2000)

class MailReplyDraftIn(BaseModel):
    """A Chinese instruction for an English draft. The server never sends mail."""
    purpose: str | None = Field(default=None, max_length=1200)

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    category: Literal["外贸", "网站", "设计", "学习", "生活", "其他"] = "外贸"
    priority: Literal["important", "normal", "low"] = "normal"
    status: Literal["Pending", "Completed"] = "Pending"
    task_date: str
    start_time: str | None = None
    end_time: str | None = None
    estimated_minutes: int | None = Field(default=None, ge=5, le=1440)
    customer_id: str | None = None
    project_id: str | None = None
    product_id: str | None = None
    lead_id: str | None = None

class LeadSearchTaskIn(BaseModel):
    task_name: str = Field(min_length=1, max_length=200)
    discovery_mode: Literal["需求客户", "供应工厂"] = "需求客户"
    # The default deliberately needs no commercial search account.  Search API
    # discovery remains opt-in for users that later choose to configure one.
    discovery_strategy: Literal["public_seed_crawl", "search_plus_crawl"] = "public_seed_crawl"
    product_id: str | None = None
    product_keywords: list[str] = []
    application_keywords: list[str] = []
    target_countries: list[str] = []
    excluded_countries: list[str] = []
    target_company_types: list[str] = []
    profile_exclusion_rules: list[str] = []
    source_urls: list[str] = []
    search_language: str = "English"
    # Per-run candidate target. The worker paginates the official index and
    # verifies company pages slowly, one at a time.
    max_results: int = Field(default=50, ge=1, le=1000)
    daily_enabled: bool = False
    daily_run_time: str = "08:30"
    status: Literal["启用", "暂停"] = "启用"

class LeadReviewIn(BaseModel):
    status: Literal["待审核", "保留", "已排除", "已联系"]
    exclusion_reason: str | None = None
    notes: str | None = None
    watchlisted: bool | None = None

class LeadDevelopmentTaskIn(BaseModel):
    priority: Literal["important", "normal", "low"] = "normal"
    task_date: str
    suggested_next_action: str | None = None

class LeadConvertIn(BaseModel):
    email: str | None = None
    contact_person: str | None = None
    country: str | None = None
    product_interest: str | None = None
    application: str | None = None
    priority: Literal["HIGH", "MEDIUM HIGH", "MEDIUM"] = "MEDIUM"
    next_action: str | None = None
    next_followup_date: str | None = None
    notes: str | None = None
    customer_id: str | None = None

class DevelopmentCampaignIn(BaseModel):
    campaign_name: str = Field(min_length=1, max_length=200)
    product_code: str = Field(min_length=1, max_length=100)
    product_name: str = Field(min_length=1, max_length=300)
    product_claim_text: str = Field(min_length=1, max_length=2000)
    product_claim_source: str = Field(min_length=1, max_length=500)
    target_country: str = Field(min_length=1, max_length=100)
    target_company_types: list[str] = []
    applications: list[str] = []
    exclusion_terms: list[str] = []
    daily_candidate_limit: int = Field(default=20, ge=1, le=100)
    status: Literal["草稿", "启用", "暂停", "已关闭"] = "启用"

class DevelopmentLeadStatusIn(BaseModel):
    development_status: Literal["发现", "待核实", "合格", "不匹配", "已联系", "已回复", "拒绝联系"]
    note: str | None = Field(default=None, max_length=2000)

class OutreachDraftApprovalIn(BaseModel):
    approval_state: Literal["已审核", "已拒绝"]
    approval_note: str | None = Field(default=None, max_length=1000)

class TdsApplicationIn(BaseModel):
    application_name: str = Field(min_length=1, max_length=180)
    description: str | None = Field(default=None, max_length=2000)
    substrate_or_object: str | None = Field(default=None, max_length=1000)
    material_function: str | None = Field(default=None, max_length=1000)
    process_conditions: str | None = Field(default=None, max_length=3000)
    limitations: str | None = Field(default=None, max_length=3000)
    evidence_excerpt: str | None = Field(default=None, max_length=2000)
    evidence_page: int | None = Field(default=None, ge=1)
    evidence_status: Literal["TDS明确", "推测待确认", "用户补充"] = "用户补充"
    target_company_types: list[str] = []
    official_business_evidence: str | None = Field(default=None, max_length=2000)
    exclusion_notes: str | None = Field(default=None, max_length=2000)
    search_terms: list[str] = []
    local_search_terms: list[str] = []
    selected: bool = False
    enabled: bool = True
    revision_note: str | None = Field(default=None, max_length=1000)

class ApplicationDiscoveryTaskIn(BaseModel):
    tds_document_id: str
    application_ids: list[str] = Field(min_length=1, max_length=20)
    target_region: str | None = Field(default=None, max_length=100)
    task_name: str | None = Field(default=None, max_length=240)
    candidate_limit: int = Field(default=20, ge=1, le=500)
    search_budget: int = Field(default=0, ge=0, le=10000)

class ProductKeywordIn(BaseModel):
    product_id: str
    keyword: str = Field(min_length=1, max_length=300)
    keyword_type: Literal["include", "exclude", "local"] = "include"
    language_code: str = Field(default="en", min_length=2, max_length=16)
    country: str | None = Field(default=None, max_length=100)
    weight: int = Field(default=5, ge=1, le=20)
    enabled: bool = True

class CrawlSourceIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    source_type: Literal["官网", "展会目录", "协会目录", "行业目录", "政府或商会目录", "用户导入", "合规搜索 API"]
    start_url: str | None = Field(default=None, max_length=2000)
    country: str | None = Field(default=None, max_length=100)
    industry: str | None = Field(default=None, max_length=200)
    enabled: bool = True
    request_delay_seconds: float = Field(default=3, ge=1, le=30)
    max_pages: int = Field(default=8, ge=1, le=50)

class DomainBlockIn(BaseModel):
    root_domain: str = Field(min_length=3, max_length=253)
    reason: str = Field(default="人工屏蔽", min_length=1, max_length=500)
    enabled: bool = True

class LeadBatchReviewIn(BaseModel):
    lead_ids: list[str] = Field(min_length=1, max_length=100)
    status: Literal["待审核", "保留", "已排除", "已联系"]
    exclusion_reason: str | None = Field(default=None, max_length=1000)

class LeadBatchConvertIn(BaseModel):
    lead_ids: list[str] = Field(min_length=1, max_length=100)
    priority: Literal["HIGH", "MEDIUM HIGH", "MEDIUM"] = "MEDIUM"
    next_action: str | None = Field(default=None, max_length=1000)

class TaskStatusIn(BaseModel):
    status: Literal["Pending", "Completed"]

class DailyLogIn(BaseModel):
    summary: str | None = Field(default=None, max_length=5000)
    problem: str | None = Field(default=None, max_length=5000)
    tomorrow_plan: str | None = Field(default=None, max_length=5000)
    rating: int | None = Field(default=None, ge=1, le=5)

class ImportPreviewIn(BaseModel):
    payload: dict[str, Any]

class ImportApplyIn(BaseModel):
    confirm_company_match: bool = False
    selected_customer_id: str | None = None

async def supabase(path: str, token: str, method: str = "GET", payload: dict[str, Any] | None = None) -> Any:
    cfg = settings()
    headers = {"apikey": cfg.supabase_anon_key, "Authorization": token, "Content-Type": "application/json", "Prefer": "return=representation"}
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.request(method, f"{cfg.supabase_url}/rest/v1/{path}", headers=headers, json=payload)
    if response.status_code >= 400: raise HTTPException(response.status_code, response.text)
    return response.json() if response.content else None

def bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Supabase user token")
    return authorization

def _mail_text_for_ai(email: dict[str, Any]) -> str:
    """Bound the request; the original message remains in the mailbox."""
    return str(email.get("content_text") or email.get("content_preview") or "").strip()[:24000]

def _extract_json_object(value: str) -> dict[str, Any]:
    cleaned = value.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\\s*|\\s*```$", "", cleaned, flags=re.I)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise HTTPException(502, "AI 返回格式异常，请重试或改用原邮件人工核对。") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(502, "AI 返回不是可审核的事实卡。")
    return parsed

async def generate_siliconflow_mail_facts(email: dict[str, Any]) -> dict[str, Any]:
    """Generate review-only facts. This helper never writes CRM data."""
    cfg = settings()
    if not cfg.siliconflow_api_key:
        raise HTTPException(503, "AI 尚未配置。请由管理员在服务器 backend/.env 填写 SILICONFLOW_API_KEY 后重启后端。")
    source_text = _mail_text_for_ai(email)
    if not source_text:
        raise HTTPException(422, "这封邮件没有可供 AI 分析的正文。")
    direction = "我方已发或内部归档邮件" if is_internal_mail_address(email.get("sender")) else "客户来信"
    system = "你是外贸邮件事实审阅助手。将邮件翻译和归纳为简体中文 JSON。严格只提取原文明确表达的信息；每一条事实、承诺、时限、风险均须附简短原文 evidence。不得猜测客户身份、产品匹配、价格接受、已付款、已到账、技术可行、样品签收、发货、客户确认或邮件送达。不明确则写空数组、null 或未确认。suggested_crm_update 只供人工审核，不能把推测写成事实。若为我方邮件，只能说明我方表达/安排，不得当作客户确认。"
    instruction = "输出一个 JSON 对象，必须含有：source_language、chinese_summary、customer_stated_facts、sender_commitments、topics、product_mentions、application_mentions、deadlines、risks、suggested_crm_update、confidence、needs_human_review。事实/承诺/时限/风险数组项使用中文字段并至少包含 evidence 原文短句。suggested_crm_update 需要 stage、next_action、followup_date、reason；无依据则 null。"
    user = "邮件方向：" + direction + "\\n发件人：" + str(email.get("sender") or "未知") + "\\n收件人：" + str(email.get("receiver") or "未知") + "\\n主题：" + str(email.get("subject") or "(无主题)") + "\\n时间：" + str(email.get("received_at") or "未知") + "\\n\\n邮件正文：\\n" + source_text + "\\n\\n" + instruction
    payload = {
        "model": cfg.siliconflow_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.1,
        "max_tokens": 2400,
        "enable_thinking": False,
        "response_format": {"type": "json_object"},
    }
    endpoint = f"{cfg.siliconflow_base_url.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=75) as client:
            response = await client.post(endpoint, headers={"Authorization": f"Bearer {cfg.siliconflow_api_key}", "Content-Type": "application/json"}, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "连接硅基流动失败，请稍后重试。") from exc
    if response.status_code >= 400:
        raise HTTPException(502, f"硅基流动分析失败（{response.status_code}）：{response.text[:500]}")
    content = (((response.json().get("choices") or [{}])[0].get("message") or {}).get("content") or "")
    facts = _extract_json_object(content)
    facts["needs_human_review"] = True
    return facts

async def generate_siliconflow_reply_draft(email: dict[str, Any], purpose: str | None) -> dict[str, Any]:
    """Generate a review-only bilingual reply. It deliberately has no send side effect."""
    cfg = settings()
    if not cfg.siliconflow_api_key:
        raise HTTPException(503, "AI 尚未配置。请由管理员在服务器 backend/.env 填写 SILICONFLOW_API_KEY 后重启后端。")
    source_text = _mail_text_for_ai(email)
    if not source_text:
        raise HTTPException(422, "这封邮件没有可供 AI 起草回复的正文。")
    system = "你是谨慎的外贸邮件助手。根据一封真实邮件生成供人工审核的英文回复草稿，并提供中文回复意图和中文回译。不得编造价格、付款已到账、库存、交期、发货、运单、技术可行性、客户确认或任何未在邮件中明确的信息。信息不全时，应在英文草稿中礼貌地提出确认问题。不要承诺任何事项；输出内容不能直接视为已发送邮件。"
    instruction = "输出一个 JSON 对象，字段必须为：reply_intent_zh（简体中文）、english_draft（可直接复制的英文邮件）、chinese_back_translation（对应中文回译）、assumptions（字符串数组）、needs_human_review（true）。英文邮件应有合适称呼和落款占位符 [Your name]，语气专业、简洁。"
    user = "用户希望：" + (purpose.strip() if purpose and purpose.strip() else "根据这封邮件准备下一步的礼貌英文回复") + "\n\n发件人：" + str(email.get("sender") or "未知") + "\n主题：" + str(email.get("subject") or "(无主题)") + "\n邮件正文：\n" + source_text + "\n\n" + instruction
    payload = {
        "model": cfg.siliconflow_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0.2,
        "max_tokens": 1800,
        "enable_thinking": False,
        "response_format": {"type": "json_object"},
    }
    endpoint = f"{cfg.siliconflow_base_url.rstrip('/')}/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=75) as client:
            response = await client.post(endpoint, headers={"Authorization": f"Bearer {cfg.siliconflow_api_key}", "Content-Type": "application/json"}, json=payload)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "连接硅基流动失败，请稍后重试。") from exc
    if response.status_code >= 400:
        raise HTTPException(502, f"硅基流动起草失败（{response.status_code}）：{response.text[:500]}")
    draft = _extract_json_object((((response.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""))
    return {
        "reply_intent_zh": str(draft.get("reply_intent_zh") or "请人工核对回复意图。"),
        "english_draft": str(draft.get("english_draft") or ""),
        "chinese_back_translation": str(draft.get("chinese_back_translation") or ""),
        "assumptions": draft.get("assumptions") if isinstance(draft.get("assumptions"), list) else [],
        "needs_human_review": True,
        "provider": "siliconflow",
        "model": cfg.siliconflow_model,
    }

def is_internal_mail_address(address: str | None) -> bool:
    """Keep colleague-forwarded mail out of customer auto-matching."""
    value = (address or "").strip().lower()
    internal_addresses = {item.strip().lower() for item in settings().mail_internal_addresses.split(",") if item.strip()}
    internal_domains = {item.strip().lower() for item in settings().mail_internal_domains.split(",") if item.strip()}
    return value in internal_addresses or ("@" in value and value.rsplit("@", 1)[1] in internal_domains)

def is_system_notification_email(email: dict[str, Any]) -> bool:
    sender_name = str(email.get("sender_name") or "").strip().lower()
    subject = str(email.get("subject") or "").strip().lower()
    return "阿里邮箱" in sender_name and ("系统通知" in subject or "密码提醒" in subject)

def _domain_from_url(value: str | None) -> str:
    return (urlparse(value or "").hostname or "").lower().removeprefix("www.")

def import_text(value: Any) -> str:
    return str(value or "").strip()

def import_key(value: Any) -> str:
    return import_text(value).casefold()

def import_nonempty(data: dict[str, Any]) -> dict[str, Any]:
    """Do not let blank fields from a ChatGPT summary erase CRM fields."""
    return {key: value for key, value in data.items() if value not in (None, "", [], {})}

def import_date(value: Any, field: str, *, required: bool = False) -> str | None:
    text = import_text(value)
    if not text:
        if required:
            raise HTTPException(422, f"{field} is required")
        return None
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError as exc:
        raise HTTPException(422, f"{field} must use YYYY-MM-DD") from exc

async def add_import_effect(
    token: str, batch_id: str, *, entity_type: str, action: str, record_id: str,
    before_data: dict[str, Any] | None, after_data: dict[str, Any] | None,
) -> None:
    await supabase("import_effects", token, "POST", {
        "import_batch_id": batch_id, "entity_type": entity_type, "action": action,
        "record_id": record_id, "before_data": before_data, "after_data": after_data,
    })

async def build_import_preview(token: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Validate a chat JSON packet and calculate its effects without writing CRM data."""
    if payload.get("schema_version") != "zhiwu-os-import/v1":
        raise HTTPException(422, "schema_version must be zhiwu-os-import/v1")
    if payload.get("intent") in {"upsert_supplier", "upsert_supplier_and_followup", "create_supplier_rfq", "link_supplier_to_customer_project"}:
        return await build_supplier_import_preview(token, payload)
    if payload.get("intent") != "upsert_customer_and_followup":
        raise HTTPException(422, "intent must be upsert_customer_and_followup")
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    import_date(source.get("date"), "source.date", required=True)
    customer = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
    match = payload.get("match") if isinstance(payload.get("match"), dict) else {}
    company_name = import_text(customer.get("company_name") or match.get("company_name"))
    email = import_text(customer.get("email") or match.get("customer_email")).lower()
    if not company_name and not email:
        raise HTTPException(422, "customer.company_name or customer.email is required")
    product_refs = payload.get("product_refs") if isinstance(payload.get("product_refs"), list) else []
    for index, product in enumerate(product_refs):
        if not isinstance(product, dict) or not import_text(product.get("code")).upper().startswith("NL-"):
            raise HTTPException(422, f"product_refs[{index}].code must start with NL-")

    customers = await supabase("customers?select=*&import_reverted=eq.false&archived_at=is.null&limit=500", token)
    products = await supabase("products?select=*&import_reverted=eq.false&archived_at=is.null&limit=500", token)
    email_matches = [row for row in customers if email and import_key(row.get("email")) == email]
    company_matches = [row for row in customers if company_name and import_key(row.get("company_name")) == import_key(company_name)]
    internal = is_internal_mail_address(email)
    candidates = [{"id": row["id"], "company_name": row.get("company_name"), "email": row.get("email")} for row in company_matches]
    if internal:
        customer_match = {"kind": "internal_forwarder", "customer_id": None, "candidates": candidates, "requires_confirmation": True, "message": "内部同事邮箱不能自动创建或自动匹配客户；请人工选择真实客户。"}
    elif email_matches:
        customer_match = {"kind": "email_exact", "customer_id": email_matches[0]["id"], "candidates": [], "requires_confirmation": False, "message": "按邮箱精确匹配到现有客户。"}
    elif len(company_matches) == 1:
        customer_match = {"kind": "company_manual_review", "customer_id": company_matches[0]["id"], "candidates": candidates, "requires_confirmation": True, "message": "按公司名称找到可能的现有客户，必须人工确认后才会更新。"}
    elif len(company_matches) > 1:
        customer_match = {"kind": "company_ambiguous", "customer_id": None, "candidates": candidates, "requires_confirmation": True, "message": "存在多个同名客户，请人工选择。"}
    else:
        customer_match = {"kind": "new_customer", "customer_id": None, "candidates": [], "requires_confirmation": True, "message": "未匹配到现有客户；确认后将新建客户。"}

    product_actions: list[dict[str, Any]] = []
    for product in product_refs:
        code = import_text(product.get("code")).upper()
        existing = next((row for row in products if import_key(row.get("product_code")) == import_key(code)), None)
        product_actions.append({"entity": "产品", "action": "更新" if existing else "新增", "label": f"{code} · {import_text(product.get('name')) or code}", "record_id": existing.get("id") if existing else None})

    actions = [{"entity": "客户", "action": "更新" if customer_match["kind"] in ("email_exact", "company_manual_review") else "新增", "label": company_name or email}]
    actions.extend(product_actions)
    project = payload.get("project") if isinstance(payload.get("project"), dict) else {}
    if import_text(project.get("name")):
        project_action = "待确认"
        if customer_match.get("customer_id"):
            project_rows = await supabase(f"projects?customer_id=eq.{customer_match['customer_id']}&import_reverted=eq.false&archived_at=is.null&select=id,project_name", token)
            existing_project = next((row for row in project_rows if import_key(row.get("project_name")) == import_key(project.get("name"))), None)
            project_action = "更新" if existing_project else "新增"
        actions.append({"entity": "项目", "action": project_action, "label": import_text(project.get("name"))})
    followup = payload.get("follow_up") if isinstance(payload.get("follow_up"), dict) else {}
    if import_text(followup.get("content")):
        actions.append({"entity": "跟进", "action": "新增", "label": import_text(followup.get("content"))[:100]})
    task = payload.get("task") if isinstance(payload.get("task"), dict) else {}
    if task.get("create") is True:
        actions.append({"entity": "每日任务", "action": "新增", "label": import_text(task.get("title")) or "待补充任务标题"})
    return {
        "customer_match": customer_match, "actions": actions,
        "requires_human_confirmation": bool(customer_match["requires_confirmation"] or (payload.get("review") or {}).get("requires_human_confirmation")),
        "uncertain_fields": (payload.get("review") or {}).get("uncertain_fields") or [],
    }

async def build_supplier_import_preview(token: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Review a supplier packet without treating a domestic contact as a CRM customer."""
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    import_date(source.get("date"), "source.date", required=True)
    supplier = payload.get("supplier") if isinstance(payload.get("supplier"), dict) else {}
    company_name = import_text(supplier.get("company_name") or (payload.get("match") or {}).get("company_name"))
    if not company_name:
        raise HTTPException(422, "supplier.company_name is required")
    contact = payload.get("contact") if isinstance(payload.get("contact"), dict) else {}
    email = import_key(supplier.get("main_email") or contact.get("email"))
    phone = import_key(supplier.get("main_phone") or contact.get("phone") or contact.get("mobile"))
    rows = await supabase("suppliers?select=*&archived_at=is.null&import_reverted=eq.false&limit=500", token)
    named = [row for row in rows if import_key(row.get("company_name")) == import_key(company_name)]
    exact = next((row for row in named if (email and import_key(row.get("main_email")) == email) or (phone and import_key(row.get("main_phone")) == phone)), None)
    candidates = [{"id": row["id"], "company_name": row.get("company_name"), "email": row.get("main_email")} for row in named]
    if exact:
        supplier_match = {"kind": "email_exact", "customer_id": exact["id"], "candidates": [], "requires_confirmation": False, "message": "按供应商公司名称和电话或邮箱匹配到现有档案。"}
    elif len(named) == 1:
        supplier_match = {"kind": "company_manual_review", "customer_id": named[0]["id"], "candidates": candidates, "requires_confirmation": True, "message": "按供应商公司名称找到可能档案；必须人工确认后才会更新。"}
    elif len(named) > 1:
        supplier_match = {"kind": "company_ambiguous", "customer_id": None, "candidates": candidates, "requires_confirmation": True, "message": "存在多个同名供应商，请先人工核对联系方式。"}
    else:
        supplier_match = {"kind": "new_supplier", "customer_id": None, "candidates": [], "requires_confirmation": True, "message": "未匹配到现有供应商；确认后将新增“待确认”供应商档案。"}
    intent = import_text(payload.get("intent"))
    actions = [{"entity": "供应商", "action": "更新" if supplier_match["kind"] in {"email_exact", "company_manual_review"} else "新增", "label": company_name}]
    if isinstance(payload.get("supplier_product"), dict):
        actions.append({"entity": "供应商产品", "action": "新增", "label": import_text(payload["supplier_product"].get("product_name")) or "待确认产品能力"})
    if intent == "upsert_supplier_and_followup" and isinstance(payload.get("follow_up"), dict):
        actions.append({"entity": "供应商跟进", "action": "新增", "label": import_text(payload["follow_up"].get("content"))[:100] or "供应商跟进"})
    if intent == "link_supplier_to_customer_project":
        actions.append({"entity": "供应链协同", "action": "新增", "label": import_text((payload.get("link") or {}).get("project_name")) or "关联客户项目"})
    if intent == "create_supplier_rfq":
        actions.append({"entity": "供应商 RFQ", "action": "新增", "label": import_text((payload.get("rfq") or {}).get("demand_product")) or "待确认询价需求"})
    uncertain = list((payload.get("review") or {}).get("uncertain_fields") or [])
    if import_text(supplier.get("supplier_type")) not in {"工厂", "贸易商"}: uncertain.append("supplier_type 未经确认，写入时将保持“待确认”。")
    if import_text(supplier.get("export_status")) not in {"可出口", "不可出口"}: uncertain.append("出口能力没有正式资料，写入时将保持“待确认”。")
    return {"supplier_match": supplier_match, "actions": actions, "requires_human_confirmation": True, "uncertain_fields": uncertain}

async def record_timeline_event(
    token: str, *, title: str, event_type: Literal["task", "email", "crm", "project", "note"],
    source: str, related_id: str | None = None, customer_id: str | None = None,
    project_id: str | None = None, product_id: str | None = None,
    supplier_id: str | None = None, supplier_rfq_id: str | None = None,
    event_date: str | None = None, event_time: str | None = None,
) -> None:
    """A failed optional timeline write must not block an existing CRM/mail action."""
    try:
        await supabase("timeline_events", token, "POST", {
            "title": title, "event_type": event_type, "source": source, "related_id": related_id,
            "customer_id": customer_id, "project_id": project_id, "product_id": product_id,
            "supplier_id": supplier_id, "supplier_rfq_id": supplier_rfq_id,
            "event_date": event_date or str(date.today()),
            "event_time": event_time or datetime.now().strftime("%H:%M:%S"),
        })
    except HTTPException:
        pass

DEMO_PRODUCTS = [
    {"product_name": "NL-007", "product_code": "NL-007", "category": "Barrier Masterbatch", "application": "PPC Film", "description": "Food packaging barrier masterbatch", "notes": "Active"},
    {"product_name": "NL-PHA-21", "product_code": "NL-PHA-21", "category": "Water-based Barrier Coating", "application": "Paper Packaging", "description": "PFAS-free water-based barrier coating", "notes": "Active"},
    {"product_name": "HM-800", "product_code": "HM-800", "category": "Bio-based Polyester Plasticizer", "application": "PVC Film", "description": "Bio-based polyester plasticizer", "notes": "Active"},
    {"product_name": "ESO", "product_code": "ESO", "category": "Epoxidized Soybean Oil", "application": "PVC Plasticizer", "description": "Epoxidized soybean oil", "notes": "Active"},
    {"product_name": "MCPP", "product_code": "MCPP", "category": "Maleic Anhydride Modified Chlorinated Polypropylene", "application": "Adhesion Promoter", "description": "Adhesion promoter for PP", "notes": "Active"},
]
DEMO_CUSTOMERS = [
    {"company_name": "Uflex", "country": "India", "contact_person": "Dileep", "email": "dileep@uflex.co.in", "whatsapp": "+91 98 221 8608", "product_interest": "NL-007", "application": "PPC Film / Food Packaging", "customer_stage": "Sample Payment Pending", "priority": "HIGH", "status_label": "Waiting sample payment", "status_tone": "warning", "last_contact_date": "2026-08-20", "next_followup_date": "2026-08-25", "notes": "25kg sample · USD 310"},
    {"company_name": "Agrileaf", "country": "India", "contact_person": "Vaibhav", "email": "vaibhav@agrileaf.in", "whatsapp": "+91 97 552 3901", "product_interest": "NL-PHA-21", "application": "Water-based Barrier Coating", "customer_stage": "Sample Payment", "priority": "HIGH", "status_label": "Waiting payment", "status_tone": "warning", "last_contact_date": "2026-08-18", "next_followup_date": "2026-08-24", "notes": "5kg sample · USD 150"},
    {"company_name": "Flexo", "country": "Philippines", "contact_person": "Joselito", "email": "joselito@flexo.ph", "whatsapp": "+63 917 555 0190", "product_interest": "E4050 Replacement Project", "application": "Glassine Extrusion Coating", "customer_stage": "Technical Testing", "priority": "HIGH", "status_label": "Waiting customer sample", "status_tone": "attention", "last_contact_date": "2026-08-20", "next_followup_date": "2026-08-26", "notes": "Henkel Proxmelt E4050 replacement"},
    {"company_name": "FLEX Design", "country": "Netherlands", "contact_person": "Dominic", "email": "dominic@flexdesign.nl", "whatsapp": "+31 6 1890 3033", "product_interest": "NL-PHA-21", "application": "PFAS-free Paper Cup Barrier Coating", "customer_stage": "Technical Confirmation", "priority": "MEDIUM HIGH", "status_label": "Waiting sample confirmation", "status_tone": "warning", "last_contact_date": "2026-08-19", "next_followup_date": "2026-08-27", "notes": "Spray / dip coating"},
    {"company_name": "ATSajan", "country": "Thailand", "contact_person": "Anchasa", "email": "anchasa@atsajan.co.th", "whatsapp": "+66 81 553 2871", "product_interest": "MCPP", "application": "Polypropylene Adhesion Modification", "customer_stage": "Maintain Relationship", "priority": "MEDIUM", "status_label": "Maintain relationship", "status_tone": "success", "last_contact_date": "2026-08-16", "next_followup_date": "2026-09-02", "notes": "Potential demand: 20 tons/year"},
    {"company_name": "Inkofix", "country": "India", "contact_person": "LN Garg", "email": "lngarg@inkofix.in", "whatsapp": "+91 99 871 1640", "product_interest": "NL-PHA-21", "application": "Water-based Barrier Coating", "customer_stage": "Quotation", "priority": "MEDIUM HIGH", "status_label": "Price discussion", "status_tone": "attention", "last_contact_date": "2026-08-15", "next_followup_date": "2026-08-28", "notes": "USD 5,550/T CIF Mundra"},
]

@app.post("/api/auth/login")
async def login(credentials: LoginIn):
    """The browser never receives a Supabase service-role key."""
    cfg = settings()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{cfg.supabase_url}/auth/v1/token?grant_type=password",
            headers={"apikey": cfg.supabase_anon_key, "Content-Type": "application/json"},
            json=credentials.model_dump(),
        )
    if response.status_code >= 400:
        raise HTTPException(401, "Invalid login")
    return response.json()

@app.post("/api/auth/update-password")
async def update_password(payload: PasswordIn, authorization: str | None = Header(default=None)):
    """Change the password for the currently authenticated Supabase user."""
    cfg = settings()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.put(
            f"{cfg.supabase_url}/auth/v1/user",
            headers={"apikey": cfg.supabase_anon_key, "Authorization": bearer(authorization), "Content-Type": "application/json"},
            json=payload.model_dump(),
        )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, "Password update failed. Please log in again and retry.")
    return {"updated": True}

@app.post("/api/auth/recover")
async def request_password_recovery(payload: RecoveryIn):
    """Send a Supabase password recovery link without exposing account existence."""
    cfg = settings()
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{cfg.supabase_url}/auth/v1/recover",
            headers={"apikey": cfg.supabase_anon_key, "Content-Type": "application/json"},
            json={"email": payload.email, "redirect_to": cfg.public_app_url},
        )
    if response.status_code >= 400:
        raise HTTPException(response.status_code, "Unable to send password recovery email")
    return {"sent": True}

@app.get("/health")
def health(): return {"status": "ok"}

@app.get("/api/system/health")
def system_health():
    """Public-safe readiness signal; never return configuration values or keys."""
    cfg = settings()
    return {"status": "ok", "service": "zhiwu-os-lead-engine", "search_configured": bool(cfg.brave_search_api_key), "ai_configured": bool(cfg.ai_enabled and cfg.ai_api_key and cfg.ai_base_url and cfg.ai_model)}

@app.post("/api/demo/seed")
async def seed_demo(authorization: str | None = Header(default=None)):
    """Initialize one authenticated workspace with the V1.1 trade CRM demo dataset."""
    token = bearer(authorization)
    existing = await supabase("customers?archived_at=is.null&select=id&limit=1", token)
    if existing:
        return {"seeded": False, "reason": "workspace already has customers"}
    product_rows = await supabase("products", token, "POST", DEMO_PRODUCTS)
    customer_rows = await supabase("customers", token, "POST", DEMO_CUSTOMERS)
    product_ids = {row["product_code"]: row["id"] for row in product_rows}
    customer_ids = {row["company_name"]: row["id"] for row in customer_rows}
    await supabase("projects", token, "POST", [
        {"customer_id": customer_ids["Uflex"], "project_name": "PPC Film Barrier Masterbatch", "product_id": product_ids["NL-007"], "application": "Food Packaging", "stage": "Sample Payment Pending", "notes": "25kg sample"},
        {"customer_id": customer_ids["Agrileaf"], "project_name": "Water-based Barrier Coating Sample", "product_id": product_ids["NL-PHA-21"], "application": "Water-based Barrier Coating", "stage": "Sample Payment", "notes": "5kg sample"},
        {"customer_id": customer_ids["Flexo"], "project_name": "E4050 Replacement Project", "product_id": None, "application": "Glassine Extrusion Coating", "stage": "Technical Testing", "notes": "Prepare 2kg test sample"},
        {"customer_id": customer_ids["FLEX Design"], "project_name": "PFAS-free Paper Cup Barrier Coating", "product_id": product_ids["NL-PHA-21"], "application": "Paper Cup Barrier Coating", "stage": "Technical Confirmation", "notes": "Prepare 1–2L sample"},
        {"customer_id": customer_ids["ATSajan"], "project_name": "PP Adhesion Modification", "product_id": product_ids["MCPP"], "application": "Polypropylene Adhesion Modification", "stage": "Maintain Relationship", "notes": "20 tons/year potential"},
        {"customer_id": customer_ids["Inkofix"], "project_name": "Mundra Quotation Project", "product_id": product_ids["NL-PHA-21"], "application": "Water-based Barrier Coating", "stage": "Quotation", "notes": "CIF Mundra price discussion"},
    ])
    await supabase("followups", token, "POST", [
        {"customer_id": customer_ids["Uflex"], "date": "2026-08-20", "content": "Confirmed performance targets and 25kg sample requirement", "next_action": "Send PI and confirm payment"},
        {"customer_id": customer_ids["Agrileaf"], "date": "2026-08-18", "content": "Customer provided delivery address", "next_action": "Confirm USD 150 payment"},
        {"customer_id": customer_ids["Flexo"], "date": "2026-08-20", "content": "Sent alternative product information", "next_action": "Receive customer sample"},
    ])
    await supabase("quotes", token, "POST", [
        {"customer_id": customer_ids["Uflex"], "product_id": product_ids["NL-007"], "quantity": "25kg", "amount": 310, "currency": "USD", "trade_term": "Sample + Express", "status": "Pending Payment"},
        {"customer_id": customer_ids["Inkofix"], "product_id": product_ids["NL-PHA-21"], "quantity": "18 tons / 20GP", "amount": 5550, "currency": "USD", "trade_term": "CIF Mundra / T", "status": "Price Discussion"},
    ])
    return {"seeded": True, "customers": len(customer_rows), "products": len(product_rows)}

@app.get("/api/customers")
async def list_customers(authorization: str | None = Header(default=None), limit: int = Query(100, le=100)):
    return await supabase(f"customers?select=*&import_reverted=eq.false&archived_at=is.null&order=created_at.desc&limit={limit}", bearer(authorization))

@app.get("/api/workspace-members")
async def list_workspace_members(authorization: str | None = Header(default=None)):
    """Read-only labels for customer ownership; RLS remains the source of truth."""
    return await supabase("workspace_members?select=user_id,display_name,role&order=display_name.asc", bearer(authorization))

@app.post("/api/customers", status_code=201)
async def create_customer(customer: CustomerIn, authorization: str | None = Header(default=None)):
    return await supabase("customers", bearer(authorization), "POST", customer.model_dump(exclude_none=True))

@app.patch("/api/customers/{customer_id}")
async def update_customer(customer_id: str, customer: CustomerIn, authorization: str | None = Header(default=None)):
    return await supabase(f"customers?id=eq.{customer_id}&archived_at=is.null", bearer(authorization), "PATCH", customer.model_dump(exclude_none=True))

@app.get("/api/products")
async def list_products(authorization: str | None = Header(default=None)):
    return await supabase("products?select=*&import_reverted=eq.false&archived_at=is.null&order=product_name.asc", bearer(authorization))

@app.post("/api/products", status_code=201)
async def create_product(product: ProductIn, authorization: str | None = Header(default=None)):
    values = product.model_dump(exclude_none=True)
    values["profile_updated_at"] = datetime.now().isoformat()
    return await supabase("products", bearer(authorization), "POST", values)

@app.patch("/api/products/{product_id}")
async def update_product(product_id: str, product: ProductIn, authorization: str | None = Header(default=None)):
    values = product.model_dump(exclude_none=True)
    values["profile_updated_at"] = datetime.now().isoformat()
    rows = await supabase(f"products?id=eq.{product_id}&archived_at=is.null", bearer(authorization), "PATCH", values)
    if not rows:
        raise HTTPException(404, "Product not found")
    return rows[0]

# Lead-engine configuration stays in versioned Supabase tables rather than in
# crawler constants.  RLS is enforced again by the user's bearer token here.
@app.get("/api/keywords")
async def list_product_keywords(product_id: str | None = Query(default=None), authorization: str | None = Header(default=None)):
    filter_part = f"&product_id=eq.{quote(product_id, safe='')}" if product_id else ""
    return await supabase(f"product_keywords?select=*&order=created_at.desc{filter_part}", bearer(authorization))

@app.post("/api/keywords", status_code=201)
async def create_product_keyword(payload: ProductKeywordIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    product = await supabase(f"products?id=eq.{payload.product_id}&archived_at=is.null&select=id&limit=1", token)
    if not product:
        raise HTTPException(404, "产品不存在")
    rows = await supabase("product_keywords", token, "POST", payload.model_dump())
    return rows[0]

@app.patch("/api/keywords/{keyword_id}")
async def update_product_keyword(keyword_id: str, payload: ProductKeywordIn, authorization: str | None = Header(default=None)):
    rows = await supabase(f"product_keywords?id=eq.{keyword_id}", bearer(authorization), "PATCH", {**payload.model_dump(), "updated_at": datetime.now().isoformat()})
    if not rows: raise HTTPException(404, "关键词不存在")
    return rows[0]

@app.get("/api/sources")
async def list_crawl_sources(authorization: str | None = Header(default=None)):
    return await supabase("crawl_sources?select=*&order=updated_at.desc", bearer(authorization))

@app.post("/api/sources", status_code=201)
async def create_crawl_source(payload: CrawlSourceIn, authorization: str | None = Header(default=None)):
    if payload.start_url and (not _domain_from_url(payload.start_url) or not payload.start_url.lower().startswith(("http://", "https://"))):
        raise HTTPException(422, "起始 URL 必须是公开 HTTP(S) 地址")
    rows = await supabase("crawl_sources", bearer(authorization), "POST", payload.model_dump())
    return rows[0]

@app.patch("/api/sources/{source_id}")
async def update_crawl_source(source_id: str, payload: CrawlSourceIn, authorization: str | None = Header(default=None)):
    rows = await supabase(f"crawl_sources?id=eq.{source_id}", bearer(authorization), "PATCH", {**payload.model_dump(), "updated_at": datetime.now().isoformat()})
    if not rows: raise HTTPException(404, "数据源不存在")
    return rows[0]

@app.get("/api/domain-blocklist")
async def list_domain_blocklist(authorization: str | None = Header(default=None)):
    return await supabase("domain_blocklist?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/domain-blocklist", status_code=201)
async def create_domain_block(payload: DomainBlockIn, authorization: str | None = Header(default=None)):
    root_domain = _domain_from_url("https://" + payload.root_domain)
    if not root_domain:
        raise HTTPException(422, "请输入有效根域名")
    rows = await supabase("domain_blocklist", bearer(authorization), "POST", {**payload.model_dump(), "root_domain": root_domain})
    return rows[0]

@app.get("/api/product-customer-relations")
async def list_product_customer_relations(authorization: str | None = Header(default=None)):
    return await supabase("product_customer_relations?select=*&import_reverted=eq.false&archived_at=is.null&order=created_at.desc", bearer(authorization))

@app.post("/api/products/{product_id}/customers", status_code=201)
async def link_product_to_customer(product_id: str, payload: ProductCustomerRelationIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    product_rows = await supabase(f"products?id=eq.{product_id}&archived_at=is.null&select=id", token)
    customer_rows = await supabase(f"customers?id=eq.{payload.customer_id}&archived_at=is.null&select=id", token)
    if not product_rows or not customer_rows:
        raise HTTPException(404, "Product or customer not found")
    existing = await supabase(f"product_customer_relations?product_id=eq.{product_id}&customer_id=eq.{payload.customer_id}&import_reverted=eq.false&archived_at=is.null&select=*", token)
    if existing:
        return existing[0]
    rows = await supabase("product_customer_relations", token, "POST", {"product_id": product_id, "customer_id": payload.customer_id})
    return rows[0]

@app.get("/api/followups")
async def list_followups(authorization: str | None = Header(default=None)):
    return await supabase("followups?select=*&import_reverted=eq.false&archived_at=is.null&order=date.desc", bearer(authorization))

@app.post("/api/followups", status_code=201)
async def create_followup(followup: FollowupIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase("followups", token, "POST", followup.model_dump(exclude_none=True))
    await record_timeline_event(token, title=f"跟进客户：{followup.content}", event_type="crm", source="followup", related_id=rows[0]["id"], customer_id=followup.customer_id, event_date=followup.date)
    return rows

@app.get("/api/trade-commitments")
async def list_trade_commitments(authorization: str | None = Header(default=None)):
    return await supabase("trade_commitments?select=*&archived_at=is.null&order=due_date.asc.nullslast,created_at.desc", bearer(authorization))

@app.post("/api/trade-commitments", status_code=201)
async def create_trade_commitment(commitment: TradeCommitmentIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    customer_rows = await supabase(f"customers?id=eq.{commitment.customer_id}&archived_at=is.null&select=id", token)
    if not customer_rows:
        raise HTTPException(404, "Customer not found")
    if commitment.project_id:
        project_rows = await supabase(f"projects?id=eq.{commitment.project_id}&customer_id=eq.{commitment.customer_id}&archived_at=is.null&select=id", token)
        if not project_rows:
            raise HTTPException(422, "Commitment project must belong to this customer")
    if commitment.product_id:
        product_rows = await supabase(f"products?id=eq.{commitment.product_id}&archived_at=is.null&select=id", token)
        if not product_rows:
            raise HTTPException(422, "Product not found")
    values = commitment.model_dump(exclude_none=True, exclude={"create_task"})
    if values.get("status") == "已兑现":
        values["completed_at"] = datetime.now().isoformat()
    rows = await supabase("trade_commitments", token, "POST", values)
    record = rows[0]
    await record_timeline_event(token, title=f"新增承诺：{record['title']}", event_type="crm", source="trade_commitment", related_id=record["id"], customer_id=record["customer_id"], project_id=record.get("project_id"), product_id=record.get("product_id"), event_date=str(record.get("due_date") or date.today()))
    if commitment.create_task and commitment.status != "已兑现":
        await supabase("tasks", token, "POST", {
            "title": f"兑现承诺：{commitment.title}", "description": f"承诺台账 · {commitment.responsible_party} · 证据：{commitment.evidence_note}\\n下一步：{commitment.next_action or '待补充'}",
            "category": "外贸", "priority": "important" if commitment.status == "我方待办" else "normal",
            "status": "Pending", "task_date": commitment.due_date or str(date.today()),
            "customer_id": commitment.customer_id, "project_id": commitment.project_id, "product_id": commitment.product_id,
        })
    return record

@app.patch("/api/trade-commitments/{commitment_id}")
async def update_trade_commitment(commitment_id: str, commitment: TradeCommitmentUpdateIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    existing = await supabase(f"trade_commitments?id=eq.{commitment_id}&archived_at=is.null&select=*", token)
    if not existing:
        raise HTTPException(404, "Commitment not found")
    values = commitment.model_dump(exclude_unset=True)
    if values.get("project_id"):
        project_rows = await supabase(f"projects?id=eq.{values['project_id']}&customer_id=eq.{existing[0]['customer_id']}&archived_at=is.null&select=id", token)
        if not project_rows:
            raise HTTPException(422, "Commitment project must belong to this customer")
    if values.get("product_id"):
        product_rows = await supabase(f"products?id=eq.{values['product_id']}&archived_at=is.null&select=id", token)
        if not product_rows:
            raise HTTPException(422, "Product not found")
    if values.get("status") == "已兑现" and not existing[0].get("completed_at"):
        values["completed_at"] = datetime.now().isoformat()
    elif values.get("status") and values["status"] != "已兑现":
        values["completed_at"] = None
    values["updated_at"] = datetime.now().isoformat()
    rows = await supabase(f"trade_commitments?id=eq.{commitment_id}", token, "PATCH", values)
    record = rows[0]
    await record_timeline_event(token, title=f"更新承诺：{record['title']}（{record['status']}）", event_type="crm", source="trade_commitment", related_id=record["id"], customer_id=record["customer_id"], project_id=record.get("project_id"), product_id=record.get("product_id"), event_date=str(record.get("due_date") or date.today()))
    return record

@app.get("/api/projects")
async def list_projects(authorization: str | None = Header(default=None)):
    return await supabase("projects?select=*&import_reverted=eq.false&archived_at=is.null&order=created_at.desc", bearer(authorization))

@app.post("/api/projects", status_code=201)
async def create_project(project: ProjectIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase("projects", token, "POST", project.model_dump(exclude_none=True))
    await record_timeline_event(token, title=f"创建项目：{project.project_name}", event_type="project", source="project", related_id=rows[0]["id"], customer_id=project.customer_id, product_id=project.product_id)
    return rows

@app.patch("/api/projects/{project_id}")
async def update_project(project_id: str, project: ProjectUpdateIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    existing = await supabase(f"projects?id=eq.{project_id}&archived_at=is.null&select=id,customer_id", token)
    if not existing:
        raise HTTPException(404, "Project not found")
    rows = await supabase(f"projects?id=eq.{project_id}", token, "PATCH", project.model_dump(exclude_none=True))
    record = rows[0]
    await record_timeline_event(token, title=f"更新项目：{record['project_name']}", event_type="project", source="project", related_id=record["id"], customer_id=existing[0]["customer_id"], product_id=record.get("product_id"))
    return rows

@app.get("/api/tasks")
async def list_tasks(
    authorization: str | None = Header(default=None), task_date: str | None = None,
    from_date: str | None = Query(default=None), to_date: str | None = Query(default=None),
):
    filters = ["select=*", "import_reverted=eq.false", "archived_at=is.null", "order=task_date.asc,start_time.asc"]
    if task_date:
        filters.append(f"task_date=eq.{task_date}")
    if from_date:
        filters.append(f"task_date=gte.{from_date}")
    if to_date:
        filters.append(f"task_date=lte.{to_date}")
    return await supabase(f"tasks?{'&'.join(filters)}", bearer(authorization))

@app.post("/api/tasks", status_code=201)
async def create_task(task: TaskIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase("tasks", token, "POST", task.model_dump(exclude_none=True))
    record = rows[0]
    await record_timeline_event(token, title=f"计划：{record['title']}", event_type="task", source="task", related_id=record["id"], customer_id=record.get("customer_id"), project_id=record.get("project_id"), product_id=record.get("product_id"), event_date=record["task_date"], event_time=record.get("start_time"))
    return record

@app.patch("/api/tasks/{task_id}")
async def update_task_status(task_id: str, payload: TaskStatusIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    existing = await supabase(f"tasks?id=eq.{task_id}&archived_at=is.null&select=*", token)
    if not existing:
        raise HTTPException(404, "Task not found")
    task = existing[0]
    update = {"status": payload.status, "completed_at": datetime.now().isoformat() if payload.status == "Completed" else None}
    rows = await supabase(f"tasks?id=eq.{task_id}", token, "PATCH", update)
    if payload.status == "Completed":
        await record_timeline_event(token, title=f"完成任务：{task['title']}", event_type="task", source="task", related_id=task_id, customer_id=task.get("customer_id"), project_id=task.get("project_id"), product_id=task.get("product_id"))
    return rows[0]

@app.get("/api/lead-search-tasks")
async def list_lead_search_tasks(authorization: str | None = Header(default=None)):
    return await supabase("lead_search_tasks?deleted_at=is.null&select=*&order=created_at.asc", bearer(authorization))

async def lead_task_values_from_product_profile(payload: LeadSearchTaskIn, token: str) -> dict[str, Any]:
    """Snapshot a confirmed product profile into a reusable discovery task."""
    values = payload.model_dump()
    if payload.product_id:
        rows = await supabase(f"products?id=eq.{payload.product_id}&archived_at=is.null&select=*", token)
        if not rows:
            raise HTTPException(404, "所选产品不存在")
        product = rows[0]
        if payload.discovery_mode == "需求客户":
            if product.get("profile_status") != "已确认":
                raise HTTPException(422, "需求侧搜索只能选择已确认的产品画像")
            if not product.get("confirmed_applications") or not product.get("target_company_types"):
                raise HTTPException(422, "产品画像缺少已确认下游应用或目标企业类型，不能开始需求侧搜索")
        keyword_rows = await supabase(f"product_keywords?product_id=eq.{payload.product_id}&enabled=eq.true&select=keyword,keyword_type,country", token)
        requested_countries = {str(country).casefold() for country in payload.target_countries if str(country).strip()}
        scoped_keywords = [row for row in keyword_rows if not row.get("country") or not requested_countries or str(row["country"]).casefold() in requested_countries]
        product_terms = [str(value).strip() for value in (product.get("technical_keywords") or []) if str(value).strip()]
        product_terms.extend(str(row["keyword"]).strip() for row in scoped_keywords if row.get("keyword_type") in {"include", "local"})
        exclusions = list(product.get("exclusion_rules") or []) + [str(row["keyword"]).strip() for row in scoped_keywords if row.get("keyword_type") == "exclude"]
        for value in (product.get("product_code"), product.get("product_name")):
            if value and str(value).strip() not in product_terms:
                product_terms.append(str(value).strip())
        values.update({
            "product_keywords": list(dict.fromkeys(product_terms)),
            "application_keywords": list(product.get("confirmed_applications") or []) if payload.discovery_mode == "需求客户" else values["application_keywords"],
            "target_company_types": list(product.get("target_company_types") or []) if payload.discovery_mode == "需求客户" else values["target_company_types"],
            "profile_exclusion_rules": list(dict.fromkeys(exclusions)),
        })
    # Source settings are reusable: a task may still provide its own URLs, but
    # enabled public sources matching its target countries are appended safely.
    source_rows = await supabase("crawl_sources?enabled=eq.true&select=start_url,country", token)
    requested_countries = {str(country).casefold() for country in payload.target_countries if str(country).strip()}
    configured_urls = [str(row.get("start_url") or "").strip() for row in source_rows if row.get("start_url") and (not row.get("country") or not requested_countries or str(row["country"]).casefold() in requested_countries)]
    values["source_urls"] = list(dict.fromkeys([*values.get("source_urls", []), *configured_urls]))
    return values

@app.post("/api/lead-search-tasks", status_code=201)
async def create_lead_search_task(payload: LeadSearchTaskIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    values = await lead_task_values_from_product_profile(payload, token)
    # Task names are unique per user. A soft-deleted preset must therefore be
    # restored in place when its card is clicked again, not inserted anew.
    name = quote(payload.task_name, safe="")
    deleted = await supabase(f"lead_search_tasks?task_name=eq.{name}&deleted_at=not.is.null&select=id&limit=1", token)
    if deleted:
        rows = await supabase(f"lead_search_tasks?id=eq.{deleted[0]['id']}&deleted_at=not.is.null", token, "PATCH", {
            **values, "deleted_at": None, "cancel_requested": False, "pause_requested": False,
            "run_state": "待运行", "updated_at": datetime.now().astimezone().isoformat(),
        })
        return rows[0]
    rows = await supabase("lead_search_tasks", token, "POST", values)
    return rows[0]

@app.patch("/api/lead-search-tasks/{task_id}")
async def update_lead_search_task(task_id: str, payload: LeadSearchTaskIn, authorization: str | None = Header(default=None)):
    # Keep existing V1.13 tasks usable while V1.14's optional directory-source
    # column is being rolled out. Explicit non-default sources still persist.
    token = bearer(authorization)
    values = await lead_task_values_from_product_profile(payload, token)
    rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null", token, "PATCH", {**values, "updated_at": datetime.now().isoformat()})
    if not rows: raise HTTPException(404, "Lead search task not found")
    return rows[0]

@app.delete("/api/lead-search-tasks/{task_id}")
async def delete_lead_search_task(task_id: str, authorization: str | None = Header(default=None)):
    """Cancel any active work, then soft-delete only the task configuration."""
    token = bearer(authorization)
    now = datetime.now().astimezone().isoformat()
    try:
        rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null", token, "PATCH", {
            "cancel_requested": True, "pause_requested": False, "run_state": "已取消",
            "status": "暂停", "daily_enabled": False, "deleted_at": now, "updated_at": now,
        })
    except HTTPException:
        # The task must remain removable even if a very old deployment has not
        # yet received the optional cancellation columns.
        rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null", token, "PATCH", {
            "status": "暂停", "daily_enabled": False, "deleted_at": now, "updated_at": now,
        })
    if not rows: raise HTTPException(404, "Lead search task not found")
    # A worker checks cancel_requested between pages. Mark stuck or queued runs
    # terminal immediately so they cannot make the deleted task look permanent.
    try:
        await supabase(f"lead_discovery_runs?task_id=eq.{task_id}&status=eq.%E8%BF%90%E8%A1%8C%E4%B8%AD", token, "PATCH", {
            "status": "跳过", "finished_at": now,
            "error_message": "用户删除任务配置，已取消未完成的公开网页核验。",
        })
    except HTTPException:
        # The task is already hidden; retaining an old run row must not turn a
        # successful configuration deletion into a browser-visible 500.
        pass
    ACTIVE_LEAD_TASKS.discard(task_id)
    return {"deleted": True, "task_id": task_id, "message": "已取消运行并删除任务；已有线索与运行记录已保留。"}

@app.get("/api/lead-discovery-runs")
async def list_lead_discovery_runs(authorization: str | None = Header(default=None), limit: int = Query(50, le=100)):
    return await supabase(f"lead_discovery_runs?select=*&order=started_at.desc&limit={limit}", bearer(authorization))

async def _run_lead_task_for_user(token: str, task_id: str, trigger: str) -> dict[str, Any]:
    task_rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null&select=*&limit=1", token)
    if not task_rows: raise HTTPException(404, "Lead search task not found")
    from .lead_discovery import RestStore, run_task_once
    try:
        return await run_task_once(RestStore(token), task_rows[0], trigger)
    except Exception as exc:
        raise HTTPException(502, f"公开网页搜索失败：{str(exc)[:500]}")
    finally:
        ACTIVE_LEAD_TASKS.discard(task_id)

@app.post("/api/lead-search-tasks/{task_id}/run")
async def run_lead_search_task(task_id: str, background_tasks: BackgroundTasks, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    if task_id in ACTIVE_LEAD_TASKS:
        return {"status": "运行中", "message": "该任务正在启动或运行中，请等待当前运行结束。"}
    active = await supabase(f"lead_discovery_runs?task_id=eq.{task_id}&status=eq.%E8%BF%90%E8%A1%8C%E4%B8%AD&select=id,started_at&limit=20", token)
    cutoff = datetime.now().astimezone() - LEAD_RUN_STALE_AFTER
    stale = [row for row in active if datetime.fromisoformat(str(row["started_at"]).replace("Z", "+00:00")) < cutoff]
    for row in stale:
        await supabase(f"lead_discovery_runs?id=eq.{row['id']}", token, "PATCH", {
            "status": "失败", "finished_at": datetime.now().astimezone().isoformat(),
            "error_message": "任务超过 6 小时未完成，已自动释放；请重新运行。",
        })
    active = [row for row in active if row not in stale]
    if active:
        return {"run_id": active[0]["id"], "status": "运行中", "message": "该任务正在按合规限速运行。"}
    ACTIVE_LEAD_TASKS.add(task_id)
    background_tasks.add_task(_run_lead_task_for_user, token, task_id, "manual")
    return {"status": "已开始", "message": "已在服务器后台开始公开网页搜索；完成后刷新即可查看审核池和运行日志。"}

@app.post("/api/lead-search-tasks/{task_id}/pause")
async def pause_lead_search_task(task_id: str, authorization: str | None = Header(default=None)):
    rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null", bearer(authorization), "PATCH", {"pause_requested": True, "run_state": "已暂停", "status": "暂停", "updated_at": datetime.now().isoformat()})
    if not rows: raise HTTPException(404, "采集任务不存在")
    return {"task": rows[0], "message": "已请求暂停；当前页面处理完成后会安全停止。"}

@app.post("/api/lead-search-tasks/{task_id}/resume")
async def resume_lead_search_task(task_id: str, background_tasks: BackgroundTasks, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null", token, "PATCH", {"pause_requested": False, "cancel_requested": False, "run_state": "排队中", "status": "启用", "updated_at": datetime.now().isoformat()})
    if not rows: raise HTTPException(404, "采集任务不存在")
    if task_id not in ACTIVE_LEAD_TASKS:
        ACTIVE_LEAD_TASKS.add(task_id)
        background_tasks.add_task(_run_lead_task_for_user, token, task_id, "retry")
    return {"task": rows[0], "message": "已恢复并排队；已完成的候选会按域名去重更新。"}

@app.post("/api/lead-search-tasks/{task_id}/cancel")
async def cancel_lead_search_task(task_id: str, authorization: str | None = Header(default=None)):
    rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null", bearer(authorization), "PATCH", {"cancel_requested": True, "pause_requested": False, "run_state": "已取消", "status": "暂停", "daily_enabled": False, "updated_at": datetime.now().isoformat()})
    if not rows: raise HTTPException(404, "采集任务不存在")
    return {"task": rows[0], "message": "已请求取消；已保存的审核线索和证据不会删除。"}

async def _run_enabled_lead_tasks(token: str) -> None:
    tasks = await supabase("lead_search_tasks?deleted_at=is.null&status=eq.%E5%90%AF%E7%94%A8&select=id&order=created_at.asc", token)
    for task in tasks:
        try: await _run_lead_task_for_user(token, task["id"], "manual")
        except HTTPException: continue

@app.post("/api/lead-search-tasks/run-enabled")
async def run_enabled_lead_search_tasks(background_tasks: BackgroundTasks, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    background_tasks.add_task(_run_enabled_lead_tasks, token)
    return {"status": "已开始", "message": "所有启用任务将在服务器后台按顺序运行。"}

@app.post("/api/customer-leads/import-cpph-2a-strict")
async def import_cpph_2a_strict_leads(
    file: UploadFile = File(...), authorization: str | None = Header(default=None),
):
    """Import only the fixed, human-verified CPPH-2A strict workbook.

    This endpoint writes reviewable leads, never CRM customers. Re-uploading the
    same workbook updates the same records through source ID and identity keys.
    """
    token = bearer(authorization)
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(422, "请上传 .xlsx 格式的严格客户名单")
    content = await file.read()
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(422, "Excel 文件必须在 1 字节到 10 MB 之间")

    async def request(path: str, method: str, payload: dict[str, Any] | None) -> Any:
        return await supabase(path, token, method, payload)

    try:
        return await import_cpph_strict_records(request, content)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

@app.get("/api/customer-leads")
async def list_customer_leads(authorization: str | None = Header(default=None), limit: int = Query(300, le=500)):
    return await supabase(f"customer_leads?select=*&order=discovered_at.desc&limit={limit}", bearer(authorization))

async def tds_document(token: str, document_id: str) -> dict[str, Any]:
    rows = await supabase(f"tds_documents?id=eq.{document_id}&select=*&limit=1", token)
    if not rows:
        raise HTTPException(404, "TDS 文档不存在")
    return rows[0]

@app.get("/api/tds-documents")
async def list_tds_documents(authorization: str | None = Header(default=None)):
    return await supabase("tds_documents?select=*&order=parsed_at.desc", bearer(authorization))

@app.post("/api/tds-documents/parse", status_code=201)
async def parse_tds_document(
    file: UploadFile = File(...), product_id: str | None = Form(default=None), document_version: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
):
    """Parse a user-uploaded PDF/DOCX without inferring unsupported uses."""
    token = bearer(authorization)
    filename = (file.filename or "").strip()
    if not filename.casefold().endswith((".pdf", ".docx")):
        raise HTTPException(422, "请上传 PDF 或 DOCX 格式的 TDS。")
    content = await file.read()
    if not content or len(content) > 15 * 1024 * 1024:
        raise HTTPException(422, "TDS 文件必须在 1 字节到 15 MB 之间。")
    if product_id:
        product = await supabase(f"products?id=eq.{product_id}&archived_at=is.null&select=id&limit=1", token)
        if not product:
            raise HTTPException(422, "关联的内部产品不存在。内部牌号仅作关联，不会进入搜索词。")
    digest = content_sha256(content)
    existing = await supabase(f"tds_documents?content_sha256=eq.{digest}&select=*&limit=1", token)
    if existing:
        applications = await supabase(f"tds_applications?tds_document_id=eq.{existing[0]['id']}&select=*&order=created_at.asc", token)
        return {"document": existing[0], "applications": applications, "reused": True, "message": "该 TDS 已解析过，已保留原有应用与修改记录。"}
    parsed = parse_tds_upload(filename, content)
    mime_type = "application/pdf" if filename.casefold().endswith(".pdf") else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    values = {
        "product_id": product_id, "original_file_name": filename[:300], "document_version": (document_version or "").strip() or None,
        "mime_type": mime_type, "byte_size": len(content), "content_sha256": digest, "parse_status": parsed.status,
        "parse_error": parsed.error, "extracted_text": parsed.text[:500000] or None,
        "extracted_summary": re.sub(r"\s+", " ", parsed.text).strip()[:1600] or None,
    }
    document = (await supabase("tds_documents", token, "POST", values))[0]
    applications: list[dict[str, Any]] = []
    if parsed.status == "已解析":
        for proposal in extract_explicit_applications(parsed.pages):
            applications.append((await supabase("tds_applications", token, "POST", {"tds_document_id": document["id"], **proposal}))[0])
    message = "已从 TDS 原文提取待确认应用。请逐项编辑并确认；未确认的应用不会进入搜索。" if applications else (parsed.error or "未识别到明确应用；请依据 TDS 原文手动添加应用。")
    return {"document": document, "applications": applications, "reused": False, "message": message}

@app.get("/api/tds-documents/{document_id}/applications")
async def list_tds_applications(document_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await tds_document(token, document_id)
    return await supabase(f"tds_applications?tds_document_id=eq.{document_id}&select=*&order=created_at.asc", token)

@app.post("/api/tds-documents/{document_id}/applications", status_code=201)
async def create_tds_application(document_id: str, payload: TdsApplicationIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await tds_document(token, document_id)
    values = payload.model_dump(exclude_none=True)
    values.update({"tds_document_id": document_id, "updated_at": datetime.now().isoformat()})
    return (await supabase("tds_applications", token, "POST", values))[0]

@app.patch("/api/tds-applications/{application_id}")
async def update_tds_application(application_id: str, payload: TdsApplicationIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    existing = await supabase(f"tds_applications?id=eq.{application_id}&select=id&limit=1", token)
    if not existing:
        raise HTTPException(404, "TDS 应用不存在")
    values = payload.model_dump(exclude_none=True); values["updated_at"] = datetime.now().isoformat()
    return (await supabase(f"tds_applications?id=eq.{application_id}", token, "PATCH", values))[0]

@app.get("/api/application-discovery-tasks")
async def list_application_discovery_tasks(authorization: str | None = Header(default=None)):
    return await supabase("application_discovery_tasks?select=*&order=created_at.desc", bearer(authorization))

async def application_discovery_provider(token: str, target_region: str | None) -> tuple[str | None, str | None]:
    """Return only a provider that can currently yield real public pages."""
    if settings().brave_search_api_key:
        return "Brave Search API + 官网核验", None
    sources = await supabase("crawl_sources?enabled=eq.true&select=start_url,country", token)
    region = str(target_region or "").strip().casefold()
    usable = [
        row for row in sources
        if row.get("start_url") and (
            not region or region == "全球" or not row.get("country")
            or str(row.get("country") or "").strip().casefold() == region
        )
    ]
    if usable:
        return "公开目录纯爬虫", f"已匹配 {len(usable)} 个已启用公开入口；系统将逐页检查 robots.txt 并核验企业官网。"
    return None, "当前目标地区没有已启用的公开目录入口，且未配置搜索 API；任务可以保存，但不会伪造候选公司。"

def application_task_profile(task: dict[str, Any]) -> tuple[list[str], list[str], list[str]]:
    """Build an application-led profile without TDS filenames or product grades."""
    applications: list[str] = []
    company_types: list[str] = []
    exclusions: list[str] = []
    for item in task.get("application_snapshot") or []:
        for key in ("application_name", "substrate_or_object", "material_function"):
            value = str(item.get(key) or "").strip()
            if value:
                applications.append(value)
        company_types.extend(str(value).strip() for value in (item.get("target_company_types") or []) if str(value).strip())
        if item.get("exclusion_notes"):
            exclusions.append(str(item["exclusion_notes"]).strip())
    return list(dict.fromkeys(applications)), list(dict.fromkeys(company_types)), list(dict.fromkeys(exclusions))

async def ensure_application_legacy_task(token: str, task: dict[str, Any]) -> dict[str, Any]:
    linked_id = task.get("legacy_lead_task_id")
    if linked_id:
        linked = await supabase(f"lead_search_tasks?id=eq.{linked_id}&deleted_at=is.null&select=*&limit=1", token)
        if linked:
            return linked[0]
    provider, notice = await application_discovery_provider(token, task.get("target_region"))
    if not provider:
        await supabase(f"application_discovery_tasks?id=eq.{task['id']}", token, "PATCH", {
            "status": "待配置", "search_provider": None, "provider_notice": notice,
            "updated_at": datetime.now().astimezone().isoformat(),
        })
        raise HTTPException(422, notice)
    application_keywords, company_types, exclusions = application_task_profile(task)
    if not application_keywords:
        raise HTTPException(422, "任务没有可用于发现客户的已确认应用。")
    region = str(task.get("target_region") or "").strip()
    payload = LeadSearchTaskIn(
        task_name=f"应用发现｜{str(task['task_name'])[:150]}｜{str(task['id'])[:8]}",
        discovery_mode="需求客户",
        discovery_strategy="search_plus_crawl" if settings().brave_search_api_key else "public_seed_crawl",
        product_keywords=[],
        application_keywords=application_keywords,
        target_countries=[] if not region or region == "全球" else [region],
        target_company_types=company_types,
        profile_exclusion_rules=exclusions,
        max_results=int(task.get("candidate_limit") or 20),
        daily_enabled=False,
    )
    values = await lead_task_values_from_product_profile(payload, token)
    if not settings().brave_search_api_key and not values.get("source_urls"):
        raise HTTPException(422, "没有匹配当前地区的公开目录入口，无法开始真实采集。")
    existing = await supabase(f"lead_search_tasks?task_name=eq.{quote(payload.task_name, safe='')}&deleted_at=is.null&select=*&limit=1", token)
    legacy = existing[0] if existing else (await supabase("lead_search_tasks", token, "POST", values))[0]
    await supabase(f"application_discovery_tasks?id=eq.{task['id']}", token, "PATCH", {
        "legacy_lead_task_id": legacy["id"], "search_provider": provider, "provider_notice": notice,
        "updated_at": datetime.now().astimezone().isoformat(),
    })
    return legacy

def application_match_status(lead: dict[str, Any], application: dict[str, Any]) -> tuple[str, str, str]:
    evidence = str(lead.get("product_evidence_summary") or lead.get("verification_conclusion") or "").strip()
    hits = [str(value).strip() for value in (lead.get("discovered_application_keywords") or []) if str(value).strip()]
    searchable = " ".join(str(application.get(key) or "") for key in ("application_name", "substrate_or_object", "material_function", "description")).casefold()
    related = [hit for hit in hits if hit.casefold() in searchable or any(part in hit.casefold() for part in searchable.split() if len(part) >= 4)]
    layer = str(lead.get("lead_layer") or "")
    if layer == "排除":
        status = "不匹配"
    elif related and layer == "直接需求候选":
        status = "应用相关但工艺未知"
    elif layer == "间接应用链":
        status = "间接渠道"
    else:
        status = "资料不足"
    reason = evidence or (f"官网公开内容命中应用词：{', '.join(related[:5])}。" if related else "已发现企业官网，但尚无足够证据确认该具体应用。")
    pending = "需人工确认该企业是否自行使用相关材料/工艺、对应产品线以及采购或技术对接部门。"
    return status, reason[:2000], pending

async def sync_application_discovery_results(token: str, task: dict[str, Any], result: dict[str, Any]) -> None:
    legacy_id = task.get("legacy_lead_task_id")
    leads = await supabase(f"customer_leads?task_id=eq.{legacy_id}&select=*&order=match_score.desc,discovered_at.desc", token)
    contacts = 0
    verified = 0
    matched = 0
    app_counts: dict[str, int] = {}
    for lead in leads:
        await supabase(f"customer_leads?id=eq.{lead['id']}", token, "PATCH", {"application_discovery_task_id": task["id"]})
        if lead.get("official_website") or lead.get("official_homepage_url"):
            verified += 1
        if lead.get("public_business_email") or lead.get("public_business_phone") or lead.get("contact_page_url"):
            contacts += 1
        if lead.get("lead_layer") not in {"排除", "供应工厂候选"}:
            matched += 1
        for application in task.get("application_snapshot") or []:
            application_id = application.get("id")
            if not application_id:
                continue
            status, reason, pending = application_match_status(lead, application)
            if status != "资料不足":
                app_counts[application_id] = app_counts.get(application_id, 0) + 1
            existing = await supabase(f"lead_application_matches?customer_lead_id=eq.{lead['id']}&application_task_id=eq.{task['id']}&tds_application_id=eq.{application_id}&select=id&limit=1", token)
            values = {
                "customer_lead_id": lead["id"], "application_task_id": task["id"],
                "tds_application_id": application_id, "application_snapshot": application,
                "match_status": status, "matching_reason": reason, "pending_confirmation": pending,
                "evidence_strength": max(0, min(100, int(lead.get("match_score") or 0))),
                "updated_at": datetime.now().astimezone().isoformat(),
            }
            if existing:
                await supabase(f"lead_application_matches?id=eq.{existing[0]['id']}", token, "PATCH", values)
            else:
                await supabase("lead_application_matches", token, "POST", values)
    for application in task.get("application_snapshot") or []:
        application_id = application.get("id")
        if application_id:
            await supabase(f"application_discovery_queries?application_task_id=eq.{task['id']}&tds_application_id=eq.{application_id}", token, "PATCH", {
                "execution_status": "已运行", "result_count": app_counts.get(application_id, 0), "error_message": None,
            })
    status = "已完成" if leads else "部分失败"
    await supabase(f"application_discovery_tasks?id=eq.{task['id']}", token, "PATCH", {
        "status": status, "discovered_count": len(leads), "verified_count": verified,
        "matched_count": matched, "contact_count": contacts,
        "failure_message": None if leads else "本轮公开入口未发现可核验企业；可补充公开目录后再次运行。",
        "updated_at": datetime.now().astimezone().isoformat(),
    })

async def run_application_discovery_in_background(token: str, task_id: str, legacy_id: str) -> None:
    try:
        result = await _run_lead_task_for_user(token, legacy_id, "manual")
        rows = await supabase(f"application_discovery_tasks?id=eq.{task_id}&select=*&limit=1", token)
        if rows:
            await sync_application_discovery_results(token, rows[0], result)
    except Exception as exc:
        message = exc.detail if isinstance(exc, HTTPException) else str(exc)
        await supabase(f"application_discovery_tasks?id=eq.{task_id}", token, "PATCH", {
            "status": "部分失败", "failure_message": str(message)[:1000],
            "updated_at": datetime.now().astimezone().isoformat(),
        })
        await supabase(f"application_discovery_queries?application_task_id=eq.{task_id}", token, "PATCH", {
            "execution_status": "失败", "error_message": str(message)[:1000],
        })
    finally:
        ACTIVE_APPLICATION_TASKS.discard(task_id)

@app.post("/api/application-discovery-tasks", status_code=201)
async def create_application_discovery_task(payload: ApplicationDiscoveryTaskIn, authorization: str | None = Header(default=None)):
    """Freeze confirmed application cards.  Search execution is configured separately."""
    token = bearer(authorization); await tds_document(token, payload.tds_document_id)
    encoded_ids = ",".join(payload.application_ids)
    applications = await supabase(f"tds_applications?id=in.({encoded_ids})&tds_document_id=eq.{payload.tds_document_id}&enabled=eq.true&selected=eq.true&select=*", token)
    if len(applications) != len(set(payload.application_ids)):
        raise HTTPException(422, "任务只能选择属于该 TDS、已启用且已确认选中的应用。")
    snapshot = [{key: row.get(key) for key in ("id", "application_name", "description", "substrate_or_object", "material_function", "process_conditions", "limitations", "evidence_excerpt", "evidence_page", "evidence_status", "target_company_types", "official_business_evidence", "exclusion_notes", "search_terms", "local_search_terms")} for row in applications]
    application_label = " / ".join(str(row["application_name"]) for row in applications[:2])
    region = (payload.target_region or "").strip()
    task_name = (payload.task_name or "").strip() or f"{application_label} · {region or '全球'}"
    provider, provider_notice = await application_discovery_provider(token, region)
    values = {"tds_document_id": payload.tds_document_id, "task_name": task_name, "target_region": region or None, "candidate_limit": payload.candidate_limit, "search_budget": payload.search_budget, "application_snapshot": snapshot, "status": "待运行" if provider else "待配置", "search_provider": provider, "provider_notice": None if provider else "尚未配置合规搜索服务；当前可保存应用、导入公开 CSV/PDF 和人工官网证据，但不会伪造自动搜索结果。"}
    values["provider_notice"] = provider_notice
    task = (await supabase("application_discovery_tasks", token, "POST", values))[0]
    for application in applications:
        terms = list(application.get("search_terms") or []) or application_search_terms(application, region)
        for term in terms:
            await supabase("application_discovery_queries", token, "POST", {"application_task_id": task["id"], "tds_application_id": application["id"], "query_text": term, "query_kind": "pdf_directory" if "filetype:pdf" in term else "web", "execution_status": "待运行" if provider else "待配置"})
    queries = await supabase(f"application_discovery_queries?application_task_id=eq.{task['id']}&select=*&order=created_at.asc", token)
    return {"task": task, "queries": queries, "message": "已锁定应用快照并生成可审查查询。" if provider else values["provider_notice"]}

@app.post("/api/application-discovery-tasks/{task_id}/run")
async def run_application_discovery_task(task_id: str, background_tasks: BackgroundTasks, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase(f"application_discovery_tasks?id=eq.{task_id}&select=*&limit=1", token)
    if not rows:
        raise HTTPException(404, "应用客户发现任务不存在")
    if task_id in ACTIVE_APPLICATION_TASKS:
        return {"status": "运行中", "message": "该应用任务正在逐页采集和核验，请稍后刷新。"}
    ACTIVE_APPLICATION_TASKS.add(task_id)
    try:
        legacy = await ensure_application_legacy_task(token, rows[0])
        now = datetime.now().astimezone().isoformat()
        await supabase(f"application_discovery_tasks?id=eq.{task_id}", token, "PATCH", {"status": "运行中", "failure_message": None, "updated_at": now})
        await supabase(f"application_discovery_queries?application_task_id=eq.{task_id}", token, "PATCH", {"execution_status": "待运行", "error_message": None})
        background_tasks.add_task(run_application_discovery_in_background, token, task_id, legacy["id"])
    except Exception:
        ACTIVE_APPLICATION_TASKS.discard(task_id)
        raise
    return {"status": "已开始", "message": "已开始真实采集：公开入口 → 企业官网 → 业务证据 → 公开联系方式。完成后会自动回写客户清单。"}

@app.get("/api/application-discovery-tasks/{task_id}/workspace")
async def application_discovery_workspace(task_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase(f"application_discovery_tasks?id=eq.{task_id}&select=*&limit=1", token)
    if not rows:
        raise HTTPException(404, "应用客户发现任务不存在")
    task = rows[0]
    queries, matches, leads = await asyncio.gather(
        supabase(f"application_discovery_queries?application_task_id=eq.{task_id}&select=*&order=created_at.asc", token),
        supabase(f"lead_application_matches?application_task_id=eq.{task_id}&select=*&order=evidence_strength.desc", token),
        supabase(f"customer_leads?application_discovery_task_id=eq.{task_id}&select=*&order=match_score.desc,discovered_at.desc", token),
    )
    return {"task": task, "queries": queries, "matches": matches, "leads": leads}

async def development_campaign(token: str, campaign_id: str) -> dict[str, Any]:
    rows = await supabase(f"development_campaigns?id=eq.{campaign_id}&select=*&limit=1", token)
    if not rows:
        raise HTTPException(404, "客户开发任务不存在")
    return rows[0]

async def development_duplicate(token: str, domain: str | None, company_name: str, country: str | None) -> bool:
    customers = await supabase("customers?select=company_name,country,website&archived_at=is.null&limit=500", token)
    leads = await supabase("customer_leads?select=company_name,country,website_domain&limit=500", token)
    name_key = normalize_company_name(company_name)
    for row in [*customers, *leads]:
        if domain and canonical_domain(row.get("website") or row.get("website_domain")) == domain:
            return True
        # Same-name records without a verifiable domain stay a candidate
        # duplicate only when the country matches; they are never merged here.
        if not domain and country and str(row.get("country") or "").casefold() == country.casefold() and normalize_company_name(row.get("company_name") or "") == name_key:
            return True
    return False

async def update_development_score(token: str, lead: dict[str, Any], campaign: dict[str, Any]) -> dict[str, Any]:
    evidences = await supabase(f"lead_evidences?customer_lead_id=eq.{lead['id']}&select=evidence_role&limit=100", token)
    contacts = await supabase(f"lead_contacts?customer_lead_id=eq.{lead['id']}&select=email,email_status&limit=20", token)
    roles = {str(row.get("evidence_role") or "") for row in evidences}
    has_contact = any(row.get("email") and row.get("email_status") in {"官网公开", "已验证"} for row in contacts)
    score = score_lead(
        target_country=str(campaign["target_country"]), lead_country=lead.get("country"), evidence_roles=roles,
        has_official_website=bool(canonical_domain(lead.get("website"))), has_public_contact=has_contact,
        duplicate=bool(lead.get("suspected_duplicate")), rejected=lead.get("development_status") == "拒绝联系",
    )
    rows = await supabase(f"customer_leads?id=eq.{lead['id']}", token, "PATCH", {"match_score": score.score, "score_reasons": score.reasons, "updated_at": datetime.now().isoformat()})
    return rows[0]

@app.get("/api/development-campaigns")
async def list_development_campaigns(authorization: str | None = Header(default=None)):
    return await supabase("development_campaigns?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/development-campaigns/nl-fc-pu-brazil", status_code=201)
async def bootstrap_nl_fc_pu_brazil(authorization: str | None = Header(default=None)):
    """Create or reuse the first no-paid-API, Brazil customer-development task."""
    token = bearer(authorization)
    name = quote(NL_FC_PU_CAMPAIGN["campaign_name"], safe="")
    rows = await supabase(f"development_campaigns?campaign_name=eq.{name}&select=*&limit=1", token)
    campaign = rows[0] if rows else (await supabase("development_campaigns", token, "POST", NL_FC_PU_CAMPAIGN))[0]
    for query_text, query_kind, search_url in nl_fc_pu_queries():
        existing = await supabase(f"discovery_queries?campaign_id=eq.{campaign['id']}&query_text=eq.{quote(query_text, safe='')}&query_kind=eq.{query_kind}&select=id&limit=1", token)
        if not existing:
            await supabase("discovery_queries", token, "POST", {"campaign_id": campaign["id"], "query_text": query_text, "country": campaign["target_country"], "query_kind": query_kind, "search_url": search_url})
    queries = await supabase(f"discovery_queries?campaign_id=eq.{campaign['id']}&select=*&order=created_at.asc", token)
    return {"campaign": campaign, "queries": queries, "message": "已生成 NL-FC-PU 巴西开发任务与人工搜索链接；系统不会自动抓取搜索结果或发送任何消息。"}

@app.get("/api/development-campaigns/{campaign_id}/workspace")
async def development_workspace(campaign_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    campaign = await development_campaign(token, campaign_id)
    queries, documents, leads, drafts = await asyncio.gather(
        supabase(f"discovery_queries?campaign_id=eq.{campaign_id}&select=*&order=created_at.asc", token),
        supabase(f"source_documents?campaign_id=eq.{campaign_id}&select=*&order=imported_at.desc", token),
        supabase(f"customer_leads?development_campaign_id=eq.{campaign_id}&select=*&order=match_score.desc,discovered_at.desc&limit=300", token),
        supabase(f"outreach_drafts?campaign_id=eq.{campaign_id}&select=*&order=created_at.desc", token),
    )
    lead_ids = ",".join(item["id"] for item in leads)
    evidences = await supabase(f"lead_evidences?customer_lead_id=in.({lead_ids})&select=*&order=created_at.desc", token) if lead_ids else []
    contacts = await supabase(f"lead_contacts?customer_lead_id=in.({lead_ids})&select=*&order=created_at.desc", token) if lead_ids else []
    return {"campaign": campaign, "queries": queries, "documents": documents, "leads": leads, "evidences": evidences, "contacts": contacts, "drafts": drafts}

@app.post("/api/development-campaigns/{campaign_id}/import-csv")
async def import_development_csv(campaign_id: str, file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    """Import transparent, user-provided public-company candidates; never contacts or sends them."""
    token = bearer(authorization); campaign = await development_campaign(token, campaign_id)
    if not (file.filename or "").casefold().endswith(".csv"):
        raise HTTPException(422, "第一阶段仅接受 UTF-8 CSV；PDF 请使用 PDF 导入入口。")
    content = await file.read()
    if not content or len(content) > 2 * 1024 * 1024:
        raise HTTPException(422, "CSV 文件必须在 1 字节到 2 MB 之间")
    try:
        rows = list(csv.DictReader(content.decode("utf-8-sig").splitlines()))
    except UnicodeDecodeError as exc:
        raise HTTPException(422, "CSV 必须为 UTF-8 编码") from exc
    document = (await supabase("source_documents", token, "POST", {"campaign_id": campaign_id, "source_name": file.filename or "导入 CSV", "source_type": "CSV", "content_sha256": hashlib.sha256(content).hexdigest()}))[0]
    inserted = updated = skipped = 0
    for row in rows[:500]:
        website = str(row.get("website_url") or row.get("website") or row.get("source_url") or "").strip()
        company = str(row.get("company_name") or "").strip()
        if website and not public_http_url(website):
            skipped += 1; continue
        domain = canonical_domain(website)
        if not company:
            company = (domain or "").split(".")[0].replace("-", " ").title()
        if not company or not website:
            skipped += 1; continue
        country = str(row.get("country") or campaign["target_country"]).strip()
        duplicate = await development_duplicate(token, domain, company, country)
        existing = await supabase(f"customer_leads?development_campaign_id=eq.{campaign_id}&website_domain=eq.{quote(domain or '', safe='')}&select=*&limit=1", token) if domain else []
        values = {"development_campaign_id": campaign_id, "development_status": "待核实", "company_name": company[:300], "country": country or None, "website": website, "website_domain": domain, "root_domain": domain, "source_url": website, "source_type": "其他公开网页", "status": "待审核", "verification_bucket": "待补信息", "lead_layer": "待判定", "discovered_product_keywords": [campaign["product_code"]], "discovered_application_keywords": list(campaign.get("applications") or []), "suspected_duplicate": duplicate, "robots_status": "pending", "data_source": "development_csv_import", "needs_human_confirmation": True, "confirmation_note": "导入的公开企业候选；需官网核验后方可评定为合格。"}
        lead = (await supabase(f"customer_leads?id=eq.{existing[0]['id']}", token, "PATCH", values))[0] if existing else (await supabase("customer_leads", token, "POST", values))[0]
        updated += 1 if existing else 0; inserted += 0 if existing else 1
        evidence_url = str(row.get("evidence_url") or website).strip()
        excerpt = str(row.get("evidence_excerpt") or row.get("company_fact") or "CSV 导入的公开企业候选，待官网核验。").strip()[:2000]
        await supabase("lead_evidences", token, "POST", {"customer_lead_id": lead["id"], "source_document_id": document["id"], "evidence_type": "搜索结果", "source_url": evidence_url, "excerpt": excerpt, "evidence_role": "发现来源"})
        if row.get("company_type"):
            await supabase("lead_evidences", token, "POST", {"customer_lead_id": lead["id"], "source_document_id": document["id"], "evidence_type": "搜索结果", "source_url": evidence_url, "excerpt": str(row["company_type"])[:2000], "evidence_role": "客户身份"})
        if row.get("public_email"):
            await supabase("lead_contacts", token, "POST", {"customer_lead_id": lead["id"], "contact_name": row.get("contact_name") or None, "job_title": row.get("contact_title") or None, "email": str(row["public_email"]).strip().lower(), "email_status": "官网公开", "source_url": evidence_url})
        await update_development_score(token, lead, campaign)
    return {"source_document": document, "inserted": inserted, "updated": updated, "skipped": skipped, "message": "CSV 候选已进入待核实队列；请逐条执行官网核验后再转入 CRM。"}

@app.post("/api/development-campaigns/{campaign_id}/import-pdf")
async def import_development_pdf(campaign_id: str, file: UploadFile = File(...), source_url: str = Form(...), authorization: str | None = Header(default=None)):
    """Read a user-supplied public PDF and preserve page-level evidence.

    Only URLs and public email addresses visible in the PDF become candidates;
    no guessed company name or email is generated from a directory page.
    """
    token = bearer(authorization); campaign = await development_campaign(token, campaign_id)
    if not (file.filename or "").casefold().endswith(".pdf") or not public_http_url(source_url):
        raise HTTPException(422, "请上传公开来源的 PDF，并填写其公开 HTTP/HTTPS 来源链接")
    content = await file.read()
    if not content or len(content) > 10 * 1024 * 1024:
        raise HTTPException(422, "PDF 文件必须在 1 字节到 10 MB 之间")
    try:
        from pypdf import PdfReader
        pages = [(index + 1, page.extract_text() or "") for index, page in enumerate(PdfReader(BytesIO(content)).pages)]
    except Exception as exc:
        raise HTTPException(422, "无法读取该 PDF 的文本层；请改用可复制文本 PDF 或 CSV 导入。") from exc
    document = (await supabase("source_documents", token, "POST", {"campaign_id": campaign_id, "source_name": file.filename or "公开 PDF", "source_url": source_url, "source_type": "PDF", "content_sha256": hashlib.sha256(content).hexdigest(), "page_count": len(pages)}))[0]
    inserted = skipped = 0
    for page_number, text in pages:
        urls = re.findall(r"https?://[^\s<>\])}]+", text)
        for website in dict.fromkeys(urls):
            domain = canonical_domain(website)
            if not domain or not public_http_url(website):
                skipped += 1; continue
            company = domain.split(".")[0].replace("-", " ").title()
            duplicate = await development_duplicate(token, domain, company, str(campaign["target_country"]))
            values = {"development_campaign_id": campaign_id, "development_status": "待核实", "company_name": company, "country": campaign["target_country"], "website": website, "website_domain": domain, "root_domain": domain, "source_url": source_url, "source_type": "其他公开网页", "status": "待审核", "verification_bucket": "待补信息", "lead_layer": "待判定", "discovered_product_keywords": [campaign["product_code"]], "discovered_application_keywords": list(campaign.get("applications") or []), "suspected_duplicate": duplicate, "robots_status": "pending", "data_source": "development_pdf_import", "needs_human_confirmation": True, "confirmation_note": "PDF 名录提取的官网 URL；公司名称需以官网为准。"}
            existing = await supabase(f"customer_leads?development_campaign_id=eq.{campaign_id}&website_domain=eq.{quote(domain, safe='')}&select=*&limit=1", token)
            lead = (await supabase(f"customer_leads?id=eq.{existing[0]['id']}", token, "PATCH", values))[0] if existing else (await supabase("customer_leads", token, "POST", values))[0]
            await supabase("lead_evidences", token, "POST", {"customer_lead_id": lead["id"], "source_document_id": document["id"], "evidence_type": "PDF", "source_url": source_url, "page_number": page_number, "excerpt": text[:2000] or "PDF 页面含公开官网 URL。", "evidence_role": "发现来源"})
            for email in dict.fromkeys(re.findall(r"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", text, re.I)):
                await supabase("lead_contacts", token, "POST", {"customer_lead_id": lead["id"], "email": email.casefold(), "email_status": "未验证", "source_url": source_url})
            await update_development_score(token, lead, campaign); inserted += 1
    return {"source_document": document, "inserted": inserted, "skipped": skipped, "message": "PDF 已保留页码证据；提取的官网候选仍须逐条官网核验。"}

@app.post("/api/customer-leads/{lead_id}/verify-official")
async def verify_development_lead_official_site(lead_id: str, authorization: str | None = Header(default=None)):
    """Visit one public official site with robots checking; never visits social platforms or logins."""
    token = bearer(authorization)
    lead_rows = await supabase(f"customer_leads?id=eq.{lead_id}&select=*&limit=1", token)
    if not lead_rows or not lead_rows[0].get("development_campaign_id"):
        raise HTTPException(404, "未找到客户开发候选")
    lead = lead_rows[0]; campaign = await development_campaign(token, lead["development_campaign_id"])
    website = str(lead.get("website") or lead.get("source_url") or "").strip()
    if not public_http_url(website):
        raise HTTPException(422, "候选缺少可访问的公开官网 URL")
    agent = "ZhiwuOSDevelopment/1.0 (+https://work.101921.xyz)"
    async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=5)) as client:
        allowed, robots_note = await robots_permit(client, website, agent)
        if not allowed:
            await supabase(f"customer_leads?id=eq.{lead_id}", token, "PATCH", {"robots_status": "disallowed", "robots_reason": robots_note, "development_status": "待核实", "updated_at": datetime.now().isoformat()})
            raise HTTPException(422, robots_note)
        try:
            response = await client.get(website, headers={"User-Agent": agent}, follow_redirects=True)
        except httpx.HTTPError as exc:
            raise HTTPException(502, "官网无法访问，请稍后重试或人工补充证据。") from exc
    if response.status_code >= 400:
        raise HTTPException(422, f"官网返回 HTTP {response.status_code}")
    final_url = str(response.url); domain = canonical_domain(final_url); text = html_text(response.text)[:30000]
    lower = text.casefold(); excerpts: list[tuple[str, str]] = []
    application_terms = list(campaign.get("applications") or [])
    if campaign.get("product_code") == "NL-FC-PU":
        application_terms.extend(nl_fc_pu_application_terms())
    application_hits = [term for term in dict.fromkeys(application_terms) if str(term).casefold() in lower]
    if application_hits:
        excerpts.append(("应用或产品", f"官网出现与开发活动相关的应用词：{', '.join(application_hits[:4])}。"))
    identity_terms = ("manufacturer", "manufacturing", "producer", "factory", "blender", "formulator", "fabricante", "fabricação", "produção", "produtor")
    identity_hit = next((term for term in identity_terms if term in lower), None)
    if identity_hit:
        excerpts.append(("客户身份", f"官网出现客户身份词：{identity_hit}。"))
    country_terms = (str(campaign["target_country"]).casefold(), "brasil") if str(campaign["target_country"]).casefold() == "brazil" else (str(campaign["target_country"]).casefold(),)
    if any(term in lower for term in country_terms):
        excerpts.append(("国家或地址", f"官网文本出现目标国家：{campaign['target_country']}。"))
    email = public_email(response.text, domain)
    if email:
        excerpts.append(("公开联系入口", f"官网公开业务邮箱：{email}。"))
    for role, excerpt in excerpts:
        await supabase("lead_evidences", token, "POST", {"customer_lead_id": lead_id, "evidence_type": "官网", "source_url": final_url, "excerpt": excerpt, "evidence_role": role, "verified_at": datetime.now().isoformat()})
    if email:
        known = await supabase(f"lead_contacts?customer_lead_id=eq.{lead_id}&email=eq.{quote(email, safe='')}&select=id&limit=1", token)
        if not known:
            await supabase("lead_contacts", token, "POST", {"customer_lead_id": lead_id, "email": email, "email_status": "官网公开", "source_url": final_url, "verified_at": datetime.now().isoformat()})
    values = {"website": final_url, "website_domain": domain, "root_domain": domain, "official_homepage_url": final_url, "official_validation_source_url": final_url, "robots_status": "allowed", "robots_reason": robots_note, "development_status": "待核实", "last_verified_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()}
    if application_hits:
        values.update({"product_evidence_summary": excerpts[0][1], "product_evidence_url": final_url, "product_evidence_type": "官网"})
    if email:
        values["public_business_email"] = email
    lead = (await supabase(f"customer_leads?id=eq.{lead_id}", token, "PATCH", values))[0]
    scored = await update_development_score(token, lead, campaign)
    return {"lead": scored, "evidence_count": len(excerpts), "message": "已按 robots.txt 核验官网并保存可追溯证据；请人工确认是否合格。"}

@app.patch("/api/customer-leads/{lead_id}/development-status")
async def update_development_lead_status(lead_id: str, payload: DevelopmentLeadStatusIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    lead_rows = await supabase(f"customer_leads?id=eq.{lead_id}&select=*&limit=1", token)
    if not lead_rows or not lead_rows[0].get("development_campaign_id"):
        raise HTTPException(404, "未找到客户开发候选")
    lead = lead_rows[0]
    if payload.development_status == "合格" and not lead.get("website"):
        raise HTTPException(422, "标记合格前必须至少有官网记录")
    values = {"development_status": payload.development_status, "updated_at": datetime.now().isoformat()}
    if payload.development_status == "不匹配": values.update({"status": "已排除", "exclusion_reason": payload.note or "人工判定不匹配", "verification_bucket": "排除名单"})
    if payload.development_status == "拒绝联系": values.update({"status": "已排除", "exclusion_reason": payload.note or "客户拒绝联系", "verification_bucket": "排除名单"})
    if payload.development_status == "合格": values.update({"status": "保留", "notes": payload.note or lead.get("notes")})
    updated = (await supabase(f"customer_leads?id=eq.{lead_id}", token, "PATCH", values))[0]
    campaign = await development_campaign(token, updated["development_campaign_id"])
    return await update_development_score(token, updated, campaign)

@app.post("/api/customer-leads/{lead_id}/outreach-drafts", status_code=201)
async def create_development_outreach_draft(lead_id: str, authorization: str | None = Header(default=None)):
    """Create an approval-only draft. There is intentionally no sending endpoint."""
    token = bearer(authorization)
    lead_rows = await supabase(f"customer_leads?id=eq.{lead_id}&select=*&limit=1", token)
    if not lead_rows or not lead_rows[0].get("development_campaign_id"):
        raise HTTPException(404, "未找到客户开发候选")
    lead = lead_rows[0]
    if lead.get("development_status") != "合格":
        raise HTTPException(422, "仅人工标记为“合格”的候选可生成开发信草稿")
    campaign = await development_campaign(token, lead["development_campaign_id"])
    facts = await supabase(f"lead_evidences?customer_lead_id=eq.{lead_id}&evidence_role=eq.%E5%BA%94%E7%94%A8%E6%88%96%E4%BA%A7%E5%93%81&select=*&order=created_at.desc&limit=1", token)
    if not facts:
        raise HTTPException(422, "缺少官网应用或产品证据，不能生成个性化草稿")
    contacts = await supabase(f"lead_contacts?customer_lead_id=eq.{lead_id}&email_status=in.(%E5%AE%98%E7%BD%91%E5%85%AC%E5%BC%80,%E5%B7%B2%E9%AA%8C%E8%AF%81)&select=*&limit=1", token)
    subject, body = draft_email(company_name=lead["company_name"], company_fact=facts[0]["excerpt"], product_claim=campaign["product_claim_text"])
    contact = contacts[0] if contacts else None
    values = {"campaign_id": campaign["id"], "customer_lead_id": lead_id, "lead_contact_id": contact.get("id") if contact else None, "subject": subject, "channel": "邮件" if contact else "LinkedIn", "recipient": contact.get("email") if contact else None, "company_fact": facts[0]["excerpt"], "fact_source_url": facts[0].get("source_url"), "product_code": campaign["product_code"], "product_claim_source": campaign["product_claim_source"], "draft_body": body, "approval_state": "待审核", "reply_state": "未发送"}
    draft = (await supabase("outreach_drafts", token, "POST", values))[0]
    return {"draft": draft, "message": "已创建待审核草稿；系统不会发送邮件、LinkedIn 或社媒消息。"}

@app.patch("/api/outreach-drafts/{draft_id}/approval")
async def approve_development_outreach_draft(draft_id: str, payload: OutreachDraftApprovalIn, authorization: str | None = Header(default=None)):
    rows = await supabase(f"outreach_drafts?id=eq.{draft_id}", bearer(authorization), "PATCH", {"approval_state": payload.approval_state, "approval_note": payload.approval_note, "approved_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()})
    if not rows: raise HTTPException(404, "开发信草稿不存在")
    return rows[0]

@app.post("/api/customer-leads/batch-review")
async def batch_review_customer_leads(payload: LeadBatchReviewIn, authorization: str | None = Header(default=None)):
    if payload.status != "已排除" and payload.exclusion_reason:
        raise HTTPException(422, "只有批量排除可以写入排除原因")
    if any(not re.fullmatch(r"[0-9a-fA-F-]{36}", lead_id) for lead_id in payload.lead_ids):
        raise HTTPException(422, "线索 ID 格式错误")
    data: dict[str, Any] = {"status": payload.status, "updated_at": datetime.now().isoformat()}
    if payload.status == "已排除":
        data.update({"verification_bucket": "排除名单", "exclusion_reason": payload.exclusion_reason or "人工批量排除", "verification_conclusion": payload.exclusion_reason or "人工批量排除"})
    joined = ",".join(payload.lead_ids)
    rows = await supabase(f"customer_leads?id=in.({joined})", bearer(authorization), "PATCH", data)
    return {"updated": len(rows or []), "leads": rows or []}

@app.post("/api/customer-leads/import-seeds")
async def import_seed_leads(task_id: str = Form(...), file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    """Import a user-provided CSV seed list; no invented companies or contacts.

    Accepted columns: website_url (or website/source_url), company_name, country.
    Imported rows remain pending review and can later be fetched by the normal
    compliant task runner.  CSV is intentionally chosen for transparent import.
    """
    token = bearer(authorization)
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(422, "请上传 CSV 种子名单")
    content = await file.read()
    if not content or len(content) > 2 * 1024 * 1024:
        raise HTTPException(422, "CSV 文件必须在 1 字节到 2 MB 之间")
    task_rows = await supabase(f"lead_search_tasks?id=eq.{task_id}&deleted_at=is.null&select=id&limit=1", token)
    if not task_rows: raise HTTPException(404, "采集任务不存在")
    try:
        reader = csv.DictReader(content.decode("utf-8-sig").splitlines())
    except UnicodeDecodeError as exc:
        raise HTTPException(422, "CSV 必须为 UTF-8 编码") from exc
    inserted = updated = skipped = 0
    for source in reader:
        if inserted + updated + skipped >= 500: break
        website = str(source.get("website_url") or source.get("website") or source.get("source_url") or "").strip()
        domain = _domain_from_url(website)
        if not domain or not website.lower().startswith(("http://", "https://")):
            skipped += 1; continue
        company = str(source.get("company_name") or domain).strip()[:300]
        existing = await supabase(f"customer_leads?root_domain=eq.{quote(domain, safe='')}&select=id&limit=1", token)
        values = {"task_id": task_id, "company_name": company, "country": str(source.get("country") or "").strip() or None, "website": f"https://{domain}", "website_domain": domain, "root_domain": domain, "source_url": website, "source_type": "其他公开网页", "status": "待审核", "verification_bucket": "待补信息", "lead_layer": "待判定", "score_reasons": ["用户导入的公开种子 URL；尚未抓取或评分。"], "robots_status": "pending", "data_source": "user_seed_csv", "needs_human_confirmation": True}
        if existing:
            await supabase(f"customer_leads?id=eq.{existing[0]['id']}", token, "PATCH", values); updated += 1
        else:
            await supabase("customer_leads", token, "POST", values); inserted += 1
    return {"inserted": inserted, "updated": updated, "skipped": skipped, "message": "种子已进入待审核池；运行任务后会按 robots 与限速规则核验官网。"}

@app.patch("/api/customer-leads/{lead_id}")
async def review_customer_lead(lead_id: str, payload: LeadReviewIn, authorization: str | None = Header(default=None)):
    if payload.status != "已排除" and payload.exclusion_reason:
        raise HTTPException(422, "仅“已排除”线索可保存排除原因")
    data = {**payload.model_dump(exclude_none=True), "updated_at": datetime.now().isoformat()}
    if payload.status == "已排除":
        data.update({"verification_bucket": "排除名单", "verification_conclusion": payload.exclusion_reason or "人工排除"})
    rows = await supabase(f"customer_leads?id=eq.{lead_id}", bearer(authorization), "PATCH", data)
    if not rows: raise HTTPException(404, "Lead not found")
    return rows[0]

@app.post("/api/customer-leads/{lead_id}/development-task", status_code=201)
async def create_development_task(lead_id: str, payload: LeadDevelopmentTaskIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    lead_rows = await supabase(f"customer_leads?id=eq.{lead_id}&select=*&limit=1", token)
    if not lead_rows: raise HTTPException(404, "Lead not found")
    lead = lead_rows[0]
    if lead.get("verification_bucket") != "严格客户名单":
        raise HTTPException(422, "仅通过严格客户核验的企业可以创建开发任务")
    task_rows = await supabase("tasks", token, "POST", {
        "title": f"研究 / 联系 {lead['company_name']}", "description": payload.suggested_next_action or f"查看官网并确认是否有 {', '.join((lead.get('discovered_application_keywords') or ['目标应用'])[:2])} 业务；仅在人工确认后决定是否联系。",
        "category": "外贸", "priority": payload.priority, "status": "Pending", "task_date": payload.task_date, "lead_id": lead_id,
    })
    task = task_rows[0]
    await supabase(f"customer_leads?id=eq.{lead_id}", token, "PATCH", {"development_task_id": task["id"], "status": "保留", "updated_at": datetime.now().isoformat()})
    return task

@app.post("/api/customer-leads/{lead_id}/convert")
async def convert_customer_lead(lead_id: str, payload: LeadConvertIn, authorization: str | None = Header(default=None)):
    """Explicit user review is required before any CRM write; no NL code is invented."""
    token = bearer(authorization)
    lead_rows = await supabase(f"customer_leads?id=eq.{lead_id}&select=*&limit=1", token)
    if not lead_rows: raise HTTPException(404, "Lead not found")
    lead = lead_rows[0]
    development_qualified = bool(lead.get("development_campaign_id")) and lead.get("development_status") == "合格"
    if lead.get("verification_bucket") != "严格客户名单" and not development_qualified:
        raise HTTPException(422, "仅通过严格客户核验或人工标记为“合格”的开发候选可以载入 CRM")
    email = (payload.email or lead.get("public_business_email") or "").strip().lower()
    selected_contact = payload.contact_person or lead.get("public_contact_name") or lead.get("public_contact_or_department") or lead.get("contact_department")
    identity = f"{lead.get('company_name','')} {selected_contact or ''}".lower()
    if is_internal_mail_address(email) or any(name in identity for name in ("zhiwu", "peter")):
        raise HTTPException(422, "内部同事不能转为海外客户")
    customers = await supabase("customers?select=*&archived_at=is.null&import_reverted=eq.false&limit=500", token)
    lead_domain = _domain_from_url(lead.get("website"))
    existing = next((row for row in customers if payload.customer_id == row.get("id")), None)
    if not existing:
        existing = next((row for row in customers if email and (row.get("email") or "").lower() == email), None)
    if not existing:
        existing = next((row for row in customers if lead_domain and _domain_from_url(row.get("website")) == lead_domain), None)
    if not existing:
        existing = next((row for row in customers if (row.get("company_name") or "").strip().lower() == (lead.get("company_name") or "").strip().lower()), None)
    patch = {
        "contact_person": selected_contact, "country": payload.country or lead.get("country"),
        "website": lead.get("website"), "product_interest": payload.product_interest,
        "application": payload.application or lead.get("possible_need"), "priority": payload.priority,
        "next_action": [payload.next_action] if payload.next_action else None,
        "next_followup_date": payload.next_followup_date, "notes": payload.notes,
    }
    patch = {key: value for key, value in patch.items() if value not in (None, "")}
    if existing:
        rows = await supabase(f"customers?id=eq.{existing['id']}", token, "PATCH", patch)
        customer = rows[0]
        action = "updated"
    else:
        if not email:
            raise HTTPException(422, "新建 CRM 客户需要公开商务邮箱；请先补充邮箱或仅保留为线索")
        customer_data = {"company_name": lead["company_name"], "country": payload.country or lead.get("country") or "待确认", "contact_person": selected_contact or "待确认", "email": email, "customer_stage": "New", **patch}
        rows = await supabase("customers", token, "POST", customer_data)
        customer = rows[0]
        action = "created"
    await record_timeline_event(token, title=f"线索来源：{lead['company_name']}（公开网页审核转入）", event_type="crm", source="lead_discovery", related_id=lead_id, customer_id=customer["id"])
    await supabase(f"customer_leads?id=eq.{lead_id}", token, "PATCH", {"status": "已转 CRM", "crm_customer_id": customer["id"], "converted_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()})
    return {"customer": customer, "action": action}

@app.post("/api/customer-leads/batch-add-to-crm")
async def batch_add_customer_leads_to_crm(payload: LeadBatchConvertIn, authorization: str | None = Header(default=None)):
    """Human-triggered batch conversion with per-row outcomes, never silent skips."""
    if any(not re.fullmatch(r"[0-9a-fA-F-]{36}", lead_id) for lead_id in payload.lead_ids):
        raise HTTPException(422, "线索 ID 格式错误")
    outcomes: list[dict[str, Any]] = []
    for lead_id in payload.lead_ids:
        try:
            result = await convert_customer_lead(lead_id, LeadConvertIn(priority=payload.priority, next_action=payload.next_action or "人工批量审核后进入 CRM，请确认下一步开发动作。", notes="由人工批量审核操作转入 CRM。"), authorization)
            outcomes.append({"lead_id": lead_id, "ok": True, "action": result["action"], "customer_id": result["customer"]["id"]})
        except HTTPException as exc:
            outcomes.append({"lead_id": lead_id, "ok": False, "error": str(exc.detail)})
    return {"converted": sum(1 for row in outcomes if row["ok"]), "failed": sum(1 for row in outcomes if not row["ok"]), "outcomes": outcomes}

@app.get("/api/customer-leads/strict-export")
async def export_strict_customer_leads(authorization: str | None = Header(default=None)):
    """Export only fully verified, CRM-eligible companies as a real .xlsx file."""
    rows = await supabase("customer_leads?select=*&verification_bucket=eq.%E4%B8%A5%E6%A0%BC%E5%AE%A2%E6%88%B7%E5%90%8D%E5%8D%95&order=discovered_at.desc&limit=500", bearer(authorization))
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "严格客户名单"
    headings = ["ID", "匹配级别", "国家/地区", "公司名称", "企业类型", "官网", "公开联系人/部门", "公开邮箱", "公开电话", "公开地址/范围", "PP/PE/TPO相关公开证据", "应用范围", "与H-2A的潜在匹配点", "推荐首联部门", "首轮需确认问题", "真实性核验结论", "来源链接"]
    sheet.append(headings)
    for cell in sheet[1]: cell.font = Font(bold=True)
    for row in rows:
        source_urls = row.get("source_urls") if isinstance(row.get("source_urls"), list) else []
        if not source_urls:
            source_urls = [value for value in (row.get("company_source_url"), row.get("contact_source_url"), row.get("product_evidence_url")) if value]
        values = [
            row.get("source_record_id") or row.get("id"), row.get("match_level") or row.get("matching_grade"), row.get("country"), row.get("company_name"), row.get("company_type"),
            row.get("official_website") or row.get("official_homepage_url") or row.get("website"), row.get("public_contact_or_department") or row.get("public_contact_name") or row.get("contact_department"),
            row.get("public_business_email"), row.get("public_business_phone"), row.get("official_address") or row.get("business_scope"),
            row.get("product_application_evidence") or row.get("product_evidence_summary"), row.get("application_scope") or ", ".join(row.get("discovered_application_keywords") or []),
            row.get("potential_fit") or row.get("possible_need"), row.get("recommended_contact_department"), row.get("first_contact_questions"), row.get("verification_conclusion"), "\n".join(str(url) for url in source_urls),
        ]
        sheet.append(values)
        excel_row = sheet.max_row
        for index in (6,):
            value = sheet.cell(excel_row, index).value
            if value:
                sheet.cell(excel_row, index).hyperlink = str(value)
                sheet.cell(excel_row, index).style = "Hyperlink"
    for column in sheet.columns:
        letter = column[0].column_letter
        sheet.column_dimensions[letter].width = min(max(max(len(str(cell.value or "")) for cell in column) + 2, 14), 48)
    stream = BytesIO(); workbook.save(stream)
    return Response(stream.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=strict-customers.xlsx"})

@app.get("/api/customer-leads/export.csv")
async def export_customer_leads_csv(
    authorization: str | None = Header(default=None),
    application_task_id: str | None = Query(default=None),
    country: str | None = Query(default=None),
    min_score: int | None = Query(default=None, ge=0, le=100),
    max_score: int | None = Query(default=None, ge=0, le=100),
    review_status: str | None = Query(default=None),
    product_keyword: str | None = Query(default=None),
):
    """Export the requested review scope as an Excel-friendly UTF-8 CSV."""
    leads = await supabase("customer_leads?select=*&order=discovered_at.desc&limit=500", bearer(authorization))
    keyword = (product_keyword or "").casefold().strip()
    filtered = [lead for lead in leads if
        (not application_task_id or lead.get("application_discovery_task_id") == application_task_id) and
        (not country or str(lead.get("country") or "").casefold() == country.casefold()) and
        (min_score is None or int(lead.get("match_score") or 0) >= min_score) and
        (max_score is None or int(lead.get("match_score") or 0) <= max_score) and
        (not review_status or lead.get("status") == review_status) and
        (not keyword or keyword in " ".join(str(value) for value in ((lead.get("discovered_product_keywords") or []) + (lead.get("discovered_application_keywords") or []))).casefold())]
    headings = ["公司名称", "国家/地区", "官网", "根域名", "公司类型", "匹配分", "置信度", "公开业务邮箱", "公开电话", "首个来源", "全部来源链接", "审核状态", "CRM 状态", "匹配产品/应用", "官网业务证据", "评分/匹配理由", "待确认事项", "推荐开发角度", "发现时间"]
    from io import StringIO
    buffer = StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(headings)
    for lead in filtered:
        source_urls = lead.get("source_urls") if isinstance(lead.get("source_urls"), list) else []
        pending = lead.get("confirmation_note") or "；".join(lead.get("missing_requirements") or [])
        writer.writerow([lead.get("company_name"), lead.get("country"), lead.get("official_website") or lead.get("website"), lead.get("root_domain") or lead.get("website_domain"), lead.get("company_type"), lead.get("match_score"), lead.get("confidence_score"), lead.get("public_business_email"), lead.get("public_business_phone"), lead.get("source_url"), "\n".join(str(url) for url in source_urls), lead.get("status"), lead.get("lead_status") or lead.get("status"), "; ".join((lead.get("discovered_product_keywords") or []) + (lead.get("discovered_application_keywords") or [])), lead.get("product_evidence_summary") or lead.get("verification_conclusion"), "；".join(lead.get("score_reasons") or []), pending, lead.get("recommended_pitch") or lead.get("possible_need"), lead.get("discovered_at")])
    return Response(("\ufeff" + buffer.getvalue()).encode("utf-8"), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=customer-leads.csv"})

@app.get("/api/daily-logs")
async def get_daily_log(log_date: str, authorization: str | None = Header(default=None)):
    rows = await supabase(f"daily_logs?log_date=eq.{log_date}&select=*&limit=1", bearer(authorization))
    return rows[0] if rows else None

@app.put("/api/daily-logs/{log_date}")
async def save_daily_log(log_date: str, payload: DailyLogIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    existing = await supabase(f"daily_logs?log_date=eq.{log_date}&select=id&limit=1", token)
    data = {**payload.model_dump(exclude_none=True), "updated_at": datetime.now().isoformat()}
    if existing:
        rows = await supabase(f"daily_logs?id=eq.{existing[0]['id']}", token, "PATCH", data)
    else:
        rows = await supabase("daily_logs", token, "POST", {**data, "log_date": log_date})
    await record_timeline_event(token, title="完成今日复盘", event_type="note", source="daily_log", related_id=rows[0]["id"], event_date=log_date)
    return rows[0]

@app.get("/api/timeline")
async def list_timeline(
    authorization: str | None = Header(default=None), event_date: str | None = None,
    from_date: str | None = Query(default=None), to_date: str | None = Query(default=None), limit: int = Query(300, le=500),
):
    filters = ["select=*", "import_reverted=eq.false", "archived_at=is.null", "order=event_date.desc,event_time.desc", f"limit={limit}"]
    if event_date:
        filters.append(f"event_date=eq.{event_date}")
    if from_date:
        filters.append(f"event_date=gte.{from_date}")
    if to_date:
        filters.append(f"event_date=lte.{to_date}")
    return await supabase(f"timeline_events?{'&'.join(filters)}", bearer(authorization))

@app.get("/api/imports")
async def list_import_batches(authorization: str | None = Header(default=None), limit: int = Query(20, le=100)):
    return await supabase(f"import_batches?select=id,schema_version,source_type,source_date,source_reference,preview,status,applied_at,reverted_at,created_at&order=created_at.desc&limit={limit}", bearer(authorization))

@app.post("/api/imports/preview", status_code=201)
async def preview_import(payload: ImportPreviewIn, authorization: str | None = Header(default=None)):
    """Create a draft import batch. This endpoint never touches CRM business records."""
    token = bearer(authorization)
    preview = await build_import_preview(token, payload.payload)
    source = payload.payload.get("source") or {}
    rows = await supabase("import_batches", token, "POST", {
        "schema_version": payload.payload["schema_version"],
        "source_type": import_text(source.get("type")) or "chat_summary",
        "source_date": import_date(source.get("date"), "source.date", required=True),
        "source_reference": import_text(source.get("reference")),
        "raw_payload": payload.payload, "preview": preview, "status": "draft",
    })
    return {"batch": rows[0], "preview": preview}

async def apply_supplier_import(token: str, batch_id: str, payload: dict[str, Any], confirmation: ImportApplyIn) -> dict[str, Any]:
    preview = await build_supplier_import_preview(token, payload)
    match = preview["supplier_match"]
    if match["kind"] == "company_ambiguous":
        raise HTTPException(422, "同名供应商存在歧义；请先在供应商中心人工核对后再导入")
    if match["kind"] == "company_manual_review" and not confirmation.confirm_company_match:
        raise HTTPException(422, "供应商公司名称匹配必须人工确认后才能更新")
    source = payload.get("source") or {}; source_date = import_date(source.get("date"), "source.date", required=True) or str(date.today())
    supplier_data = payload.get("supplier") or {}; contact_data = payload.get("contact") if isinstance(payload.get("contact"), dict) else {}
    supplier_type = import_text(supplier_data.get("supplier_type")); supplier_type = supplier_type if supplier_type in {"工厂", "贸易商"} else "待确认"
    export_status = import_text(supplier_data.get("export_status")); export_status = export_status if export_status in {"可出口", "不可出口"} else "待确认"
    values = {
        "company_name": import_text(supplier_data.get("company_name") or (payload.get("match") or {}).get("company_name")),
        "english_name": import_text(supplier_data.get("english_name")) or None, "country": import_text(supplier_data.get("country")) or "China",
        "province": import_text(supplier_data.get("province")) or None, "city": import_text(supplier_data.get("city")) or None,
        "address": import_text(supplier_data.get("address")) or None, "website": import_text(supplier_data.get("website")) or None,
        "supplier_type": supplier_type, "export_status": export_status,
        "main_phone": import_text(supplier_data.get("main_phone") or contact_data.get("phone") or contact_data.get("mobile")) or None,
        "main_email": import_text(supplier_data.get("main_email") or contact_data.get("email")).lower() or None,
        "wechat": import_text(supplier_data.get("wechat") or contact_data.get("wechat")) or None,
        "product_keywords": supplier_data.get("product_keywords") if isinstance(supplier_data.get("product_keywords"), list) else [],
        "product_categories": supplier_data.get("product_categories") if isinstance(supplier_data.get("product_categories"), list) else [],
        "supplier_tags": supplier_data.get("tags") if isinstance(supplier_data.get("tags"), list) else [],
        "current_status": import_text(supplier_data.get("current_status")) or "待联系", "last_contact_date": source_date,
        "next_action": import_text(supplier_data.get("next_action")) or None, "next_followup_date": import_date(supplier_data.get("next_followup_date"), "supplier.next_followup_date"),
        "notes": import_text(supplier_data.get("notes")) or None, "risk_notes": import_text(supplier_data.get("risk_notes")) or None,
        "updated_at": datetime.now().isoformat(),
    }
    if not values["company_name"]: raise HTTPException(422, "supplier.company_name is required")
    if match.get("customer_id"):
        current = (await supabase(f"suppliers?id=eq.{match['customer_id']}&select=*&limit=1", token))[0]
        changed = import_nonempty(values); before = {key: current.get(key) for key in changed}
        supplier = (await supabase(f"suppliers?id=eq.{current['id']}", token, "PATCH", changed))[0]
        await add_import_effect(token, batch_id, entity_type="supplier", action="updated", record_id=supplier["id"], before_data=before, after_data=changed); supplier_action = "updated"
    else:
        supplier = (await supabase("suppliers", token, "POST", {**values, "import_batch_id": batch_id}))[0]
        await add_import_effect(token, batch_id, entity_type="supplier", action="created", record_id=supplier["id"], before_data=None, after_data=values); supplier_action = "created"
    contact = None
    if import_text(contact_data.get("name")):
        contact_values = {"supplier_id": supplier["id"], "name": import_text(contact_data.get("name")), "title": import_text(contact_data.get("title")) or None, "mobile": import_text(contact_data.get("mobile")) or None, "phone": import_text(contact_data.get("phone")) or None, "email": import_text(contact_data.get("email")) or None, "wechat": import_text(contact_data.get("wechat")) or None, "whatsapp": import_text(contact_data.get("whatsapp")) or None, "responsible_products": import_text(contact_data.get("responsible_products")) or None, "is_primary": bool(contact_data.get("is_primary")), "notes": import_text(contact_data.get("notes")) or None, "import_batch_id": batch_id}
        contact = (await supabase("supplier_contacts", token, "POST", contact_values))[0]
        await add_import_effect(token, batch_id, entity_type="supplier_contact", action="created", record_id=contact["id"], before_data=None, after_data=contact_values)
    supplier_product = None; product_data = payload.get("supplier_product") if isinstance(payload.get("supplier_product"), dict) else {}
    if import_text(product_data.get("product_name")):
        product_values = {"supplier_id": supplier["id"], "product_name": import_text(product_data.get("product_name")), "internal_keywords": product_data.get("internal_keywords") if isinstance(product_data.get("internal_keywords"), list) else [], "nl_status": "无 / 待确认", "reference_model": import_text(product_data.get("reference_model")) or None, "application": import_text(product_data.get("application")) or None, "technical_summary": import_text(product_data.get("technical_summary")) or None, "customizable": import_text(product_data.get("customizable")) if import_text(product_data.get("customizable")) in {"是", "否"} else "待确认", "sample_available": import_text(product_data.get("sample_available")) if import_text(product_data.get("sample_available")) in {"是", "否"} else "待确认", "capacity": import_text(product_data.get("capacity")) or None, "moq": import_text(product_data.get("moq")) or None, "standard_lead_time": import_text(product_data.get("standard_lead_time")) or None, "packaging": import_text(product_data.get("packaging")) or None, "export_capacity": import_text(product_data.get("export_capacity")) or "待确认", "notes": "由 AI 导入；不是正式 NL 牌号。", "import_batch_id": batch_id}
        supplier_product = (await supabase("supplier_products", token, "POST", product_values))[0]
        await add_import_effect(token, batch_id, entity_type="supplier_product", action="created", record_id=supplier_product["id"], before_data=None, after_data=product_values)
    link = None; rfq = None; link_data = payload.get("link") if isinstance(payload.get("link"), dict) else {}; rfq_data = payload.get("rfq") if isinstance(payload.get("rfq"), dict) else {}
    reference = link_data or rfq_data
    if payload.get("intent") in {"link_supplier_to_customer_project", "create_supplier_rfq"}:
        customer_name = import_text(reference.get("customer_company_name")); project_name = import_text(reference.get("project_name"))
        customer_rows = await supabase(f"customers?company_name=ilike.{quote(customer_name, safe='')}&archived_at=is.null&select=id,company_name&limit=2", token)
        if len(customer_rows) != 1: raise HTTPException(422, "supplier import must name one accessible overseas customer")
        project_rows = await supabase(f"projects?customer_id=eq.{customer_rows[0]['id']}&project_name=ilike.{quote(project_name, safe='')}&archived_at=is.null&select=id&limit=2", token)
        if len(project_rows) != 1: raise HTTPException(422, "supplier import must name one accessible customer project")
        link_values = {"customer_id": customer_rows[0]["id"], "project_id": project_rows[0]["id"], "supplier_id": supplier["id"], "supplier_product_id": supplier_product.get("id") if supplier_product else None, "customer_need": import_text(reference.get("customer_need")) or None, "reference_product": import_text(reference.get("reference_product")) or None, "match_status": import_text(reference.get("match_status")) or "待询价", "technical_match_notes": import_text(reference.get("technical_match_notes")) or None, "quote_status": import_text(reference.get("quote_status")) or None, "sample_status": import_text(reference.get("sample_status")) or None, "current_risk": import_text(reference.get("current_risk")) or None, "next_action": import_text(reference.get("next_action")) or None, "next_followup_date": import_date(reference.get("next_followup_date"), "link.next_followup_date"), "import_batch_id": batch_id}
        link = (await supabase("supplier_project_links", token, "POST", link_values))[0]
        await add_import_effect(token, batch_id, entity_type="supplier_project_link", action="created", record_id=link["id"], before_data=None, after_data=link_values)
        if payload.get("intent") == "create_supplier_rfq":
            rfq_values = {"rfq_number": await next_supplier_rfq_number(token), "customer_id": link_values["customer_id"], "project_id": link_values["project_id"], "supplier_id": supplier["id"], "supplier_product_id": supplier_product.get("id") if supplier_product else None, "demand_product": import_text(rfq_data.get("demand_product")) or "待确认", "reference_product": import_text(rfq_data.get("reference_product")) or link_values["reference_product"], "end_application": import_text(rfq_data.get("end_application")) or None, "technical_requirements": import_text(rfq_data.get("technical_requirements")) or None, "sample_quantity": import_text(rfq_data.get("sample_quantity")) or None, "expected_monthly_usage": import_text(rfq_data.get("expected_monthly_usage")) or None, "expected_annual_usage": import_text(rfq_data.get("expected_annual_usage")) or None, "destination_country": import_text(rfq_data.get("destination_country")) or None, "requested_materials": rfq_data.get("requested_materials") if isinstance(rfq_data.get("requested_materials"), list) else [], "status": import_text(rfq_data.get("status")) or "草稿", "created_date": source_date, "sent_date": import_date(rfq_data.get("sent_date"), "rfq.sent_date"), "next_followup_date": import_date(rfq_data.get("next_followup_date"), "rfq.next_followup_date"), "reply_content": import_text(rfq_data.get("reply_content")) or None, "import_batch_id": batch_id}
            rfq = (await supabase("supplier_rfqs", token, "POST", rfq_values))[0]
            await add_import_effect(token, batch_id, entity_type="supplier_rfq", action="created", record_id=rfq["id"], before_data=None, after_data=rfq_values)
    followup = None; followup_data = payload.get("follow_up") if isinstance(payload.get("follow_up"), dict) else {}
    if payload.get("intent") == "upsert_supplier_and_followup" and import_text(followup_data.get("content")):
        followup_values = {"supplier_id": supplier["id"], "date": import_date(followup_data.get("date"), "follow_up.date") or source_date, "channel": import_text(followup_data.get("channel")) or "微信", "content": import_text(followup_data.get("content")), "conclusion": import_text(followup_data.get("conclusion")) or None, "next_action": import_text(followup_data.get("next_action")) or values["next_action"], "next_followup_date": import_date(followup_data.get("next_followup_date"), "follow_up.next_followup_date") or values["next_followup_date"], "status": import_text(followup_data.get("status")) or values["current_status"], "import_batch_id": batch_id}
        followup = (await supabase("supplier_followups", token, "POST", followup_values))[0]
        await add_import_effect(token, batch_id, entity_type="supplier_followup", action="created", record_id=followup["id"], before_data=None, after_data=followup_values)
    await record_timeline_event(token, title=f"AI 导入供应商：{supplier['company_name']}", event_type="crm", source="ai_supplier_import", related_id=supplier["id"], supplier_id=supplier["id"], event_date=source_date)
    await supabase(f"import_batches?id=eq.{batch_id}", token, "PATCH", {"status": "applied", "applied_at": datetime.now().isoformat(), "preview": preview})
    return {"batch_id": batch_id, "supplier": supplier, "supplier_action": supplier_action, "supplier_product": supplier_product, "link": link, "rfq": rfq, "followup": followup}

@app.post("/api/imports/{batch_id}/apply")
async def apply_import(batch_id: str, confirmation: ImportApplyIn, authorization: str | None = Header(default=None)):
    """Apply one approved draft. Every created or changed row gets an import effect log."""
    token = bearer(authorization)
    batch_rows = await supabase(f"import_batches?id=eq.{batch_id}&select=*", token)
    if not batch_rows:
        raise HTTPException(404, "Import batch not found")
    batch = batch_rows[0]
    if batch.get("status") != "draft":
        raise HTTPException(409, "Only a draft import can be applied")
    payload = batch.get("raw_payload") or {}
    if payload.get("intent") in {"upsert_supplier", "upsert_supplier_and_followup", "create_supplier_rfq", "link_supplier_to_customer_project"}:
        return await apply_supplier_import(token, batch_id, payload, confirmation)
    preview = await build_import_preview(token, payload)
    match = preview["customer_match"]
    customer_data = payload.get("customer") or {}
    source = payload.get("source") or {}
    source_date = import_date(source.get("date"), "source.date", required=True) or str(date.today())
    selected_customer_id = confirmation.selected_customer_id or match.get("customer_id")
    if match["kind"] == "internal_forwarder" and not confirmation.selected_customer_id:
        raise HTTPException(422, "内部同事转发邮件必须人工选择真实客户，不能自动创建客户")
    if match["kind"] in ("company_manual_review", "company_ambiguous") and not (confirmation.confirm_company_match or confirmation.selected_customer_id):
        raise HTTPException(422, "公司名称匹配必须人工确认后才能更新客户")
    if match["kind"] == "company_ambiguous" and not confirmation.selected_customer_id:
        raise HTTPException(422, "请从同名客户中选择一个目标客户")

    active_customers = await supabase("customers?select=*&import_reverted=eq.false&archived_at=is.null&limit=500", token)
    if selected_customer_id:
        customer_rows = [row for row in active_customers if row["id"] == selected_customer_id]
        if not customer_rows:
            raise HTTPException(422, "所选客户不存在或已撤销")
        customer = customer_rows[0]
        customer_values = import_nonempty({
            "company_name": import_text(customer_data.get("company_name")), "country": import_text(customer_data.get("country")),
            "contact_person": import_text(customer_data.get("contact_name")), "email": import_text(customer_data.get("email")).lower(),
            "whatsapp": import_text(customer_data.get("wechat_or_whatsapp")), "industry": import_text(customer_data.get("industry")),
            "customer_summary": import_text(customer_data.get("summary")), "customer_background": import_text(customer_data.get("background")),
            "customer_need": import_text(customer_data.get("current_need")), "priority": {"high": "HIGH", "medium": "MEDIUM", "low": "MEDIUM"}.get(import_key(customer_data.get("priority")), import_text(customer_data.get("priority"))),
            "customer_value": customer_data.get("customer_value") if isinstance(customer_data.get("customer_value"), int) else None,
            "customer_stage": import_text(customer_data.get("stage")), "status_label": import_text(customer_data.get("status_text")),
            "customer_tags": customer_data.get("tags") if isinstance(customer_data.get("tags"), list) else None,
            "next_action": [import_text(customer_data.get("next_action"))] if import_text(customer_data.get("next_action")) else None,
            "next_followup_date": import_date(customer_data.get("next_follow_up_date"), "customer.next_follow_up_date"),
            "last_contact_date": source_date,
        })
        # A forwarded internal address may identify context, but it must never
        # overwrite the real customer's CRM email.
        if is_internal_mail_address(import_text(customer_data.get("email") or (payload.get("match") or {}).get("customer_email"))):
            customer_values.pop("email", None)
        before = {key: customer.get(key) for key in customer_values}
        customer = (await supabase(f"customers?id=eq.{customer['id']}", token, "PATCH", customer_values))[0]
        await add_import_effect(token, batch_id, entity_type="customer", action="updated", record_id=customer["id"], before_data=before, after_data=customer_values)
        customer_action = "updated"
    else:
        company_name = import_text(customer_data.get("company_name") or (payload.get("match") or {}).get("company_name"))
        email = import_text(customer_data.get("email") or (payload.get("match") or {}).get("customer_email")).lower()
        if not company_name:
            raise HTTPException(422, "新建客户必须提供 company_name")
        if is_internal_mail_address(email):
            raise HTTPException(422, "内部同事邮箱不能创建为客户")
        customer_values = {
            "company_name": company_name, "country": import_text(customer_data.get("country")) or "待确认",
            "contact_person": import_text(customer_data.get("contact_name")) or "待确认", "email": email or "待确认",
            "whatsapp": import_text(customer_data.get("wechat_or_whatsapp")) or None, "industry": import_text(customer_data.get("industry")) or None,
            "customer_summary": import_text(customer_data.get("summary")) or None, "customer_background": import_text(customer_data.get("background")) or None,
            "customer_need": import_text(customer_data.get("current_need")) or None,
            "priority": {"high": "HIGH", "medium": "MEDIUM", "low": "MEDIUM"}.get(import_key(customer_data.get("priority")), "MEDIUM"),
            "customer_value": customer_data.get("customer_value") if isinstance(customer_data.get("customer_value"), int) else 3,
            "customer_stage": import_text(customer_data.get("stage")) or "New", "status_label": import_text(customer_data.get("status_text")) or None,
            "customer_tags": customer_data.get("tags") if isinstance(customer_data.get("tags"), list) else [],
            "next_action": [import_text(customer_data.get("next_action"))] if import_text(customer_data.get("next_action")) else [],
            "next_followup_date": import_date(customer_data.get("next_follow_up_date"), "customer.next_follow_up_date"),
            "last_contact_date": source_date, "import_batch_id": batch_id,
        }
        customer = (await supabase("customers", token, "POST", customer_values))[0]
        await add_import_effect(token, batch_id, entity_type="customer", action="created", record_id=customer["id"], before_data=None, after_data=customer_values)
        customer_action = "created"

    product_refs = payload.get("product_refs") or []
    product_records: list[dict[str, Any]] = []
    active_products = await supabase("products?select=*&import_reverted=eq.false&archived_at=is.null&limit=500", token)
    for product_data in product_refs:
        code = import_text(product_data.get("code")).upper()
        existing = next((row for row in active_products if import_key(row.get("product_code")) == import_key(code)), None)
        values = import_nonempty({"product_name": import_text(product_data.get("name")) or code, "product_code": code, "category": import_text(product_data.get("category")), "application": import_text(product_data.get("application"))})
        if existing:
            before = {key: existing.get(key) for key in values}
            product = (await supabase(f"products?id=eq.{existing['id']}", token, "PATCH", values))[0]
            await add_import_effect(token, batch_id, entity_type="product", action="updated", record_id=product["id"], before_data=before, after_data=values)
        else:
            product = (await supabase("products", token, "POST", {**values, "notes": "由 AI 导入暂存箱创建", "import_batch_id": batch_id}))[0]
            await add_import_effect(token, batch_id, entity_type="product", action="created", record_id=product["id"], before_data=None, after_data=values)
        product_records.append(product)
        relation_rows = await supabase(f"product_customer_relations?product_id=eq.{product['id']}&customer_id=eq.{customer['id']}&select=*&limit=1", token)
        if not relation_rows:
            relation = (await supabase("product_customer_relations", token, "POST", {"product_id": product["id"], "customer_id": customer["id"], "import_batch_id": batch_id}))[0]
            await add_import_effect(token, batch_id, entity_type="product_customer_relation", action="created", record_id=relation["id"], before_data=None, after_data={"product_id": product["id"], "customer_id": customer["id"]})

    product = product_records[0] if product_records else None
    project_data = payload.get("project") or {}
    project = None
    project_name = import_text(project_data.get("name"))
    if project_name:
        project_rows = await supabase(f"projects?customer_id=eq.{customer['id']}&import_reverted=eq.false&archived_at=is.null&select=*", token)
        existing_project = next((row for row in project_rows if import_key(row.get("project_name")) == import_key(project_name)), None)
        project_values = import_nonempty({"project_name": project_name, "product_id": product.get("id") if product else None, "application": import_text(project_data.get("application")), "stage": import_text(project_data.get("stage")) or import_text(customer_data.get("stage")), "notes": import_text(project_data.get("notes"))})
        if existing_project:
            before = {key: existing_project.get(key) for key in project_values}
            project = (await supabase(f"projects?id=eq.{existing_project['id']}", token, "PATCH", project_values))[0]
            await add_import_effect(token, batch_id, entity_type="project", action="updated", record_id=project["id"], before_data=before, after_data=project_values)
        else:
            project = (await supabase("projects", token, "POST", {**project_values, "customer_id": customer["id"], "import_batch_id": batch_id}))[0]
            await add_import_effect(token, batch_id, entity_type="project", action="created", record_id=project["id"], before_data=None, after_data=project_values)

    followup_data = payload.get("follow_up") or {}
    followup = None
    if import_text(followup_data.get("content")):
        followup_values = {"customer_id": customer["id"], "date": import_date(followup_data.get("date"), "follow_up.date") or source_date, "content": import_text(followup_data.get("content")), "next_action": import_text(followup_data.get("next_action")) or import_text(customer_data.get("next_action")) or "安排下一步行动", "status": import_text(followup_data.get("status")) or "Open", "import_batch_id": batch_id}
        followup = (await supabase("followups", token, "POST", followup_values))[0]
        await add_import_effect(token, batch_id, entity_type="followup", action="created", record_id=followup["id"], before_data=None, after_data=followup_values)

    task_data = payload.get("task") or {}
    task = None
    if task_data.get("create") is True:
        title = import_text(task_data.get("title"))
        if not title:
            raise HTTPException(422, "task.title is required when task.create is true")
        task_values = {"title": title, "description": import_text(task_data.get("description")) or None, "category": import_text(task_data.get("category")) or "外贸", "priority": {"重要": "important", "普通": "normal", "低": "low"}.get(import_text(task_data.get("priority")), "normal"), "status": "Pending", "task_date": import_date(task_data.get("due_date"), "task.due_date") or source_date, "customer_id": customer["id"], "project_id": project.get("id") if project else None, "product_id": product.get("id") if product else None, "import_batch_id": batch_id}
        task = (await supabase("tasks", token, "POST", task_values))[0]
        await add_import_effect(token, batch_id, entity_type="task", action="created", record_id=task["id"], before_data=None, after_data=task_values)

    timeline_values = {"event_date": source_date, "event_time": datetime.now().strftime("%H:%M:%S"), "title": f"AI 导入确认：{customer.get('company_name')} · {import_text(followup_data.get('content')) or import_text(customer_data.get('next_action')) or '更新客户资料'}", "event_type": "crm", "source": "ai_import", "related_id": followup.get("id") if followup else customer["id"], "customer_id": customer["id"], "project_id": project.get("id") if project else None, "product_id": product.get("id") if product else None, "import_batch_id": batch_id}
    timeline = (await supabase("timeline_events", token, "POST", timeline_values))[0]
    await add_import_effect(token, batch_id, entity_type="timeline", action="created", record_id=timeline["id"], before_data=None, after_data=timeline_values)
    await supabase(f"import_batches?id=eq.{batch_id}", token, "PATCH", {"status": "applied", "applied_at": datetime.now().isoformat(), "preview": preview})
    return {"batch_id": batch_id, "customer": customer, "customer_action": customer_action, "project": project, "products": product_records, "followup": followup, "task": task}

@app.post("/api/imports/{batch_id}/revert")
async def revert_import(batch_id: str, authorization: str | None = Header(default=None)):
    """Reverse one batch without hard-deleting any business row."""
    token = bearer(authorization)
    batch_rows = await supabase(f"import_batches?id=eq.{batch_id}&select=*", token)
    if not batch_rows:
        raise HTTPException(404, "Import batch not found")
    if batch_rows[0].get("status") != "applied":
        raise HTTPException(409, "Only an applied import can be reverted")
    effects = await supabase(f"import_effects?import_batch_id=eq.{batch_id}&reverted_at=is.null&select=*&order=created_at.desc", token)
    table_by_entity = {
        "customer": "customers", "project": "projects", "product": "products",
        "product_customer_relation": "product_customer_relations", "followup": "followups",
        "task": "tasks", "timeline": "timeline_events", "supplier": "suppliers",
        "supplier_contact": "supplier_contacts", "supplier_product": "supplier_products",
        "supplier_followup": "supplier_followups", "supplier_project_link": "supplier_project_links",
        "supplier_rfq": "supplier_rfqs",
    }
    now = datetime.now().isoformat()
    for effect in effects:
        table = table_by_entity.get(effect["entity_type"])
        if not table:
            continue
        if effect["action"] == "updated":
            before = effect.get("before_data") or {}
            if before:
                await supabase(f"{table}?id=eq.{effect['record_id']}", token, "PATCH", before)
        else:
            await supabase(f"{table}?id=eq.{effect['record_id']}", token, "PATCH", {"import_reverted": True})
        await supabase(f"import_effects?id=eq.{effect['id']}", token, "PATCH", {"reverted_at": now})
    await supabase(f"import_batches?id=eq.{batch_id}", token, "PATCH", {"status": "reverted", "reverted_at": now})
    return {"batch_id": batch_id, "reverted_effects": len(effects), "message": "已撤销本次导入影响；业务记录未被硬删除。"}

@app.get("/api/quotes")
async def list_quotes(authorization: str | None = Header(default=None)):
    return await supabase("quotes?select=*&archived_at=is.null&order=created_at.desc", bearer(authorization))

async def require_quote(token: str, quote_id: str) -> dict[str, Any]:
    rows = await supabase(f"quotes?id=eq.{quote(quote_id, safe='')}&archived_at=is.null&select=*&limit=1", token)
    if not rows:
        raise HTTPException(404, "Quotation not found")
    return rows[0]

def new_quote_number() -> str:
    # Timestamp plus microseconds avoids depending on a mutable global counter.
    return datetime.now().strftime("QT-%Y%m%d-%H%M%S-%f")

def quote_send_evidence(payload: dict[str, Any], *, current: dict[str, Any] | None = None) -> dict[str, Any]:
    """Only a linked real email or an explicit manual confirmation can mark a quote sent."""
    result = dict(payload)
    status = result.get("status", current.get("status") if current else "草稿")
    source_email_id = result.get("source_email_id", current.get("source_email_id") if current else None)
    manual_confirmed = bool(result.pop("manual_send_confirmed", False))
    manual_note = result.get("manual_send_note") or (current or {}).get("manual_send_note")
    if manual_confirmed:
        if not manual_note:
            raise HTTPException(422, "请填写实际发送的人工确认说明，不能仅凭推测标记已发送。")
        result["manual_send_confirmed_at"] = datetime.now().isoformat()
        result["send_evidence_type"] = "manual_confirmation"
    if status in {"已发送", "客户议价", "已接受"}:
        if source_email_id:
            result["send_evidence_type"] = "linked_email"
            result.setdefault("sent_at", datetime.now().isoformat())
        elif not (result.get("manual_send_confirmed_at") or (current or {}).get("manual_send_confirmed_at")):
            raise HTTPException(422, "只有关联真实邮件或填写人工发送确认后，才能将报价标记为已发送、议价或已接受。")
    return result

@app.post("/api/quotes", status_code=201)
async def create_quote(quote_data: QuoteIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    payload = quote_data.model_dump(exclude_none=True)
    payload = quote_send_evidence(payload)
    payload.pop("manual_send_confirmed", None)
    payload.update({"quote_number": new_quote_number(), "version": 1, "updated_at": datetime.now().isoformat()})
    return await supabase("quotes", token, "POST", payload)

@app.patch("/api/quotes/{quote_id}")
async def update_quote(quote_id: str, quote_data: QuoteUpdateIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    current = await require_quote(token, quote_id)
    payload = quote_data.model_dump(exclude_none=True)
    payload = quote_send_evidence(payload, current=current)
    payload.pop("manual_send_confirmed", None)
    payload["updated_at"] = datetime.now().isoformat()
    return (await supabase(f"quotes?id=eq.{quote(quote_id, safe='')}", token, "PATCH", payload))[0]

@app.post("/api/quotes/{quote_id}/revisions", status_code=201)
async def create_quote_revision(quote_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    current = await require_quote(token, quote_id)
    revision = {key: value for key, value in current.items() if key not in {
        "id", "created_at", "updated_at", "archived_at", "merged_into_quote_id", "archive_reason", "converted_order_id",
        "status", "sent_at", "send_evidence_type", "manual_send_confirmed_at", "manual_send_note", "source_email_id",
    }}
    revision.update({
        "quote_number": current["quote_number"], "version": int(current.get("version") or 1) + 1,
        "revision_of_quote_id": current["id"], "status": "草稿", "quantity": current.get("quantity") or "待确认",
        "source_evidence_summary": f"基于 {current['quote_number']} V{current.get('version') or 1} 建立的修订草稿；须重新确认并发送。",
        "updated_at": datetime.now().isoformat(),
    })
    return await supabase("quotes", token, "POST", revision)

@app.get("/api/orders")
async def list_orders(authorization: str | None = Header(default=None)):
    return await supabase("sales_orders?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/quotes/{quote_id}/convert-order", status_code=201)
async def convert_quote_to_order(quote_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    record = await require_quote(token, quote_id)
    if record.get("converted_order_id"):
        raise HTTPException(409, "This quotation has already been converted to an order.")
    if record.get("status") != "已接受":
        raise HTTPException(422, "只有已接受且具有真实发送凭证的正式报价才能转为订单。")
    order_number = datetime.now().strftime("SO-%Y%m%d-%H%M%S-%f")
    order_payload = {key: record.get(key) for key in (
        "customer_id", "project_id", "product_id", "product_code", "product_name_snapshot", "specification", "packaging",
        "quantity", "quantity_unit", "unit_price", "amount", "currency", "incoterm", "loading_port", "destination_port",
        "lead_time", "payment_terms",
    )}
    order_payload.update({"order_number": order_number, "quote_id": record["id"], "status": "待PI/合同确认", "execution_notes": "由已接受正式报价转换；请补充真实 PI、付款、生产与出运记录。", "updated_at": datetime.now().isoformat()})
    order = (await supabase("sales_orders", token, "POST", order_payload))[0]
    await supabase(f"quotes?id=eq.{quote(quote_id, safe='')}", token, "PATCH", {"converted_order_id": order["id"], "updated_at": datetime.now().isoformat()})
    return order

@app.post("/api/quotes/import-mail-drafts")
async def import_mail_quote_drafts(authorization: str | None = Header(default=None)):
    """Create review-only drafts from existing quotation-related mails.

    This never parses or invents price, quantity, Incoterms or sending status.
    A draft is created only for an already-linked external customer mail and keeps
    the email as its evidence reference for the user's review.
    """
    token = bearer(authorization)
    emails = await supabase("emails?select=*&customer_id=not.is.null&order=received_at.desc&limit=500", token)
    existing = await supabase("quotes?select=source_email_id&source_email_id=not.is.null", token)
    imported = {row.get("source_email_id") for row in existing}
    quotation_pattern = re.compile(r"\b(quotation|quote|proforma|price|pricing|pi)\b|报价|价格", re.IGNORECASE)
    created: list[dict[str, Any]] = []
    skipped = 0
    for email in emails:
        if email.get("id") in imported or email.get("is_internal_sender"):
            skipped += 1
            continue
        text = " ".join(str(email.get(key) or "") for key in ("subject", "content_preview", "content_text"))
        if email.get("category") != "quotation" and not quotation_pattern.search(text):
            skipped += 1
            continue
        source = f"邮件证据：{str(email.get('received_at') or '')[:10]} · {str(email.get('subject') or '(无主题)')[:300]}。仅据此创建草稿，金额、数量、条款和发送状态均待人工确认。"
        payload = {
            "customer_id": email["customer_id"], "project_id": email.get("project_id"), "product_id": email.get("product_id"),
            "quote_number": new_quote_number(), "version": 1, "quantity": "待确认", "currency": "USD", "status": "草稿",
            "source_email_id": email["id"], "source_evidence_summary": source, "internal_notes": "由邮件中心自动建立的待核对报价草稿；未自动提取商业条款。",
            "updated_at": datetime.now().isoformat(),
        }
        rows = await supabase("quotes", token, "POST", payload)
        created.append(rows[0])
    return {"created": len(created), "skipped": skipped, "quotes": created, "message": "仅创建草稿；请逐条补全并以真实邮件或人工发送确认后再标记已发送。"}

# Supplier Center -----------------------------------------------------------
# Supplier products are intentionally separate from public.products.  A formal
# product link is optional and cannot be inferred from a supplier reference.

async def require_supplier(token: str, supplier_id: str) -> dict[str, Any]:
    rows = await supabase(f"suppliers?id=eq.{supplier_id}&archived_at=is.null&import_reverted=eq.false&select=*&limit=1", token)
    if not rows:
        raise HTTPException(404, "Supplier not found")
    return rows[0]

async def require_customer_project(token: str, customer_id: str, project_id: str) -> dict[str, Any]:
    rows = await supabase(f"projects?id=eq.{project_id}&customer_id=eq.{customer_id}&archived_at=is.null&import_reverted=eq.false&select=*&limit=1", token)
    if not rows:
        raise HTTPException(422, "Customer project was not found or is not accessible")
    return rows[0]

@app.get("/api/suppliers")
async def list_suppliers(authorization: str | None = Header(default=None), limit: int = Query(500, le=500)):
    return await supabase(f"suppliers?select=*&archived_at=is.null&import_reverted=eq.false&order=next_followup_date.asc.nullslast,created_at.desc&limit={limit}", bearer(authorization))

@app.post("/api/suppliers", status_code=201)
async def create_supplier(payload: SupplierIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    company = payload.company_name.strip()
    existing = await supabase(f"suppliers?company_name=ilike.{quote(company, safe='')}&archived_at=is.null&import_reverted=eq.false&select=id,company_name,main_email,main_phone&limit=20", token)
    email = import_key(payload.main_email)
    phone = import_key(payload.main_phone)
    duplicate = next((row for row in existing if not email and not phone or (email and import_key(row.get('main_email')) == email) or (phone and import_key(row.get('main_phone')) == phone)), None)
    if duplicate:
        raise HTTPException(409, f"Supplier may already exist: {duplicate['company_name']}. Please open and update the existing supplier instead.")
    rows = await supabase("suppliers", token, "POST", {**payload.model_dump(exclude_none=True), "company_name": company, "updated_at": datetime.now().isoformat()})
    await record_timeline_event(token, title=f"新增供应商：{company}", event_type="crm", source="supplier", related_id=rows[0]["id"], supplier_id=rows[0]["id"])
    return rows[0]

@app.patch("/api/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, payload: SupplierUpdateIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    await require_supplier(token, supplier_id)
    rows = await supabase(f"suppliers?id=eq.{supplier_id}", token, "PATCH", {**payload.model_dump(exclude_none=True), "company_name": payload.company_name.strip(), "updated_at": datetime.now().isoformat()})
    return rows[0]

@app.delete("/api/suppliers/{supplier_id}")
async def archive_supplier(supplier_id: str, authorization: str | None = Header(default=None)):
    """Hide a supplier from active work without destroying supply-chain evidence."""
    token = bearer(authorization)
    supplier = await require_supplier(token, supplier_id)
    linked = await supabase(f"supplier_project_links?supplier_id=eq.{supplier_id}&select=id&limit=500", token)
    rfqs = await supabase(f"supplier_rfqs?supplier_id=eq.{supplier_id}&select=id&limit=500", token)
    await supabase(
        f"suppliers?id=eq.{supplier_id}", token, "PATCH",
        {"archived_at": datetime.now().isoformat(), "updated_at": datetime.now().isoformat()},
    )
    await record_timeline_event(
        token, title=f"归档供应商：{supplier['company_name']}", event_type="crm",
        source="supplier", related_id=supplier_id, supplier_id=supplier_id,
    )
    return {
        "deleted": True, "supplier_id": supplier_id,
        "linked_projects": len(linked), "rfqs": len(rfqs),
        "message": "供应商已从当前列表移除；已关联项目、询价、资料和跟进记录均已保留。",
    }

@app.get("/api/suppliers/{supplier_id}/contacts")
async def list_supplier_contacts(supplier_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await require_supplier(token, supplier_id)
    return await supabase(f"supplier_contacts?supplier_id=eq.{supplier_id}&select=*&order=is_primary.desc,created_at.asc", token)

@app.post("/api/supplier-contacts", status_code=201)
async def create_supplier_contact(payload: SupplierContactIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await require_supplier(token, payload.supplier_id)
    if payload.is_primary:
        await supabase(f"supplier_contacts?supplier_id=eq.{payload.supplier_id}&is_primary=eq.true", token, "PATCH", {"is_primary": False})
    rows = await supabase("supplier_contacts", token, "POST", payload.model_dump(exclude_none=True))
    return rows[0]

@app.get("/api/suppliers/{supplier_id}/products")
async def list_supplier_products(supplier_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await require_supplier(token, supplier_id)
    return await supabase(f"supplier_products?supplier_id=eq.{supplier_id}&select=*&order=created_at.desc", token)

@app.post("/api/supplier-products", status_code=201)
async def create_supplier_product(payload: SupplierProductIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await require_supplier(token, payload.supplier_id)
    # Never allow a formal product id unless the caller explicitly marked it confirmed.
    if payload.nl_product_id and payload.nl_status != "已确认关联":
        raise HTTPException(422, "A formal NL product can be linked only after explicit confirmation")
    if payload.nl_product_id:
        product = await supabase(f"products?id=eq.{payload.nl_product_id}&archived_at=is.null&select=id,product_code&limit=1", token)
        if not product or not str(product[0].get("product_code") or "").upper().startswith("NL-"):
            raise HTTPException(422, "nl_product_id must refer to an existing formal NL product")
    rows = await supabase("supplier_products", token, "POST", payload.model_dump(exclude_none=True))
    return rows[0]

@app.get("/api/suppliers/{supplier_id}/followups")
async def list_supplier_followups(supplier_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await require_supplier(token, supplier_id)
    return await supabase(f"supplier_followups?supplier_id=eq.{supplier_id}&select=*&order=date.desc,created_at.desc", token)

@app.post("/api/supplier-followups", status_code=201)
async def create_supplier_followup(payload: SupplierFollowupIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await require_supplier(token, payload.supplier_id)
    values = payload.model_dump(exclude_none=True, exclude={"create_task"})
    rows = await supabase("supplier_followups", token, "POST", values)
    supplier = (await supabase(f"suppliers?id=eq.{payload.supplier_id}", token, "PATCH", {
        "current_status": payload.status, "last_contact_date": payload.date,
        "next_action": payload.next_action, "next_followup_date": payload.next_followup_date,
        "updated_at": datetime.now().isoformat(),
    }))[0]
    task = None
    if payload.create_task and payload.next_followup_date:
        task_rows = await supabase("tasks", token, "POST", {
            "title": f"跟进供应商：{supplier['company_name']}", "description": payload.next_action or payload.content,
            "category": "外贸", "priority": "normal", "status": "Pending", "task_date": payload.next_followup_date,
            "supplier_id": payload.supplier_id,
        })
        task = task_rows[0]
    await record_timeline_event(token, title=f"供应商跟进：{supplier['company_name']} · {payload.content[:80]}", event_type="crm", source="supplier_followup", related_id=rows[0]["id"], supplier_id=payload.supplier_id, event_date=payload.date)
    return {"followup": rows[0], "supplier": supplier, "task": task}

@app.get("/api/supplier-project-links")
async def list_supplier_project_links(authorization: str | None = Header(default=None), project_id: str | None = None, supplier_id: str | None = None):
    filters = ["select=*", "order=next_followup_date.asc.nullslast,created_at.desc"]
    if project_id: filters.append(f"project_id=eq.{project_id}")
    if supplier_id: filters.append(f"supplier_id=eq.{supplier_id}")
    return await supabase(f"supplier_project_links?{'&'.join(filters)}", bearer(authorization))

@app.post("/api/supplier-project-links", status_code=201)
async def create_supplier_project_link(payload: SupplierProjectLinkIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    await require_supplier(token, payload.supplier_id)
    await require_customer_project(token, payload.customer_id, payload.project_id)
    if payload.supplier_product_id:
        products = await supabase(f"supplier_products?id=eq.{payload.supplier_product_id}&supplier_id=eq.{payload.supplier_id}&select=id&limit=1", token)
        if not products: raise HTTPException(422, "Supplier product does not belong to this supplier")
    existing = await supabase(f"supplier_project_links?project_id=eq.{payload.project_id}&supplier_id=eq.{payload.supplier_id}&supplier_product_id={'eq.' + payload.supplier_product_id if payload.supplier_product_id else 'is.null'}&select=*&limit=1", token)
    values = {**payload.model_dump(exclude_none=True), "updated_at": datetime.now().isoformat()}
    if existing:
        rows = await supabase(f"supplier_project_links?id=eq.{existing[0]['id']}", token, "PATCH", values)
        return rows[0]
    rows = await supabase("supplier_project_links", token, "POST", values)
    await record_timeline_event(token, title="关联供应商至客户项目", event_type="project", source="supplier_link", related_id=rows[0]["id"], customer_id=payload.customer_id, project_id=payload.project_id, supplier_id=payload.supplier_id)
    return rows[0]

async def next_supplier_rfq_number(token: str) -> str:
    prefix = f"SUP-RFQ-{date.today().strftime('%Y%m%d')}-"
    rows = await supabase(f"supplier_rfqs?rfq_number=like.{prefix}*&select=rfq_number&limit=500", token)
    numbers = [int(str(row.get("rfq_number") or "").rsplit("-", 1)[-1]) for row in rows if str(row.get("rfq_number") or "").rsplit("-", 1)[-1].isdigit()]
    return f"{prefix}{max(numbers, default=0) + 1:03d}"

@app.get("/api/supplier-rfqs")
async def list_supplier_rfqs(authorization: str | None = Header(default=None), supplier_id: str | None = None, project_id: str | None = None):
    filters = ["select=*", "order=created_date.desc,created_at.desc"]
    if supplier_id: filters.append(f"supplier_id=eq.{supplier_id}")
    if project_id: filters.append(f"project_id=eq.{project_id}")
    return await supabase(f"supplier_rfqs?{'&'.join(filters)}", bearer(authorization))

@app.get("/api/supplier-insights")
async def supplier_insights(authorization: str | None = Header(default=None)):
    """Small aggregated facts for the supplier list; every source is still RLS-scoped."""
    token = bearer(authorization)
    documents = await supabase("supplier_documents?select=supplier_id,document_type&limit=5000", token)
    products = await supabase("supplier_products?select=supplier_id,sample_available&limit=5000", token)
    rfqs = await supabase("supplier_rfqs?select=supplier_id,status&limit=5000", token)
    links = await supabase("supplier_project_links?select=supplier_id&limit=5000", token)
    by_supplier: dict[str, dict[str, Any]] = {}
    def insight(supplier_id: str) -> dict[str, Any]:
        return by_supplier.setdefault(supplier_id, {"supplier_id": supplier_id, "document_count": 0, "tds_count": 0, "sample_available": False, "effective_quote_count": 0, "project_link_count": 0})
    for row in documents:
        item = insight(row["supplier_id"]); item["document_count"] += 1
        if row.get("document_type") == "TDS": item["tds_count"] += 1
        if row.get("document_type") == "报价单": item["effective_quote_count"] += 1
    for row in products:
        if row.get("sample_available") == "是": insight(row["supplier_id"])["sample_available"] = True
    for row in rfqs:
        if row.get("status") in {"供应商已回复", "技术评估"}: insight(row["supplier_id"])["effective_quote_count"] += 1
    for row in links: insight(row["supplier_id"])["project_link_count"] += 1
    return list(by_supplier.values())

@app.post("/api/supplier-rfqs", status_code=201)
async def create_supplier_rfq(payload: SupplierRfqIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    await require_supplier(token, payload.supplier_id)
    await require_customer_project(token, payload.customer_id, payload.project_id)
    if payload.supplier_product_id:
        products = await supabase(f"supplier_products?id=eq.{payload.supplier_product_id}&supplier_id=eq.{payload.supplier_id}&select=id&limit=1", token)
        if not products: raise HTTPException(422, "Supplier product does not belong to this supplier")
    values = payload.model_dump(exclude_none=True)
    values["rfq_number"] = await next_supplier_rfq_number(token)
    values["created_date"] = str(date.today())
    values["updated_at"] = datetime.now().isoformat()
    rows = await supabase("supplier_rfqs", token, "POST", values)
    await record_timeline_event(token, title=f"创建供应商 RFQ：{values['rfq_number']}", event_type="project", source="supplier_rfq", related_id=rows[0]["id"], customer_id=payload.customer_id, project_id=payload.project_id, supplier_id=payload.supplier_id, supplier_rfq_id=rows[0]["id"])
    return rows[0]

async def supplier_storage_upload(path: str, content: bytes, mime_type: str | None) -> None:
    cfg = settings()
    headers = {"apikey": cfg.supabase_service_role_key, "Authorization": f"Bearer {cfg.supabase_service_role_key}", "Content-Type": mime_type or "application/octet-stream", "x-upsert": "false"}
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(f"{cfg.supabase_url}/storage/v1/object/supplier-documents/{quote(path, safe='/')}", headers=headers, content=content)
    if response.status_code >= 400: raise HTTPException(502, "Supplier document upload failed")

async def supplier_storage_signed_url(path: str) -> str:
    cfg = settings()
    headers = {"apikey": cfg.supabase_service_role_key, "Authorization": f"Bearer {cfg.supabase_service_role_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(f"{cfg.supabase_url}/storage/v1/object/sign/supplier-documents/{quote(path, safe='/')}", headers=headers, json={"expiresIn": 3600})
    if response.status_code >= 400: raise HTTPException(502, "Supplier document preview could not be created")
    signed_path = response.json().get("signedURL")
    if not signed_path: raise HTTPException(502, "Supplier document preview could not be created")
    return f"{cfg.supabase_url}/storage/v1{signed_path}"

@app.get("/api/suppliers/{supplier_id}/documents")
async def list_supplier_documents(supplier_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization); await require_supplier(token, supplier_id)
    return await supabase(f"supplier_documents?supplier_id=eq.{supplier_id}&select=*&order=uploaded_at.desc", token)

@app.post("/api/supplier-documents", status_code=201)
async def upload_supplier_document(
    supplier_id: str = Form(...), document_type: str = Form(...), file: UploadFile = File(...),
    supplier_product_id: str | None = Form(default=None), project_id: str | None = Form(default=None),
    rfq_id: str | None = Form(default=None), source: str = Form(default="手动上传"), internal_notes: str | None = Form(default=None),
    authorization: str | None = Header(default=None),
):
    token = bearer(authorization); await require_supplier(token, supplier_id)
    allowed = {"TDS", "SDS", "COA", "报价单", "产品图片", "认证文件", "邮件附件", "其他资料"}
    if document_type not in allowed: raise HTTPException(422, "Unsupported supplier document type")
    content = await file.read()
    if not content or len(content) > 25 * 1024 * 1024: raise HTTPException(422, "Document must be between 1 byte and 25 MB")
    safe_name = "".join(character if character.isalnum() or character in ".-_" else "_" for character in (file.filename or "document"))
    storage_path = f"{supplier_id}/{datetime.now().strftime('%Y%m%d%H%M%S%f')}-{safe_name}"
    await supplier_storage_upload(storage_path, content, file.content_type)
    rows = await supabase("supplier_documents", token, "POST", {"supplier_id": supplier_id, "supplier_product_id": supplier_product_id, "project_id": project_id, "rfq_id": rfq_id, "document_type": document_type, "file_name": file.filename or safe_name, "storage_path": storage_path, "mime_type": file.content_type, "file_size": len(content), "source": source, "internal_notes": internal_notes})
    return rows[0]

@app.get("/api/supplier-documents/{document_id}/preview")
async def preview_supplier_document(document_id: str, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase(f"supplier_documents?id=eq.{document_id}&select=*&limit=1", token)
    if not rows: raise HTTPException(404, "Supplier document not found")
    return {"url": await supplier_storage_signed_url(rows[0]["storage_path"]), "file_name": rows[0]["file_name"], "mime_type": rows[0].get("mime_type")}

@app.get("/api/emails")
async def list_emails(
    authorization: str | None = Header(default=None), limit: int = Query(500, le=500),
    category: Literal["customer_inquiry", "technical", "quotation", "sample", "payment", "other"] | None = None,
    status: Literal["unread", "new_lead", "linked", "followup_created", "completed"] | None = None,
    unlinked: bool = False,
):
    filters = ["select=*", "order=received_at.desc", f"limit={limit}"]
    if category:
        filters.append(f"category=eq.{category}")
    if status:
        filters.append(f"status=eq.{status}")
    if unlinked:
        filters.append("customer_id=is.null")
    rows = await supabase(f"emails?{'&'.join(filters)}", bearer(authorization))
    return [{**row, "is_internal_sender": is_internal_mail_address(row.get("sender"))} for row in rows]

@app.get("/api/emails/unlinked")
async def list_unlinked_emails(authorization: str | None = Header(default=None), limit: int = Query(200, le=200)):
    rows = await supabase(f"emails?customer_id=is.null&select=*&order=received_at.desc&limit={limit}", bearer(authorization))
    return [{**row, "is_internal_sender": is_internal_mail_address(row.get("sender"))} for row in rows]

@app.get("/api/emails/{email_id}")
async def get_email(email_id: str, authorization: str | None = Header(default=None)):
    rows = await supabase(f"emails?id=eq.{email_id}&select=*", bearer(authorization))
    if not rows:
        raise HTTPException(404, "Email not found")
    return {**rows[0], "is_internal_sender": is_internal_mail_address(rows[0].get("sender"))}

@app.get("/api/mail-ai-fact-cards")
async def list_email_ai_fact_cards(email_ids: str = Query(default=""), authorization: str | None = Header(default=None)):
    """Fetch saved cards only; this endpoint never calls an AI provider."""
    token = bearer(authorization)
    ids = [item.strip() for item in email_ids.split(",") if re.fullmatch(r"[0-9a-fA-F-]{36}", item.strip())]
    if not ids:
        return []
    if len(ids) > 120:
        raise HTTPException(422, "Too many email ids")
    return await supabase(f"mail_ai_fact_cards?email_id=in.({','.join(ids)})&select=*", token)

@app.get("/api/emails/{email_id}/ai-fact-card")
async def get_email_ai_fact_card(email_id: str, authorization: str | None = Header(default=None)):
    """Read a previously generated card. This does not call an AI provider."""
    token = bearer(authorization)
    email_rows = await supabase(f"emails?id=eq.{quote(email_id, safe='')}&select=id&limit=1", token)
    if not email_rows:
        raise HTTPException(404, "Email not found")
    rows = await supabase(f"mail_ai_fact_cards?email_id=eq.{quote(email_id, safe='')}&select=*&limit=1", token)
    return rows[0] if rows else None

@app.post("/api/emails/{email_id}/ai-fact-card")
async def create_email_ai_fact_card(email_id: str, authorization: str | None = Header(default=None)):
    """Explicit user action only: send one email body to SiliconFlow for review."""
    token = bearer(authorization)
    email_rows = await supabase(f"emails?id=eq.{quote(email_id, safe='')}&select=*&limit=1", token)
    if not email_rows:
        raise HTTPException(404, "Email not found")
    email = email_rows[0]
    facts = await generate_siliconflow_mail_facts(email)
    source_hash = hashlib.sha256(_mail_text_for_ai(email).encode("utf-8")).hexdigest()
    confidence = facts.get("confidence") if isinstance(facts.get("confidence"), (int, float)) else None
    values = {
        "email_id": email_id,
        "provider": "siliconflow",
        "model": settings().siliconflow_model,
        "prompt_version": "mail-facts-v1",
        "source_hash": source_hash,
        "chinese_summary": str(facts.get("chinese_summary") or "AI 未返回可用中文摘要。"),
        "facts": facts,
        "confidence": confidence,
        "status": "待审核",
        "review_note": None,
        "reviewed_at": None,
        "updated_at": datetime.utcnow().isoformat(),
    }
    existing = await supabase(f"mail_ai_fact_cards?email_id=eq.{quote(email_id, safe='')}&select=id&limit=1", token)
    if existing:
        rows = await supabase(f"mail_ai_fact_cards?id=eq.{existing[0]['id']}", token, "PATCH", values)
    else:
        rows = await supabase("mail_ai_fact_cards", token, "POST", values)
    return rows[0]

@app.post("/api/emails/{email_id}/reply-draft")
async def create_email_reply_draft(email_id: str, payload: MailReplyDraftIn, authorization: str | None = Header(default=None)):
    """An explicit, review-only AI action. The draft is not stored or sent."""
    token = bearer(authorization)
    rows = await supabase(f"emails?id=eq.{quote(email_id, safe='')}&select=*&limit=1", token)
    if not rows:
        raise HTTPException(404, "Email not found")
    email = rows[0]
    if is_internal_mail_address(email.get("sender")) or is_system_notification_email(email):
        raise HTTPException(422, "系统通知或内部转发邮件不能生成客户回复草稿。")
    return await generate_siliconflow_reply_draft(email, payload.purpose)

@app.patch("/api/emails/{email_id}/ai-fact-card")
async def review_email_ai_fact_card(email_id: str, payload: MailAiFactCardStatusIn, authorization: str | None = Header(default=None)):
    """Allow dismissal, but deliberately no AI endpoint can write CRM fields."""
    token = bearer(authorization)
    rows = await supabase(f"mail_ai_fact_cards?email_id=eq.{quote(email_id, safe='')}&select=id&limit=1", token)
    if not rows:
        raise HTTPException(404, "AI fact card not found")
    updated = await supabase(f"mail_ai_fact_cards?id=eq.{rows[0]['id']}", token, "PATCH", {
        "status": payload.status,
        "review_note": payload.review_note,
        "reviewed_at": datetime.utcnow().isoformat() if payload.status == "已忽略" else None,
        "updated_at": datetime.utcnow().isoformat(),
    })
    return updated[0]

@app.patch("/api/emails/{email_id}")
async def update_email_status(email_id: str, payload: EmailStatusIn, authorization: str | None = Header(default=None)):
    rows = await supabase(f"emails?id=eq.{email_id}", bearer(authorization), "PATCH", payload.model_dump())
    if not rows:
        raise HTTPException(404, "Email not found")
    return {**rows[0], "is_internal_sender": is_internal_mail_address(rows[0].get("sender"))}

@app.post("/api/emails/{email_id}/link")
async def link_email_to_customer(email_id: str, payload: EmailLinkIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase(f"emails?id=eq.{email_id}&select=*", token)
    if not rows:
        raise HTTPException(404, "Email not found")
    customer_rows = await supabase(f"customers?id=eq.{payload.customer_id}&archived_at=is.null&select=id,contact_person", token)
    if not customer_rows:
        raise HTTPException(404, "Customer not found")
    projects = await supabase(f"projects?customer_id=eq.{payload.customer_id}&archived_at=is.null&select=id,product_id&order=created_at.desc&limit=1", token)
    project = projects[0] if projects else {}
    email = rows[0]
    if not is_internal_mail_address(email.get("sender")):
        mapping_rows = await supabase(f"customer_email_mappings?email_address=eq.{quote(email['sender'], safe='')}&select=id", token)
        mapping_payload = {"customer_id": payload.customer_id, "email_address": email["sender"], "contact_name": payload.contact_name or email.get("sender_name") or customer_rows[0].get("contact_person")}
        if mapping_rows:
            await supabase(f"customer_email_mappings?id=eq.{mapping_rows[0]['id']}", token, "PATCH", mapping_payload)
        else:
            await supabase("customer_email_mappings", token, "POST", mapping_payload)
    updated = await supabase(f"emails?id=eq.{email_id}", token, "PATCH", {
        "customer_id": payload.customer_id,
        "project_id": project.get("id"),
        "product_id": project.get("product_id"),
        "status": "linked",
    })
    return {**updated[0], "is_internal_sender": is_internal_mail_address(updated[0].get("sender"))}

@app.post("/api/emails/{email_id}/customers", status_code=201)
async def create_customer_from_email(email_id: str, payload: EmailCustomerCreateIn, authorization: str | None = Header(default=None)):
    """Create a customer owned by the signed-in member and link the reviewed email."""
    token = bearer(authorization)
    email_rows = await supabase(f"emails?id=eq.{email_id}&select=*", token)
    if not email_rows:
        raise HTTPException(404, "Email not found")
    email = email_rows[0]
    if is_internal_mail_address(email.get("sender")):
        raise HTTPException(422, "Internal colleague mail cannot create a customer")

    address = payload.email.strip().lower()
    existing = await supabase(
        f"customers?email=eq.{quote(address, safe='')}&archived_at=is.null&import_reverted=eq.false&select=id,company_name&limit=1",
        token,
    )
    if existing:
        raise HTTPException(409, f"Customer email already exists: {existing[0]['company_name']}. Link the email to that customer instead.")

    company_name = payload.company_name.strip()
    existing_company = await supabase(
        f"customers?company_name=ilike.{quote(company_name, safe='')}&archived_at=is.null&import_reverted=eq.false&select=id,company_name&limit=1",
        token,
    )
    if existing_company:
        raise HTTPException(409, f"Customer company already exists: {existing_company[0]['company_name']}. Link the email to that customer instead.")

    customer = (await supabase("customers", token, "POST", payload.model_dump(exclude_none=True)))[0]
    await supabase("customer_email_mappings", token, "POST", {
        "customer_id": customer["id"], "email_address": email.get("sender") or address,
        "contact_name": email.get("sender_name") or payload.contact_person,
    })
    updated = (await supabase(f"emails?id=eq.{email_id}", token, "PATCH", {
        "customer_id": customer["id"], "status": "linked",
    }))[0]
    await record_timeline_event(
        token, title=f"从邮件创建客户：{customer['company_name']}", event_type="crm",
        source="mail_new_lead", related_id=email_id, customer_id=customer["id"],
        event_date=str(email.get("received_at") or date.today())[:10],
    )
    return {"customer": customer, "email": {**updated, "is_internal_sender": is_internal_mail_address(updated.get("sender"))}}

@app.post("/api/emails/{email_id}/followups", status_code=201)
async def create_followup_from_email(email_id: str, payload: EmailFollowupIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase(f"emails?id=eq.{email_id}&select=*", token)
    if not rows:
        raise HTTPException(404, "Email not found")
    email = rows[0]
    if not email.get("customer_id"):
        raise HTTPException(422, "This email is not linked to a CRM customer")
    record = await supabase("followups", token, "POST", {
        "customer_id": email["customer_id"],
        "email_id": email_id,
        "date": str(email.get("received_at") or "")[:10] or None,
        "content": payload.content or f"邮件：{email.get('subject', '(无主题)')}\n{email.get('content_preview') or ''}",
        "next_action": payload.next_action or "阅读邮件并确认下一步行动",
        "status": "Open",
    })
    customer_rows = await supabase(f"customers?id=eq.{email['customer_id']}&archived_at=is.null&select=next_followup_date", token)
    await supabase("email_actions", token, "POST", {
        "email_id": email_id,
        "customer_id": email["customer_id"],
        "action": "Create follow-up",
        "next_action": payload.next_action or "阅读邮件并确认下一步行动",
        "deadline": customer_rows[0].get("next_followup_date") if customer_rows else None,
        "status": "Pending",
    })
    # Turning an email into a CRM follow-up also creates a visible Daily Focus task.
    # The migration is optional during rollout, so an unavailable tasks table must
    # never prevent the user from creating the original CRM follow-up.
    try:
        task_rows = await supabase("tasks", token, "POST", {
            "title": f"回复邮件：{email.get('subject', '(无主题)')[:120]}",
            "description": payload.content or email.get("content_preview") or "由邮件中心创建的跟进任务",
            "category": "外贸", "priority": "normal", "status": "Pending",
            "task_date": customer_rows[0].get("next_followup_date") if customer_rows and customer_rows[0].get("next_followup_date") else str(date.today()),
            "customer_id": email["customer_id"], "project_id": email.get("project_id"), "product_id": email.get("product_id"),
        })
        task = task_rows[0]
        await record_timeline_event(token, title=f"邮件转任务：{task['title']}", event_type="email", source="mail_followup", related_id=task["id"], customer_id=task.get("customer_id"), project_id=task.get("project_id"), product_id=task.get("product_id"), event_date=task["task_date"])
    except HTTPException:
        pass
    await supabase(f"emails?id=eq.{email_id}", token, "PATCH", {"status": "followup_created"})
    return record[0]

@app.post("/api/emails/{email_id}/update-crm")
async def update_crm_from_email(email_id: str, payload: EmailCrmUpdateIn, authorization: str | None = Header(default=None)):
    """Turn one reviewed email into a complete CRM update without duplicate entry."""
    token = bearer(authorization)
    email_rows = await supabase(f"emails?id=eq.{email_id}&select=*", token)
    if not email_rows:
        raise HTTPException(404, "Email not found")
    email = email_rows[0]
    customer_rows = await supabase(f"customers?id=eq.{payload.customer_id}&archived_at=is.null&select=*", token)
    if not customer_rows:
        raise HTTPException(404, "Customer not found")
    customer = customer_rows[0]
    project = None
    if payload.project_id:
        project_rows = await supabase(f"projects?id=eq.{payload.project_id}&customer_id=eq.{payload.customer_id}&archived_at=is.null&select=*", token)
        if not project_rows:
            raise HTTPException(422, "Selected project does not belong to this customer")
        project = (await supabase(f"projects?id=eq.{payload.project_id}&archived_at=is.null", token, "PATCH", {
            "product_id": payload.product_id,
            "stage": payload.customer_stage,
        }))[0]
    if payload.product_id:
        product_rows = await supabase(f"products?id=eq.{payload.product_id}&archived_at=is.null&select=product_code", token)
        if not product_rows:
            raise HTTPException(404, "Product not found")
        product_code = product_rows[0]["product_code"]
    else:
        product_code = customer.get("product_interest")
    updated_customer = (await supabase(f"customers?id=eq.{payload.customer_id}&archived_at=is.null", token, "PATCH", {
        "customer_stage": payload.customer_stage,
        "next_followup_date": payload.followup_date,
        "next_action": [payload.next_action],
        "status_label": payload.next_action,
        "product_interest": product_code,
    }))[0]
    if not is_internal_mail_address(email.get("sender")):
        mapping_rows = await supabase(f"customer_email_mappings?email_address=eq.{quote(email['sender'], safe='')}&select=id", token)
        mapping_payload = {"customer_id": payload.customer_id, "email_address": email["sender"], "contact_name": email.get("sender_name") or customer.get("contact_person")}
        if mapping_rows:
            await supabase(f"customer_email_mappings?id=eq.{mapping_rows[0]['id']}", token, "PATCH", mapping_payload)
        else:
            await supabase("customer_email_mappings", token, "POST", mapping_payload)
    email_updated = (await supabase(f"emails?id=eq.{email_id}", token, "PATCH", {
        "customer_id": payload.customer_id, "project_id": payload.project_id,
        "product_id": payload.product_id, "status": "followup_created",
    }))[0]
    followup = (await supabase("followups", token, "POST", {
        "customer_id": payload.customer_id, "email_id": email_id, "date": payload.followup_date,
        "content": payload.notes, "next_action": payload.next_action, "status": "Open",
    }))[0]
    await supabase("email_actions", token, "POST", {
        "email_id": email_id, "customer_id": payload.customer_id, "action": "Update CRM",
        "next_action": payload.next_action, "deadline": payload.followup_date, "status": "Pending",
    })
    await record_timeline_event(token, title=f"邮件更新 CRM：{email.get('subject', '(无主题)')[:120]}", event_type="crm", source="mail_crm_update", related_id=followup["id"], customer_id=payload.customer_id, project_id=payload.project_id, product_id=payload.product_id, event_date=payload.followup_date)
    # The CRM action is the explicit human confirmation.  Keep an optional AI
    # card in sync, but never make a missing V1.25 table block real CRM work.
    try:
        card_rows = await supabase(f"mail_ai_fact_cards?email_id=eq.{quote(email_id, safe='')}&select=id&limit=1", token)
        if card_rows:
            await supabase(f"mail_ai_fact_cards?id=eq.{card_rows[0]['id']}", token, "PATCH", {
                "status": "已确认", "reviewed_at": datetime.utcnow().isoformat(), "updated_at": datetime.utcnow().isoformat(),
            })
    except HTTPException:
        pass
    task = None
    if payload.create_task:
        try:
            task = (await supabase("tasks", token, "POST", {
                "title": payload.next_action, "description": payload.notes, "category": "外贸", "priority": "important", "status": "Pending",
                "task_date": payload.task_date or payload.followup_date, "customer_id": payload.customer_id,
                "project_id": payload.project_id, "product_id": payload.product_id,
            }))[0]
            await record_timeline_event(token, title=f"邮件转任务：{task['title']}", event_type="task", source="mail_crm_update", related_id=task["id"], customer_id=payload.customer_id, project_id=payload.project_id, product_id=payload.product_id, event_date=task["task_date"])
        except HTTPException:
            # Daily Focus tables may be introduced later; the CRM update remains valid.
            task = None
    return {"email": {**email_updated, "is_internal_sender": is_internal_mail_address(email_updated.get("sender"))}, "customer": updated_customer, "project": project, "followup": followup, "task": task}

@app.get("/api/email-sync")
async def get_email_sync(authorization: str | None = Header(default=None)):
    rows = await supabase("email_sync?select=*&limit=1", bearer(authorization))
    return rows[0] if rows else {"status": "Not configured", "total_synced": 0, "last_sync_time": None}

@app.get("/api/mailbox")
async def get_current_mailbox(authorization: str | None = Header(default=None)):
    """Return only the signed-in member's safe mailbox label, never IMAP secrets."""
    token = bearer(authorization)
    try:
        rows = await supabase("mailbox_accounts?select=id,mailbox_key,label,email_address,is_active&limit=1", token)
    except HTTPException:
        # Keeps the existing single-mailbox release usable until the V1.8 SQL migration is run.
        return {"configured": False, "label": "当前邮件中心", "email_address": None, "is_active": False}
    if not rows:
        return {"configured": False, "label": "当前邮件中心", "email_address": None, "is_active": False}
    return {**rows[0], "configured": True}
