import React, { useState } from 'react';
import {
  Download,
  CheckCircle2,
  AlertCircle,
  Disc3,
  Sliders,
  Layers,
  FileAudio,
  Radio,
  Check,
} from 'lucide-react';
import {
  AudioExportEngine,
  ExportTarget,
  ExportFormat,
  ExportBitDepth,
  ExportSampleRate,
  ExportValidationResult,
} from '../audio/export/AudioExportEngine';
import { audioEngine } from '../audio/AudioEngine';
import { timelineModel } from '../audio/timeline/TimelineModel';
import { remixComposerModel } from '../audio/remix/RemixComposerModel';
import { Track } from '../audio/timeline/types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  tracks: Track[];
  showToast: (msg: string, type?: 'error' | 'success') => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  tracks,
  showToast,
}) => {
  const [target, setTarget] = useState<ExportTarget>('full_mix');
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [sampleRate, setSampleRate] = useState<ExportSampleRate>(44100);
  const [bitDepth, setBitDepth] = useState<ExportBitDepth>(16);
  const [mp3Bitrate, setMp3Bitrate] = useState<'128k' | '192k' | '256k' | '320k'>('320k');
  const [selectedTrackId, setSelectedTrackId] = useState<string>('track-1');
  const [selectedStems, setSelectedStems] = useState<Record<string, boolean>>({
    vocals: true,
    drums: true,
    bass: true,
    other: true,
  });
  const [regionStart, setRegionStart] = useState<number>(0);
  const [regionEnd, setRegionEnd] = useState<number>(timelineModel.getTotalDuration());
  const [customFilename, setCustomFilename] = useState<string>('My_AudioWeave_Session');

  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<ExportValidationResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const totalDuration = timelineModel.getTotalDuration();

  const toggleStem = (stem: string) => {
    setSelectedStems((prev) => ({
      ...prev,
      [stem]: !prev[stem],
    }));
  };

  const handleStartExport = async () => {
    setIsRendering(true);
    setValidationResult(null);
    setExportError(null);

    try {
      const activeStemsList = Object.keys(selectedStems).filter((s) => selectedStems[s]);

      if (target === 'stems') {
        showToast('Rendering all 4 synchronized stems...', 'success');
        const stemResults = await AudioExportEngine.exportStemSet(timelineModel, sampleRate, bitDepth, audioEngine);
        const entries = Object.values(stemResults);
        if (entries.length === 0) {
          throw new Error('No audio clips available on stem tracks to export.');
        }
        for (const result of entries) {
          AudioExportEngine.triggerDownload(result.blob, result.filename);
        }
        showToast('All 4 stems exported and downloaded!', 'success');
        onClose();
        return;
      }

      showToast(`Rendering ${target.replace('_', ' ')} (${format.toUpperCase()})...`, 'success');

      const result = await AudioExportEngine.exportAudio(
        {
          target,
          format,
          sampleRate,
          bitDepth,
          mp3Bitrate,
          selectedTrackId: target === 'selected_track' ? selectedTrackId : undefined,
          includedStems: target === 'selected_track' ? undefined : activeStemsList,
          regionStart: target === 'selected_region' ? regionStart : undefined,
          regionEnd: target === 'selected_region' ? regionEnd : undefined,
          filename: customFilename.trim() || 'AudioWeave_Render',
          engine: audioEngine,
        },
        timelineModel,
        remixComposerModel,
        audioEngine
      );

      setValidationResult(result.validation);

      if (result.validation.isValid) {
        AudioExportEngine.triggerDownload(result.blob, result.filename);
        showToast(`Exported "${result.filename}" successfully!`, 'success');
      } else {
        const warning = result.validation.error || 'Check audio content';
        setExportError(warning);
        showToast(`Validation warning: ${warning}`, 'error');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setExportError(errorMsg);
      showToast(`Export failed: ${errorMsg}`, 'error');
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#10141d] border border-[#222b3d] rounded-2xl w-full max-w-xl flex flex-col shadow-2xl overflow-hidden select-none">
        {/* Header */}
        <div className="p-5 border-b border-[#1d2535] flex items-center justify-between shrink-0 bg-[#131824]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 flex items-center justify-center shadow-md">
              <Download className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white">Export Audio Studio</h2>
              <p className="text-[11px] text-zinc-400">
                Sample-accurate rendering, effects rack processing, and multi-format export
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 rounded-lg text-sm font-mono"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
          {/* Filename Input */}
          <div className="space-y-1">
            <label className="text-zinc-300 font-semibold">Output Filename</label>
            <input
              type="text"
              value={customFilename}
              onChange={(e) => setCustomFilename(e.target.value)}
              className="w-full bg-[#0a0d14] border border-[#222a3d] rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
            />
          </div>

          {/* 1. Export Target Selection */}
          <div className="space-y-1.5">
            <label className="text-zinc-300 font-semibold">Export Target</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'full_mix', label: 'Full Mix', desc: 'All active tracks combined', icon: Layers },
                { id: 'stems', label: 'Individual Stems', desc: 'All 4 stems as separate files', icon: Sliders },
                { id: 'selected_track', label: 'Selected Track', desc: 'Render one single track', icon: FileAudio },
                { id: 'selected_region', label: 'Selected Region', desc: 'Custom time boundary [start, end]', icon: Radio },
                { id: 'arrangement', label: 'Remix Arrangement', desc: 'Active Remix Composer sequence', icon: Disc3 },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = target === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setTarget(item.id as ExportTarget)}
                    className={`p-3 rounded-xl border text-left flex items-start gap-2.5 transition-all ${
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500 text-white shadow-sm'
                        : 'bg-[#141824] hover:bg-[#1a2030] border-[#222a3d] text-zinc-300'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 ${isSelected ? 'text-blue-400' : 'text-zinc-500'}`} />
                    <div>
                      <span className="font-bold block text-white">{item.label}</span>
                      <span className="text-[10px] text-zinc-400">{item.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Stem Selector for Mix / Arrangement */}
          {target !== 'selected_track' && target !== 'stems' && (
            <div className="bg-[#131724] p-3 rounded-xl border border-[#21293a] space-y-1.5">
              <label className="text-zinc-300 font-semibold">Include Selected Stems</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'vocals', label: 'Vocals', color: 'border-cyan-500/50 text-cyan-400' },
                  { id: 'drums', label: 'Drums', color: 'border-amber-500/50 text-amber-400' },
                  { id: 'bass', label: 'Bass', color: 'border-purple-500/50 text-purple-400' },
                  { id: 'other', label: 'Other', color: 'border-emerald-500/50 text-emerald-400' },
                ].map((st) => {
                  const active = !!selectedStems[st.id];
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => toggleStem(st.id)}
                      className={`py-1.5 px-2 rounded-lg border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                        active
                          ? `bg-[#1a2333] ${st.color}`
                          : 'bg-[#0d1017] border-[#202738] text-zinc-500 hover:text-zinc-400'
                      }`}
                    >
                      {active && <Check className="w-3 h-3" />}
                      <span>{st.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected Track Dropdown */}
          {target === 'selected_track' && (
            <div className="space-y-1 bg-[#131724] p-3 rounded-xl border border-[#21293a]">
              <label className="text-zinc-300 font-semibold">Choose Track to Render</label>
              <select
                value={selectedTrackId}
                onChange={(e) => setSelectedTrackId(e.target.value)}
                className="w-full bg-[#0b0e16] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
              >
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Selected Region Bounds */}
          {target === 'selected_region' && (
            <div className="bg-[#131724] p-3 rounded-xl border border-[#21293a] space-y-2">
              <label className="text-zinc-300 font-semibold">Region Boundaries (Seconds)</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[10px] text-zinc-400">Start Time:</span>
                  <input
                    type="number"
                    min={0}
                    max={totalDuration}
                    step={0.1}
                    value={regionStart}
                    onChange={(e) => setRegionStart(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="w-full bg-[#0b0e16] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-zinc-400">End Time:</span>
                  <input
                    type="number"
                    min={0}
                    max={totalDuration}
                    step={0.1}
                    value={regionEnd}
                    onChange={(e) => setRegionEnd(Math.max(regionStart + 0.1, parseFloat(e.target.value) || totalDuration))}
                    className="w-full bg-[#0b0e16] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 2. Format & Quality Settings */}
          <div className="grid grid-cols-2 gap-4 bg-[#131824] p-3.5 rounded-xl border border-[#202738]">
            {/* Format Choice */}
            <div className="space-y-1">
              <label className="text-zinc-300 font-semibold">Format</label>
              <div className="flex gap-2">
                {(['wav', 'mp3'] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    className={`flex-1 py-1.5 rounded-lg font-mono font-bold uppercase transition-all ${
                      format === fmt
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-[#181e2b] text-zinc-400 border border-[#263044]'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Sample Rate */}
            <div className="space-y-1">
              <label className="text-zinc-300 font-semibold">Sample Rate</label>
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(parseInt(e.target.value) as ExportSampleRate)}
                className="w-full bg-[#0c0f17] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
              >
                <option value={44100}>44.1 kHz (CD Quality)</option>
                <option value={48000}>48.0 kHz (Studio Quality)</option>
              </select>
            </div>

            {/* Bit Depth / Bitrate */}
            {format === 'wav' ? (
              <div className="space-y-1">
                <label className="text-zinc-300 font-semibold">WAV Bit Depth</label>
                <select
                  value={bitDepth}
                  onChange={(e) => setBitDepth(parseInt(e.target.value) as ExportBitDepth)}
                  className="w-full bg-[#0c0f17] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                >
                  <option value={16}>16-Bit PCM (Standard)</option>
                  <option value={24}>24-Bit PCM (High-Res Master)</option>
                </select>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-zinc-300 font-semibold">MP3 Bitrate</label>
                <select
                  value={mp3Bitrate}
                  onChange={(e) => setMp3Bitrate(e.target.value as '128k' | '192k' | '256k' | '320k')}
                  className="w-full bg-[#0c0f17] border border-[#263147] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none font-mono"
                >
                  <option value="128k">128 kbps (Standard)</option>
                  <option value="192k">192 kbps (Medium)</option>
                  <option value="256k">256 kbps (High)</option>
                  <option value="320k">320 kbps (Maximum Quality)</option>
                </select>
              </div>
            )}
          </div>

          {/* Validation & Error Feedback Display */}
          {exportError && (
            <div className="p-3 rounded-xl border text-xs flex items-center gap-2 bg-red-950/40 border-red-500/40 text-red-300">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <div>
                <span className="font-bold">Export Notice</span>
                <p className="text-[11px] text-red-200/80">{exportError}</p>
              </div>
            </div>
          )}

          {validationResult && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                validationResult.isValid
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : 'bg-amber-950/40 border-amber-500/40 text-amber-300'
              }`}
            >
              <div className="flex items-center gap-2">
                {validationResult.isValid ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                )}
                <div>
                  <span className="font-bold">
                    {validationResult.isValid ? 'Audio Validation Passed' : 'Validation Alert'}
                  </span>
                  <div className="text-[10px] font-mono text-zinc-400">
                    Duration: {validationResult.duration}s | Sample Rate: {validationResult.sampleRate}Hz | Max Peak: {validationResult.maxPeak}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#121622] border-t border-[#1d2535] flex items-center justify-between shrink-0">
          <span className="text-[11px] text-zinc-500 font-mono">
            Renders via sample-accurate OfflineAudioContext &amp; EffectsRack
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isRendering}
              className="px-3.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white"
            >
              Cancel
            </button>

            <button
              onClick={handleStartExport}
              disabled={isRendering}
              className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 text-white shadow-lg transition-all ${
                isRendering
                  ? 'bg-blue-800 cursor-not-allowed opacity-60'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 shadow-blue-500/25'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>{isRendering ? 'Rendering Audio...' : 'Start Render & Download'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
