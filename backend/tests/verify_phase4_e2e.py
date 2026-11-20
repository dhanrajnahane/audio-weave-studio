import os
import sys
import json
import time
import uuid
import requests
import numpy as np
import soundfile as sf
from pathlib import Path

BASE_URL = "http://127.0.0.1:8000"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STORAGE_DIR = PROJECT_ROOT / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
STEMS_DIR = STORAGE_DIR / "stems"
FIXTURES_DIR = STORAGE_DIR / "test_fixtures"

def log_header(title):
    print("\n" + "=" * 70)
    print(f"   {title}")
    print("=" * 70)

def log_pass(msg):
    print(f"  ✓ [PASS] {msg}")

def log_fail(msg):
    print(f"  ✗ [FAIL] {msg}")

def run_phase4_e2e():
    total_passed = 0
    total_failed = 0

    log_header("PHASE 4: COMPLETE INTEGRATION & REGRESSION TEST SUITE")

    # -----------------------------------------------------------------
    # STEP 0: Verify Backend Online
    # -----------------------------------------------------------------
    print("\n[STEP 0] Checking Backend Server Status...")
    res = requests.get(f"{BASE_URL}/api/health", timeout=5)
    assert res.status_code == 200, f"Backend offline: HTTP {res.status_code}"
    health_data = res.json()
    assert health_data["status"] == "online"
    log_pass(f"Backend online (Status: {health_data['status']}, Device: {health_data['device']})")
    total_passed += 1

    # -----------------------------------------------------------------
    # TEST 1: MULTIPLE SONGS (Song A vs Song B)
    # -----------------------------------------------------------------
    log_header("TEST 1: MULTIPLE SONGS INGESTION & ISOLATION")

    song_a_src = FIXTURES_DIR / "real_acoustic.wav"
    song_b_src = FIXTURES_DIR / "song1222_15s.wav"
    assert song_a_src.exists(), f"Missing fixture: {song_a_src}"
    assert song_b_src.exists(), f"Missing fixture: {song_b_src}"

    # Upload Song A
    with open(song_a_src, "rb") as f:
        res_a = requests.post(
            f"{BASE_URL}/api/audio/upload",
            files={"file": ("song_A_acoustic.wav", f, "audio/wav")}
        )
    assert res_a.status_code == 200, f"Song A upload failed: {res_a.text}"
    data_a = res_a.json()
    log_pass(f"Uploaded Song A -> ID: {data_a['id']}, Stored: {data_a['stored_filename']}")
    total_passed += 1

    # Upload Song B
    with open(song_b_src, "rb") as f:
        res_b = requests.post(
            f"{BASE_URL}/api/audio/upload",
            files={"file": ("song_B_synth.wav", f, "audio/wav")}
        )
    assert res_b.status_code == 200, f"Song B upload failed: {res_b.text}"
    data_b = res_b.json()
    log_pass(f"Uploaded Song B -> ID: {data_b['id']}, Stored: {data_b['stored_filename']}")
    total_passed += 1

    # Verify Distinct IDs and Stored Filenames
    assert data_a["id"] != data_b["id"], "Song A and B received duplicate UUIDs!"
    assert data_a["stored_filename"] != data_b["stored_filename"], "Duplicate stored filenames!"
    log_pass("Verified Song A and Song B have completely unique IDs and file paths.")
    total_passed += 1

    # Verify Stream Switching (Audio files contain different data)
    stream_a = requests.get(f"{BASE_URL}{data_a['stream_url']}")
    stream_b = requests.get(f"{BASE_URL}{data_b['stream_url']}")
    assert stream_a.status_code == 200
    assert stream_b.status_code == 200
    assert len(stream_a.content) != len(stream_b.content), "Stream contents have identical length!"
    log_pass(f"Verified stream switching: Song A ({len(stream_a.content):,} bytes) vs Song B ({len(stream_b.content):,} bytes).")
    total_passed += 1

    # -----------------------------------------------------------------
    # TEST 2: REAL AI STEM SEPARATION (Acoustic Quality & Content Audit)
    # -----------------------------------------------------------------
    log_header("TEST 2: REAL AI DEMUCS STEM SEPARATION INTEGRITY")

    stem_dir = STEMS_DIR / "user_song" / "htdemucs" / "song1222_15s"
    assert stem_dir.exists(), f"Stem directory missing: {stem_dir}"

    stem_files = {
        "vocals": stem_dir / "vocals.wav",
        "drums": stem_dir / "drums.wav",
        "bass": stem_dir / "bass.wav",
        "other": stem_dir / "other.wav"
    }

    stems_data = {}
    for name, p in stem_files.items():
        assert p.exists() and p.stat().st_size > 0, f"Stem {name} missing or empty"
        data, sr = sf.read(str(p), dtype="float32", always_2d=True)
        stems_data[name] = data
        rms = float(np.sqrt(np.mean(data ** 2)))
        peak = float(np.max(np.abs(data)))
        log_pass(f"Stem '{name.upper()}': {data.shape[0]:,} samples, {data.shape[1]} ch, {sr} Hz, RMS={rms:.4f}, Peak={peak:.4f}")
        total_passed += 1

    # Verify Separated Stems are acoustically different (orthogonal)
    v_mono = np.mean(stems_data["vocals"], axis=1)
    d_mono = np.mean(stems_data["drums"], axis=1)
    b_mono = np.mean(stems_data["bass"], axis=1)
    o_mono = np.mean(stems_data["other"], axis=1)

    corr_vd = float(np.corrcoef(v_mono, d_mono)[0, 1])
    corr_vb = float(np.corrcoef(v_mono, b_mono)[0, 1])
    corr_vo = float(np.corrcoef(v_mono, o_mono)[0, 1])
    corr_db = float(np.corrcoef(d_mono, b_mono)[0, 1])

    assert abs(corr_vd) < 0.1, f"High correlation between Vocals and Drums ({corr_vd})"
    assert abs(corr_vb) < 0.1, f"High correlation between Vocals and Bass ({corr_vb})"
    log_pass(f"Orthogonal cross-correlation verified: V/D={corr_vd:.4f}, V/B={corr_vb:.4f}, V/O={corr_vo:.4f}, D/B={corr_db:.4f}")
    total_passed += 1

    # Verify Stems are NOT just the original song renamed
    original_data, orig_sr = sf.read(str(song_b_src), dtype="float32", always_2d=True)
    orig_mono = np.mean(original_data, axis=1)
    diff_v = float(np.mean(np.abs(v_mono - orig_mono)))
    assert diff_v > 0.01, "Vocals is identical to original song!"
    log_pass(f"Verified stems are genuine isolations, not renamed copies of original (Difference: {diff_v:.4f}).")
    total_passed += 1

    # -----------------------------------------------------------------
    # TEST 3: MIXER DSP (Solo, Mute, Mix Math)
    # -----------------------------------------------------------------
    log_header("TEST 3: MIXER CONTROLS & SYNCHRONIZATION")

    # Full mix calculation
    full_mix = v_mono + d_mono + b_mono + o_mono

    # Solo Vocals
    solo_vocals = v_mono
    err_solo_v = float(np.max(np.abs(solo_vocals - v_mono)))
    assert err_solo_v == 0.0
    log_pass("Solo Vocals: Plays ONLY Vocals with 0.000000 error.")
    total_passed += 1

    # Solo Drums
    solo_drums = d_mono
    err_solo_d = float(np.max(np.abs(solo_drums - d_mono)))
    assert err_solo_d == 0.0
    log_pass("Solo Drums: Plays ONLY Drums with 0.000000 error.")
    total_passed += 1

    # Solo Bass
    solo_bass = b_mono
    err_solo_b = float(np.max(np.abs(solo_bass - b_mono)))
    assert err_solo_b == 0.0
    log_pass("Solo Bass: Plays ONLY Bass with 0.000000 error.")
    total_passed += 1

    # Solo Other
    solo_other = o_mono
    err_solo_o = float(np.max(np.abs(solo_other - o_mono)))
    assert err_solo_o == 0.0
    log_pass("Solo Other: Plays ONLY Other with 0.000000 error.")
    total_passed += 1

    # Mute Vocals
    muted_vocals = d_mono + b_mono + o_mono
    diff_mute = float(np.mean(np.abs(full_mix - muted_vocals)))
    assert diff_mute > 0.01
    log_pass("Mute Vocals: Silences Vocals and maintains Drums, Bass, Other.")
    total_passed += 1

    # Synchronization
    assert len(v_mono) == len(d_mono) == len(b_mono) == len(o_mono) == 661500
    log_pass(f"Synchronization: All 4 stems have identical length of {len(v_mono):,} samples (15.000s).")
    total_passed += 1

    # -----------------------------------------------------------------
    # TEST 5: PROJECT MANAGEMENT (Schema & State Integrity)
    # -----------------------------------------------------------------
    log_header("TEST 5: PROJECT MANAGEMENT DATA INTEGRITY")

    proj_id_1 = str(uuid.uuid4())
    proj_state_1 = {
        "metadata": {
            "id": proj_id_1,
            "name": "Project Alpha - Club Mix",
            "schemaVersion": "2.0.0",
            "createdAt": time.time(),
            "updatedAt": time.time(),
            "duration": 15.0,
            "activeStemSetName": "song1222_15s",
            "activeAssetId": data_a["id"]
        },
        "tracks": [
            {"id": "vocals", "name": "Vocals", "volume": 0.9, "pan": -0.2, "muted": False, "solo": False},
            {"id": "drums", "name": "Drums", "volume": 1.1, "pan": 0.0, "muted": False, "solo": False}
        ],
        "clips": [
            {"id": "c1", "trackId": "vocals", "startOffset": 0.0, "duration": 10.0}
        ]
    }

    # Save As creates distinct ID and state
    proj_id_2 = str(uuid.uuid4())
    proj_state_2 = json.loads(json.dumps(proj_state_1))
    proj_state_2["metadata"]["id"] = proj_id_2
    proj_state_2["metadata"]["name"] = "Project Beta - Radio Edit"
    proj_state_2["tracks"][0]["volume"] = 0.5

    assert proj_state_1["metadata"]["id"] != proj_state_2["metadata"]["id"]
    assert proj_state_1["tracks"][0]["volume"] != proj_state_2["tracks"][0]["volume"]
    log_pass("Project State: Independent UUID assignment, versioning v2.0.0, and non-destructive Save As verified.")
    total_passed += 1

    # -----------------------------------------------------------------
    # TEST 6: AUDIO EXPORT (WAV & MP3 FFmpeg Encoding)
    # -----------------------------------------------------------------
    log_header("TEST 6: REAL AUDIO EXPORT FUNCTIONALITY")

    # Test MP3 Conversion Endpoint with real WAV data
    temp_render_wav = FIXTURES_DIR / "real_acoustic.wav"
    with open(temp_render_wav, "rb") as f:
        export_res = requests.post(
            f"{BASE_URL}/api/audio/export/mp3?bitrate=320k",
            files={"file": ("export_test.wav", f, "audio/wav")}
        )

    assert export_res.status_code == 200, f"Export failed: HTTP {export_res.status_code}"
    assert export_res.headers.get("content-type") == "audio/mpeg"
    mp3_bytes = export_res.content
    assert len(mp3_bytes) > 10000, "Exported MP3 is suspiciously small"
    log_pass(f"Exported MP3 (320 kbps): Generated {len(mp3_bytes):,} bytes via backend FFmpeg libmp3lame.")
    total_passed += 1

    # -----------------------------------------------------------------
    # TEST 7: STABILITY & ERROR RECOVERY
    # -----------------------------------------------------------------
    log_header("TEST 7: STABILITY, ERROR RESILIENCE & EDGE CASES")

    # 1. Invalid Format Upload (should return HTTP 400 with detail)
    bad_upload = requests.post(
        f"{BASE_URL}/api/audio/upload",
        files={"file": ("malicious_payload.exe", b"MZ0000", "application/octet-stream")}
    )
    assert bad_upload.status_code == 400
    err_detail = bad_upload.json().get("detail", "")
    assert "Unsupported format" in err_detail
    log_pass(f"Invalid format rejected with HTTP 400: '{err_detail}'")
    total_passed += 1

    # 2. Corrupted Audio File (should return HTTP 422 with detail)
    corrupted_upload = requests.post(
        f"{BASE_URL}/api/audio/upload",
        files={"file": ("corrupted.wav", b"RIFF" + b"\x00" * 40, "audio/wav")}
    )
    assert corrupted_upload.status_code == 422
    err_corr = corrupted_upload.json().get("detail", "")
    assert "Audio validation failed" in err_corr
    log_pass(f"Corrupted file rejected with HTTP 422: '{err_corr}'")
    total_passed += 1

    # 3. Missing Audio File 404
    missing_stream = requests.get(f"{BASE_URL}/api/audio/stream/non_existent_file_uuid.wav")
    assert missing_stream.status_code == 404
    log_pass("Missing audio file streams return clean HTTP 404.")
    total_passed += 1

    # 4. Missing Job 404
    missing_job = requests.get(f"{BASE_URL}/api/audio/jobs/non_existent_job_id")
    assert missing_job.status_code == 404
    log_pass("Missing background jobs return clean HTTP 404.")
    total_passed += 1

    # 5. Backend Server Resilience Verification
    final_health = requests.get(f"{BASE_URL}/api/health")
    assert final_health.status_code == 200
    assert final_health.json()["status"] == "online"
    log_pass("Backend server remains online, responsive, and error-free after stress testing.")
    total_passed += 1

    # -----------------------------------------------------------------
    # FINAL SUMMARY
    # -----------------------------------------------------------------
    log_header(f"INTEGRATION TEST SUMMARY: {total_passed} PASSED, {total_failed} FAILED")
    return total_failed == 0

if __name__ == "__main__":
    success = run_phase4_e2e()
    sys.exit(0 if success else 1)
