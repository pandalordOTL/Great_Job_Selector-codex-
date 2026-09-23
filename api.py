from __future__ import annotations

import asyncio
import hashlib
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import DateTime, String, Text, create_engine, func, or_, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column


SOURCE_URL = "https://free.taiwanjobs.gov.tw/webservice_taipei/Webservice.ashx"
REFRESH_SECONDS = 12 * 60 * 60
RETRY_SECONDS = 5 * 60


def database_url() -> str:
    value = os.getenv("DATABASE_URL", "sqlite:///./good_job_radar.db")
    if value.startswith("postgres://"):
        value = value.replace("postgres://", "postgresql+psycopg://", 1)
    elif value.startswith("postgresql://"):
        value = value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


engine = create_engine(
    database_url(),
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if database_url().startswith("sqlite") else {},
)


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), index=True)
    company: Mapped[str] = mapped_column(String(300), default="")
    location: Mapped[str] = mapped_column(String(200), default="", index=True)
    salary: Mapped[str] = mapped_column(String(200), default="薪資面議")
    salary_min: Mapped[int] = mapped_column(default=0, index=True)
    employment_type: Mapped[str] = mapped_column(String(120), default="")
    experience: Mapped[str] = mapped_column(String(120), default="")
    education: Mapped[str] = mapped_column(String(120), default="")
    category: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    source_url: Mapped[str] = mapped_column(Text, default="")
    updated_at_source: Mapped[str] = mapped_column(String(40), default="")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class Metadata(Base):
    __tablename__ = "metadata"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


def local_name(tag: str) -> str:
    return tag.split("}")[-1].split("（", 1)[0].strip().upper()


def text_of(node: ET.Element, name: str) -> str:
    for child in node:
        if local_name(child.tag) == name:
            return (child.text or "").strip()
    return ""


def make_id(url: str, title: str, company: str) -> str:
    match = re.search(r"EMPLOYER_ID=(\d+).*?HIRE_ID=(\d+)", url, re.I)
    if match:
        return f"twj-{match.group(1)}-{match.group(2)}"
    return "twj-" + hashlib.sha256(f"{url}|{title}|{company}".encode()).hexdigest()[:32]


def salary_info(low: str, high: str, basis: str) -> tuple[str, int]:
    numbers = [int(re.sub(r"\D", "", value)) for value in (low, high) if re.search(r"\d", value)]
    monthly = "月" in basis or "每月" in basis or not basis
    if not numbers:
        return (basis if basis else "薪資面議", 0)
    if not monthly:
        return (basis or "依規定核薪", 0)
    start = numbers[0]
    end = numbers[-1] if len(numbers) > 1 else 0
    if start >= 1000:
        start //= 1000
    if end >= 1000:
        end //= 1000
    label = f"月薪 {start}K" + (f"–{end}K" if end and end != start else "")
    return label, start


def parse_jobs(xml_text: str) -> list[dict]:
    try:
        root = ET.fromstring(xml_text.lstrip("\ufeff"))
    except ET.ParseError as exc:
        raise ValueError(f"台灣就業通回傳的 XML 格式無法解析：{exc}") from exc
    output = []
    for node in root.iter():
        if local_name(node.tag) not in {"DATA", "JOB", "JOBDATA"}:
            continue
        title = text_of(node, "OCCU_DESC")
        if not title:
            continue
        company = text_of(node, "COMPNAME")
        url = text_of(node, "URL_QUERY")
        basis = text_of(node, "SALARYCD")
        salary, salary_min = salary_info(text_of(node, "NT_L"), text_of(node, "NT_U"), basis)
        output.append({
            "id": make_id(url, title, company),
            "title": title,
            "company": company or "公司資料未提供",
            "location": text_of(node, "CITYNAME"),
            "salary": salary,
            "salary_min": salary_min,
            "employment_type": text_of(node, "WK_TYPE"),
            "experience": text_of(node, "EXPERIENCE"),
            "education": text_of(node, "EDGRDESC"),
            "category": text_of(node, "CJOB_NAME2") or text_of(node, "CJOB_NAME1"),
            "description": text_of(node, "JOB_DETAIL"),
            "source_url": url,
            "updated_at_source": text_of(node, "TRANDATE"),
        })
    return output


def fetch_source() -> list[dict]:
    url = SOURCE_URL + "?" + urllib.parse.urlencode({"count": 1000, "T": "XML"})
    request = urllib.request.Request(url, headers={"User-Agent": "GoodJobRadar/1.0"})
    with urllib.request.urlopen(request, timeout=35) as response:
        payload = response.read().decode("utf-8-sig", errors="replace")
    return parse_jobs(payload)


def refresh_jobs() -> int:
    records = fetch_source()
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        for data in records:
            job = session.get(Job, data["id"])
            if job is None:
                job = Job(id=data["id"], last_seen_at=now, **{k: v for k, v in data.items() if k != "id"})
                session.add(job)
            else:
                for key, value in data.items():
                    if key != "id":
                        setattr(job, key, value)
                job.last_seen_at = now
        session.merge(Metadata(key="last_refresh_at", value=now.isoformat()))
        session.merge(Metadata(key="last_refresh_count", value=str(len(records))))
        session.merge(Metadata(key="last_refresh_error", value=""))
        session.commit()
    return len(records)


def save_refresh_error(error: Exception) -> None:
    with Session(engine) as session:
        session.merge(Metadata(key="last_refresh_error", value=str(error)[:1000]))
        session.commit()


async def refresh_loop() -> None:
    while True:
        with Session(engine) as session:
            has_success = session.get(Metadata, "last_refresh_at") is not None
            last_error = session.get(Metadata, "last_refresh_error")
        delay = RETRY_SECONDS if not has_success or (last_error and last_error.value) else REFRESH_SECONDS
        await asyncio.sleep(delay)
        try:
            await asyncio.to_thread(refresh_jobs)
        except Exception as exc:
            print(f"TaiwanJobs refresh failed: {exc}", flush=True)
            try:
                await asyncio.to_thread(save_refresh_error, exc)
            except Exception as save_exc:
                print(f"Could not save TaiwanJobs refresh error: {save_exc}", flush=True)


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    try:
        await asyncio.to_thread(refresh_jobs)
    except Exception as exc:
        print(f"Initial TaiwanJobs refresh failed: {exc}", flush=True)
        try:
            await asyncio.to_thread(save_refresh_error, exc)
        except Exception as save_exc:
            print(f"Could not save TaiwanJobs refresh error: {save_exc}", flush=True)
    task = asyncio.create_task(refresh_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="好職雷達 API", version="1.0.0", lifespan=lifespan)
origins = ["https://good-job-radar.onrender.com", "http://localhost:8000", "http://127.0.0.1:8000"]
extra_origin = os.getenv("FRONTEND_ORIGIN")
if extra_origin and extra_origin not in origins:
    origins.append(extra_origin)
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET"], allow_headers=["*"])


def serialize(job: Job) -> dict:
    detail = job.description or ""
    tags = [item for item in [job.category, job.employment_type, job.experience] if item]
    if job.education:
        tags.append(job.education)
    if not tags:
        tags = ["台灣就業通"]
    score = 72
    if job.salary_min >= 60:
        score += 12
    elif job.salary_min:
        score += 5
    if "台北" in job.location:
        score += 7
    if any(word in job.title + job.category for word in ["產品", "設計", "UX", "UI"]):
        score += 5
    if "遠端" in detail or "在家工作" in detail:
        score += 4
    return {
        "id": job.id, "title": job.title, "company": job.company,
        "location": job.location or "工作地點待確認", "salary": job.salary,
        "salary_min": job.salary_min, "type": job.employment_type or "工作型態待確認",
        "experience": job.experience, "education": job.education, "category": job.category,
        "description": detail, "source_url": job.source_url,
        "posted": job.updated_at_source or "近期更新", "score": min(score, 96), "tags": tags[:4],
        "remote": "遠端" in detail or "在家工作" in detail,
        "reason": "依薪資、地點與職缺內容整理的初步符合度，請查看原始職缺確認條件。",
    }


@app.get("/api/health")
def health():
    with Session(engine) as session:
        last = session.get(Metadata, "last_refresh_at")
        error = session.get(Metadata, "last_refresh_error")
        count = session.scalar(select(func.count()).select_from(Job)) or 0
        return {"status": "ok", "job_count": count, "last_refresh_at": last.value if last else None, "last_refresh_error": error.value if error and error.value else None}


@app.get("/api/jobs")
def list_jobs(
    q: str = Query(default="", max_length=100),
    city: str = Query(default="", max_length=40),
    limit: int = Query(default=1000, ge=1, le=1000),
):
    with Session(engine) as session:
        statement = select(Job).order_by(Job.salary_min.desc(), Job.updated_at_source.desc()).limit(limit)
        if q.strip():
            term = f"%{q.strip()}%"
            statement = statement.where(or_(Job.title.ilike(term), Job.company.ilike(term), Job.category.ilike(term), Job.description.ilike(term)))
        if city.strip():
            statement = statement.where(Job.location.ilike(f"%{city.strip()}%"))
        jobs = session.scalars(statement).all()
        last = session.get(Metadata, "last_refresh_at")
        return {"jobs": [serialize(job) for job in jobs], "count": len(jobs), "last_refresh_at": last.value if last else None, "source": "台灣就業通", "source_url": "https://data.gov.tw/dataset/44062"}
