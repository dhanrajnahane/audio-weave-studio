import React from 'react';
import { Play, Pause, Square, Volume2, VolumeX, RotateCcw } from 'lucide-react';

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  onTogglePlay: () => void;
  onStop: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (vol: number) => void;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  volume,
  onTogglePlay,
  onStop,
  onSeek,
  onVolumeChange,
}) => {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };

  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(parseFloat(e.target.value));
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <footer className="h-16 bg-studio-900 border-t border-studio-700/60 px-6 flex items-center justify-between shrink-0 select-none z-30">
      {/* Playback Action Buttons */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onStop}
          title="Stop & Rewind (00:00)"
          disabled={duration === 0}
          className="p-2.5 rounded-xl bg-studio-800 hover:bg-studio-700 active:bg-studio-750 disabled:opacity-40 text-zinc-300 transition"
        >
          <Square className="w-4 h-4 fill-current" />
        </button>

        <button
          onClick={onTogglePlay}
          disabled={duration === 0}
          title={isPlaying ? "Pause (Spacebar)" : "Play (Spacebar)"}
          className="w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-40 text-white flex items-center justify-center shadow-lg shadow-blue-600/30 transition transform active:scale-95 cursor-pointer"
        >
          {isPlaying ? (
            <Pause className="w-5 h-5 fill-current" />
          ) : (
            <Play className="w-5 h-5 fill-current ml-0.5" />
          )}
        </button>

        <button
          onClick={() => onSeek(0)}
          disabled={duration === 0}
          title="Rewind to beginning"
          className="p-2.5 rounded-xl bg-studio-800 hover:bg-studio-700 active:bg-studio-750 disabled:opacity-40 text-zinc-300 transition"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Central Scrubber & Time Display with Dynamic Progress Indicator (Task 5, 6, 7) */}
      <div className="flex-1 max-w-2xl mx-8 flex items-center space-x-4">
        <span className="font-mono text-xs font-bold text-blue-400 w-24 text-right">
          {formatTime(currentTime)}
        </span>

        {/* Working Playback Progress Scrubber with Dynamic Gradient Fill */}
        <div className="flex-1 flex items-center relative">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.005}
            value={currentTime}
            onChange={handleScrubberChange}
            disabled={duration === 0}
            style={{
              background: `linear-gradient(to right, #3b82f6 ${progressPercent}%, #1e2230 ${progressPercent}%)`
            }}
            className="w-full accent-blue-400 h-2 rounded-lg cursor-pointer transition-all"
          />
        </div>

        <span className="font-mono text-xs font-medium text-zinc-400 w-24">
          {formatTime(duration)}
        </span>
      </div>

      {/* Master Volume Slider */}
      <div className="flex items-center space-x-3 w-48 justify-end">
        <button
          onClick={() => onVolumeChange(volume === 0 ? 1.0 : 0)}
          className="text-zinc-400 hover:text-white transition"
          title={volume === 0 ? "Unmute" : "Mute"}
        >
          {volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
        </button>

        <input
          type="range"
          min={0}
          max={1.5}
          step={0.01}
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="w-24 accent-blue-500 h-1.5 bg-studio-800 rounded-lg cursor-pointer"
        />

        <span className="font-mono text-[11px] text-zinc-400 w-10 text-right">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </footer>
  );
};
