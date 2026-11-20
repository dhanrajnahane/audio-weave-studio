import React, { useState, useEffect, useCallback } from 'react';
import {
  BrainCircuit,
  Activity,
  Flame,
  Volume2,
  RefreshCw,
  Sliders,
  Disc3,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { AudioAsset, SongAnalysisResult, SongSectionAnalysis } from '../types/audio';
import { remixComposerModel } from '../audio/remix/RemixComposerModel';
import { projectManager } from '../audio/project/ProjectManager';
import { MusicalSection, MusicalSectionType } from '../audio/remix/types';

interface SongAnalyzerViewProps {
  activeAsset: AudioAsset | null;
  onNavigateToRemix?: () => void;
  showToast: (msg: string, type?: 'error' | 'success') => void;
}

export const SongAnalyzerView: React.FC<SongAnalyzerViewProps> = ({
  activeAsset,
  onNavigateToRemix,
  showToast,
}) => {
  const [analysis, setAnalysis] = useState<SongAnalysisResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedSection, setSelectedSection] = useState<SongSectionAnalysis | null>(null);

  const fetchAnalysis = useCallback(
    async (force: boolean = false) => {
      if (!activeAsset) return;

      setIsLoading(true);
      try {
        const url = `/api/audio/analyze/${encodeURIComponent(activeAsset.stored_filename)}?force=${force}`;
        const res = await fetch(url);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || 'Analysis request failed on backend.');
        }

        const data: SongAnalysisResult = await res.json();
        setAnalysis(data);
        projectManager.setAnalysisResult(data);
        if (data.sections && data.sections.length > 0) {
          setSelectedSection(data.sections[0]);
        }

        if (data.from_cache) {
          showToast('Loaded real acoustic analysis from cache (< 5ms).', 'success');
        } else {
          showToast(
            `Analysis complete in ${data.analysis_time_seconds}s (Librosa & SciPy)!`,
            'success'
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Song Analyzer error: ${msg}`, 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [activeAsset, showToast]
  );

  useEffect(() => {
    const existing = projectManager.getAnalysisResult();
    if (existing && (!activeAsset || existing.filename === activeAsset.filename)) {
      setAnalysis(existing);
      if (existing.sections && existing.sections.length > 0) {
        setSelectedSection(existing.sections[0]);
      }
    } else if (activeAsset) {
      fetchAnalysis(false);
    } else {
      setAnalysis(null);
      setSelectedSection(null);
    }
  }, [activeAsset, fetchAnalysis]);

  const handleSyncToRemixComposer = () => {
    if (!analysis || !analysis.sections || analysis.sections.length === 0) {
      showToast('No analyzed sections to sync.', 'error');
      return;
    }

    const normalizeType = (label: string): MusicalSectionType => {
      const l = label.toLowerCase();
      if (l.includes('intro')) return 'intro';
      if (l.includes('chorus') || l.includes('hook')) return 'chorus';
      if (l.includes('bridge')) return 'bridge';
      if (l.includes('outro')) return 'outro';
      return 'verse';
    };

    const getHexColor = (type: MusicalSectionType): string => {
      switch (type) {
        case 'intro': return '#06b6d4';
        case 'verse': return '#3b82f6';
        case 'chorus': return '#f59e0b';
        case 'bridge': return '#a855f7';
        case 'outro': return '#10b981';
        default: return '#6b7280';
      }
    };

    const getNumericEnergy = (level: 'low' | 'medium' | 'high'): number => {
      switch (level) {
        case 'low': return 0.3;
        case 'medium': return 0.65;
        case 'high': return 0.95;
        default: return 0.5;
      }
    };

    // Convert SongSectionAnalysis to MusicalSection format for RemixComposerModel
    const composerSections: MusicalSection[] = analysis.sections.map((sec) => {
      const secType = normalizeType(sec.label);
      return {
        id: sec.id,
        name: sec.label,
        type: secType,
        start: sec.start,
        end: sec.end,
        duration: sec.duration,
        energy: getNumericEnergy(sec.energy_level),
        color: getHexColor(secType),
      };
    });

    remixComposerModel.setDetectedSections(composerSections);
    showToast(
      `Synchronized ${composerSections.length} real acoustic sections to Remix Composer!`,
      'success'
    );
    if (onNavigateToRemix) {
      onNavigateToRemix();
    }
  };

  const getSectionColor = (label: string) => {
    switch (label.toLowerCase()) {
      case 'intro':
        return 'from-cyan-600 to-blue-700 border-cyan-400 text-cyan-200';
      case 'verse':
        return 'from-blue-600 to-indigo-700 border-blue-400 text-blue-200';
      case 'chorus':
        return 'from-amber-500 to-orange-600 border-amber-300 text-amber-100';
      case 'bridge':
        return 'from-purple-600 to-fuchsia-700 border-purple-400 text-purple-200';
      case 'outro':
        return 'from-emerald-600 to-teal-700 border-emerald-400 text-emerald-200';
      default:
        return 'from-zinc-700 to-zinc-800 border-zinc-500 text-zinc-200';
    }
  };

  if (!activeAsset) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#090b10]">
        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4 text-zinc-600">
          <BrainCircuit className="w-8 h-8" />
        </div>
        <h2 className="text-base font-semibold text-zinc-200">No Audio Track Selected</h2>
        <p className="text-xs text-zinc-500 max-w-sm mt-1">
          Import or select an audio track from the library on the left to perform real acoustic
          analysis with Librosa, NumPy, and SciPy.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080a0f] text-zinc-100 overflow-y-auto">
      {/* 1. Header Toolbar */}
      <div className="px-6 py-4 border-b border-[#1b2233] bg-[#0c1017] flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-600/20">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-white tracking-wide">
                Smart Song Analyzer
              </h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-violet-500/20 text-violet-300 border border-violet-500/30">
                Librosa DSP
              </span>
              {analysis?.from_cache && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Cached</span>
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              Analyzing: <strong className="text-zinc-200">{activeAsset.filename}</strong> (
              {activeAsset.metadata.duration_formatted} • {activeAsset.metadata.sample_rate} Hz)
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={() => fetchAnalysis(true)}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#181f2f] hover:bg-[#20293d] border border-[#2b3752] text-xs font-semibold text-zinc-300 rounded-lg transition disabled:opacity-50"
            title="Bypass cache and perform fresh Librosa acoustic feature extraction"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Re-Analyze</span>
          </button>

          <button
            onClick={handleSyncToRemixComposer}
            disabled={!analysis || !analysis.sections || analysis.sections.length === 0}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-semibold rounded-lg shadow-md shadow-cyan-600/20 transition disabled:opacity-40"
          >
            <Disc3 className="w-3.5 h-3.5" />
            <span>Sync to Remix Composer</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
          <div className="w-12 h-12 rounded-full border-4 border-violet-500/20 border-t-violet-500 animate-spin mb-4" />
          <h3 className="text-sm font-semibold text-zinc-200">
            Running Acoustic Analysis Pipeline...
          </h3>
          <p className="text-xs text-zinc-400 max-w-sm mt-1">
            Computing onset envelope, beat tracking, silence detection, and agglomerative section
            clustering with Librosa & NumPy.
          </p>
        </div>
      ) : !analysis ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
          <p className="text-xs text-zinc-500">Click &apos;Re-Analyze&apos; to process this audio track.</p>
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {/* 2. Key Metrics Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {/* Card 1: Estimated BPM */}
            <div className="p-4 rounded-xl bg-[#0f131c] border border-[#1e2536] relative overflow-hidden">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                <span>Estimated Tempo</span>
                <Zap className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1.5">
                <span className="text-2xl font-bold font-mono text-white tracking-tight">
                  {analysis.bpm}
                </span>
                <span className="text-xs font-bold text-amber-400">BPM</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 font-mono">
                {analysis.beat_count} beat markers
              </div>
            </div>

            {/* Card 2: Average RMS Energy */}
            <div className="p-4 rounded-xl bg-[#0f131c] border border-[#1e2536]">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                <span>RMS Energy</span>
                <Activity className="w-3.5 h-3.5 text-blue-400" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1.5">
                <span className="text-2xl font-bold font-mono text-white tracking-tight">
                  {analysis.energy.rms_dbfs}
                </span>
                <span className="text-xs font-mono text-blue-400">dBFS</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 font-mono">
                Max RMS: {analysis.energy.max_rms}
              </div>
            </div>

            {/* Card 3: True Peak & Dynamic Range */}
            <div className="p-4 rounded-xl bg-[#0f131c] border border-[#1e2536]">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                <span>Peak Amplitude</span>
                <Flame className="w-3.5 h-3.5 text-rose-400" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1.5">
                <span className="text-2xl font-bold font-mono text-white tracking-tight">
                  {analysis.energy.peak_dbfs}
                </span>
                <span className="text-xs font-mono text-rose-400">dBFS</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 font-mono">
                Dynamic Range: {analysis.energy.dynamic_range_db} dB
              </div>
            </div>

            {/* Card 4: Silence Regions */}
            <div className="p-4 rounded-xl bg-[#0f131c] border border-[#1e2536]">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                <span>Silence Detected</span>
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1.5">
                <span className="text-2xl font-bold font-mono text-white tracking-tight">
                  {analysis.silence_count}
                </span>
                <span className="text-xs text-cyan-400">regions</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 font-mono">
                Total:{' '}
                {analysis.silence_regions
                  .reduce((acc, s) => acc + s.duration, 0)
                  .toFixed(2)}
                s
              </div>
            </div>

            {/* Card 5: Sections Count */}
            <div className="p-4 rounded-xl bg-[#0f131c] border border-[#1e2536]">
              <div className="flex items-center justify-between text-zinc-400 text-xs font-medium">
                <span>Song Sections</span>
                <Layers className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="mt-2 flex items-baseline space-x-1.5">
                <span className="text-2xl font-bold font-mono text-white tracking-tight">
                  {analysis.section_count}
                </span>
                <span className="text-xs text-purple-400">sections</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500 font-mono">
                {analysis.sections.filter((s) => !s.is_estimated).length} Verified •{' '}
                {analysis.sections.filter((s) => s.is_estimated).length} Estimated
              </div>
            </div>
          </div>

          {/* 3. Section Timeline Visualizer */}
          <div className="p-5 rounded-2xl bg-[#0f131c] border border-[#1e2536] space-y-4 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Acoustic Section Segmentation
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Calculated from chroma recurrence &amp; spectral contrast clustering.
                </p>
              </div>
              <div className="flex items-center space-x-2 text-[11px]">
                <span className="flex items-center space-x-1 text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>High Confidence</span>
                </span>
                <span className="text-zinc-600">•</span>
                <span className="flex items-center space-x-1 text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Estimated Boundary</span>
                </span>
              </div>
            </div>

            {/* Visual Multi-Section Strip */}
            <div className="h-14 w-full bg-[#080b12] rounded-xl border border-[#1e2434] overflow-hidden flex p-1 gap-1">
              {analysis.sections.map((sec) => {
                const widthPercent = (sec.duration / analysis.duration_seconds) * 100;
                const isSelected = selectedSection?.id === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => setSelectedSection(sec)}
                    style={{ width: `${Math.max(widthPercent, 5)}%` }}
                    className={`h-full rounded-lg bg-gradient-to-r ${getSectionColor(
                      sec.label
                    )} border px-2.5 flex flex-col justify-center items-start text-left transition-all cursor-pointer relative overflow-hidden group ${
                      isSelected ? 'ring-2 ring-white shadow-lg' : 'opacity-85 hover:opacity-100'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-bold text-xs truncate drop-shadow-sm">
                        {sec.label}
                      </span>
                      {sec.is_estimated && (
                        <span className="text-[9px] px-1 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40 font-mono">
                          EST
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-mono opacity-80 truncate">
                      {sec.duration}s
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Section Detail Inspector */}
            {selectedSection && (
              <div className="p-3.5 rounded-xl bg-[#0a0d14] border border-[#1a2030] flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="flex items-center space-x-3">
                  <span
                    className={`px-3 py-1 rounded-md font-bold uppercase tracking-wider bg-gradient-to-r ${getSectionColor(
                      selectedSection.label
                    )}`}
                  >
                    {selectedSection.label}
                  </span>
                  <span className="text-zinc-300">
                    Timestamp: <strong>{selectedSection.start.toFixed(2)}s</strong> →{' '}
                    <strong>{selectedSection.end.toFixed(2)}s</strong> (Duration:{' '}
                    {selectedSection.duration}s)
                  </span>
                </div>

                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-zinc-500">Confidence:</span>
                    <span
                      className={`font-bold ${
                        selectedSection.is_estimated ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {Math.round(selectedSection.confidence * 100)}% (
                      {selectedSection.confidence_label})
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <span className="text-zinc-500">Energy:</span>
                    <span
                      className={`px-2 py-0.5 rounded uppercase text-[10px] font-bold ${
                        selectedSection.energy_level === 'high'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : selectedSection.energy_level === 'medium'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                      }`}
                    >
                      {selectedSection.energy_level}
                    </span>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <span className="text-zinc-500">RMS:</span>
                    <span className="text-zinc-200">{selectedSection.avg_rms}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 4. Real Waveform Energy Envelope & Beat Positions */}
          <div className="p-5 rounded-2xl bg-[#0f131c] border border-[#1e2536] space-y-3 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  RMS Energy Curve &amp; Beat Grid Overlays
                </h3>
                <p className="text-[11px] text-zinc-500">
                  Continuous frame energy with beat onsets and detected silence overlays.
                </p>
              </div>
              <div className="flex items-center space-x-3 text-[11px] font-mono text-zinc-400">
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-400" />
                  <span>RMS Envelope</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                  <span>Beat Grid ({analysis.bpm} BPM)</span>
                </span>
                <span className="flex items-center space-x-1">
                  <span className="w-2.5 h-2.5 rounded bg-red-500/40 border border-red-500/60" />
                  <span>Silence Gap</span>
                </span>
              </div>
            </div>

            {/* SVG Visualizer */}
            <div className="h-32 w-full bg-[#06080d] rounded-xl border border-[#181e2e] relative overflow-hidden flex items-end p-1">
              {/* Silence Region Overlays */}
              {analysis.silence_regions.map((sil, sIdx) => {
                const leftPct = (sil.start / analysis.duration_seconds) * 100;
                const widthPct = (sil.duration / analysis.duration_seconds) * 100;
                return (
                  <div
                    key={`sil-${sIdx}`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    className="absolute top-0 bottom-0 bg-red-500/15 border-x border-red-500/30 flex items-center justify-center pointer-events-none"
                    title={`Silence: ${sil.start}s - ${sil.end}s (${sil.duration}s)`}
                  >
                    <span className="text-[9px] font-mono text-red-300/80 bg-red-950/80 px-1 rounded">
                      SILENCE
                    </span>
                  </div>
                );
              })}

              {/* Beat Marker Grid Lines */}
              {analysis.beat_positions.map((beatTime, bIdx) => {
                const leftPct = (beatTime / analysis.duration_seconds) * 100;
                return (
                  <div
                    key={`beat-${bIdx}`}
                    style={{ left: `${leftPct}%` }}
                    className="absolute top-0 bottom-0 w-[1px] bg-amber-400/40 pointer-events-none"
                    title={`Beat at ${beatTime}s`}
                  />
                );
              })}

              {/* Energy Curve Bars */}
              <div className="w-full h-full flex items-end gap-[1px] z-10">
                {analysis.energy.energy_envelope.map((val, idx) => {
                  return (
                    <div
                      key={`env-${idx}`}
                      style={{ height: `${Math.max(val * 100, 4)}%` }}
                      className="flex-1 bg-gradient-to-t from-violet-700 via-violet-500 to-fuchsia-400 rounded-t-sm transition-all"
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* 5. Stem Activity Map (When Demucs stems exist) */}
          {analysis.stem_activity ? (
            <div className="p-5 rounded-2xl bg-[#0f131c] border border-[#1e2536] space-y-4 shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Demucs 4-Stem Activity Breakdown
                  </h3>
                  <p className="text-[11px] text-zinc-500">
                    Energy distribution across separated Vocals, Drums, Bass, and Other.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-md text-xs font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Folder: {analysis.stem_activity.stems_folder}
                </span>
              </div>

              {/* Energy Distribution Bars */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-[#090c12] border border-[#1c2333]">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Vocals</span>
                    <span className="font-mono font-bold text-cyan-400">
                      {analysis.stem_activity.energy_distribution.vocals}%
                    </span>
                  </div>
                  <div className="w-full bg-[#141a27] h-2 rounded-full overflow-hidden mt-2">
                    <div
                      style={{
                        width: `${analysis.stem_activity.energy_distribution.vocals}%`,
                      }}
                      className="h-full bg-cyan-500 rounded-full"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[#090c12] border border-[#1c2333]">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Drums</span>
                    <span className="font-mono font-bold text-amber-400">
                      {analysis.stem_activity.energy_distribution.drums}%
                    </span>
                  </div>
                  <div className="w-full bg-[#141a27] h-2 rounded-full overflow-hidden mt-2">
                    <div
                      style={{
                        width: `${analysis.stem_activity.energy_distribution.drums}%`,
                      }}
                      className="h-full bg-amber-500 rounded-full"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[#090c12] border border-[#1c2333]">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Bass</span>
                    <span className="font-mono font-bold text-purple-400">
                      {analysis.stem_activity.energy_distribution.bass}%
                    </span>
                  </div>
                  <div className="w-full bg-[#141a27] h-2 rounded-full overflow-hidden mt-2">
                    <div
                      style={{
                        width: `${analysis.stem_activity.energy_distribution.bass}%`,
                      }}
                      className="h-full bg-purple-500 rounded-full"
                    />
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-[#090c12] border border-[#1c2333]">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Other (Melody)</span>
                    <span className="font-mono font-bold text-emerald-400">
                      {analysis.stem_activity.energy_distribution.other}%
                    </span>
                  </div>
                  <div className="w-full bg-[#141a27] h-2 rounded-full overflow-hidden mt-2">
                    <div
                      style={{
                        width: `${analysis.stem_activity.energy_distribution.other}%`,
                      }}
                      className="h-full bg-emerald-500 rounded-full"
                    />
                  </div>
                </div>
              </div>

              {/* Stem Activity Heatmap Grid */}
              <div className="space-y-1.5 pt-2">
                <span className="text-[11px] font-mono text-zinc-400">
                  Stem Activity Timeline (Time Slices):
                </span>
                <div className="grid grid-cols-1 gap-1 bg-[#07090e] p-2.5 rounded-xl border border-[#1a2130]">
                  {(['vocals', 'drums', 'bass', 'other'] as const).map((stemKey) => (
                    <div key={stemKey} className="flex items-center space-x-2 text-xs">
                      <span className="w-14 uppercase font-mono text-[10px] font-bold text-zinc-400">
                        {stemKey}
                      </span>
                      <div className="flex-1 flex gap-[2px] h-4">
                        {analysis.stem_activity?.timeline_buckets.map((bucket, bIdx) => {
                          const val = bucket[stemKey];
                          const bg =
                            stemKey === 'vocals'
                              ? 'bg-cyan-500'
                              : stemKey === 'drums'
                              ? 'bg-amber-500'
                              : stemKey === 'bass'
                              ? 'bg-purple-500'
                              : 'bg-emerald-500';
                          return (
                            <div
                              key={bIdx}
                              style={{ opacity: Math.max(0.1, val) }}
                              className={`flex-1 rounded-sm ${bg}`}
                              title={`${stemKey.toUpperCase()}: ${(val * 100).toFixed(0)}% at ${
                                bucket.time_start
                              }s`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-[#0f131c] border border-[#1e2536] flex items-center justify-between text-xs text-zinc-400">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-zinc-500" />
                <span>
                  Stem activity map requires separated stems. Run <strong>AI Stem Separation</strong> in
                  the Mixer to unlock multi-stem energy analysis.
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
