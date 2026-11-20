import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Layers,
  Copy,
  Trash2,
  Play,
  Pause,
  Download,
  Plus,
  ArrowLeft,
  ArrowRight,
  Disc3,
  SlidersHorizontal,
  FolderPlus,
  Clock,
  Music,
  RotateCcw,
  BrainCircuit,
  Volume2,
  VolumeX,
  Radio,
} from 'lucide-react';
import { remixComposerModel } from '../audio/remix/RemixComposerModel';
import { SectionAnalyzer } from '../audio/remix/SectionAnalyzer';
import { MusicalSection, MusicalSectionType, RemixArrangement, ArrangementBlock } from '../audio/remix/types';
import { timelineModel } from '../audio/timeline/TimelineModel';
import { audioEngine } from '../audio/AudioEngine';
import { AudioAsset } from '../types/audio';

interface RemixComposerProps {
  activeAsset: AudioAsset | null;
  isPlaying: boolean;
  currentTime: number;
  onSeek: (time: number) => void;
  showToast: (msg: string, type?: 'error' | 'success') => void;
}

export const RemixComposer: React.FC<RemixComposerProps> = ({
  activeAsset,
  isPlaying,
  currentTime,
  onSeek,
  showToast,
}) => {
  const [detectedSections, setDetectedSections] = useState<MusicalSection[]>([]);
  const [activeArrangement, setActiveArrangement] = useState<RemixArrangement>(
    remixComposerModel.getActiveArrangement()
  );
  const [allArrangements, setAllArrangements] = useState<RemixArrangement[]>(
    remixComposerModel.getAllArrangements()
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState<boolean>(false);
  const [newArrangementName, setNewArrangementName] = useState<string>('');
  const [showNewModal, setShowNewModal] = useState<boolean>(false);

  // Sync state from model
  const refreshModel = useCallback(() => {
    setDetectedSections(remixComposerModel.getDetectedSections());
    setActiveArrangement(remixComposerModel.getActiveArrangement());
    setAllArrangements(remixComposerModel.getAllArrangements());
  }, []);

  useEffect(() => {
    refreshModel();
    const unsub = remixComposerModel.subscribe(refreshModel);
    return () => unsub();
  }, [refreshModel]);

  // Snapshot original timeline when entering Remix Composer
  useEffect(() => {
    const clips = timelineModel.getAllClips();
    if (clips.length > 0) {
      remixComposerModel.snapshotOriginalTimeline(clips);
    }
  }, []);

  // Fetch real acoustic analysis from backend (Librosa) or fall back to SectionAnalyzer
  const fetchRealAnalysis = useCallback(
    async (force: boolean = false) => {
      if (!activeAsset) return;
      setIsLoadingAnalysis(true);

      try {
        const url = `/api/audio/analyze/${encodeURIComponent(activeAsset.stored_filename)}?force=${force}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.sections && data.sections.length > 0) {
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
                case 'intro':
                  return '#06b6d4';
                case 'verse':
                  return '#3b82f6';
                case 'chorus':
                  return '#f59e0b';
                case 'bridge':
                  return '#a855f7';
                case 'outro':
                  return '#10b981';
                default:
                  return '#6b7280';
              }
            };

            const getNumericEnergy = (level: string): number => {
              switch (level) {
                case 'low':
                  return 0.3;
                case 'medium':
                  return 0.65;
                case 'high':
                  return 0.95;
                default:
                  return 0.5;
              }
            };

            const composerSections: MusicalSection[] = data.sections.map((sec: {
              id: string;
              label: string;
              start: number;
              end: number;
              duration: number;
              energy_level: string;
            }) => {
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
              `Synchronized ${composerSections.length} real acoustic sections from Smart Song Analyzer!`,
              'success'
            );
            return;
          }
        }
      } catch {
        // Fallback to local audio buffer
      } finally {
        setIsLoadingAnalysis(false);
      }

      // Fallback: local buffer detection
      const buffer =
        timelineModel.getAsset('vocals') ||
        timelineModel.getAsset('master') ||
        timelineModel.getAsset(activeAsset?.id || '');

      if (buffer) {
        const sections = SectionAnalyzer.detectSections(buffer, 120);
        remixComposerModel.setDetectedSections(sections);
      }
    },
    [activeAsset, showToast]
  );

  // When activeAsset changes, load real analysis if no sections exist yet
  useEffect(() => {
    if (remixComposerModel.getDetectedSections().length === 0 && activeAsset) {
      fetchRealAnalysis(false);
    }
  }, [activeAsset, fetchRealAnalysis]);

  // Synchronize active remix arrangement to TimelineModel for immediate Web Audio playback
  const syncAndPreviewArrangement = useCallback(() => {
    remixComposerModel.applyToTimeline(timelineModel);
    audioEngine.play(0);
    showToast('Remix arrangement synchronized to timeline and playing.', 'success');
  }, [showToast]);

  // Handle section duplication
  const handleDuplicateBlock = (blockId: string) => {
    const clone = remixComposerModel.duplicateSection(blockId);
    if (clone) {
      setSelectedBlockId(clone.id);
      remixComposerModel.applyToTimeline(timelineModel);
      showToast(`Duplicated section "${clone.name}".`, 'success');
    }
  };

  // Handle section deletion
  const handleRemoveBlock = (blockId: string) => {
    const success = remixComposerModel.removeSection(blockId);
    if (success) {
      if (selectedBlockId === blockId) setSelectedBlockId(null);
      remixComposerModel.applyToTimeline(timelineModel);
      showToast('Removed section from arrangement.', 'success');
    }
  };

  // Handle moving section Left/Right (earlier/later)
  const handleMoveBlock = (blockId: string, direction: -1 | 1) => {
    const idx = activeArrangement.blocks.findIndex((b) => b.id === blockId);
    if (idx !== -1) {
      remixComposerModel.rearrangeSection(blockId, idx + direction);
      remixComposerModel.applyToTimeline(timelineModel);
    }
  };

  // Handle stem toggle in section
  const handleToggleStem = (blockId: string, stem: 'vocals' | 'drums' | 'bass' | 'other') => {
    const activeState = remixComposerModel.toggleStem(blockId, stem);
    remixComposerModel.applyToTimeline(timelineModel);
    showToast(
      `${stem.toUpperCase()} is now ${activeState ? 'ACTIVE' : 'MUTED'} for this section.`,
      'success'
    );
  };

  // Handle adding section from detected sections strip
  const handleAddSection = (sectionId: string) => {
    const added = remixComposerModel.addSectionToArrangement(sectionId);
    if (added) {
      setSelectedBlockId(added.id);
      remixComposerModel.applyToTimeline(timelineModel);
      showToast(`Added "${added.name}" to remix arrangement.`, 'success');
    }
  };

  // Return to original arrangement & timeline
  const handleReturnToOriginal = () => {
    remixComposerModel.restoreOriginalArrangement(timelineModel);
    audioEngine.stop();
    setSelectedBlockId(null);
    showToast('Restored original arrangement and timeline clips.', 'success');
  };

  // Handle creating alternative arrangement
  const handleCreateNewArrangement = (
    template: 'copy_current' | 'radio_edit' | 'club_extended' | 'empty'
  ) => {
    const name = newArrangementName.trim() || (
      template === 'radio_edit'
        ? 'Radio Edit'
        : template === 'club_extended'
        ? 'Club Extended'
        : `Arrangement ${allArrangements.length + 1}`
    );

    remixComposerModel.createArrangement(name, template);
    remixComposerModel.applyToTimeline(timelineModel);
    setShowNewModal(false);
    setNewArrangementName('');
    showToast(`Created new remix arrangement: "${name}"`, 'success');
  };

  // Handle Exporting arrangement to WAV
  const handleExportWav = async () => {
    setIsExporting(true);
    showToast('Rendering remix arrangement to 16-bit WAV...', 'success');

    try {
      const stemBuffers: Record<string, AudioBuffer> = {};
      for (const stem of ['vocals', 'drums', 'bass', 'other']) {
        const buf = timelineModel.getAsset(stem);
        if (buf) {
          stemBuffers[stem] = buf;
        }
      }

      if (Object.keys(stemBuffers).length === 0) {
        const masterBuf =
          timelineModel.getAsset('master') || timelineModel.getAsset(activeAsset?.id || '');
        if (masterBuf) {
          stemBuffers['vocals'] = masterBuf;
          stemBuffers['drums'] = masterBuf;
          stemBuffers['bass'] = masterBuf;
          stemBuffers['other'] = masterBuf;
        }
      }

      const wavBlob = await remixComposerModel.exportArrangementWav(stemBuffers);
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `AudioWeave_${activeArrangement.name.replace(/\s+/g, '_')}_Remix.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(
        `WAV exported successfully: ${(wavBlob.size / 1024 / 1024).toFixed(2)} MB`,
        'success'
      );
    } catch (err: unknown) {
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const totalArrangementDuration = remixComposerModel.getArrangementDuration();
  const selectedBlock = activeArrangement.blocks.find((b) => b.id === selectedBlockId);

  return (
    <div className="h-full flex flex-col bg-[#090b10] text-zinc-100 select-none overflow-hidden relative">
      {/* 1. Header Toolbar */}
      <div className="h-14 px-5 bg-[#10131a] border-b border-[#1f2533] flex items-center justify-between text-xs shrink-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md">
            <Disc3 className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-sm text-white">Intelligent Remix Composer</h2>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Structural Section Arranger & Multi-Stem Remix Orchestrator
            </p>
          </div>
        </div>

        {/* Arrangement Selector & Actions */}
        <div className="flex items-center gap-2">
          {/* Arrangement Switcher */}
          <div className="flex items-center gap-1.5 bg-[#161a24] px-2.5 py-1 rounded-lg border border-[#242b3b]">
            <Layers className="w-3.5 h-3.5 text-zinc-400" />
            <select
              value={activeArrangement.id}
              onChange={(e) => {
                remixComposerModel.selectArrangement(e.target.value);
                remixComposerModel.applyToTimeline(timelineModel);
              }}
              className="bg-transparent text-xs font-semibold text-cyan-300 outline-none cursor-pointer"
            >
              {allArrangements.map((arr) => (
                <option key={arr.id} value={arr.id} className="bg-[#161a24] text-white">
                  {arr.name} ({arr.blocks.length} sections)
                </option>
              ))}
            </select>
          </div>

          {/* Return to Original Sequence Button */}
          <button
            onClick={handleReturnToOriginal}
            className="px-2.5 py-1.5 rounded-lg bg-[#1a202d] hover:bg-[#252f42] text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center gap-1.5 transition-colors"
            title="Restore original chronological arrangement and preserved timeline tracks"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Original Sequence</span>
          </button>

          {/* New Arrangement Button */}
          <button
            onClick={() => setShowNewModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-[#1a202d] hover:bg-[#252f42] text-zinc-200 border border-[#2c364c] text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5 text-cyan-400" />
            <span>New Version</span>
          </button>

          {/* Quick Radio Edit Preset Button */}
          <button
            onClick={() => handleCreateNewArrangement('radio_edit')}
            className="px-2.5 py-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-200 border border-cyan-500/40 text-xs font-medium flex items-center gap-1.5 transition-colors"
            title="Create standard Radio Edit: Intro → Chorus → Verse → Chorus → Outro"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>Radio Edit</span>
          </button>

          {/* Preview Play / Pause */}
          <button
            onClick={() => {
              if (isPlaying) {
                audioEngine.pause();
              } else {
                syncAndPreviewArrangement();
              }
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all shadow-md ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'
            }`}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isPlaying ? 'Pause Preview' : 'Play Arrangement'}</span>
          </button>

          {/* Export WAV */}
          <button
            onClick={handleExportWav}
            disabled={isExporting || activeArrangement.blocks.length === 0}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
              isExporting
                ? 'bg-[#181d28] text-zinc-500 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20 shadow-md'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExporting ? 'Exporting...' : 'Export WAV'}</span>
          </button>
        </div>
      </div>

      {/* 2. Detected Musical Sections Strip */}
      <div className="bg-[#0d1017] border-b border-[#1b212e] px-5 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-semibold text-zinc-300">
              Detected Musical Sections in Source Audio
            </span>
            <span className="text-[11px] text-zinc-500">
              ({detectedSections.length} sections identified via acoustic analysis)
            </span>
            <button
              onClick={() => fetchRealAnalysis(true)}
              disabled={isLoadingAnalysis}
              className="ml-2 px-2 py-0.5 rounded text-[10px] font-mono bg-violet-950/60 hover:bg-violet-900/80 text-violet-300 border border-violet-500/40 flex items-center gap-1 transition-all"
              title="Re-run Smart Song Analyzer Librosa pipeline on this track"
            >
              <BrainCircuit className="w-3 h-3 text-violet-400" />
              <span>{isLoadingAnalysis ? 'Analyzing...' : 'Sync Analyzer'}</span>
            </button>
          </div>
          <span className="text-[11px] text-zinc-400 font-mono">
            Click any section below to append to arrangement
          </span>
        </div>

        {/* Section Pill Palette */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
          {detectedSections.length === 0 ? (
            <div className="text-xs text-zinc-500 italic py-1">
              No sections loaded. Click &quot;Sync Analyzer&quot; to detect sections with Librosa DSP.
            </div>
          ) : (
            detectedSections.map((sec) => (
              <button
                key={sec.id}
                onClick={() => handleAddSection(sec.id)}
                style={{ borderColor: `${sec.color}40`, backgroundColor: `${sec.color}15` }}
                className="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 hover:scale-105 transition-all shrink-0 group shadow-sm cursor-pointer"
                title={`Click to add "${sec.name}" (${sec.duration}s) to remix arrangement`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: sec.color }}
                />
                <span className="text-zinc-200 group-hover:text-white font-semibold">
                  {sec.name}
                </span>
                <span className="text-[10px] text-zinc-400 font-mono">{sec.duration}s</span>
                <span
                  className="text-[9px] px-1 rounded uppercase font-mono"
                  style={{ backgroundColor: `${sec.color}30`, color: sec.color }}
                >
                  E: {Math.round(sec.energy * 100)}%
                </span>
                <Plus className="w-3 h-3 text-cyan-400 opacity-60 group-hover:opacity-100" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* 3. Main Arrangement Sequence Canvas */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Arrangement Summary Bar */}
        <div className="flex items-center justify-between text-xs text-zinc-400 bg-[#121622] px-4 py-2 rounded-lg border border-[#202738]">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-zinc-200">
              Arrangement: <span className="text-cyan-400">{activeArrangement.name}</span>
            </span>
            <span>•</span>
            <span>Sections: {activeArrangement.blocks.length}</span>
            <span>•</span>
            <span className="flex items-center gap-1 font-mono text-zinc-300">
              <Clock className="w-3.5 h-3.5 text-zinc-400" />
              Total Duration: {totalArrangementDuration}s
            </span>
          </div>

          <div className="text-[11px] text-zinc-500 italic">
            Each section block below is an independent, non-destructive slice with per-stem activation.
          </div>
        </div>

        {/* Real-time Playback Scrubber for Remix Arrangement */}
        {totalArrangementDuration > 0 && (
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              onSeek(ratio * totalArrangementDuration);
            }}
            className="w-full h-3 bg-[#131722] border border-[#242c3d] rounded-full overflow-hidden cursor-pointer relative shadow-inner"
            title={`Arrangement Playhead: ${currentTime.toFixed(1)}s / ${totalArrangementDuration}s (Click to seek)`}
          >
            <div
              style={{
                width: `${Math.min(100, (currentTime / totalArrangementDuration) * 100)}%`,
              }}
              className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-75 relative"
            >
              <div className="absolute right-0 top-0 bottom-0 w-1 bg-white shadow-[0_0_8px_#ffffff]" />
            </div>
          </div>
        )}

        {/* Section Arrangement Blocks Sequence */}
        {activeArrangement.blocks.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 space-y-2 border-2 border-dashed border-[#1f2536] rounded-xl">
            <Music className="w-8 h-8 mx-auto text-zinc-600" />
            <p className="text-sm font-medium text-zinc-400">Your Remix Arrangement is Empty</p>
            <p className="text-xs">
              Click any detected section in the top bar or choose &quot;Radio Edit&quot; to build a custom arrangement.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {activeArrangement.blocks.map((block: ArrangementBlock, idx: number) => {
              const isCurrentPlaying =
                isPlaying &&
                currentTime >= block.timelineStart &&
                currentTime < block.timelineStart + block.duration;
              const isSelected = selectedBlockId === block.id;

              return (
                <div
                  key={block.id}
                  onClick={() => setSelectedBlockId(block.id)}
                  style={{ borderLeftColor: block.color }}
                  className={`bg-[#121622] rounded-xl border p-3 flex flex-wrap items-center justify-between gap-4 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-cyan-400 shadow-lg shadow-cyan-900/20 bg-[#161c2a]'
                      : isCurrentPlaying
                      ? 'border-emerald-500/80 shadow-md shadow-emerald-950/40 bg-[#111922]'
                      : 'border-[#222a3d] hover:border-[#323d57]'
                  } border-l-4`}
                >
                  {/* Block Order & Title */}
                  <div className="flex items-center gap-3 min-w-[200px]">
                    <span
                      className={`w-6 h-6 rounded-full text-xs font-mono font-bold flex items-center justify-center ${
                        isCurrentPlaying
                          ? 'bg-emerald-500 text-black font-extrabold animate-pulse'
                          : 'bg-[#1b2130] text-zinc-400'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div>
                      <h4 className="font-bold text-sm text-white flex items-center gap-1.5">
                        <span>{block.name}</span>
                        <span
                          className="text-[9px] px-1.5 py-0.2 rounded font-mono uppercase"
                          style={{ backgroundColor: `${block.color}25`, color: block.color }}
                        >
                          {block.type}
                        </span>
                        {isCurrentPlaying && (
                          <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                            PLAYING
                          </span>
                        )}
                      </h4>
                      <div className="flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
                        <span>
                          Timeline: {block.timelineStart}s -{' '}
                          {(block.timelineStart + block.duration).toFixed(2)}s
                        </span>
                        <span>({block.duration}s)</span>
                      </div>
                    </div>
                  </div>

                  {/* Per-Section Stem Activation Matrix */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 bg-[#0b0e15] px-3 py-1.5 rounded-lg border border-[#1b2230]"
                  >
                    <span className="text-[10px] font-mono text-zinc-500 mr-1 flex items-center gap-1">
                      <SlidersHorizontal className="w-3 h-3" /> STEMS:
                    </span>

                    {(['vocals', 'drums', 'bass', 'other'] as const).map((stem) => {
                      const isActive = block.activeStems[stem];
                      const stemColor =
                        stem === 'vocals'
                          ? 'text-cyan-400 border-cyan-500/40 bg-cyan-950/40'
                          : stem === 'drums'
                          ? 'text-amber-400 border-amber-500/40 bg-amber-950/40'
                          : stem === 'bass'
                          ? 'text-purple-400 border-purple-500/40 bg-purple-950/40'
                          : 'text-emerald-400 border-emerald-500/40 bg-emerald-950/40';

                      return (
                        <button
                          key={stem}
                          onClick={() => handleToggleStem(block.id, stem)}
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border transition-all ${
                            isActive
                              ? stemColor
                              : 'bg-[#151922] text-zinc-600 border-[#202738] line-through'
                          }`}
                          title={`Click to ${isActive ? 'Mute' : 'Enable'} ${stem.toUpperCase()} in this section`}
                        >
                          {stem}
                        </button>
                      );
                    })}
                  </div>

                  {/* Section Re-order & Edit Actions */}
                  <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
                    {/* Move Earlier (Left) */}
                    <button
                      onClick={() => handleMoveBlock(block.id, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded hover:bg-[#1f2638] text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move section earlier in arrangement"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </button>

                    {/* Move Later (Right) */}
                    <button
                      onClick={() => handleMoveBlock(block.id, 1)}
                      disabled={idx === activeArrangement.blocks.length - 1}
                      className="p-1.5 rounded hover:bg-[#1f2638] text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                      title="Move section later in arrangement"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    {/* Duplicate Section */}
                    <button
                      onClick={() => handleDuplicateBlock(block.id)}
                      className="p-1.5 rounded hover:bg-[#1f2638] text-amber-400 hover:text-amber-300"
                      title="Duplicate this section block"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    {/* Delete Section */}
                    <button
                      onClick={() => handleRemoveBlock(block.id)}
                      className="p-1.5 rounded hover:bg-red-950 text-red-400 hover:text-red-300"
                      title="Remove section from arrangement"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 4. Section Detail Inspector Drawer (When a section is selected) */}
        {selectedBlock && (
          <div className="p-4 rounded-xl bg-[#10141d] border border-cyan-500/30 space-y-3 animate-fade-in shadow-xl">
            <div className="flex items-center justify-between border-b border-[#1f2637] pb-2">
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: selectedBlock.color }}
                />
                <h4 className="font-bold text-xs text-white">
                  Section Inspector: <span className="text-cyan-300">{selectedBlock.name}</span>
                </h4>
                <span className="text-[10px] font-mono text-zinc-400">
                  (Duration: {selectedBlock.duration}s • Source Range: {selectedBlock.sourceStart}s -{' '}
                  {selectedBlock.sourceEnd}s)
                </span>
              </div>
              <button
                onClick={() => setSelectedBlockId(null)}
                className="text-zinc-500 hover:text-zinc-300 text-xs font-mono"
              >
                ✕ Close
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 text-[11px]">Quick Stem Presets:</span>
                <button
                  onClick={() => {
                    const stems: Array<'vocals' | 'drums' | 'bass' | 'other'> = [
                      'vocals',
                      'drums',
                      'bass',
                      'other',
                    ];
                    for (const s of stems) {
                      if (!selectedBlock.activeStems[s]) {
                        remixComposerModel.toggleStem(selectedBlock.id, s);
                      }
                    }
                    remixComposerModel.applyToTimeline(timelineModel);
                    showToast('Activated all stems for selected section.', 'success');
                  }}
                  className="px-2 py-1 rounded bg-[#1a2130] hover:bg-[#252f44] text-zinc-200 border border-[#2b354c] text-[10px] font-mono flex items-center gap-1"
                >
                  <Volume2 className="w-3 h-3 text-cyan-400" />
                  <span>All Stems On</span>
                </button>

                <button
                  onClick={() => {
                    // Acapella solo: vocals on, others off
                    const stems: Array<'vocals' | 'drums' | 'bass' | 'other'> = [
                      'vocals',
                      'drums',
                      'bass',
                      'other',
                    ];
                    for (const s of stems) {
                      const shouldBeActive = s === 'vocals';
                      if (selectedBlock.activeStems[s] !== shouldBeActive) {
                        remixComposerModel.toggleStem(selectedBlock.id, s);
                      }
                    }
                    remixComposerModel.applyToTimeline(timelineModel);
                    showToast('Acapella solo activated (Vocals only).', 'success');
                  }}
                  className="px-2 py-1 rounded bg-[#1a2130] hover:bg-[#252f44] text-cyan-300 border border-cyan-500/40 text-[10px] font-mono"
                >
                  Acapella Solo
                </button>

                <button
                  onClick={() => {
                    // Instrumental: vocals off, others on
                    const stems: Array<'vocals' | 'drums' | 'bass' | 'other'> = [
                      'vocals',
                      'drums',
                      'bass',
                      'other',
                    ];
                    for (const s of stems) {
                      const shouldBeActive = s !== 'vocals';
                      if (selectedBlock.activeStems[s] !== shouldBeActive) {
                        remixComposerModel.toggleStem(selectedBlock.id, s);
                      }
                    }
                    remixComposerModel.applyToTimeline(timelineModel);
                    showToast('Instrumental preset activated (Vocals muted).', 'success');
                  }}
                  className="px-2 py-1 rounded bg-[#1a2130] hover:bg-[#252f44] text-amber-300 border border-amber-500/40 text-[10px] font-mono"
                >
                  Instrumental
                </button>

                <button
                  onClick={() => {
                    // Mute all
                    const stems: Array<'vocals' | 'drums' | 'bass' | 'other'> = [
                      'vocals',
                      'drums',
                      'bass',
                      'other',
                    ];
                    for (const s of stems) {
                      if (selectedBlock.activeStems[s]) {
                        remixComposerModel.toggleStem(selectedBlock.id, s);
                      }
                    }
                    remixComposerModel.applyToTimeline(timelineModel);
                    showToast('All stems muted for selected section (Silence).', 'success');
                  }}
                  className="px-2 py-1 rounded bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 text-[10px] font-mono flex items-center gap-1"
                >
                  <VolumeX className="w-3 h-3 text-red-400" />
                  <span>Silence Block</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDuplicateBlock(selectedBlock.id)}
                  className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-semibold flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  <span>Duplicate</span>
                </button>
                <button
                  onClick={() => handleRemoveBlock(selectedBlock.id)}
                  className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-[10px] font-semibold flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Remove</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. New Arrangement Modal */}
      {showNewModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#121622] border border-[#273248] rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#212a3d] pb-3">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-cyan-400" />
                <span>Create Alternative Arrangement</span>
              </h3>
              <button
                onClick={() => setShowNewModal(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-300 font-medium">Arrangement Name</label>
              <input
                type="text"
                placeholder="e.g. Radio Edit, Club Mix, Acoustic Version"
                value={newArrangementName}
                onChange={(e) => setNewArrangementName(e.target.value)}
                className="w-full bg-[#0a0d14] border border-[#232c3f] rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 outline-none focus:border-cyan-400"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-300 font-medium">Arrangement Template</label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  onClick={() => handleCreateNewArrangement('copy_current')}
                  className="p-3 rounded-xl bg-[#171c29] hover:bg-[#202738] border border-[#2a3449] text-left text-zinc-200 transition-colors"
                >
                  <span className="font-bold block text-white">Clone Current</span>
                  <span className="text-[10px] text-zinc-400">Copy current arrangement sequence</span>
                </button>
                <button
                  onClick={() => handleCreateNewArrangement('radio_edit')}
                  className="p-3 rounded-xl bg-[#171c29] hover:bg-[#202738] border border-cyan-500/30 text-left text-cyan-300 transition-colors"
                >
                  <span className="font-bold block text-white">Radio Edit</span>
                  <span className="text-[10px] text-zinc-400">
                    Intro → Chorus → Verse → Chorus → Outro
                  </span>
                </button>
                <button
                  onClick={() => handleCreateNewArrangement('club_extended')}
                  className="p-3 rounded-xl bg-[#171c29] hover:bg-[#202738] border border-amber-500/30 text-left text-amber-300 transition-colors"
                >
                  <span className="font-bold block text-white">Club Extended</span>
                  <span className="text-[10px] text-zinc-400">Extended intro, dual drop, outro</span>
                </button>
                <button
                  onClick={() => handleCreateNewArrangement('empty')}
                  className="p-3 rounded-xl bg-[#171c29] hover:bg-[#202738] border border-[#2a3449] text-left text-zinc-400 transition-colors"
                >
                  <span className="font-bold block text-white">Blank Canvas</span>
                  <span className="text-[10px] text-zinc-500">Start with zero sections</span>
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[#212a3d]">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
