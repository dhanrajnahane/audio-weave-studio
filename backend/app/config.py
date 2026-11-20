from pathlib import Path

# Base Paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
STORAGE_DIR = PROJECT_ROOT / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
STEMS_DIR = STORAGE_DIR / "stems"
ANALYSIS_DIR = STORAGE_DIR / "analysis"

# Create storage directories
for directory in [STORAGE_DIR, UPLOADS_DIR, STEMS_DIR, ANALYSIS_DIR]:
    directory.mkdir(parents=True, exist_ok=True)

# Hardware & Audio Processing Configuration
# CPU configured by default; CUDA-ready structure
DEVICE_TARGET = "cpu"
DEFAULT_SAMPLE_RATE = 44100

# Strict Supported Formats for Phase 2
SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac"}
SUPPORTED_MIME_TYPES = {
    "audio/wav", "audio/x-wav", "audio/wave",
    "audio/mpeg", "audio/mp3",
    "audio/flac", "audio/x-flac"
}
MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024  # 100MB limit
