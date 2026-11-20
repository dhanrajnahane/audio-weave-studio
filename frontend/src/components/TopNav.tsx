import React, { useRef } from 'react';
import { Waves, Upload, Activity, Layers, Disc3, GitBranch, Sliders, FolderOpen, Download, BrainCircuit, SlidersHorizontal } from 'lucide-react';
import { BackendStatus } from '../types/audio';

export type WorkspaceView = 'timeline' | 'remix' | 'routing' | 'mixer' | 'analyzer' | 'effects';

interface TopNavProps {
  backendStatus: BackendStatus;
  isImporting: boolean;
  activeView: WorkspaceView;
  projectName: string;
  onViewChange: (view: WorkspaceView) => void;
  onOpenProjects: () => void;
  onOpenExport: () => void;
  onFileSelected: (file: File) => void;
  onError: (msg: string) => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  backendStatus,
  isImporting,
  activeView,
  projectName,
  onViewChange,
  onOpenProjects,
  onOpenExport,
  onFileSelected,
  onError,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Task 6: Validate file extension
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const validExts = ['.wav', '.mp3', '.flac'];
    if (!validExts.includes(ext)) {
      onError(`Unsupported file format '${ext}'. Please import a WAV, MP3, or FLAC file.`);
      e.target.value = '';
      return;
    }

    onFileSelected(file);
    e.target.value = '';
  };

  return (
    <header className="h-14 bg-studio-900 border-b border-studio-700/60 px-5 flex items-center justify-between shrink-0 select-none z-30">
      {/* Brand & Studio Title */}
      <div className="flex items-center space-x-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
          <Waves className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="font-bold text-sm tracking-wide text-zinc-100">
              AudioWeave <span className="text-blue-400 font-semibold">Studio</span>
            </h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              STUDIO PRO
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 font-mono">
            Intelligent Audio Stem Editing & Remix Platform
          </p>
        </div>
      </div>

      {/* Center: Workspace Navigation Tabs */}
      <div className="flex items-center bg-[#0d1017] p-1 rounded-xl border border-[#1e2638] space-x-1 shadow-inner">
        <button
          onClick={() => onViewChange('timeline')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeView === 'timeline'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-[#181f2f]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Timeline Editor</span>
        </button>

        <button
          onClick={() => onViewChange('remix')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeView === 'remix'
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-md shadow-cyan-500/20 font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-[#181f2f]'
          }`}
        >
          <Disc3 className="w-3.5 h-3.5 text-cyan-400" />
          <span>Remix Composer</span>
        </button>

        <button
          onClick={() => onViewChange('routing')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeView === 'routing'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/20 font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-[#181f2f]'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
          <span>Routing DAG</span>
        </button>

        <button
          onClick={() => onViewChange('mixer')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeView === 'mixer'
              ? 'bg-amber-600 text-white shadow-md shadow-amber-500/20'
              : 'text-zinc-400 hover:text-white hover:bg-[#181f2f]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Stem Mixer</span>
        </button>

        <button
          onClick={() => onViewChange('analyzer')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeView === 'analyzer'
              ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/20 font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-[#181f2f]'
          }`}
        >
          <BrainCircuit className="w-3.5 h-3.5 text-violet-300" />
          <span>Song Analyzer</span>
        </button>

        <button
          onClick={() => onViewChange('effects')}
          className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeView === 'effects'
              ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md shadow-orange-500/20 font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-[#181f2f]'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-orange-300" />
          <span>Effects Studio</span>
        </button>
      </div>

      {/* Right: Project Manager, Export Studio, Backend Status & Audio Import */}
      <div className="flex items-center space-x-2.5">
        {/* Projects Modal Trigger */}
        <button
          onClick={onOpenProjects}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#181e2b] hover:bg-[#222a3c] text-zinc-200 border border-[#2b354b] text-xs font-semibold shadow-sm transition"
          title="Open Project Manager (Save, Open, New, Rename)"
        >
          <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
          <span className="truncate max-w-[120px]">{projectName}</span>
        </button>

        {/* Export Audio Studio Trigger */}
        <button
          onClick={onOpenExport}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm shadow-emerald-600/20 transition"
          title="Export Multi-Track Mix, Stems or Audio Region"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export</span>
        </button>

        <div className="flex items-center space-x-2 bg-studio-850 px-3 py-1.5 rounded-lg border border-studio-700/60 font-mono text-xs">
          <Activity className="w-3.5 h-3.5 text-zinc-400" />
          {backendStatus.connected ? (
            <div className="flex items-center space-x-1.5 text-emerald-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>FastAPI CPU</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 text-red-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              <span>Disconnected</span>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,.mp3,.flac,audio/wav,audio/mpeg,audio/flac"
          className="hidden"
          onChange={handleInputChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isImporting}
          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-blue-600/25 transition transform active:scale-95 cursor-pointer"
        >
          <Upload className={`w-3.5 h-3.5 ${isImporting ? 'animate-bounce' : ''}`} />
          <span>{isImporting ? 'Importing...' : 'Import'}</span>
        </button>
      </div>
    </header>
  );
};
