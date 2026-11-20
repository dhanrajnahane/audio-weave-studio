# 🎵 AudioWeave Studio — Intelligent Audio Stem Editing & Remix Platform

AudioWeave Studio is a full-stack, AI-powered Digital Audio Workstation (DAW) and stem editing platform built for modern music production, live remixing, and acoustic analysis.

It features deep-learning **Demucs AI** 4-stem separation on the backend, a sample-accurate **Web Audio API** engine in the frontend, client-side **IndexedDB** persistence, and an architecture built on fundamental **Data Structures and Algorithms (DSA)**.

---

## 🚀 Key Features

* **AI Stem Separation:** Deep-learning audio isolation into **Vocals, Drums, Bass, and Other** instruments using Meta's `htdemucs` model.
* **Timeline Editor:** Multi-track non-destructive audio editing with slice/split (`S`), duplicate (`Ctrl+D`), delete, drag, zoom, and timecode scrubbing.
* **Remix Composer:** Librosa-powered structural analysis (Intro, Verse, Chorus, Outro) with arrangement templates (Radio Edit, Club Extended) and per-section stem volume automation.
* **Routing DAG (Directed Acyclic Graph):** Interactive node-based audio canvas to patch custom effects chains (Gain, EQ, Compressor, Delay, Reverb) with DFS cycle prevention.
* **5-Channel Stem Mixer:** Hardware-calibrated mixer desk with Mute, Solo, Pan, Gain faders, and real-time 60 FPS peak VU meters.
* **Song Analyzer:** Acoustic intelligence dashboard with BPM tempo detection, beat timestamps, dynamic range, true peak dBFS, and stem energy distribution heatmaps.
* **Effects Studio:** 4-stage DSP effects rack (3-Band Parametric EQ, Studio Compressor, Stereo Delay, Convolver Reverb) with bypass toggles and presets.
* **Persistent Session Storage:** Full IndexedDB storage (`AudioWeaveStudioDB` v2) that retains audio binaries, projects, and edits across page reloads.
* **Lossless & Compressed Audio Export:** 24-bit Lossless WAV (via browser `OfflineAudioContext`) and 320 kbps MP3 (via backend FFmpeg).

---

## 🧠 Data Structures & Algorithms (DSA) Implementation

AudioWeave Studio implements custom Computer Science data structures for performance-critical audio operations:

| Data Structure / Algorithm | File Location | Purpose & Complexity |
| :--- | :--- | :--- |
| **Doubly Linked List** | `frontend/src/audio/models/ClipLinkedList.ts` | **$O(1)$** clip splitting, insertion, and chronological track ordering without array shifting. |
| **Augmented Interval Tree (BST)** | `frontend/src/audio/models/IntervalTree.ts` | **$O(\log N + K)$** collision detection, overlap prevention, and instantaneous playhead queries. |
| **Double Stack (LIFO)** | `frontend/src/audio/models/UndoRedoStack.ts` | **$O(1)$** non-destructive Undo and Redo operations with a 50-step bounded memory footprint. |
| **Directed Acyclic Graph (DAG)** | `frontend/src/audio/models/AudioGraphModel.ts` | Adjacency-list graph model representing modular audio effects routing and signal flow. |
| **Depth-First Search (DFS)** | `frontend/src/audio/models/AudioGraphModel.ts` | Traversal algorithm to detect and reject cycles before cables can create audio feedback loops. |
| **Kahn’s Topological Sort** | `frontend/src/audio/models/AudioGraphModel.ts` | In-degree queue algorithm computing the exact sequential processing order of audio DSP nodes. |
| **Thread-Safe FIFO Queue** | `backend/app/utils/job_manager.py` | Queue-based worker enforcing sequential Demucs AI separations to prevent CPU/RAM exhaustion. |
| **Hash Maps (`Map<K, V>`)** | `frontend/src/audio/AudioEngine.ts` | **$O(1)$** lookup for decoded audio buffers, active tracks, and volume gain nodes. |

---

## 🛠️ Tech Stack

### Frontend
* **Framework:** React 18 + TypeScript + Vite
* **Audio Synthesis:** Native Web Audio API (`AudioContext`, `AudioBufferSourceNode`, `GainNode`, `StereoPannerNode`, `DynamicsCompressorNode`, `BiquadFilterNode`, `OfflineAudioContext`)
* **Styling & Icons:** Tailwind CSS, Lucide React
* **Client Storage:** IndexedDB API (`idb`)

### Backend
* **API Framework:** Python 3.11+ FastAPI (RESTful, async, Uvicorn)
* **AI Separation:** Demucs (`htdemucs` hybrid convolutional transformer)
* **Acoustic Analysis:** Librosa, SoundFile, NumPy, SciPy
* **Transcoding:** FFmpeg audio pipeline

---

## 📦 Project Structure

```
audio-weave-studio/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI entrypoint, CORS & static mounting
│   │   ├── config.py                   # Paths, formats & device configuration
│   │   ├── routers/
│   │   │   └── audio.py                # Upload, stream, separate, jobs, analysis & export
│   │   └── utils/
│   │       ├── audio_io.py             # PCM decoding & 1200-bin peak envelope generator
│   │       ├── job_manager.py          # Thread-safe FIFO queue for Demucs jobs
│   │       └── song_analyzer.py        # Librosa BPM, beat grid & structural segmentation
│   ├── tests/                          # E2E and regression test suites
│   ├── requirements.txt                # Python dependencies
│   └── run.py                          # Backend launcher
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── apiClient.ts            # Centralized API service with timeout & error handling
│   │   ├── audio/
│   │   │   ├── AudioEngine.ts          # Web Audio API engine & buffer manager
│   │   │   ├── export/                 # WAV & MP3 export rendering engines
│   │   │   └── models/                 # DSA: ClipLinkedList, IntervalTree, UndoRedo, DAG
│   │   ├── components/                 # Workspace tabs (Timeline, Mixer, Remix, DAG, Analyzer, Effects)
│   │   ├── storage/
│   │   │   └── indexedDB.ts            # IndexedDB manager for audio binaries & project state
│   │   ├── types/
│   │   │   └── audio.ts                # TypeScript interfaces & domain models
│   │   └── App.tsx                     # Main layout & hotkey bindings
│   ├── package.json
│   └── vite.config.ts
└── storage/
    ├── uploads/                        # Original uploaded audio files
    ├── stems/                          # Demucs AI separated stems (Vocals, Drums, Bass, Other)
    └── analysis/                       # Cached Librosa acoustic analysis JSON
```

---

## ⚡ Getting Started

### 1. Prerequisites
* **Node.js** v18+ & npm
* **Python** 3.10+ (Recommended: Python 3.11 or 3.12)
* **FFmpeg** installed and accessible in system `PATH`

### 2. Backend Setup
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python run.py
```
*Backend runs on `http://localhost:8000`.*

### 3. Frontend Setup
```powershell
cd frontend
npm install
npm run dev
```
*Frontend runs on `http://localhost:5173`.*

---

## 🧪 Running Tests

* **Backend End-to-End Suite:**
  ```powershell
  python backend/tests/verify_phase4_e2e.py
  ```
* **Frontend DSA & Audio Engine Tests:**
  ```powershell
  node frontend/src/audio/TimelineAndProject.test.mjs
  node frontend/src/audio/AudioEngine.test.mjs
  ```

---

## 📄 License
MIT License. Built for educational, research, and creative audio production.
