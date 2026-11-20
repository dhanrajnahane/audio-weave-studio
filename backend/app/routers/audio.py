import uuid
import shutil
import os
import subprocess
from urllib.parse import unquote
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, Query, Response, status
from fastapi.responses import FileResponse, JSONResponse
from ..config import UPLOADS_DIR, STEMS_DIR, STORAGE_DIR, SUPPORTED_EXTENSIONS
from ..utils.audio_io import validate_audio_file, extract_metadata, generate_real_peaks, detect_audio_sections
from ..utils.song_analyzer import SongAnalyzer
from ..utils.job_manager import job_manager

router = APIRouter(prefix="/api/audio", tags=["Audio Asset Management"])

@router.post("/upload")
async def upload_audio_file(file: UploadFile = File(...)):
    """
    Task 5 & 6 & 8 & 9: Real audio import, format validation, metadata extraction,
    and real waveform generation for WAV, MP3, and FLAC.
    """
    filename = file.filename or "audio_track"
    ext = Path(filename).suffix.lower()

    # 1. Format Validation (Task 6)
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. AudioWeave Studio currently supports WAV, MP3, and FLAC."
        )

    asset_id = str(uuid.uuid4())
    stored_filename = f"{asset_id}_{filename}"
    save_path = UPLOADS_DIR / stored_filename

    # Save to disk
    try:
        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write uploaded file to disk: {str(e)}")

    # 2. Audio Validation & Metadata Extraction (Task 6 & 8)
    is_valid, validation_msg = validate_audio_file(save_path)
    if not is_valid:
        if save_path.exists():
            save_path.unlink()
        raise HTTPException(status_code=422, detail=f"Audio validation failed: {validation_msg}")

    try:
        metadata = extract_metadata(save_path)
        # 3. Real Waveform Peak Extraction (Task 9)
        peaks_data = generate_real_peaks(save_path, num_bins=1200)

        return {
            "id": asset_id,
            "filename": filename,
            "stored_filename": stored_filename,
            "file_path": str(save_path),
            "stream_url": f"/api/audio/stream/{stored_filename}",
            "metadata": metadata,
            "peaks": peaks_data["peaks"],
            "rms": peaks_data["rms"],
            "max_peak": peaks_data["max_peak"]
        }
    except Exception as e:
        if save_path.exists():
            save_path.unlink()
        raise HTTPException(status_code=500, detail=f"Error analyzing audio samples: {str(e)}")

@router.get("/stream/{stored_filename}")
async def stream_audio_file(stored_filename: str):
    """Streams audio file to client for Web Audio API decoding and playback."""
    file_path = UPLOADS_DIR / stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio asset not found on server.")

    # Determine media type
    ext = file_path.suffix.lower()
    media_types = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac"
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(file_path, media_type=media_type)

@router.get("/metadata/{stored_filename}")
async def get_file_metadata(stored_filename: str):
    """Retrieve metadata for stored audio asset."""
    file_path = UPLOADS_DIR / stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio asset not found.")

    try:
        return extract_metadata(file_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract metadata: {str(e)}")

@router.get("/sections/{stored_filename}")
async def get_musical_sections(stored_filename: str):
    """
    Analyzes audio asset and returns detected musical sections
    (Intro, Verse, Chorus, Drop, Outro) with timestamps and energy profiles.
    """
    file_path = UPLOADS_DIR / stored_filename
    if not file_path.exists():
        # Check in stems directory as well
        for root_dir, dirs, files in os.walk(STEMS_DIR):
            if stored_filename in files:
                file_path = Path(root_dir) / stored_filename
                break

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio asset not found for section analysis.")

    try:
        sections = detect_audio_sections(file_path)
        return {"filename": stored_filename, "sections": sections}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to detect musical sections: {str(e)}")

@router.get("/library")
async def get_audio_library():
    """Retrieve list of all imported audio assets stored in backend storage."""
    assets = []
    for file_path in UPLOADS_DIR.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in SUPPORTED_EXTENSIONS:
            try:
                meta = extract_metadata(file_path)
                parts = file_path.name.split("_", 1)
                asset_id = parts[0] if len(parts) > 1 else file_path.stem
                orig_name = parts[1] if len(parts) > 1 else file_path.name

                assets.append({
                    "id": asset_id,
                    "filename": orig_name,
                    "stored_filename": file_path.name,
                    "stream_url": f"/api/audio/stream/{file_path.name}",
                    "metadata": meta
                })
            except Exception:
                continue

    return {"assets": assets}


@router.get("/stems/available")
async def get_available_stems():
    """Retrieve all separated stem sets available in backend storage."""
    results = []
    if not STEMS_DIR.exists():
        return {"stem_sets": []}

    # Search for directories containing the 4 Demucs stems
    for root_dir, dirs, files in os.walk(STEMS_DIR):
        file_set = set(files)
        if {"vocals.wav", "drums.wav", "bass.wav", "other.wav"}.issubset(file_set):
            p = Path(root_dir)
            rel_path = p.relative_to(STEMS_DIR).as_posix()
            track_name = p.name
            stems = {}
            for stem in ["vocals", "drums", "bass", "other"]:
                stem_file = p / f"{stem}.wav"
                meta = extract_metadata(stem_file)
                stems[stem] = {
                    "stem": stem,
                    "filename": f"{stem}.wav",
                    "stream_url": f"/api/audio/stems/{rel_path}/{stem}.wav",
                    "metadata": meta
                }
            results.append({
                "id": rel_path.replace("/", "__"),
                "name": track_name,
                "relative_path": rel_path,
                "stems": stems
            })

    return {"stem_sets": results}


@router.get("/stems/{stem_path:path}")
async def stream_stem_file(stem_path: str):
    """Stream a separated stem WAV file safely decoding URLs and checking existence."""
    decoded_path = unquote(stem_path).replace("\\", "/")
    file_path = STEMS_DIR / decoded_path
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail=f"Stem file '{decoded_path}' not found.")
    return FileResponse(file_path, media_type="audio/wav")


@router.post("/separate/{stored_filename}")
async def separate_audio_stems(stored_filename: str, sync: bool = Query(False)):
    """
    Runs real Demucs stem separation on an imported audio file.
    By default runs as an asynchronous background job returning job_id (HTTP 202)
    to keep FastAPI non-blocking and prevent connection timeouts.
    If sync=True, waits for completion and returns the final result.
    """
    file_path = UPLOADS_DIR / stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found in uploads.")

    # 1. Check if stem set is already cached on disk
    cached = job_manager.find_cached_stem_set(stored_filename)
    if cached:
        return cached

    # 2. Launch background separation job
    job_id = job_manager.start_separation_job(stored_filename)

    if not sync:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "job_id": job_id,
                "status": "queued",
                "progress": 0,
                "stage": "Job queued for AI stem separation...",
                "stored_filename": stored_filename
            }
        )

    # If synchronous mode requested, poll until done
    import asyncio
    while True:
        job = job_manager.get_job(job_id)
        if not job:
            raise HTTPException(status_code=500, detail="Separation job lost.")
        if job["status"] == "completed":
            return job["result"]
        if job["status"] == "error":
            raise HTTPException(status_code=500, detail=job["error"] or job["stage"])
        await asyncio.sleep(0.5)


@router.get("/jobs/{job_id}")
async def get_separation_job(job_id: str):
    """Retrieves real-time processing status, actual progress (0-100), and stage for a separation job."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return job


@router.get("/jobs")
async def list_separation_jobs():
    """Lists all active and recent separation jobs."""
    return {"jobs": job_manager.list_jobs()}

@router.post("/export/mp3")
async def export_wav_to_mp3(file: UploadFile = File(...), bitrate: str = "320k"):
    """
    Converts rendered WAV audio stream to MP3 using backend FFmpeg libmp3lame.
    Supports bitrates: 128k, 192k, 256k, 320k.
    """
    temp_id = str(uuid.uuid4())
    temp_wav = UPLOADS_DIR / f"temp_{temp_id}.wav"
    temp_mp3 = UPLOADS_DIR / f"export_{temp_id}.mp3"

    try:
        with open(temp_wav, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        ffmpeg_bin = Path(r"C:\Users\dhana\aw_env\Scripts\ffmpeg.exe")
        ffmpeg_cmd = str(ffmpeg_bin) if ffmpeg_bin.exists() else "ffmpeg"

        cmd = [
            ffmpeg_cmd,
            "-y",
            "-i", str(temp_wav),
            "-c:a", "libmp3lame",
            "-b:a", bitrate,
            str(temp_mp3)
        ]

        proc = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not temp_mp3.exists() or temp_mp3.stat().st_size == 0:
            raise HTTPException(status_code=500, detail="MP3 conversion produced an empty file.")

        return FileResponse(
            temp_mp3,
            media_type="audio/mpeg",
            filename=f"AudioWeave_Export_{bitrate}.mp3"
        )
    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"FFmpeg MP3 encoding failed: {e.stderr or str(e)}")
    finally:
        if temp_wav.exists():
            temp_wav.unlink()

@router.get("/analyze/{filename}")
async def analyze_audio_file(filename: str, force: bool = False):
    """
    Performs real acoustic analysis using Librosa, NumPy, and SciPy:
    - BPM estimation & exact beat grid timestamps
    - Silence regions detection
    - RMS energy, peak amplitude, and dynamic range
    - Acoustic song section segmentation (Intro, Verse, Chorus, Bridge, Outro)
    - Stem activity map when separated stems exist
    - Transparent caching in storage/analysis/
    """
    target_path = UPLOADS_DIR / filename
    if not target_path.exists():
        alt_path = STORAGE_DIR / "test_fixtures" / filename
        if alt_path.exists():
            target_path = alt_path
        else:
            raise HTTPException(status_code=404, detail=f"Audio file '{filename}' not found.")

    try:
        analysis = SongAnalyzer.analyze_song(target_path, force_recompute=force)
        return analysis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Song analysis failed: {str(e)}")

@router.get("/analyze/stem-activity/{filename}")
async def get_stem_activity(filename: str):
    """
    Returns stem activity map for the audio file if separated stems exist.
    """
    target_path = UPLOADS_DIR / filename
    if not target_path.exists():
        alt_path = STORAGE_DIR / "test_fixtures" / filename
        if alt_path.exists():
            target_path = alt_path
        else:
            raise HTTPException(status_code=404, detail=f"Audio file '{filename}' not found.")

    try:
        analysis = SongAnalyzer.analyze_song(target_path, force_recompute=False)
        stem_activity = analysis.get("stem_activity")
        if not stem_activity:
            return {"has_stems": False, "message": "Separated stems not found for this audio track."}
        return stem_activity
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract stem activity: {str(e)}")



