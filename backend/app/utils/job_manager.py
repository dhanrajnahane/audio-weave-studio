import os
import re
import uuid
import time
import queue
import threading
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional

from ..config import UPLOADS_DIR, STEMS_DIR
from .audio_io import extract_metadata

class JobManager:
    """
    Thread-safe asynchronous background job manager for Demucs stem separation.
    Uses a FIFO Queue to process jobs sequentially in arrival order, keeps FastAPI's
    event loop completely non-blocking, captures real-time stderr progress percentages,
    and isolates failures without stopping unrelated queued jobs.
    """
    def __init__(self):
        self._jobs: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._queue: queue.Queue = queue.Queue()
        self._worker_thread = threading.Thread(
            target=self._process_queue_worker,
            daemon=True
        )
        self._worker_thread.start()

    def _process_queue_worker(self):
        """Worker thread processing queued separation jobs sequentially."""
        while True:
            try:
                job_id, stored_filename = self._queue.get()
                try:
                    self._run_separation_worker(job_id, stored_filename)
                except Exception as e:
                    self.update_job(
                        job_id,
                        status="error",
                        progress=0,
                        stage="Separation failed with unhandled exception.",
                        error=str(e)
                    )
                finally:
                    self._queue.task_done()
            except Exception:
                time.sleep(0.5)

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                return dict(job)
            return None

    def list_jobs(self) -> list:
        with self._lock:
            return [dict(j) for j in self._jobs.values()]

    def update_job(self, job_id: str, **kwargs):
        with self._lock:
            if job_id in self._jobs:
                self._jobs[job_id].update(kwargs)
                self._jobs[job_id]["updated_at"] = time.time()

    def find_cached_stem_set(self, stored_filename: str) -> Optional[Dict[str, Any]]:
        """
        Checks if a full, valid 4-stem Demucs set already exists for this uploaded file.
        Returns the stem set payload if found, or None.
        """
        asset_id = Path(stored_filename).stem
        target_dir = STEMS_DIR / asset_id
        if not target_dir.exists():
            return None

        for root_dir, dirs, files in os.walk(target_dir):
            if {"vocals.wav", "drums.wav", "bass.wav", "other.wav"}.issubset(set(files)):
                stem_folder = Path(root_dir)
                try:
                    rel_path = stem_folder.relative_to(STEMS_DIR).as_posix()
                    stems = {}
                    for stem in ["vocals", "drums", "bass", "other"]:
                        stem_file = stem_folder / f"{stem}.wav"
                        if not stem_file.exists() or stem_file.stat().st_size == 0:
                            return None
                        meta = extract_metadata(stem_file)
                        stems[stem] = {
                            "stem": stem,
                            "filename": f"{stem}.wav",
                            "stream_url": f"/api/audio/stems/{rel_path}/{stem}.wav",
                            "metadata": meta
                        }
                    return {
                        "status": "success",
                        "id": rel_path.replace("/", "__"),
                        "name": Path(stored_filename).stem,
                        "relative_path": rel_path,
                        "stems": stems
                    }
                except Exception:
                    return None
        return None

    def start_separation_job(self, stored_filename: str) -> str:
        job_id = str(uuid.uuid4())
        queue_pos = self._queue.qsize() + 1
        initial_job = {
            "job_id": job_id,
            "stored_filename": stored_filename,
            "status": "queued",
            "progress": 0,
            "stage": f"Job queued for AI stem separation (position #{queue_pos})...",
            "result": None,
            "error": None,
            "created_at": time.time(),
            "updated_at": time.time(),
        }

        with self._lock:
            self._jobs[job_id] = initial_job

        # Enqueue job to FIFO Queue for safe sequential processing
        self._queue.put((job_id, stored_filename))
        return job_id

    def _run_separation_worker(self, job_id: str, stored_filename: str):
        try:
            self.update_job(
                job_id,
                status="processing",
                progress=5,
                stage="Checking storage cache for existing stems..."
            )

            file_path = UPLOADS_DIR / stored_filename
            if not file_path.exists():
                self.update_job(
                    job_id,
                    status="error",
                    progress=0,
                    stage="Audio file not found in uploads directory.",
                    error=f"Uploaded file '{stored_filename}' does not exist on disk."
                )
                return

            # Check cache first
            cached = self.find_cached_stem_set(stored_filename)
            if cached:
                self.update_job(
                    job_id,
                    status="completed",
                    progress=100,
                    stage="Stems loaded from existing cache successfully.",
                    result=cached
                )
                return

            asset_id = Path(stored_filename).stem
            out_dir = STEMS_DIR / asset_id
            out_dir.mkdir(parents=True, exist_ok=True)

            venv_python = Path(r"C:\Users\dhana\aw_env\Scripts\python.exe")
            python_cmd = str(venv_python) if venv_python.exists() else "python"

            env = os.environ.copy()
            env["PATH"] = r"C:\Users\dhana\aw_env\Scripts;" + env.get("PATH", "")
            env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
            env["PYTHONUNBUFFERED"] = "1"

            cmd = [
                python_cmd, "-u", "-m", "demucs",
                "-d", "cpu",
                "-n", "htdemucs",
                "--shifts", "0",
                "-o", str(out_dir),
                str(file_path)
            ]

            self.update_job(
                job_id,
                status="processing",
                progress=10,
                stage="Loading Demucs htdemucs neural model on CPU..."
            )

            # Start process and stream stderr in real-time
            proc = subprocess.Popen(
                cmd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )

            progress_pattern = re.compile(r"(\d+)%")
            stderr_lines = []

            # Read stderr line-by-line for actual Demucs progress
            if proc.stderr:
                for raw_line in proc.stderr:
                    line = raw_line.strip()
                    if not line:
                        continue
                    stderr_lines.append(line)

                    # Look for percentage in Demucs progress output
                    match = progress_pattern.search(line)
                    if match:
                        pct = int(match.group(1))
                        # Scale Demucs inner progress (0-100) to overall job progress (15-90%)
                        overall_pct = 15 + int(pct * 0.75)
                        self.update_job(
                            job_id,
                            status="processing",
                            progress=overall_pct,
                            stage=f"Separating audio into Vocals, Drums, Bass, and Other ({pct}%)..."
                        )
                    elif "Separating track" in line:
                        self.update_job(
                            job_id,
                            status="processing",
                            progress=20,
                            stage="Demucs neural separation active on CPU..."
                        )

            proc.wait()

            if proc.returncode != 0:
                err_msg = "\n".join(stderr_lines[-10:]) if stderr_lines else f"Demucs exited with code {proc.returncode}"
                self.update_job(
                    job_id,
                    status="error",
                    progress=0,
                    stage=f"Demucs separation failed (exit code {proc.returncode})",
                    error=err_msg
                )
                return

            self.update_job(
                job_id,
                status="processing",
                progress=92,
                stage="Verifying generated stem audio files on disk..."
            )

            # Find stem folder
            stem_folder = None
            for root_dir, dirs, files in os.walk(out_dir):
                if {"vocals.wav", "drums.wav", "bass.wav", "other.wav"}.issubset(set(files)):
                    stem_folder = Path(root_dir)
                    break

            if not stem_folder:
                self.update_job(
                    job_id,
                    status="error",
                    progress=0,
                    stage="Demucs finished but stem files were not found on disk.",
                    error="Expected stem files (vocals.wav, drums.wav, bass.wav, other.wav) were missing."
                )
                return

            rel_path = stem_folder.relative_to(STEMS_DIR).as_posix()
            stems = {}
            for stem in ["vocals", "drums", "bass", "other"]:
                stem_file = stem_folder / f"{stem}.wav"
                if not stem_file.exists() or stem_file.stat().st_size == 0:
                    self.update_job(
                        job_id,
                        status="error",
                        progress=0,
                        stage=f"Stem file '{stem}.wav' is missing or empty.",
                        error=f"Corrupt or empty stem output for {stem}"
                    )
                    return
                meta = extract_metadata(stem_file)
                stems[stem] = {
                    "stem": stem,
                    "filename": f"{stem}.wav",
                    "stream_url": f"/api/audio/stems/{rel_path}/{stem}.wav",
                    "metadata": meta
                }

            result_payload = {
                "status": "success",
                "id": rel_path.replace("/", "__"),
                "name": Path(stored_filename).stem,
                "relative_path": rel_path,
                "stems": stems
            }

            self.update_job(
                job_id,
                status="completed",
                progress=100,
                stage="AI Stem Separation completed successfully!",
                result=result_payload
            )

        except Exception as ex:
            self.update_job(
                job_id,
                status="error",
                progress=0,
                stage="Unexpected error during stem separation.",
                error=str(ex)
            )

# Global JobManager singleton
job_manager = JobManager()
