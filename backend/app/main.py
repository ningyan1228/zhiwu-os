"""Thin API gateway: browser credentials are verified with Supabase before data is proxied."""
from functools import lru_cache
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    allowed_origins: str = "http://localhost:5173"
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

class LoginIn(BaseModel):
    email: str
    password: str

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

class QuoteIn(BaseModel):
    customer_id: str
    product_id: str | None = None
    quantity: str
    amount: float | None = None
    currency: str = "USD"
    trade_term: str | None = None
    status: str = "Draft"

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

@app.get("/health")
def health(): return {"status": "ok"}

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

@app.get("/api/followups")
async def list_followups(authorization: str | None = Header(default=None)):
    return await supabase("followups?select=*&order=date.desc", bearer(authorization))

@app.post("/api/followups", status_code=201)
async def create_followup(followup: FollowupIn, authorization: str | None = Header(default=None)):
    return await supabase("followups", bearer(authorization), "POST", followup.model_dump(exclude_none=True))

@app.get("/api/projects")
async def list_projects(authorization: str | None = Header(default=None)):
    return await supabase("projects?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/projects", status_code=201)
async def create_project(project: ProjectIn, authorization: str | None = Header(default=None)):
    return await supabase("projects", bearer(authorization), "POST", project.model_dump(exclude_none=True))

@app.get("/api/quotes")
async def list_quotes(authorization: str | None = Header(default=None)):
    return await supabase("quotes?select=*&order=created_at.desc", bearer(authorization))

@app.post("/api/quotes", status_code=201)
async def create_quote(quote: QuoteIn, authorization: str | None = Header(default=None)):
    return await supabase("quotes", bearer(authorization), "POST", quote.model_dump(exclude_none=True))
