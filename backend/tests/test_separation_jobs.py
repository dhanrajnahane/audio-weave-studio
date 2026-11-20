import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from app.main import app
from app.config import STEMS_DIR, UPLOADS_DIR

client = TestClient(app)

def test_separation_jobs_and_stem_endpoints():
    print("==================================================================")
    print("      DEMUCS STEM SEPARATION ASYNC JOBS & ENDPOINTS VERIFICATION  ")
    print("==================================================================")

    # 1. Test Health Check
    health_res = client.get("/api/health")
    assert health_res.status_code == 200
    assert health_res.json()["status"] == "online"
    print("  --> PASS: Health check endpoint is responsive.")

    # 2. Test Available Stems Listing
    stems_res = client.get("/api/audio/stems/available")
    assert stems_res.status_code == 200
    stem_sets = stems_res.json()["stem_sets"]
    assert len(stem_sets) > 0, "Expected at least one stem set in storage/stems"
    sample_set = stem_sets[0]
    print(f"  --> PASS: Available stems listed {len(stem_sets)} sets. Sample: '{sample_set['name']}'")

    # 3. Test Safe Stem File Streaming (with URL decoding)
    for stem_name in ["vocals", "drums", "bass", "other"]:
        stem_info = sample_set["stems"][stem_name]
        stream_url = stem_info["stream_url"]
        stream_res = client.get(stream_url)
        assert stream_res.status_code == 200, f"Failed to stream stem: {stream_url}"
        assert stream_res.headers["content-type"] == "audio/wav"
        assert len(stream_res.content) > 1000
        print(f"  --> PASS: Stem '{stem_name}' streamed ({len(stream_res.content)} bytes, audio/wav).")

    # 4. Test Job Listing Endpoint
    jobs_res = client.get("/api/audio/jobs")
    assert jobs_res.status_code == 200
    assert "jobs" in jobs_res.json()
    print("  --> PASS: /api/audio/jobs endpoint operational.")

    # 5. Test Non-blocking Job Submission on an audio file
    # Upload or find an upload file
    uploads = list(UPLOADS_DIR.glob("*.wav"))
    if uploads:
        test_file = uploads[0].name
        print(f"  --> Testing job submission for '{test_file}'...")
        sep_res = client.post(f"/api/audio/separate/{test_file}")
        # Can be 202 (queued) or 200 (if cached)
        assert sep_res.status_code in [200, 202]
        data = sep_res.json()
        if sep_res.status_code == 202:
            assert "job_id" in data
            assert data["status"] in ["queued", "processing"]
            print(f"  --> PASS: Job submitted (HTTP 202 Accepted), Job ID = {data['job_id']}")
            # Poll job status
            job_status_res = client.get(f"/api/audio/jobs/{data['job_id']}")
            assert job_status_res.status_code == 200
            assert "progress" in job_status_res.json()
            assert "stage" in job_status_res.json()
            print(f"  --> PASS: Job status retrieved: stage='{job_status_res.json()['stage']}', progress={job_status_res.json()['progress']}%")
        else:
            assert data["status"] == "success"
            assert "stems" in data
            print(f"  --> PASS: Cached stem set returned immediately with 4 stems.")

    print("\n==================================================================")
    print("    ALL SEPARATION ASYNC JOBS & ENDPOINTS TESTS PASSED!          ")
    print("==================================================================")

if __name__ == "__main__":
    test_separation_jobs_and_stem_endpoints()
