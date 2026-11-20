import React, { useState, useEffect, useCallback } from 'react';
import {
  SlidersHorizontal,
  Play,
  Pause,
  Power,
  Sparkles,
  Waves,
  Activity,
  Clock,
} from 'lucide-react';
import { effectsManager } from '../audio/effects/EffectsManager';
import {
  TrackEffectsSettings,
  EqualizerSettings,
  ReverbSettings,
  DelaySettings,
  CompressorSettings,
} from '../audio/effects/types';
import { audioEngine } from '../audio/AudioEngine';
import { AudioAsset } from '../types/audio';

interface EffectsStudioProps {
  activeAsset: AudioAsset | null;
  isPlaying: boolean;
  showToast: (msg: string, type?: 'error' | 'success') => void;
  initialTarget?: string; // 'master' | 'vocals' | 'drums' | 'bass' | 'other'
}

type EffectTarget = 'master' | 'vocals' | 'drums' | 'bass' | 'other' | 'track-1' | 'track-2' | 'track-3' | 'track-4';

const TARGET_LABELS: Record<string, { name: string; tag: string; color: string }> = {
  master: { name: 'Master Output', tag: 'MASTER BUS', color: '#3b82f6' },
  vocals: { name: 'Vocals', tag: 'STEM 1', color: '#06b6d4' },
  drums: { name: 'Drums', tag: 'STEM 2', color: '#f59e0b' },
  bass: { name: 'Bass', tag: 'STEM 3', color: '#a855f7' },
  other: { name: 'Other', tag: 'STEM 4', color: '#10b981' },
  'track-1': { name: 'Vocals', tag: 'STEM 1', color: '#06b6d4' },
  'track-2': { name: 'Drums', tag: 'STEM 2', color: '#f59e0b' },
  'track-3': { name: 'Bass', tag: 'STEM 3', color: '#a855f7' },
  'track-4': { name: 'Other', tag: 'STEM 4', color: '#10b981' },
};

export const EffectsStudio: React.FC<EffectsStudioProps> = ({
  activeAsset,
  isPlaying,
  showToast,
  initialTarget = 'master',
}) => {
  const [target, setTarget] = useState<EffectTarget>(initialTarget as EffectTarget);
  const [settings, setSettings] = useState<TrackEffectsSettings>(
    target === 'master' ? effectsManager.getMasterSettings() : effectsManager.getTrackSettings(target)
  );

  const refreshSettings = useCallback(() => {
    if (target === 'master') {
      setSettings(effectsManager.getMasterSettings());
    } else {
      setSettings(effectsManager.getTrackSettings(target));
    }
  }, [target]);

  useEffect(() => {
    refreshSettings();
    const unsub = effectsManager.subscribe(refreshSettings);
    return () => unsub();
  }, [refreshSettings]);

  // Handle Target Switch
  const handleSelectTarget = (newTarget: EffectTarget) => {
    setTarget(newTarget);
    if (newTarget === 'master') {
      setSettings(effectsManager.getMasterSettings());
    } else {
      setSettings(effectsManager.getTrackSettings(newTarget));
    }
  };

  // -------------------------------------------------------------
  // Equalizer Updates
  // -------------------------------------------------------------
  const updateEQ = (patch: Partial<EqualizerSettings>) => {
    if (target === 'master') {
      effectsManager.setMasterEqualizer(patch);
    } else {
      effectsManager.setTrackEqualizer(target, patch);
    }
  };

  // -------------------------------------------------------------
  // Reverb Updates
  // -------------------------------------------------------------
  const updateReverb = (patch: Partial<ReverbSettings>) => {
    if (target === 'master') {
      effectsManager.setMasterReverb(patch);
    } else {
      effectsManager.setTrackReverb(target, patch);
    }
  };

  // -------------------------------------------------------------
  // Delay Updates
  // -------------------------------------------------------------
  const updateDelay = (patch: Partial<DelaySettings>) => {
    if (target === 'master') {
      effectsManager.setMasterDelay(patch);
    } else {
      effectsManager.setTrackDelay(target, patch);
    }
  };

  // -------------------------------------------------------------
  // Compressor Updates
  // -------------------------------------------------------------
  const updateCompressor = (patch: Partial<CompressorSettings>) => {
    if (target === 'master') {
      effectsManager.setMasterCompressor(patch);
    } else {
      effectsManager.setTrackCompressor(target, patch);
    }
  };

  const currentMeta = TARGET_LABELS[target];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080a0f] text-zinc-100 select-none overflow-y-auto">
      {/* 1. Header Toolbar */}
      <div className="px-6 py-3.5 border-b border-[#1b2233] bg-[#0c1017] flex flex-wrap items-center justify-between gap-4 shrink-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
            <SlidersHorizontal className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-white tracking-wide">Audio Effects Studio</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-orange-500/20 text-orange-300 border border-orange-500/40 font-bold">
                DSP RACK
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono">
              Real-time Web Audio API Processing • Equalizer • Reverb • Delay • Compressor
            </p>
          </div>
        </div>

        {/* Channel Selector Pills & Transport */}
        <div className="flex items-center gap-3">
          {/* Channel Target Selector */}
          <div className="flex items-center bg-[#131722] p-1 rounded-xl border border-[#232b3d] space-x-1">
            {(['master', 'vocals', 'drums', 'bass', 'other'] as const).map((tid) => {
              const meta = TARGET_LABELS[tid];
              const isSelected = target === tid || (tid === 'vocals' && target === 'track-1') || (tid === 'drums' && target === 'track-2') || (tid === 'bass' && target === 'track-3') || (tid === 'other' && target === 'track-4');

              return (
                <button
                  key={tid}
                  onClick={() => handleSelectTarget(tid)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-bold'
                      : 'text-zinc-400 hover:text-white hover:bg-[#1b2233]'
                  }`}
                >
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  <span>{meta.name}</span>
                </button>
              );
            })}
          </div>

          {/* Real-time Preview Play/Pause */}
          <button
            onClick={() => {
              if (isPlaying) {
                audioEngine.pause();
              } else {
                audioEngine.play();
                showToast('Auditioning effects in real time.', 'success');
              }
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
            }`}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause' : 'Audition'}</span>
          </button>
        </div>
      </div>

      {/* Target Status Banner */}
      <div className="bg-[#0f131c] border-b border-[#1d2435] px-6 py-2 flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2">
          <span className="text-zinc-400">Currently Editing:</span>
          <span
            className="px-2 py-0.5 rounded font-mono font-bold text-xs"
            style={{ backgroundColor: `${currentMeta.color}25`, color: currentMeta.color }}
          >
            {currentMeta.name} ({currentMeta.tag})
          </span>
          {activeAsset && (
            <span className="text-zinc-500 font-mono text-[11px]">
              [{activeAsset.filename}]
            </span>
          )}
          <span className="text-zinc-500 text-[11px]">
            • All changes apply immediately to Web Audio nodes and render during export.
          </span>
        </div>
        <div className="flex items-center space-x-2 text-[11px] text-zinc-400 font-mono">
          <span>Active Effects:</span>
          <span className={settings.eq.enabled ? 'text-cyan-400 font-bold' : 'text-zinc-600'}>EQ</span>
          <span>•</span>
          <span className={settings.compressor.enabled ? 'text-amber-400 font-bold' : 'text-zinc-600'}>COMP</span>
          <span>•</span>
          <span className={settings.delay.enabled ? 'text-purple-400 font-bold' : 'text-zinc-600'}>DELAY</span>
          <span>•</span>
          <span className={settings.reverb.enabled ? 'text-emerald-400 font-bold' : 'text-zinc-600'}>REVERB</span>
        </div>
      </div>

      {/* 2. Main Effects Studio Grid */}
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5 flex-1">
        {/* ========================================================= */}
        {/* EFFECT 1: 3-BAND PARAMETRIC EQUALIZER                     */}
        {/* ========================================================= */}
        <div
          className={`rounded-2xl border p-5 flex flex-col justify-between transition-all shadow-xl ${
            settings.eq.enabled
              ? 'bg-[#0f1420] border-cyan-500/50 shadow-cyan-950/20'
              : 'bg-[#0c0f16] border-[#1d2436] opacity-75'
          }`}
        >
          {/* Card Header */}
          <div className="flex items-center justify-between border-b border-[#1f2638] pb-3 mb-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-950 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                <Waves className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <span>3-Band Equalizer</span>
                  {settings.eq.enabled && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  )}
                </h3>
                <p className="text-[10px] text-zinc-400 font-mono">LowShelf • Peaking • HighShelf</p>
              </div>
            </div>

            {/* Power Toggle Switch */}
            <button
              onClick={() => {
                const next = !settings.eq.enabled;
                updateEQ({ enabled: next });
                showToast(`Equalizer ${next ? 'ENABLED' : 'BYPASSED'} for ${currentMeta.name}.`, 'success');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 border transition-all ${
                settings.eq.enabled
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-sm shadow-cyan-500/30'
                  : 'bg-[#161a24] text-zinc-500 border-[#252c3e] hover:text-zinc-300'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{settings.eq.enabled ? 'ACTIVE' : 'BYPASS'}</span>
            </button>
          </div>

          {/* EQ Sliders Grid (3 Bands) */}
          <div className="grid grid-cols-3 gap-3 my-2">
            {/* Low Shelf */}
            <div className="bg-[#131826] border border-[#20293d] rounded-xl p-3 flex flex-col items-center">
              <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">Low</span>
              <span className="text-[10px] font-mono text-zinc-400">{settings.eq.lowFreq} Hz</span>
              <input
                type="range"
                min="-24"
                max="24"
                step="0.5"
                value={settings.eq.lowGain}
                disabled={!settings.eq.enabled}
                onChange={(e) => updateEQ({ lowGain: parseFloat(e.target.value) })}
                className="w-full my-4 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-xs font-bold text-white">
                {settings.eq.lowGain > 0 ? `+${settings.eq.lowGain}` : settings.eq.lowGain} dB
              </span>
            </div>

            {/* Mid Peaking */}
            <div className="bg-[#131826] border border-[#20293d] rounded-xl p-3 flex flex-col items-center">
              <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">Mid</span>
              <span className="text-[10px] font-mono text-zinc-400">{settings.eq.midFreq} Hz</span>
              <input
                type="range"
                min="-24"
                max="24"
                step="0.5"
                value={settings.eq.midGain}
                disabled={!settings.eq.enabled}
                onChange={(e) => updateEQ({ midGain: parseFloat(e.target.value) })}
                className="w-full my-4 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-xs font-bold text-white">
                {settings.eq.midGain > 0 ? `+${settings.eq.midGain}` : settings.eq.midGain} dB
              </span>
            </div>

            {/* High Shelf */}
            <div className="bg-[#131826] border border-[#20293d] rounded-xl p-3 flex flex-col items-center">
              <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wider">High</span>
              <span className="text-[10px] font-mono text-zinc-400">{settings.eq.highFreq} Hz</span>
              <input
                type="range"
                min="-24"
                max="24"
                step="0.5"
                value={settings.eq.highGain}
                disabled={!settings.eq.enabled}
                onChange={(e) => updateEQ({ highGain: parseFloat(e.target.value) })}
                className="w-full my-4 accent-cyan-400 cursor-pointer"
              />
              <span className="font-mono text-xs font-bold text-white">
                {settings.eq.highGain > 0 ? `+${settings.eq.highGain}` : settings.eq.highGain} dB
              </span>
            </div>
          </div>

          {/* EQ Quick Presets */}
          <div className="mt-4 pt-3 border-t border-[#1f2638] flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 font-mono uppercase mr-1">Presets:</span>
            {[
              { name: 'Flat', low: 0, mid: 0, high: 0 },
              { name: 'Bass Boost', low: 6, mid: -1, high: 2 },
              { name: 'Vocal Air', low: -2, mid: 1, high: 5 },
              { name: 'Mid Scoop', low: 3, mid: -6, high: 3 },
            ].map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  updateEQ({ enabled: true, lowGain: p.low, midGain: p.mid, highGain: p.high });
                  showToast(`EQ Preset '${p.name}' applied.`, 'success');
                }}
                className="px-2 py-0.5 rounded bg-[#171c29] hover:bg-[#22293b] text-zinc-300 border border-[#29334a] text-[10px] font-mono transition"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* ========================================================= */}
        {/* EFFECT 2: DYNAMICS COMPRESSOR                             */}
        {/* ========================================================= */}
        <div
          className={`rounded-2xl border p-5 flex flex-col justify-between transition-all shadow-xl ${
            settings.compressor.enabled
              ? 'bg-[#0f1420] border-amber-500/50 shadow-amber-950/20'
              : 'bg-[#0c0f16] border-[#1d2436] opacity-75'
          }`}
        >
          {/* Card Header */}
          <div className="flex items-center justify-between border-b border-[#1f2638] pb-3 mb-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-950 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <span>Dynamics Compressor</span>
                  {settings.compressor.enabled && (
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </h3>
                <p className="text-[10px] text-zinc-400 font-mono">RMS Leveling • Peak Taming</p>
              </div>
            </div>

            {/* Power Toggle Switch */}
            <button
              onClick={() => {
                const next = !settings.compressor.enabled;
                updateCompressor({ enabled: next });
                showToast(`Compressor ${next ? 'ENABLED' : 'BYPASSED'} for ${currentMeta.name}.`, 'success');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 border transition-all ${
                settings.compressor.enabled
                  ? 'bg-amber-500/20 text-amber-300 border-amber-400 shadow-sm shadow-amber-500/30'
                  : 'bg-[#161a24] text-zinc-500 border-[#252c3e] hover:text-zinc-300'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{settings.compressor.enabled ? 'ACTIVE' : 'BYPASS'}</span>
            </button>
          </div>

          {/* Compressor Controls */}
          <div className="space-y-3 my-2 text-xs">
            {/* Threshold */}
            <div>
              <div className="flex justify-between text-zinc-400 text-[11px] mb-1">
                <span>Threshold</span>
                <span className="font-mono text-white font-bold">{settings.compressor.threshold} dB</span>
              </div>
              <input
                type="range"
                min="-60"
                max="0"
                step="1"
                value={settings.compressor.threshold}
                disabled={!settings.compressor.enabled}
                onChange={(e) => updateCompressor({ threshold: parseFloat(e.target.value) })}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            {/* Ratio */}
            <div>
              <div className="flex justify-between text-zinc-400 text-[11px] mb-1">
                <span>Ratio</span>
                <span className="font-mono text-white font-bold">{settings.compressor.ratio}:1</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="0.5"
                value={settings.compressor.ratio}
                disabled={!settings.compressor.enabled}
                onChange={(e) => updateCompressor({ ratio: parseFloat(e.target.value) })}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>

            {/* Attack & Release */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex justify-between text-zinc-400 text-[10px] mb-1">
                  <span>Attack</span>
                  <span className="font-mono text-white">{(settings.compressor.attack * 1000).toFixed(0)} ms</span>
                </div>
                <input
                  type="range"
                  min="0.001"
                  max="0.2"
                  step="0.002"
                  value={settings.compressor.attack}
                  disabled={!settings.compressor.enabled}
                  onChange={(e) => updateCompressor({ attack: parseFloat(e.target.value) })}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-zinc-400 text-[10px] mb-1">
                  <span>Release</span>
                  <span className="font-mono text-white">{(settings.compressor.release * 1000).toFixed(0)} ms</span>
                </div>
                <input
                  type="range"
                  min="0.01"
                  max="1.0"
                  step="0.02"
                  value={settings.compressor.release}
                  disabled={!settings.compressor.enabled}
                  onChange={(e) => updateCompressor({ release: parseFloat(e.target.value) })}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Compressor Presets */}
          <div className="mt-4 pt-3 border-t border-[#1f2638] flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 font-mono uppercase mr-1">Presets:</span>
            {[
              { name: 'Vocal Leveler', th: -22, r: 3.5, a: 0.005, rel: 0.2 },
              { name: 'Punchy Drums', th: -16, r: 6.0, a: 0.02, rel: 0.15 },
              { name: 'Master Glue', th: -12, r: 2.0, a: 0.01, rel: 0.3 },
            ].map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  updateCompressor({
                    enabled: true,
                    threshold: p.th,
                    ratio: p.r,
                    attack: p.a,
                    release: p.rel,
                  });
                  showToast(`Compressor Preset '${p.name}' applied.`, 'success');
                }}
                className="px-2 py-0.5 rounded bg-[#171c29] hover:bg-[#22293b] text-zinc-300 border border-[#29334a] text-[10px] font-mono transition"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* ========================================================= */}
        {/* EFFECT 3: STEREO FEEDBACK DELAY                           */}
        {/* ========================================================= */}
        <div
          className={`rounded-2xl border p-5 flex flex-col justify-between transition-all shadow-xl ${
            settings.delay.enabled
              ? 'bg-[#0f1420] border-purple-500/50 shadow-purple-950/20'
              : 'bg-[#0c0f16] border-[#1d2436] opacity-75'
          }`}
        >
          {/* Card Header */}
          <div className="flex items-center justify-between border-b border-[#1f2638] pb-3 mb-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-purple-950 border border-purple-500/40 flex items-center justify-center text-purple-400">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <span>Stereo Delay</span>
                  {settings.delay.enabled && (
                    <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                  )}
                </h3>
                <p className="text-[10px] text-zinc-400 font-mono">Feedback Echo • Tempo Sync</p>
              </div>
            </div>

            {/* Power Toggle Switch */}
            <button
              onClick={() => {
                const next = !settings.delay.enabled;
                updateDelay({ enabled: next });
                showToast(`Delay ${next ? 'ENABLED' : 'BYPASSED'} for ${currentMeta.name}.`, 'success');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 border transition-all ${
                settings.delay.enabled
                  ? 'bg-purple-500/20 text-purple-300 border-purple-400 shadow-sm shadow-purple-500/30'
                  : 'bg-[#161a24] text-zinc-500 border-[#252c3e] hover:text-zinc-300'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{settings.delay.enabled ? 'ACTIVE' : 'BYPASS'}</span>
            </button>
          </div>

          {/* Delay Controls */}
          <div className="space-y-3 my-2 text-xs">
            {/* Delay Time */}
            <div>
              <div className="flex justify-between text-zinc-400 text-[11px] mb-1">
                <span>Delay Time</span>
                <span className="font-mono text-white font-bold">{(settings.delay.time * 1000).toFixed(0)} ms</span>
              </div>
              <input
                type="range"
                min="0.02"
                max="1.0"
                step="0.01"
                value={settings.delay.time}
                disabled={!settings.delay.enabled}
                onChange={(e) => updateDelay({ time: parseFloat(e.target.value) })}
                className="w-full accent-purple-400 cursor-pointer"
              />
            </div>

            {/* Feedback */}
            <div>
              <div className="flex justify-between text-zinc-400 text-[11px] mb-1">
                <span>Feedback (Echo Tail)</span>
                <span className="font-mono text-white font-bold">{(settings.delay.feedback * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="0.85"
                step="0.02"
                value={settings.delay.feedback}
                disabled={!settings.delay.enabled}
                onChange={(e) => updateDelay({ feedback: parseFloat(e.target.value) })}
                className="w-full accent-purple-400 cursor-pointer"
              />
            </div>

            {/* Wet / Dry Balance */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex justify-between text-zinc-400 text-[10px] mb-1">
                  <span>Wet Level</span>
                  <span className="font-mono text-white">{(settings.delay.wet * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={settings.delay.wet}
                  disabled={!settings.delay.enabled}
                  onChange={(e) => updateDelay({ wet: parseFloat(e.target.value) })}
                  className="w-full accent-purple-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-zinc-400 text-[10px] mb-1">
                  <span>Dry Level</span>
                  <span className="font-mono text-white">{(settings.delay.dry * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={settings.delay.dry}
                  disabled={!settings.delay.enabled}
                  onChange={(e) => updateDelay({ dry: parseFloat(e.target.value) })}
                  className="w-full accent-purple-400 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Delay Presets */}
          <div className="mt-4 pt-3 border-t border-[#1f2638] flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 font-mono uppercase mr-1">Presets:</span>
            {[
              { name: 'Slapback', t: 0.08, fb: 0.15, w: 0.35 },
              { name: '1/8 Note Echo', t: 0.25, fb: 0.4, w: 0.3 },
              { name: 'Space Dub', t: 0.45, fb: 0.65, w: 0.5 },
            ].map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  updateDelay({ enabled: true, time: p.t, feedback: p.fb, wet: p.w });
                  showToast(`Delay Preset '${p.name}' applied.`, 'success');
                }}
                className="px-2 py-0.5 rounded bg-[#171c29] hover:bg-[#22293b] text-zinc-300 border border-[#29334a] text-[10px] font-mono transition"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* ========================================================= */}
        {/* EFFECT 4: CONVOLVER REVERB                                */}
        {/* ========================================================= */}
        <div
          className={`rounded-2xl border p-5 flex flex-col justify-between transition-all shadow-xl ${
            settings.reverb.enabled
              ? 'bg-[#0f1420] border-emerald-500/50 shadow-emerald-950/20'
              : 'bg-[#0c0f16] border-[#1d2436] opacity-75'
          }`}
        >
          {/* Card Header */}
          <div className="flex items-center justify-between border-b border-[#1f2638] pb-3 mb-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <span>Convolver Reverb</span>
                  {settings.reverb.enabled && (
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  )}
                </h3>
                <p className="text-[10px] text-zinc-400 font-mono">Algorithmic Room & Hall Simulation</p>
              </div>
            </div>

            {/* Power Toggle Switch */}
            <button
              onClick={() => {
                const next = !settings.reverb.enabled;
                updateReverb({ enabled: next });
                showToast(`Reverb ${next ? 'ENABLED' : 'BYPASSED'} for ${currentMeta.name}.`, 'success');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center space-x-1.5 border transition-all ${
                settings.reverb.enabled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400 shadow-sm shadow-emerald-500/30'
                  : 'bg-[#161a24] text-zinc-500 border-[#252c3e] hover:text-zinc-300'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{settings.reverb.enabled ? 'ACTIVE' : 'BYPASS'}</span>
            </button>
          </div>

          {/* Reverb Controls */}
          <div className="space-y-3 my-2 text-xs">
            {/* Decay Time */}
            <div>
              <div className="flex justify-between text-zinc-400 text-[11px] mb-1">
                <span>Decay Time</span>
                <span className="font-mono text-white font-bold">{settings.reverb.decay.toFixed(1)} s</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="8.0"
                step="0.1"
                value={settings.reverb.decay}
                disabled={!settings.reverb.enabled}
                onChange={(e) => updateReverb({ decay: parseFloat(e.target.value) })}
                className="w-full accent-emerald-400 cursor-pointer"
              />
            </div>

            {/* Wet / Dry Balance */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <div className="flex justify-between text-zinc-400 text-[10px] mb-1">
                  <span>Wet Level</span>
                  <span className="font-mono text-white">{(settings.reverb.wet * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={settings.reverb.wet}
                  disabled={!settings.reverb.enabled}
                  onChange={(e) => updateReverb({ wet: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-zinc-400 text-[10px] mb-1">
                  <span>Dry Level</span>
                  <span className="font-mono text-white">{(settings.reverb.dry * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={settings.reverb.dry}
                  disabled={!settings.reverb.enabled}
                  onChange={(e) => updateReverb({ dry: parseFloat(e.target.value) })}
                  className="w-full accent-emerald-400 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Reverb Presets */}
          <div className="mt-4 pt-3 border-t border-[#1f2638] flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 font-mono uppercase mr-1">Presets:</span>
            {[
              { name: 'Room (1.2s)', decay: 1.2, wet: 0.25 },
              { name: 'Studio Hall (2.5s)', decay: 2.5, wet: 0.35 },
              { name: 'Cathedral (5.0s)', decay: 5.0, wet: 0.55 },
            ].map((p) => (
              <button
                key={p.name}
                onClick={() => {
                  updateReverb({ enabled: true, decay: p.decay, wet: p.wet });
                  showToast(`Reverb Preset '${p.name}' applied.`, 'success');
                }}
                className="px-2 py-0.5 rounded bg-[#171c29] hover:bg-[#22293b] text-zinc-300 border border-[#29334a] text-[10px] font-mono transition"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
