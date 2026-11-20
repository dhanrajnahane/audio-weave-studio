import React, { useEffect, useState, useRef } from 'react';
import { Play } from 'lucide-react';
import { audioEngine, TrackInfo } from '../audio/AudioEngine';
import { timelineModel } from '../audio/timeline/TimelineModel';

interface StemMixerProps {
  onSeparateRequest?: () => void;
  isSeparating?: boolean;
}

export const StemMixer: React.FC<StemMixerProps> = ({ onSeparateRequest, isSeparating }) => {
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [masterVolume, setMasterVolume] = useState<number>(1.0);
  const [masterMuted, setMasterMuted] = useState<boolean>(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [meterLevels, setMeterLevels] = useState<{ [id: string]: number }>({});
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    // Initial fetch of tracks
    setTracks(audioEngine.getTrackStates());
    setMasterVolume(audioEngine.getMasterVolume());
    setMasterMuted(audioEngine.getMasterMute());
    setSelectedTrackId(timelineModel.getSelectedTrackId());

    // Subscribe to changes in track states
    const unsubAudio = audioEngine.onTrackStatesChange((updatedTracks) => {
      setTracks(updatedTracks);
      setMasterVolume(audioEngine.getMasterVolume());
      setMasterMuted(audioEngine.getMasterMute());
    });

    const unsubTimeline = timelineModel.subscribe(() => {
      setSelectedTrackId(timelineModel.getSelectedTrackId());
      setTracks(audioEngine.getTrackStates());
    });

    return () => {
      unsubAudio();
      unsubTimeline();
    };
  }, []);

  // Real-time audio VU metering ticker
  useEffect(() => {
    const updateMeters = () => {
      if (audioEngine.getIsPlaying()) {
        const levels: { [id: string]: number } = {};
        const allTracks = audioEngine.getAllTracks();

        allTracks.forEach((trackNode, id) => {
          if (trackNode.analyserNode && !trackNode.muted) {
            const data = new Uint8Array(trackNode.analyserNode.frequencyBinCount);
            trackNode.analyserNode.getByteTimeDomainData(data);
            let peak = 0;
            for (let i = 0; i < data.length; i++) {
              const val = Math.abs((data[i] - 128) / 128);
              if (val > peak) peak = val;
            }
            // Scale and smooth peak
            levels[id] = Math.min(1.0, peak * 1.4);
          } else {
            levels[id] = 0;
          }
        });

        // Master level
        const masterAnalyser = audioEngine.getAnalyser();
        if (masterAnalyser && !audioEngine.getMasterMute()) {
          const data = new Uint8Array(masterAnalyser.frequencyBinCount);
          masterAnalyser.getByteTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            const val = Math.abs((data[i] - 128) / 128);
            if (val > peak) peak = val;
          }
          levels['master'] = Math.min(1.0, peak * 1.4);
        } else {
          levels['master'] = 0;
        }

        setMeterLevels(levels);
      } else {
        setMeterLevels({});
      }
      animRef.current = requestAnimationFrame(updateMeters);
    };

    animRef.current = requestAnimationFrame(updateMeters);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  const formatDb = (volume: number): string => {
    if (volume <= 0.001) return '-inf dB';
    const db = 20 * Math.log10(volume);
    return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
  };

  const formatPan = (pan: number): string => {
    if (Math.abs(pan) < 0.05) return 'C';
    if (pan < 0) return `L ${Math.round(Math.abs(pan) * 100)}%`;
    return `R ${Math.round(pan * 100)}%`;
  };

  const getStemColor = (stemId: string) => {
    const id = stemId.toLowerCase();
    if (id.includes('vocal')) return { border: 'border-cyan-500/40', badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50', meter: 'from-cyan-500 to-teal-400' };
    if (id.includes('drum')) return { border: 'border-amber-500/40', badge: 'bg-amber-500/20 text-amber-300 border-amber-500/50', meter: 'from-amber-500 to-orange-400' };
    if (id.includes('bass')) return { border: 'border-purple-500/40', badge: 'bg-purple-500/20 text-purple-300 border-purple-500/50', meter: 'from-purple-500 to-pink-400' };
    if (id.includes('other')) return { border: 'border-emerald-500/40', badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50', meter: 'from-emerald-500 to-teal-400' };
    return { border: 'border-blue-500/40', badge: 'bg-blue-500/20 text-blue-300 border-blue-500/50', meter: 'from-blue-500 to-indigo-400' };
  };

  return (
    <div className="bg-[#12151e] border border-[#222838] rounded-xl p-4 shadow-xl select-none">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between pb-3 mb-4 border-b border-[#222838] gap-3">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)] animate-pulse" />
          <h2 className="text-sm font-semibold tracking-wide text-gray-100 uppercase">
            Multi-Stem Audio Mixer
          </h2>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#1b2233] text-blue-400 font-mono border border-blue-500/30">
            {tracks.length} Channels Loaded
          </span>
        </div>

        {onSeparateRequest && (
          <button
            onClick={onSeparateRequest}
            disabled={isSeparating}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
              isSeparating
                ? 'bg-[#1b2233] text-gray-400 border border-[#2d374e] cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-md shadow-blue-600/30 border border-blue-400/30'
            }`}
          >
            {isSeparating ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Separating Stems with Demucs...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
                </svg>
                Run AI Stem Separation
              </>
            )}
          </button>
        )}
      </div>

      {tracks.length === 0 ? (
        <div className="py-12 text-center text-gray-400 flex flex-col items-center justify-center gap-2">
          <svg className="w-10 h-10 text-gray-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <span className="text-sm font-medium text-gray-300">No separated audio stems loaded yet.</span>
          <span className="text-xs text-gray-500 max-w-md">
            Import an audio file or click "Load Demucs Stems" to start mixing Vocals, Drums, Bass, and Other channels in real-time synchronization.
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
          {/* Individual Stem Channel Strips */}
          {tracks.map((track) => {
            const colors = getStemColor(track.id);
            const level = meterLevels[track.id] || 0;
            const isSelected = track.isSelected || selectedTrackId === track.id;

            return (
              <div
                key={track.id}
                onClick={() => {
                  timelineModel.selectTrack(track.id);
                  audioEngine.selectStem(track.id);
                }}
                className={`bg-[#171b26] border rounded-xl p-3 flex flex-col justify-between transition-all shadow-md relative overflow-hidden cursor-pointer ${
                  isSelected
                    ? 'border-cyan-400 ring-2 ring-cyan-400/80 shadow-[0_0_16px_rgba(6,182,212,0.35)] bg-[#1c2232]'
                    : `${colors.border} hover:border-gray-500`
                }`}
              >
                {/* Active audio glow indicator */}
                {track.isActive && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 animate-pulse" />
                )}

                {/* Track Header */}
                <div>
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`text-xs font-bold tracking-wider truncate uppercase ${
                          isSelected ? 'text-cyan-300' : 'text-gray-200'
                        }`}
                      >
                        {track.name}
                      </span>
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

                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold border ${
                        track.muted
                          ? 'bg-red-500/20 text-red-400 border-red-500/30'
                          : track.solo
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                          : track.isActive
                          ? colors.badge
                          : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}
                    >
                      {track.muted ? 'MUTED' : track.solo ? 'SOLO' : track.isActive ? 'ACTIVE' : 'READY'}
                    </span>
                  </div>

                  {/* Dynamic VU Meter Bar */}
                  <div className="h-2 w-full bg-[#0d1017] rounded-full overflow-hidden p-0.5 mb-3 border border-[#222838]">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${colors.meter} transition-all duration-75`}
                      style={{ width: `${Math.round(level * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Mute & Solo Action Buttons */}
                <div className="grid grid-cols-2 gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => audioEngine.setTrackMute(track.id)}
                    className={`py-1 rounded font-bold text-xs uppercase tracking-wider transition-all border ${
                      track.muted
                        ? 'bg-red-600 text-white border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'
                        : 'bg-[#1b2233] text-gray-300 hover:text-white border-[#2d374e] hover:bg-[#252e42]'
                    }`}
                    title="Mute Track (Silences this stem immediately)"
                  >
                    Mute
                  </button>
                  <button
                    onClick={() => audioEngine.setTrackSolo(track.id)}
                    className={`py-1 rounded font-bold text-xs uppercase tracking-wider transition-all border ${
                      track.solo
                        ? 'bg-amber-400 text-black border-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.6)]'
                        : 'bg-[#1b2233] text-gray-300 hover:text-white border-[#2d374e] hover:bg-[#252e42]'
                    }`}
                    title="Solo Track (Silences all non-solo stems immediately)"
                  >
                    Solo
                  </button>
                </div>

                {/* Stereo Pan Control */}
                <div className="mb-3 bg-[#11141d] p-2 rounded-lg border border-[#222838]" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono mb-1">
                    <span>PAN</span>
                    <button
                      onClick={() => audioEngine.setTrackPan(track.id, 0)}
                      className="text-blue-400 hover:text-blue-300 transition-colors"
                      title="Click to center pan"
                    >
                      {formatPan(track.pan)}
                    </button>
                  </div>
                  <input
                    type="range"
                    min="-1"
                    max="1"
                    step="0.05"
                    value={track.pan}
                    onChange={(e) => audioEngine.setTrackPan(track.id, parseFloat(e.target.value))}
                    className="w-full accent-blue-500 h-1.5 bg-[#1e2333] rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-gray-600 font-mono mt-0.5">
                    <span>L</span>
                    <span>C</span>
                    <span>R</span>
                  </div>
                </div>

                {/* Volume Fader */}
                <div className="bg-[#11141d] p-2 rounded-lg border border-[#222838]" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between items-center text-[10px] text-gray-400 font-mono mb-1">
                    <span>GAIN</span>
                    <span className="text-gray-200 font-bold">{formatDb(track.volume)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.01"
                    value={track.volume}
                    onChange={(e) => audioEngine.setTrackVolume(track.id, parseFloat(e.target.value))}
                    className="w-full accent-blue-500 h-2 bg-[#1e2333] rounded-lg cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-gray-500 font-mono mt-0.5">
                    <span>-inf</span>
                    <span className="text-blue-400">0dB</span>
                    <span>+3dB</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Master Output Channel Strip */}
          <div className="bg-[#1a1824] border border-indigo-500/40 rounded-xl p-3 flex flex-col justify-between shadow-md relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />

            <div>
              <div className="flex items-center justify-between gap-1 mb-2">
                <span className="text-xs font-bold text-indigo-300 tracking-wider truncate uppercase">
                  Master Output
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold border ${
                    masterMuted
                      ? 'bg-red-500/20 text-red-400 border-red-500/30'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  }`}
                >
                  {masterMuted ? 'MUTED' : 'MAIN'}
                </span>
              </div>

              {/* Master VU Meter Bar */}
              <div className="h-2 w-full bg-[#0d1017] rounded-full overflow-hidden p-0.5 mb-3 border border-[#222838]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-400 to-pink-500 transition-all duration-75"
                  style={{ width: `${Math.round((meterLevels['master'] || 0) * 100)}%` }}
                />
              </div>
            </div>

            {/* Master Mute Button */}
            <div className="mb-3">
              <button
                onClick={() => audioEngine.setMasterMute(!masterMuted)}
                className={`w-full py-1 rounded font-bold text-xs uppercase tracking-wider transition-all border ${
                  masterMuted
                    ? 'bg-red-600 text-white border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.5)]'
                    : 'bg-[#221e33] text-indigo-200 hover:text-white border-indigo-500/30 hover:bg-[#2d2744]'
                }`}
              >
                {masterMuted ? 'UNMUTE ALL' : 'MUTE MASTER'}
              </button>
            </div>

            {/* Master Stereo Balance / Note */}
            <div className="mb-3 bg-[#13111b] p-2 rounded-lg border border-indigo-500/20 text-center">
              <span className="text-[10px] text-indigo-300 font-mono tracking-wide">
                STEREO MASTER BUS
              </span>
              <div className="text-[9px] text-gray-500 mt-0.5">32-bit Floating Point Mix</div>
            </div>

            {/* Master Fader */}
            <div className="bg-[#13111b] p-2 rounded-lg border border-indigo-500/20">
              <div className="flex justify-between items-center text-[10px] text-indigo-300 font-mono mb-1">
                <span>MASTER GAIN</span>
                <span className="text-gray-100 font-bold">{formatDb(masterVolume)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.01"
                value={masterVolume}
                onChange={(e) => audioEngine.setMasterVolume(parseFloat(e.target.value))}
                className="w-full accent-indigo-500 h-2 bg-[#252033] rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-gray-500 font-mono mt-0.5">
                <span>-inf</span>
                <span className="text-indigo-400">0dB</span>
                <span>+3dB</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
