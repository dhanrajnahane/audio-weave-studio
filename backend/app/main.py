from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .routers import audio
from .config import DEVICE_TARGET, SUPPORTED_EXTENSIONS, PROJECT_ROOT

app = FastAPI(
    title="AudioWeave Studio API",
    description="Backend audio ingestion and processing engine for AudioWeave Studio",
    version="0.2.0"
)

# CORS setup for Vite frontend (http://localhost:5173 / http://127.0.0.1:5173) and local origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include audio management router
app.include_router(audio.router)

@app.get("/api/health")
async def health_check():
    """Connection test endpoint for frontend to verify backend availability."""
    return {
        "status": "online",
        "app": "AudioWeave Studio",
        "phase": 2,
        "device": DEVICE_TARGET,
        "cuda_compatible": True,
        "supported_formats": sorted(list(SUPPORTED_EXTENSIONS))
    }

# Mount Frontend production build if available
frontend_dist = PROJECT_ROOT / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = frontend_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(frontend_dist / "index.html")
