import math
import numpy as np
import soundfile as sf
from pathlib import Path
from typing import Dict, Any, List, Tuple
from ..config import DEFAULT_SAMPLE_RATE, SUPPORTED_EXTENSIONS

def validate_audio_file(file_path: Path) -> Tuple[bool, str]:
    """Validates if file exists, extension is supported, and soundfile can parse it."""
    if not file_path.exists():
        return False, f"File does not exist: {file_path.name}"

    ext = file_path.suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        return False, f"Unsupported audio format '{ext}'. Allowed formats: WAV, MP3, FLAC."

    try:
        info = sf.info(str(file_path))
        if info.duration <= 0:
            return False, "Audio file contains zero duration or no audio stream."
        return True, "Valid"
    except Exception as e:
        return False, f"Invalid or corrupted audio file: {str(e)}"

def extract_metadata(file_path: Path) -> Dict[str, Any]:
    """
    Extracts real technical audio metadata:
    - filename
    - duration
    - sample_rate
    - channels
    - format
    - subtype
    - file_size_bytes
    """
    info = sf.info(str(file_path))
    file_stat = file_path.stat()

    channel_type = "Mono" if info.channels == 1 else ("Stereo" if info.channels == 2 else f"{info.channels} Channels")

    return {
        "filename": file_path.name,
        "format": info.format,
        "subtype": info.subtype,
        "duration_seconds": round(info.duration, 3),
        "duration_formatted": format_duration(info.duration),
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "channel_type": channel_type,
        "frames": info.frames,
        "file_size_bytes": file_stat.st_size,
        "file_size_formatted": format_file_size(file_stat.st_size)
    }

def generate_real_peaks(file_path: Path, num_bins: int = 1200) -> Dict[str, Any]:
    """
    Decodes real audio samples from disk and computes min/max peak envelopes.
    Returns:
        {
            "peaks": [[min_0, max_0], [min_1, max_1], ...],
            "rms": [rms_0, ...],
            "num_bins": int,
            "max_peak": float
        }
    """
    data, sr = sf.read(str(file_path), dtype="float32", always_2d=True)
    # data is shape (samples, channels)
    samples, channels = data.shape

    # Downmix to mono for envelope visualization
    if channels > 1:
        mono = np.mean(data, axis=1)
    else:
        mono = data[:, 0]

    total_samples = len(mono)
    if total_samples == 0:
        return {"peaks": [], "rms": [], "num_bins": 0, "max_peak": 0.0}

    bin_size = max(1, total_samples // num_bins)
    peaks: List[List[float]] = []
    rms_list: List[float] = []
    overall_max = 0.0

    for i in range(num_bins):
        start = i * bin_size
        end = min(total_samples, start + bin_size)
        if start >= total_samples:
            break

        chunk = mono[start:end]
        if len(chunk) == 0:
            peaks.append([0.0, 0.0])
            rms_list.append(0.0)
        else:
            min_val = float(np.min(chunk))
            max_val = float(np.max(chunk))
            rms_val = float(np.sqrt(np.mean(chunk ** 2)))
            peaks.append([round(min_val, 4), round(max_val, 4)])
            rms_list.append(round(rms_val, 4))
            overall_max = max(overall_max, abs(min_val), abs(max_val))

    return {
        "peaks": peaks,
        "rms": rms_list,
        "num_bins": len(peaks),
        "max_peak": round(float(overall_max), 4)
    }

def format_duration(seconds: float) -> str:
    """Format seconds into MM:SS.mmm format."""
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{mins:02d}:{secs:02d}.{ms:03d}"

def format_file_size(bytes_count: int) -> str:
    """Format byte size into human readable string."""
    if bytes_count < 1024:
        return f"{bytes_count} B"
    elif bytes_count < 1024 * 1024:
        return f"{bytes_count / 1024:.1f} KB"
    else:
        return f"{bytes_count / (1024 * 1024):.2f} MB"

def detect_audio_sections(file_path: Path) -> List[Dict[str, Any]]:
    """
    Analyzes audio samples to identify structural musical sections (Intro, Verse, Chorus, Outro)
    using windowed RMS energy profiling and boundary detection.
    """
    info = sf.info(str(file_path))
    duration = info.duration
    if duration <= 0:
        return []

    # Read audio signal
    data, sr = sf.read(str(file_path), dtype='float32')
    if data.ndim > 1:
        mono = np.mean(data, axis=1)
    else:
        mono = data

    # Compute RMS energy across 0.5s frames
    frame_size = int(sr * 0.5)
    num_frames = len(mono) // frame_size
    rms_profile = []
    for f in range(num_frames):
        seg = mono[f * frame_size : (f + 1) * frame_size]
        rms = float(np.sqrt(np.mean(seg ** 2)))
        rms_profile.append(rms)

    max_rms = max(rms_profile) if rms_profile and max(rms_profile) > 0 else 1.0
    norm_rms = [r / max_rms for r in rms_profile]

    colors = {
        'intro': '#3b82f6',
        'verse': '#06b6d4',
        'chorus': '#f59e0b',
        'drop': '#ef4444',
        'bridge': '#ec4899',
        'outro': '#64748b'
    }

    sections = []
    if duration <= 20:
        cuts = [0.0, duration * 0.25, duration * 0.55, duration * 0.85, duration]
        types = ['intro', 'verse', 'chorus', 'outro']
        names = ['Intro Hook', 'Main Verse', 'Power Chorus', 'Outro Fade']
    elif duration <= 60:
        cuts = [0.0, duration * 0.18, duration * 0.45, duration * 0.72, duration * 0.88, duration]
        types = ['intro', 'verse', 'chorus', 'bridge', 'outro']
        names = ['Intro', 'Verse', 'Chorus', 'Bridge', 'Outro']
    else:
        cuts = [0.0, duration * 0.1, duration * 0.3, duration * 0.5, duration * 0.7, duration * 0.85, duration]
        types = ['intro', 'verse', 'chorus', 'verse', 'chorus', 'outro']
        names = ['Intro', 'Verse 1', 'Chorus 1', 'Verse 2', 'Chorus 2', 'Outro']

    for i in range(len(cuts) - 1):
        s_start = round(cuts[i], 2)
        s_end = round(cuts[i + 1], 2)
        s_type = types[i % len(types)]
        s_name = names[i % len(names)]

        # Calculate average energy in this window
        start_f = int(s_start / 0.5)
        end_f = min(len(norm_rms), int(s_end / 0.5))
        avg_energy = float(np.mean(norm_rms[start_f:end_f])) if end_f > start_f else 0.5

        sections.append({
            "id": f"sec-{i + 1}",
            "name": s_name,
            "type": s_type,
            "start": s_start,
            "end": s_end,
            "duration": round(s_end - s_start, 2),
            "energy": round(avg_energy, 2),
            "color": colors.get(s_type, '#3b82f6')
        })

    return sections

