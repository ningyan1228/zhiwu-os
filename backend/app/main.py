"""Thin API gateway: browser credentials are verified with Supabase before data is proxied."""
from datetime import date, datetime
from functools import lru_cache
from typing import Any, Literal
from urllib.parse import quote

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

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
    mail_sync_interval_seconds: int = 600
    mail_sync_max_messages: int = 100
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

@lru_cache
def settings() -> Settings: return Settings()

app = FastAPI(title="Zhiwu OS API", version="0.1.0")
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

class FollowupIn(BaseModel):
    customer_id: str
    date: str
    content: str
    next_action: str | None = None
    status: str = "Open"

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
    product_id: str | None = None
    quantity: str
    amount: float | None = None
    currency: str = "USD"
    trade_term: str | None = None
    status: str = "Draft"

class EmailStatusIn(BaseModel):
    status: Literal["unread", "new_lead", "linked", "followup_created", "completed"]

class EmailFollowupIn(BaseModel):
    content: str | None = Field(default=None, max_length=5000)
    next_action: str | None = Field(default=None, max_length=1000)

class EmailLinkIn(BaseModel):
    customer_id: str
    contact_name: str | None = Field(default=None, max_length=200)

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

class TaskStatusIn(BaseModel):
    status: Literal["Pending", "Completed"]

class DailyLogIn(BaseModel):
    summary: str | None = Field(default=None, max_length=5000)
    problem: str | None = Field(default=None, max_length=5000)
    tomorrow_plan: str | None = Field(default=None, max_length=5000)
    rating: int | None = Field(default=None, ge=1, le=5)

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

def is_internal_mail_address(address: str | None) -> bool:
    """Keep colleague-forwarded mail out of customer auto-matching."""
    internal_addresses = {item.strip().lower() for item in settings().mail_internal_addresses.split(",") if item.strip()}
    return (address or "").strip().lower() in internal_addresses

async def record_timeline_event(
    token: str, *, title: str, event_type: Literal["task", "email", "crm", "project", "note"],
    source: str, related_id: str | None = None, customer_id: str | None = None,
    project_id: str | None = None, product_id: str | None = None,
    event_date: str | None = None, event_time: str | None = None,
) -> None:
    """A failed optional timeline write must not block an existing CRM/mail action."""
    try:
        await supabase("timeline_events", token, "POST", {
            "title": title, "event_type": event_type, "source": source, "related_id": related_id,
            "customer_id": customer_id, "project_id": project_id, "product_id": product_id,
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

@app.post("/api/demo/seed")
async def seed_demo(authorization: str | None = Header(default=None)):
    """Initialize one authenticated workspace with the V1.1 trade CRM demo dataset."""
    token = bearer(authorization)
    existing = await supabase("customers?select=id&limit=1", token)
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
    return await supabase(f"customers?select=*&order=created_at.desc&limit={limit}", bearer(authorization))

@app.post("/api/customers", status_code=201)
async def create_customer(customer: CustomerIn, authorization: str | None = Header(default=None)):
    return await supabase("customers", bearer(authorization), "POST", customer.model_dump(exclude_none=True))

@app.patch("/api/customers/{customer_id}")
async def update_customer(customer_id: str, customer: CustomerIn, authorization: str | None = Header(default=None)):
    return await supabase(f"customers?id=eq.{customer_id}", bearer(authorization), "PATCH", customer.model_dump(exclude_none=True))

@app.get("/api/products")
async def list_products(authorization: str | None = Header(default=None)):
    return await supabase("products?select=*&order=product_name.asc", bearer(authorization))

@app.post("/api/products", status_code=201)
async def create_product(product: ProductIn, authorization: str | None = Header(default=None)):
    return await supabase("products", bearer(authorization), "POST", product.model_dump(exclude_none=True))

@app.get("/api/product-customer-relations")
async def list_product_customer_relations(authorization: str | None = Header(default=None)):
    return await supabase("product_customer_relations?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/products/{product_id}/customers", status_code=201)
async def link_product_to_customer(product_id: str, payload: ProductCustomerRelationIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    product_rows = await supabase(f"products?id=eq.{product_id}&select=id", token)
    customer_rows = await supabase(f"customers?id=eq.{payload.customer_id}&select=id", token)
    if not product_rows or not customer_rows:
        raise HTTPException(404, "Product or customer not found")
    existing = await supabase(f"product_customer_relations?product_id=eq.{product_id}&customer_id=eq.{payload.customer_id}&select=*", token)
    if existing:
        return existing[0]
    rows = await supabase("product_customer_relations", token, "POST", {"product_id": product_id, "customer_id": payload.customer_id})
    return rows[0]

@app.get("/api/followups")
async def list_followups(authorization: str | None = Header(default=None)):
    return await supabase("followups?select=*&order=date.desc", bearer(authorization))

@app.post("/api/followups", status_code=201)
async def create_followup(followup: FollowupIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase("followups", token, "POST", followup.model_dump(exclude_none=True))
    await record_timeline_event(token, title=f"跟进客户：{followup.content}", event_type="crm", source="followup", related_id=rows[0]["id"], customer_id=followup.customer_id, event_date=followup.date)
    return rows

@app.get("/api/projects")
async def list_projects(authorization: str | None = Header(default=None)):
    return await supabase("projects?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/projects", status_code=201)
async def create_project(project: ProjectIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    rows = await supabase("projects", token, "POST", project.model_dump(exclude_none=True))
    await record_timeline_event(token, title=f"创建项目：{project.project_name}", event_type="project", source="project", related_id=rows[0]["id"], customer_id=project.customer_id, product_id=project.product_id)
    return rows

@app.patch("/api/projects/{project_id}")
async def update_project(project_id: str, project: ProjectUpdateIn, authorization: str | None = Header(default=None)):
    token = bearer(authorization)
    existing = await supabase(f"projects?id=eq.{project_id}&select=id,customer_id", token)
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
    filters = ["select=*", "order=task_date.asc,start_time.asc"]
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
    existing = await supabase(f"tasks?id=eq.{task_id}&select=*", token)
    if not existing:
        raise HTTPException(404, "Task not found")
    task = existing[0]
    update = {"status": payload.status, "completed_at": datetime.now().isoformat() if payload.status == "Completed" else None}
    rows = await supabase(f"tasks?id=eq.{task_id}", token, "PATCH", update)
    if payload.status == "Completed":
        await record_timeline_event(token, title=f"完成任务：{task['title']}", event_type="task", source="task", related_id=task_id, customer_id=task.get("customer_id"), project_id=task.get("project_id"), product_id=task.get("product_id"))
    return rows[0]

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
    filters = ["select=*", "order=event_date.desc,event_time.desc", f"limit={limit}"]
    if event_date:
        filters.append(f"event_date=eq.{event_date}")
    if from_date:
        filters.append(f"event_date=gte.{from_date}")
    if to_date:
        filters.append(f"event_date=lte.{to_date}")
    return await supabase(f"timeline_events?{'&'.join(filters)}", bearer(authorization))

@app.get("/api/quotes")
async def list_quotes(authorization: str | None = Header(default=None)):
    return await supabase("quotes?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/quotes", status_code=201)
async def create_quote(quote: QuoteIn, authorization: str | None = Header(default=None)):
    return await supabase("quotes", bearer(authorization), "POST", quote.model_dump(exclude_none=True))

@app.get("/api/emails")
async def list_emails(
    authorization: str | None = Header(default=None), limit: int = Query(100, le=200),
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
    customer_rows = await supabase(f"customers?id=eq.{payload.customer_id}&select=id,contact_person", token)
    if not customer_rows:
        raise HTTPException(404, "Customer not found")
    projects = await supabase(f"projects?customer_id=eq.{payload.customer_id}&select=id,product_id&order=created_at.desc&limit=1", token)
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
    customer_rows = await supabase(f"customers?id=eq.{email['customer_id']}&select=next_followup_date", token)
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
    customer_rows = await supabase(f"customers?id=eq.{payload.customer_id}&select=*", token)
    if not customer_rows:
        raise HTTPException(404, "Customer not found")
    customer = customer_rows[0]
    project = None
    if payload.project_id:
        project_rows = await supabase(f"projects?id=eq.{payload.project_id}&customer_id=eq.{payload.customer_id}&select=*", token)
        if not project_rows:
            raise HTTPException(422, "Selected project does not belong to this customer")
        project = (await supabase(f"projects?id=eq.{payload.project_id}", token, "PATCH", {
            "product_id": payload.product_id,
            "stage": payload.customer_stage,
        }))[0]
    if payload.product_id:
        product_rows = await supabase(f"products?id=eq.{payload.product_id}&select=product_code", token)
        if not product_rows:
            raise HTTPException(404, "Product not found")
        product_code = product_rows[0]["product_code"]
    else:
        product_code = customer.get("product_interest")
    updated_customer = (await supabase(f"customers?id=eq.{payload.customer_id}", token, "PATCH", {
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
