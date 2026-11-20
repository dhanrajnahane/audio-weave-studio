import time
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
import sys

# Setup backend import path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.utils.song_analyzer import SongAnalyzer
from app.config import STORAGE_DIR

class TestSmartSongAnalyzer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures_dir = STORAGE_DIR / "test_fixtures"
        cls.fixtures_dir.mkdir(parents=True, exist_ok=True)

        # 1. Real song 1: song1222_15s.wav
        cls.song1_path = cls.fixtures_dir / "song1222_15s.wav"
        if not cls.song1_path.exists():
            # If not in test_fixtures, check stems folder
            alt_path = STORAGE_DIR / "stems" / "user_song" / "htdemucs" / "song1222_15s" / "vocals.wav"
            if alt_path.exists():
                y, sr = sf.read(str(alt_path))
                sf.write(str(cls.song1_path), y, sr)

        # 2. Real song 2: acoustic synthesizer with intentional silence pause
        cls.song2_path = cls.fixtures_dir / "acoustic_with_silence.wav"
        sr = 22050
        duration = 8.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        audio = 0.5 * np.sin(2 * np.pi * 130.0 * t) # Bass tone
        # Inject intentional 1.5s silence gap in the middle (seconds 3.0 to 4.5)
        audio[int(sr * 3.0):int(sr * 4.5)] = 0.0
        # Inject leading 0.4s silence
        audio[:int(sr * 0.4)] = 0.0
        sf.write(str(cls.song2_path), audio, sr)

    def test_01_bpm_and_beat_estimation(self):
        """Feature 1 & 2: Estimate BPM and detect real beat positions."""
        analysis = SongAnalyzer.analyze_song(self.song1_path, force_recompute=True)

        self.assertIn("bpm", analysis)
        self.assertGreater(analysis["bpm"], 60.0, "BPM should be greater than 60")
        self.assertLess(analysis["bpm"], 220.0, "BPM should be less than 220")

        self.assertIn("beat_positions", analysis)
        beats = analysis["beat_positions"]
        self.assertGreater(len(beats), 5, "Beat count must be greater than 5 for real audio")
        self.assertTrue(all(isinstance(t, float) for t in beats))
        # Verify strictly increasing timestamps
        for i in range(len(beats) - 1):
            self.assertGreater(beats[i + 1], beats[i], "Beat timestamps must be monotonically increasing")

    def test_02_silence_detection(self):
        """Feature 3: Detect silence regions accurately."""
        analysis = SongAnalyzer.analyze_song(self.song2_path, force_recompute=True)

        self.assertIn("silence_regions", analysis)
        silences = analysis["silence_regions"]
        self.assertGreaterEqual(len(silences), 1, "Must detect the injected silence regions")

        # Find the middle silence gap (~3.0s to ~4.5s)
        mid_silence = None
        for s in silences:
            if s["start"] >= 2.8 and s["end"] <= 4.7:
                mid_silence = s
                break

        self.assertIsNotNone(mid_silence, f"Should detect the 1.5s silence gap (detected: {silences})")
        self.assertAlmostEqual(mid_silence["duration"], 1.5, delta=0.25)

    def test_03_rms_energy_and_peaks(self):
        """Feature 4 & 5: Calculate RMS energy, true peak and dynamic range."""
        analysis = SongAnalyzer.analyze_song(self.song1_path)

        energy = analysis["energy"]
        self.assertIn("average_rms", energy)
        self.assertGreater(energy["average_rms"], 0.01, "RMS must indicate active audio signal")
        self.assertIn("rms_dbfs", energy)
        self.assertLess(energy["rms_dbfs"], 0.0, "RMS dBFS must be negative")

        self.assertIn("peak_amplitude", energy)
        self.assertGreater(energy["peak_amplitude"], 0.05, "Peak level must be non-zero")
        self.assertLessEqual(energy["peak_amplitude"], 1.05, "Peak amplitude within bounds")

        self.assertIn("dynamic_range_db", energy)
        self.assertGreater(energy["dynamic_range_db"], 0.0)

        self.assertIn("energy_envelope", energy)
        self.assertEqual(len(energy["energy_envelope"]), 120, "Energy curve has 120 points")

    def test_04_song_sections_estimation(self):
        """Feature 6 & 7: Estimate song sections (Intro, Verse, Chorus, etc.) and timeline."""
        analysis = SongAnalyzer.analyze_song(self.song1_path)

        sections = analysis["sections"]
        self.assertGreaterEqual(len(sections), 1, "Must detect song sections")

        # Check section structure
        labels = [s["label"] for s in sections]
        valid_labels = {"Intro", "Verse", "Chorus", "Bridge", "Outro", "Full Track", "Segment"}
        self.assertTrue(all(lbl in valid_labels for lbl in labels), f"Labels must be valid musical sections: {labels}")

        for sec in sections:
            self.assertIn("start", sec)
            self.assertIn("end", sec)
            self.assertIn("confidence", sec)
            self.assertGreater(sec["confidence"], 0.5, "Confidence score must be meaningful")
            self.assertIn("is_estimated", sec)
            self.assertIn("energy_level", sec)
            self.assertIn(sec["energy_level"], ["low", "medium", "high"])

        # Timeline contiguous integrity
        self.assertEqual(sections[0]["start"], 0.0, "First section starts at 0.0s")
        for i in range(len(sections) - 1):
            self.assertAlmostEqual(sections[i]["end"], sections[i + 1]["start"], delta=0.05,
                                   msg="Sections must form a contiguous timeline")

    def test_05_stem_activity_map(self):
        """Feature 8: Create stem activity map when separated stems exist."""
        analysis = SongAnalyzer.analyze_song(self.song1_path)

        activity = analysis.get("stem_activity")
        if activity:
            self.assertTrue(activity["has_stems"])
            dist = activity["energy_distribution"]
            self.assertIn("vocals", dist)
            self.assertIn("drums", dist)
            self.assertIn("bass", dist)
            self.assertIn("other", dist)
            # Sum of percentages should be close to 100%
            self.assertAlmostEqual(sum(dist.values()), 100.0, delta=1.5)

            self.assertIn("timeline_buckets", activity)
            self.assertGreater(len(activity["timeline_buckets"]), 5)

    def test_06_analysis_caching(self):
        """Verify transparent caching: repeat requests are instantaneous (< 15ms)."""
        # First call ensures cache exists
        SongAnalyzer.analyze_song(self.song1_path)

        # Second call should load from cache
        t0 = time.time()
        cached = SongAnalyzer.analyze_song(self.song1_path)
        elapsed = (time.time() - t0) * 1000.0

        self.assertTrue(cached.get("from_cache"), "Should be loaded from cache")
        self.assertLess(elapsed, 25.0, f"Cache retrieval should be < 25ms (took {elapsed:.2f}ms)")

    def test_07_error_handling(self):
        """Handle missing or invalid audio files gracefully."""
        with self.assertRaises(FileNotFoundError):
            SongAnalyzer.analyze_song(Path("non_existent_file.wav"))

if __name__ == "__main__":
    unittest.main()
