import json
import math
import time
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import numpy as np
import soundfile as sf
import librosa
from ..config import ANALYSIS_DIR, STEMS_DIR

class SongAnalyzer:
    """
    Production Smart Song Analyzer using Librosa, NumPy, and SciPy.
    Performs real acoustic feature extraction:
    - BPM estimation & beat grid positions
    - Silence regions detection
    - RMS energy calculation & dBFS levels
    - True peak & dynamic range
    - Acoustic section segmentation (Intro, Verse, Chorus, Bridge, Outro)
    - Stem activity map when separated stems exist
    - Transparent caching with mtime invalidation
    """

    @staticmethod
    def _get_cache_path(file_path: Path) -> Path:
        cache_filename = f"{file_path.stem}_analysis.json"
        return ANALYSIS_DIR / cache_filename

    @staticmethod
    def estimate_bpm_and_beats(y: np.ndarray, sr: int) -> Tuple[float, List[float]]:
        """
        Estimates BPM and detects exact beat timestamp onsets.
        """
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr)

        # In modern Librosa, tempo can be a numpy array or scalar
        tempo_val = float(np.atleast_1d(tempo)[0])
        bpm = round(tempo_val, 1)

        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        # Format timestamps to 3 decimal places
        beat_timestamps = [round(float(t), 3) for t in beat_times]

        return bpm, beat_timestamps

    @staticmethod
    def detect_silence_regions(y: np.ndarray, sr: int, top_db: float = 38.0, min_duration: float = 0.2) -> List[Dict[str, float]]:
        """
        Detects silent regions in the audio track below top_db threshold.
        """
        non_silent_intervals = librosa.effects.split(y, top_db=top_db)
        total_duration = len(y) / sr
        silence_regions = []

        if len(non_silent_intervals) == 0:
            # Entire track is silent
            return [{"start": 0.0, "end": round(total_duration, 3), "duration": round(total_duration, 3)}]

        # 1. Check leading silence
        first_start = non_silent_intervals[0][0] / sr
        if first_start >= min_duration:
            silence_regions.append({
                "start": 0.0,
                "end": round(first_start, 3),
                "duration": round(first_start, 3)
            })

        # 2. Check gaps between non-silent intervals
        for i in range(len(non_silent_intervals) - 1):
            gap_start = non_silent_intervals[i][1] / sr
            gap_end = non_silent_intervals[i + 1][0] / sr
            dur = gap_end - gap_start
            if dur >= min_duration:
                silence_regions.append({
                    "start": round(gap_start, 3),
                    "end": round(gap_end, 3),
                    "duration": round(dur, 3)
                })

        # 3. Check trailing silence
        last_end = non_silent_intervals[-1][1] / sr
        if (total_duration - last_end) >= min_duration:
            silence_regions.append({
                "start": round(last_end, 3),
                "end": round(total_duration, 3),
                "duration": round(total_duration - last_end, 3)
            })

        return silence_regions

    @staticmethod
    def calculate_energy_and_peaks(y: np.ndarray, num_curve_points: int = 120) -> Dict[str, Any]:
        """
        Calculates real RMS energy, true peak, dBFS metrics, and normalized energy envelope curve.
        """
        frame_len = 2048
        hop_len = 512
        rms_frames = librosa.feature.rms(y=y, frame_length=frame_len, hop_length=hop_len)[0]

        avg_rms = float(np.mean(rms_frames)) if len(rms_frames) > 0 else 0.0
        max_rms = float(np.max(rms_frames)) if len(rms_frames) > 0 else 0.0
        rms_dbfs = round(20 * math.log10(max(avg_rms, 1e-6)), 2)

        peak_amplitude = float(np.max(np.abs(y))) if len(y) > 0 else 0.0
        peak_dbfs = round(20 * math.log10(max(peak_amplitude, 1e-6)), 2)
        dynamic_range_db = round(abs(peak_dbfs - rms_dbfs), 2)

        # Downsample RMS envelope to fixed number of points for fast frontend rendering
        if len(rms_frames) <= num_curve_points:
            curve = [round(float(v), 4) for v in rms_frames]
        else:
            step = len(rms_frames) / num_curve_points
            curve = []
            for i in range(num_curve_points):
                start_idx = int(i * step)
                end_idx = min(len(rms_frames), int((i + 1) * step))
                chunk = rms_frames[start_idx:end_idx]
                chunk_val = float(np.mean(chunk)) if len(chunk) > 0 else 0.0
                curve.append(round(chunk_val, 4))

        # Normalize curve to 0.0 - 1.0
        max_c = max(curve) if len(curve) > 0 else 1.0
        if max_c > 0:
            norm_curve = [round(v / max_c, 3) for v in curve]
        else:
            norm_curve = [0.0] * len(curve)

        return {
            "average_rms": round(avg_rms, 4),
            "max_rms": round(max_rms, 4),
            "rms_dbfs": rms_dbfs,
            "peak_amplitude": round(peak_amplitude, 4),
            "peak_dbfs": peak_dbfs,
            "dynamic_range_db": dynamic_range_db,
            "energy_envelope": norm_curve
        }

    @staticmethod
    def estimate_song_sections(y: np.ndarray, sr: int, duration: float) -> List[Dict[str, Any]]:
        """
        Estimates real structural song sections (Intro, Verse, Chorus, Bridge, Outro)
        using agglomerative clustering on chroma & spectral contrast features.
        Marks uncertain boundaries as estimated.
        """
        if duration < 4.0:
            # Very short clip: single generic section
            return [{
                "id": "sec-0",
                "label": "Segment",
                "start": 0.0,
                "end": round(duration, 3),
                "duration": round(duration, 3),
                "confidence": 0.90,
                "is_estimated": False,
                "energy_level": "medium",
                "avg_rms": round(float(np.mean(np.abs(y))), 4)
            }]

        hop_length = 512
        # Extract features for structural boundary detection
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop_length)
        contrast = librosa.feature.spectral_contrast(y=y, sr=sr, hop_length=hop_length)
        rms = librosa.feature.rms(y=y, hop_length=hop_length)

        # Stack normalized features
        features = np.vstack([chroma, contrast, rms])
        features = librosa.util.normalize(features, axis=1)

        # Choose reasonable segment count k based on duration (1 section per 3.5 - 12s)
        k = max(3, min(8, int(round(duration / 3.5)))) if duration >= 8.0 else 2

        try:
            # Agglomerative clustering with temporal connectivity constraint
            bounds = librosa.segment.agglomerative(features, k=k)
            bound_times = librosa.frames_to_time(bounds, sr=sr, hop_length=hop_length).tolist()
            # Ensure 0.0 and end are present
            time_points = sorted(list(set([0.0] + [round(t, 2) for t in bound_times if 0.0 < t < duration] + [round(duration, 2)])))
        except Exception:
            # Fallback uniform division if agglomerative clustering fails on edge cases
            step = duration / k
            time_points = [round(i * step, 2) for i in range(k + 1)]
            time_points[-1] = round(duration, 2)

        # Analyze each slice's acoustic properties to classify label
        sections: List[Dict[str, Any]] = []
        raw_sections = []

        overall_mean_rms = float(np.mean(rms)) if len(rms) > 0 else 0.1

        for i in range(len(time_points) - 1):
            s_start = time_points[i]
            s_end = time_points[i + 1]
            s_dur = round(s_end - s_start, 2)
            if s_dur < 0.5:
                continue

            start_sample = int(s_start * sr)
            end_sample = min(len(y), int(s_end * sr))
            slice_y = y[start_sample:end_sample]

            slice_rms = float(np.mean(librosa.feature.rms(y=slice_y))) if len(slice_y) > 0 else 0.0
            slice_centroid = float(np.mean(librosa.feature.spectral_centroid(y=slice_y, sr=sr))) if len(slice_y) > 0 else 1000.0

            raw_sections.append({
                "start": s_start,
                "end": s_end,
                "duration": s_dur,
                "rms": slice_rms,
                "centroid": slice_centroid
            })

        if not raw_sections:
            return [{
                "id": "sec-0",
                "label": "Full Track",
                "start": 0.0,
                "end": round(duration, 3),
                "duration": round(duration, 3),
                "confidence": 0.85,
                "is_estimated": False,
                "energy_level": "medium",
                "avg_rms": round(overall_mean_rms, 4)
            }]

        # Sort slices by RMS to identify Chorus / peak energy zones
        sorted_by_rms = sorted(raw_sections, key=lambda x: x["rms"])
        median_rms = sorted_by_rms[len(sorted_by_rms) // 2]["rms"]
        max_rms_val = sorted_by_rms[-1]["rms"]

        total_secs = len(raw_sections)

        for idx, sec in enumerate(raw_sections):
            is_first = (idx == 0)
            is_last = (idx == total_secs - 1)
            rms_ratio = sec["rms"] / max(median_rms, 1e-5)

            # Heuristic acoustic classification
            if is_first and (sec["rms"] <= median_rms * 1.1 or sec["start"] < 5.0):
                label = "Intro"
                energy = "low" if sec["rms"] < median_rms else "medium"
                confidence = 0.88
            elif is_last and (sec["rms"] <= median_rms * 1.1 or sec["end"] >= duration - 2.0):
                label = "Outro"
                energy = "low"
                confidence = 0.86
            elif sec["rms"] >= max_rms_val * 0.85 and rms_ratio >= 1.15:
                label = "Chorus"
                energy = "high"
                confidence = 0.92
            elif idx >= total_secs - 3 and sec["rms"] < max_rms_val * 0.8 and total_secs >= 4:
                label = "Bridge"
                energy = "medium"
                confidence = 0.76
            else:
                label = "Verse"
                energy = "medium" if sec["rms"] >= median_rms * 0.9 else "low"
                confidence = 0.84

            # Mark sections with lower confidence or boundary ambiguity as estimated
            is_estimated = confidence < 0.80 or (sec["duration"] < 2.0)

            sections.append({
                "id": f"sec-{idx}",
                "label": label,
                "start": sec["start"],
                "end": sec["end"],
                "duration": sec["duration"],
                "confidence": round(confidence, 2),
                "is_estimated": is_estimated,
                "confidence_label": "High Confidence" if not is_estimated else "Estimated",
                "energy_level": energy,
                "avg_rms": round(sec["rms"], 4)
            })

        return sections

    @staticmethod
    def calculate_stem_activity(file_path: Path, duration: float, num_buckets: int = 30) -> Optional[Dict[str, Any]]:
        """
        When Demucs separated stems exist for this file, analyzes independent stem activity
        over time slices to produce a stem activity heatmap.
        """
        stem_keys = ["vocals", "drums", "bass", "other"]
        # Look strictly for separated stem folder belonging to THIS specific audio file
        stems_found: Dict[str, Path] = {}
        target_dir = STEMS_DIR / file_path.stem
        if target_dir.exists():
            for root_dir, dirs, files in os.walk(target_dir):
                if set(f"{s}.wav" for s in stem_keys).issubset(set(files)):
                    for stem in stem_keys:
                        stems_found[stem] = Path(root_dir) / f"{stem}.wav"
                    break

        # Also check direct htdemucs output path for legacy formats
        if len(stems_found) < 4:
            alt_dir = STEMS_DIR / "user_song" / "htdemucs" / file_path.stem
            if alt_dir.exists():
                for stem in stem_keys:
                    candidate = alt_dir / f"{stem}.wav"
                    if candidate.exists():
                        stems_found[stem] = candidate

        if len(stems_found) < 4:
            return None

        # Compute RMS energy per stem in time slices
        slice_dur = duration / num_buckets
        stem_envelopes: Dict[str, List[float]] = {s: [] for s in stem_keys}
        total_energies: Dict[str, float] = {s: 0.0 for s in stem_keys}

        for stem, p in stems_found.items():
            y_stem, sr_stem = librosa.load(str(p), sr=22050, mono=True)
            samples_per_bucket = int(slice_dur * sr_stem)

            for b in range(num_buckets):
                b_start = b * samples_per_bucket
                b_end = min(len(y_stem), (b + 1) * samples_per_bucket)
                chunk = y_stem[b_start:b_end]
                val = float(np.mean(np.abs(chunk))) if len(chunk) > 0 else 0.0
                stem_envelopes[stem].append(val)
                total_energies[stem] += val

        # Normalize envelopes to 0.0 - 1.0 scale
        max_all = max(max(env) for env in stem_envelopes.values()) if any(stem_envelopes.values()) else 1.0
        if max_all <= 0: max_all = 1.0

        normalized_envelopes = {}
        for stem, env in stem_envelopes.items():
            normalized_envelopes[stem] = [round(v / max_all, 3) for v in env]

        # Calculate percentage distribution
        sum_total = sum(total_energies.values())
        if sum_total > 0:
            distribution = {stem: round((v / sum_total) * 100, 1) for stem, v in total_energies.items()}
        else:
            distribution = {stem: 25.0 for stem in stem_keys}

        # Build timeline buckets
        timeline_buckets = []
        for b in range(num_buckets):
            t_start = round(b * slice_dur, 2)
            t_end = round(min(duration, (b + 1) * slice_dur), 2)
            active_stems = [s for s in stem_keys if normalized_envelopes[s][b] > 0.10]
            timeline_buckets.append({
                "time_start": t_start,
                "time_end": t_end,
                "vocals": normalized_envelopes["vocals"][b],
                "drums": normalized_envelopes["drums"][b],
                "bass": normalized_envelopes["bass"][b],
                "other": normalized_envelopes["other"][b],
                "active_stems": active_stems
            })

        return {
            "has_stems": True,
            "stems_folder": stems_found["vocals"].parent.name,
            "energy_distribution": distribution,
            "timeline_buckets": timeline_buckets
        }

    @classmethod
    def analyze_song(cls, file_path: Path, force_recompute: bool = False) -> Dict[str, Any]:
        """
        Complete Smart Song Analysis with transparent caching.
        """
        if not file_path.exists():
            raise FileNotFoundError(f"Audio file not found: {file_path}")

        cache_path = cls._get_cache_path(file_path)

        # 1. Check Cache
        if not force_recompute and cache_path.exists():
            try:
                if cache_path.stat().st_mtime >= file_path.stat().st_mtime:
                    with open(cache_path, "r", encoding="utf-8") as f:
                        cached_data = json.load(f)
                        cached_data["from_cache"] = True
                        return cached_data
            except Exception as e:
                # If cache read fails, recompute
                pass

        start_time = time.time()

        # 2. Load Audio with Librosa
        # Load at 22.05kHz mono for fast and accurate structural analysis
        y, sr = librosa.load(str(file_path), sr=22050, mono=True)
        duration = round(len(y) / sr, 3)

        # 3. Extract Features
        bpm, beat_positions = cls.estimate_bpm_and_beats(y, sr)
        silence_regions = cls.detect_silence_regions(y, sr)
        energy_metrics = cls.calculate_energy_and_peaks(y)
        sections = cls.estimate_song_sections(y, sr, duration)
        stem_activity = cls.calculate_stem_activity(file_path, duration)

        analysis_duration = round(time.time() - start_time, 3)

        result: Dict[str, Any] = {
            "filename": file_path.name,
            "duration_seconds": duration,
            "sample_rate": sr,
            "bpm": bpm,
            "beat_count": len(beat_positions),
            "beat_positions": beat_positions,
            "silence_regions": silence_regions,
            "silence_count": len(silence_regions),
            "energy": energy_metrics,
            "sections": sections,
            "section_count": len(sections),
            "stem_activity": stem_activity,
            "analysis_time_seconds": analysis_duration,
            "analyzed_at": int(time.time() * 1000),
            "from_cache": False
        }

        # 4. Save to Cache
        try:
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception as e:
            print(f"Warning: Failed to save analysis cache: {e}")

        return result
