import React from 'react';
import { AudioAsset } from '../types/audio';
import { FileText, Sliders, Database, Info, Activity } from 'lucide-react';

interface PropertiesPanelProps {
  activeAsset: AudioAsset | null;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({ activeAsset }) => {
  if (!activeAsset) {
    return (
      <aside className="w-80 bg-studio-900 border-l border-studio-700/60 p-5 flex flex-col justify-center items-center text-center text-zinc-500 shrink-0 select-none">
        <Info className="w-8 h-8 mb-2 text-zinc-600" />
        <h3 className="text-xs font-bold text-zinc-400 mb-1">Properties Panel</h3>
        <p className="text-[11px] text-zinc-500 max-w-[200px]">
          Select an audio track in the library or workspace to inspect technical metadata.
        </p>
      </aside>
    );
  }

  const meta = activeAsset.metadata;
  const peakDb = activeAsset.max_peak > 0 ? (20 * Math.log10(activeAsset.max_peak)).toFixed(1) : '-inf';

  return (
    <aside className="w-80 bg-studio-900 border-l border-studio-700/60 flex flex-col shrink-0 overflow-y-auto select-none">
      {/* Panel Header */}
      <div className="h-10 border-b border-studio-700/50 px-4 flex items-center justify-between bg-studio-850 shrink-0">
        <div className="flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-zinc-400" />
          <h2 className="text-xs font-bold text-zinc-200 tracking-wide">Audio Properties</h2>
        </div>
        <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/30">
          RAW DSP
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Track Title Card */}
        <div className="bg-studio-850 p-3 rounded-xl border border-studio-700/60">
          <div className="text-[10px] font-mono text-zinc-400 mb-1 flex items-center space-x-1">
            <FileText className="w-3 h-3 text-blue-400" />
            <span>TRACK ASSET</span>
          </div>
          <div className="text-xs font-semibold text-zinc-100 truncate" title={activeAsset.filename}>
            {activeAsset.filename}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1">
            ID: {activeAsset.id.slice(0, 8)}...
          </div>
        </div>

        {/* Technical Metadata Table (Task 8: Actual Audio Metadata) */}
        <div className="bg-studio-850 rounded-xl border border-studio-700/60 overflow-hidden text-xs font-mono">
          <div className="px-3 py-2 bg-studio-800/80 border-b border-studio-700/50 text-[10px] font-bold text-zinc-300">
            TECHNICAL SPECIFICATIONS
          </div>

          <div className="divide-y divide-studio-700/40 text-[11px]">
            <div className="px-3 py-2 flex justify-between items-center">
              <span className="text-zinc-400">Audio Format:</span>
              <span className="text-zinc-200 font-semibold uppercase">{meta.format}</span>
            </div>

            <div className="px-3 py-2 flex justify-between items-center">
              <span className="text-zinc-400">Subtype / Encoding:</span>
              <span className="text-zinc-200">{meta.subtype || 'Standard PCM'}</span>
            </div>

            <div className="px-3 py-2 flex justify-between items-center">
              <span className="text-zinc-400">Sample Rate:</span>
              <span className="text-blue-400 font-semibold">{meta.sample_rate.toLocaleString()} Hz</span>
            </div>

            <div className="px-3 py-2 flex justify-between items-center">
              <span className="text-zinc-400">Channels:</span>
              <span className="text-indigo-400 font-semibold">{meta.channels} ({meta.channel_type})</span>
            </div>

            <div className="px-3 py-2 flex justify-between items-center">
              <span className="text-zinc-400">Duration:</span>
              <span className="text-amber-400 font-semibold">{meta.duration_formatted} ({meta.duration_seconds}s)</span>
            </div>

            <div className="px-3 py-2 flex justify-between items-center">
              <span className="text-zinc-400">Total Frames:</span>
              <span className="text-zinc-300">{meta.frames.toLocaleString()} samples</span>
            </div>

            <div className="px-3 py-2 flex justify-between items-center">
              <span className="text-zinc-400">File Size:</span>
              <span className="text-zinc-300">{meta.file_size_formatted}</span>
            </div>
          </div>
        </div>

        {/* Amplitude & Waveform Peak Stats (Task 9) */}
        <div className="bg-studio-850 p-3 rounded-xl border border-studio-700/60 space-y-2 text-xs font-mono">
          <div className="text-[10px] font-bold text-zinc-300 flex items-center space-x-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span>AMPLITUDE ENVELOPE</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-center text-[10px]">
            <div className="bg-studio-900 p-2 rounded-lg border border-studio-700/50">
              <span className="text-zinc-400 block mb-0.5">MAX PEAK</span>
              <span className="text-xs font-bold text-emerald-400">
                {activeAsset.max_peak.toFixed(4)} ({peakDb} dBFS)
              </span>
            </div>
            <div className="bg-studio-900 p-2 rounded-lg border border-studio-700/50">
              <span className="text-zinc-400 block mb-0.5">WAVEFORM BINS</span>
              <span className="text-xs font-bold text-blue-400">
                {activeAsset.peaks.length} buckets
              </span>
            </div>
          </div>
        </div>

        {/* Storage Persistence Status (Task 11) */}
        <div className="p-3 rounded-xl bg-studio-850 border border-studio-700/60 text-xs font-mono flex items-center space-x-2.5 text-zinc-400">
          <Database className="w-4 h-4 text-emerald-400 shrink-0" />
          <div className="text-[11px] leading-tight">
            <span className="text-zinc-200 font-semibold block">Browser IndexedDB</span>
            <span>Survives page refresh & restart</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
