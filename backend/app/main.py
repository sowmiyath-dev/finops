import logging
import asyncio
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from app.models.database import init_db
from app.routers import auth, towers, reports, admin, tags, verticals
from app.routers import azure_costs

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# Silence noisy Azure SDK HTTP logs
logging.getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(logging.WARNING)
logging.getLogger("azure.identity").setLevel(logging.WARNING)
logging.getLogger("azure.storage").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

app = FastAPI(title="Finoptix", version="2.0.0")

# Cache-control headers for GET API responses
class CacheHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if request.method == "GET" and response.status_code == 200:
            response.headers["Cache-Control"] = "private, max-age=60"
        return response

app.add_middleware(CacheHeaderMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=512)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://finoptix.novactech.in",
        "http://localhost:3000",
        "http://13.234.82.78:3000",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(towers.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(verticals.router, prefix="/api")
app.include_router(azure_costs.router, prefix="/api")


@app.on_event("startup")
async def startup():
    max_retries = 10
    for attempt in range(1, max_retries + 1):
        try:
            await init_db()
            logger.info("Finoptix API started — DB connected")
            return
        except Exception as e:
            logger.warning(f"DB connection attempt {attempt}/{max_retries} failed: {e}")
            if attempt < max_retries:
                await asyncio.sleep(10)
            else:
                logger.error("Could not connect to DB after all retries")
                raise


@app.get("/")
async def root():
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok", "app": "Finoptix"}


@app.get("/api/health")
async def health_api():
    return {"status": "ok", "app": "Finoptix"}
