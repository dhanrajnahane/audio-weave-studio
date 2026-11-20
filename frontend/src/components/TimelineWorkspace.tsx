import React, { useRef, useEffect, useState, useCallback } from 'react';
import { AudioAsset } from '../types/audio';
import {
  ZoomIn,
  ZoomOut,
  UploadCloud,
  Scissors,
  Copy,
  Trash2,
  Undo2,
  Redo2,
  Magnet,
  Play,
} from 'lucide-react';
import { timelineModel } from '../audio/timeline/TimelineModel';
import { audioEngine } from '../audio/AudioEngine';
import { AudioClip, Track } from '../audio/timeline/types';

interface TimelineWorkspaceProps {
  activeAsset: AudioAsset | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  onDropFiles: (files: FileList) => void;
}

export const TimelineWorkspace: React.FC<TimelineWorkspaceProps> = ({
  activeAsset,
  currentTime,
  duration,
  isPlaying,
  onSeek,
  onDropFiles,
}) => {
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Timeline UI State
  const [zoom, setZoom] = useState<number>(1.0);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [snapGrid, setSnapGrid] = useState<number>(0.25);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Dragging / Trimming Interaction State
  const [interaction, setInteraction] = useState<{
    type: 'move' | 'trim-left' | 'trim-right';
    clipId: string;
    startX: number;
    initialStartOffset: number;
    initialDuration: number;
    initialSourceOffset: number;
    trackId: string;
  } | null>(null);

  const basePixelsPerSec = 50;
  const pixelsPerSec = basePixelsPerSec * zoom;

  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);
  const [undoText, setUndoText] = useState<string | null>(null);
  const [redoText, setRedoText] = useState<string | null>(null);

  // Sync timeline model state
  const refreshFromModel = useCallback(() => {
    setTracks(timelineModel.getTracks());
    setClips(timelineModel.getAllClips());
    const sel = timelineModel.getSelectedClipIds();
    setSelectedClipId(sel.length > 0 ? sel[0] : null);
    setSelectedTrackId(timelineModel.getSelectedTrackId());
    setCanUndo(timelineModel.canUndo());
    setCanRedo(timelineModel.canRedo());
    setUndoText(timelineModel.getUndoText());
    setRedoText(timelineModel.getRedoText());
  }, []);

  useEffect(() => {
    refreshFromModel();
    const unsub = timelineModel.subscribe(refreshFromModel);
    return () => unsub();
  }, [refreshFromModel]);

  // When activeAsset changes, register it in timeline model and create clip if timeline empty
  useEffect(() => {
    if (activeAsset) {
      // Create a clip on primary track (vocals) if timeline is completely empty
      if (timelineModel.getAllClips().length === 0) {
        timelineModel.addClip(
          {
            id: `clip-${activeAsset.id}`,
            trackId: 'vocals',
            assetId: activeAsset.id,
            name: activeAsset.filename,
            startOffset: 0,
            duration: activeAsset.metadata.duration_seconds || duration,
            sourceOffset: 0,
            color: '#06b6d4',
          },
          false
        );
      }
    }
  }, [activeAsset, duration]);

  // Draw Time Ruler
  const drawRuler = useCallback(() => {
    const canvas = rulerRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#0f121a';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#273043';
    ctx.fillStyle = '#71717a';
    ctx.font = '10px JetBrains Mono, monospace';

    const maxSeconds = Math.max(15, Math.ceil(duration || 15));

    for (let sec = 0; sec <= maxSeconds; sec++) {
      const x = sec * pixelsPerSec;
      if (x > width) break;

      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const mins = Math.floor(sec / 60);
      const s = sec % 60;
      ctx.fillText(`${mins}:${s < 10 ? '0' : ''}${s}`, x + 4, 14);

      // Sub-second markers (250ms)
      for (let sub = 1; sub < 4; sub++) {
        const subX = x + sub * 0.25 * pixelsPerSec;
        if (subX <= width) {
          ctx.beginPath();
          ctx.moveTo(subX, height - 5);
          ctx.lineTo(subX, height);
          ctx.stroke();
        }
      }
    }
  }, [duration, pixelsPerSec]);

  useEffect(() => {
    const canvas = rulerRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const totalWidth = Math.max(container.clientWidth, (duration + 10) * pixelsPerSec);
    canvas.width = totalWidth;
    canvas.height = 24;
    drawRuler();
  }, [duration, pixelsPerSec, drawRuler]);

  // Keyboard Shortcuts (Split: S, Duplicate: Ctrl+D, Delete: Delete/Backspace, Undo: Ctrl+Z, Redo: Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          timelineModel.redo();
        } else {
          timelineModel.undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        timelineModel.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedClipId) {
          timelineModel.duplicateClip(selectedClipId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipId) {
          e.preventDefault();
          timelineModel.deleteClip(selectedClipId);
        }
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        // Split at playhead
        if (selectedClipId) {
          e.preventDefault();
          timelineModel.splitClip(selectedClipId, currentTime);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipId, currentTime]);

  // Ruler scrub / seek
  const handleRulerClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const seekTime = Math.max(0, clickX / pixelsPerSec);
    onSeek(seekTime);
  };

  // Mouse Drag / Trim Listeners
  const handleMouseDownOnClip = (
    e: React.MouseEvent,
    clip: AudioClip,
    actionType: 'move' | 'trim-left' | 'trim-right'
  ) => {
    e.stopPropagation();
    timelineModel.selectClip(clip.id);
    setSelectedClipId(clip.id);

    setInteraction({
      type: actionType,
      clipId: clip.id,
      startX: e.clientX,
      initialStartOffset: clip.startOffset,
      initialDuration: clip.duration,
      initialSourceOffset: clip.sourceOffset,
      trackId: clip.trackId,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!interaction) return;

      const deltaX = e.clientX - interaction.startX;
      const deltaTime = deltaX / pixelsPerSec;

      if (interaction.type === 'move') {
        let newStart = interaction.initialStartOffset + deltaTime;
        if (snapEnabled) {
          newStart = timelineModel.snapPosition(newStart, interaction.trackId, snapGrid);
        } else {
          newStart = Math.max(0, newStart);
        }
        timelineModel.moveClip(interaction.clipId, newStart, interaction.trackId, false);
      } else if (interaction.type === 'trim-left') {
        let newStart = interaction.initialStartOffset + deltaTime;
        if (snapEnabled) {
          newStart = timelineModel.snapPosition(newStart, interaction.trackId, snapGrid);
        }
        const deltaStart = newStart - interaction.initialStartOffset;
        const newDuration = interaction.initialDuration - deltaStart;
        const newSourceOffset = interaction.initialSourceOffset + deltaStart;

        if (newDuration >= 0.2 && newSourceOffset >= 0) {
          timelineModel.trimClip(interaction.clipId, newStart, newDuration, newSourceOffset, false);
        }
      } else if (interaction.type === 'trim-right') {
        let newDuration = interaction.initialDuration + deltaTime;
        if (snapEnabled) {
          const rawEnd = interaction.initialStartOffset + newDuration;
          const snappedEnd = timelineModel.snapPosition(rawEnd, interaction.trackId, snapGrid);
          newDuration = Math.max(0.2, snappedEnd - interaction.initialStartOffset);
        }
        if (newDuration >= 0.2) {
          timelineModel.trimClip(
            interaction.clipId,
            interaction.initialStartOffset,
            newDuration,
            interaction.initialSourceOffset,
            false
          );
        }
      }
    };

    const handleMouseUp = () => {
      if (interaction) {
        const currentClip = timelineModel.getClip(interaction.clipId);
        if (currentClip) {
          if (interaction.type === 'move') {
            timelineModel.recordMoveHistory(
              interaction.clipId,
              interaction.initialStartOffset,
              currentClip.startOffset,
              interaction.trackId,
              currentClip.trackId
            );
          } else if (interaction.type === 'trim-left' || interaction.type === 'trim-right') {
            timelineModel.recordTrimHistory(
              interaction.clipId,
              interaction.initialStartOffset,
              interaction.initialDuration,
              interaction.initialSourceOffset,
              currentClip.startOffset,
              currentClip.duration,
              currentClip.sourceOffset
            );
          }
        }
        setInteraction(null);
      }
    };

    if (interaction) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [interaction, pixelsPerSec, snapEnabled, snapGrid]);

  const playheadX = currentTime * pixelsPerSec;
  const canvasWidth = Math.max(
    containerRef.current?.clientWidth || 800,
    (duration + 10) * pixelsPerSec
  );

  return (
    <section className="h-full flex flex-col bg-[#0b0d13] text-zinc-100 select-none overflow-hidden relative border-b border-[#1b202e]">
      {/* 1. Editor Toolbar */}
      <div className="h-11 px-4 bg-[#121620] border-b border-[#212738] flex items-center justify-between text-xs gap-3 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Split at Playhead */}
          <button
            onClick={() => {
              if (selectedClipId) {
                timelineModel.splitClip(selectedClipId, currentTime);
              }
            }}
            disabled={!selectedClipId}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 font-medium transition-all ${
              selectedClipId
                ? 'bg-[#1e2536] hover:bg-[#283248] text-white border border-[#36425e]'
                : 'bg-[#151924] text-gray-500 border border-[#202738] cursor-not-allowed'
            }`}
            title="Split selected clip at current playhead position (S)"
          >
            <Scissors className="w-3.5 h-3.5 text-cyan-400" />
            <span>Split (S)</span>
          </button>

          {/* Duplicate Clip */}
          <button
            onClick={() => {
              if (selectedClipId) {
                timelineModel.duplicateClip(selectedClipId);
              }
            }}
            disabled={!selectedClipId}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 font-medium transition-all ${
              selectedClipId
                ? 'bg-[#1e2536] hover:bg-[#283248] text-white border border-[#36425e]'
                : 'bg-[#151924] text-gray-500 border border-[#202738] cursor-not-allowed'
            }`}
            title="Duplicate selected clip (Ctrl+D)"
          >
            <Copy className="w-3.5 h-3.5 text-amber-400" />
            <span>Duplicate (Ctrl+D)</span>
          </button>

          {/* Delete Clip */}
          <button
            onClick={() => {
              if (selectedClipId) {
                timelineModel.deleteClip(selectedClipId);
              }
            }}
            disabled={!selectedClipId}
            className={`px-2.5 py-1 rounded flex items-center gap-1.5 font-medium transition-all ${
              selectedClipId
                ? 'bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/30'
                : 'bg-[#151924] text-gray-500 border border-[#202738] cursor-not-allowed'
            }`}
            title="Delete selected clip (Del)"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>Delete</span>
          </button>

          <div className="h-4 w-[1px] bg-[#273043] mx-1" />

          {/* Undo */}
          <button
            onClick={() => timelineModel.undo()}
            disabled={!canUndo}
            className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-all ${
              canUndo
                ? 'bg-[#1e2536] hover:bg-[#283248] text-white border border-[#36425e]'
                : 'bg-[#151924] text-gray-600 border border-[#202738] cursor-not-allowed'
            }`}
            title={`Undo (Ctrl+Z): ${undoText || 'Nothing to undo'}`}
          >
            <Undo2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px]">Undo</span>
          </button>

          {/* Redo */}
          <button
            onClick={() => timelineModel.redo()}
            disabled={!canRedo}
            className={`px-2 py-1 rounded flex items-center gap-1 font-medium transition-all ${
              canRedo
                ? 'bg-[#1e2536] hover:bg-[#283248] text-white border border-[#36425e]'
                : 'bg-[#151924] text-gray-600 border border-[#202738] cursor-not-allowed'
            }`}
            title={`Redo (Ctrl+Y): ${redoText || 'Nothing to redo'}`}
          >
            <Redo2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px]">Redo</span>
          </button>

          <div className="h-4 w-[1px] bg-[#273043] mx-1" />

          {/* Snapping Toggle */}
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`px-2 py-1 rounded flex items-center gap-1.5 font-mono text-xs border transition-all ${
              snapEnabled
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 shadow-sm'
                : 'bg-[#151924] text-gray-400 border-[#22293b]'
            }`}
            title="Toggle Snapping to Grid and Neighboring Clips"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Snap: {snapEnabled ? 'ON' : 'OFF'}</span>
          </button>

          {/* Snap Grid Selection */}
          {snapEnabled && (
            <select
              value={snapGrid}
              onChange={(e) => setSnapGrid(parseFloat(e.target.value))}
              className="bg-[#171b26] border border-[#2b3348] text-gray-300 rounded px-1.5 py-0.5 text-[11px] font-mono outline-none"
            >
              <option value="0.1">0.1s</option>
              <option value="0.25">0.25s (1/4s)</option>
              <option value="0.5">0.5s (1/2s)</option>
              <option value="1.0">1.0s (1s)</option>
            </select>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setZoom((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))))}
            className="p-1 rounded hover:bg-[#202738] text-gray-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-[11px] text-gray-400 w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.2).toFixed(1))))}
            className="p-1 rounded hover:bg-[#202738] text-gray-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Timeline Workspace Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-x-auto overflow-y-auto relative bg-[#090b10]"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (e.dataTransfer.files) {
            onDropFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => {
          timelineModel.deselectAll();
          setSelectedClipId(null);
        }}
      >
        <div style={{ width: `${canvasWidth}px`, minWidth: '100%' }} className="relative">
          {/* Time Ruler */}
          <div className="sticky top-0 z-30 shadow-md">
            <canvas
              ref={rulerRef}
              onClick={handleRulerClick}
              className="cursor-pointer block border-b border-[#212738]"
            />
          </div>

          {/* Multi-Track Lanes */}
          <div className="py-2 flex flex-col gap-2 min-h-[260px]">
            {tracks.map((track) => {
              const trackClips = clips.filter((c) => c.trackId === track.id);
              const isTrackSelected = track.id === selectedTrackId;

              return (
                <div
                  key={track.id}
                  onClick={() => {
                    timelineModel.selectTrack(track.id);
                    audioEngine.selectStem(track.id);
                  }}
                  className={`h-20 border-y relative flex items-center transition-all ${
                    isTrackSelected
                      ? 'bg-[#151c2c] border-cyan-500/60 shadow-[inset_0_0_12px_rgba(6,182,212,0.15)]'
                      : 'bg-[#12151f]/80 border-[#1e2436] hover:bg-[#151824]'
                  }`}
                >
                  {/* Track Left Info Tab */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      timelineModel.selectTrack(track.id);
                      audioEngine.selectStem(track.id);
                      if (trackClips.length > 0) {
                        timelineModel.selectClip(trackClips[0].id);
                        setSelectedClipId(trackClips[0].id);
                      }
                    }}
                    className={`sticky left-0 z-20 h-full w-32 px-2.5 py-1.5 flex flex-col justify-between shadow-md cursor-pointer transition-all border-r ${
                      isTrackSelected
                        ? 'bg-[#1e263a] border-cyan-400 shadow-[0_0_14px_rgba(6,182,212,0.35)]'
                        : 'bg-[#151924] border-[#262e42] hover:bg-[#1a2030]'
                    }`}
                    title={`Click to select ${track.name} stem track`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 transition-transform ${
                            isTrackSelected ? 'scale-125 ring-2 ring-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]' : ''
                          }`}
                          style={{ backgroundColor: track.color }}
                        />
                        <span
                          className={`text-[11px] font-bold truncate uppercase tracking-wide ${
                            isTrackSelected ? 'text-cyan-300' : 'text-gray-200'
                          }`}
                        >
                          {track.name}
                        </span>
                      </div>

                      {/* Audition / Play Stem Action */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          audioEngine.playStem(track.id);
                        }}
                        className="p-1 rounded bg-[#10141f] hover:bg-cyan-500/30 text-cyan-400 hover:text-cyan-200 border border-cyan-500/30 transition-all shrink-0"
                        title={`Audition ${track.name} (Solo & Play)`}
                      >
                        <Play className="w-2.5 h-2.5 fill-current" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[9px] font-mono text-gray-400">
                      <span>{trackClips.length} {trackClips.length === 1 ? 'clip' : 'clips'}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          audioEngine.setTrackMute(track.id);
                        }}
                        className={`text-[9px] px-1 rounded transition-colors ${
                          track.muted ? 'bg-red-500/20 text-red-400 border border-red-500/40 font-bold' : 'text-gray-500 hover:text-gray-300'
                        }`}
                        title={track.muted ? 'Unmute stem' : 'Mute stem'}
                      >
                        {track.muted ? 'MUTED' : 'MUTE'}
                      </button>
                    </div>
                  </div>

                  {/* Track Clips Container */}
                  <div className="relative flex-1 h-full">
                    {trackClips.map((clip) => {
                      const leftPx = clip.startOffset * pixelsPerSec;
                      const widthPx = Math.max(12, clip.duration * pixelsPerSec);
                      const isSelected = clip.id === selectedClipId;

                      return (
                        <div
                          key={clip.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            timelineModel.selectClip(clip.id);
                            setSelectedClipId(clip.id);
                          }}
                          onMouseDown={(e) => handleMouseDownOnClip(e, clip, 'move')}
                          style={{
                            left: `${leftPx}px`,
                            width: `${widthPx}px`,
                          }}
                          className={`absolute top-1 bottom-1 rounded-md border text-xs cursor-grab active:cursor-grabbing flex flex-col justify-between overflow-hidden shadow-md transition-shadow group ${
                            isSelected
                              ? 'border-cyan-400 bg-cyan-950/60 shadow-[0_0_12px_rgba(6,182,212,0.4)] z-10'
                              : 'border-[#2d3852] bg-[#1a2133] hover:border-gray-400'
                          }`}
                        >
                          {/* Left Trim Handle */}
                          <div
                            onMouseDown={(e) => handleMouseDownOnClip(e, clip, 'trim-left')}
                            className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-cyan-400/50 z-20 transition-colors"
                            title="Drag to trim beginning"
                          />

                          {/* Clip Header Label */}
                          <div className="px-2 py-0.5 bg-black/40 text-[10px] font-mono font-bold text-gray-300 truncate flex items-center justify-between">
                            <span className="truncate">{clip.name}</span>
                            <span className="text-[9px] text-gray-400 shrink-0 ml-1">
                              {clip.duration.toFixed(2)}s
                            </span>
                          </div>

                          {/* Decorative Waveform representation of this slice */}
                          <div className="flex-1 px-1 flex items-center justify-around opacity-75">
                            {Array.from({ length: Math.min(40, Math.floor(widthPx / 6)) }).map(
                              (_, i) => (
                                <div
                                  key={i}
                                  className="w-1 bg-cyan-400/60 rounded-full"
                                  style={{
                                    height: `${Math.max(15, (Math.sin(i * 0.7) * 0.5 + 0.5) * 80)}%`,
                                  }}
                                />
                              )
                            )}
                          </div>

                          {/* Right Trim Handle */}
                          <div
                            onMouseDown={(e) => handleMouseDownOnClip(e, clip, 'trim-right')}
                            className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-cyan-400/50 z-20 transition-colors"
                            title="Drag to trim end"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Hardware-Accurate Animated Playhead Line */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-blue-400 pointer-events-none z-30 shadow-[0_0_10px_rgba(96,165,250,1)]"
            style={{ transform: `translateX(${playheadX}px)` }}
          >
            <div
              className={`w-3.5 h-3.5 bg-blue-500 rotate-45 -translate-x-[6px] -translate-y-1.5 shadow-md border border-white/60 ${
                isPlaying ? 'animate-pulse' : ''
              }`}
            ></div>
          </div>
        </div>

        {/* Empty State Overlay if no asset and no clips */}
        {clips.length === 0 && !activeAsset && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8 z-10 pointer-events-none">
            <UploadCloud className="w-12 h-12 text-gray-600 mb-2" />
            <h3 className="text-sm font-bold text-gray-300">No Audio Clips in Timeline</h3>
            <p className="text-xs text-gray-500 max-w-sm mt-1">
              Import a real WAV/MP3/FLAC song or click "Load Stems" to populate multi-track clips.
            </p>
          </div>
        )}

        {/* Drag Over Overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-blue-600/20 backdrop-blur-sm border-2 border-blue-500 rounded-xl flex items-center justify-center z-50">
            <div className="bg-[#121622] p-6 rounded-2xl border border-blue-400 text-center shadow-2xl">
              <UploadCloud className="w-10 h-10 text-blue-400 mx-auto mb-2 animate-bounce" />
              <div className="text-sm font-bold text-white">Drop Audio File to Import</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
