import React, { useState, useEffect, useCallback } from 'react';
import { TopNav, WorkspaceView } from './components/TopNav';
import { AudioLibrary } from './components/AudioLibrary';
import { TimelineWorkspace } from './components/TimelineWorkspace';
import { PropertiesPanel } from './components/PropertiesPanel';
import { PlaybackControls } from './components/PlaybackControls';
import { StemMixer } from './components/StemMixer';
import { RemixComposer } from './components/RemixComposer';
import { AudioRoutingGraph } from './components/AudioRoutingGraph';
import { SongAnalyzerView } from './components/SongAnalyzerView';
import { EffectsStudio } from './components/EffectsStudio';
import { ProjectModal } from './components/ProjectModal';
import { ExportModal } from './components/ExportModal';

import { AudioAsset, BackendStatus } from './types/audio';
import { ProjectState } from './types/project';
import { assetStorage } from './storage/indexedDB';
import { audioEngine } from './audio/AudioEngine';
import { timelineModel } from './audio/timeline/TimelineModel';
import { projectManager } from './audio/project/ProjectManager';
import { WaveformExtractor } from './audio/WaveformExtractor';
import { AlertTriangle, CheckCircle, RotateCcw } from 'lucide-react';

export interface StemSetInfo {
  id: string;
  name: string;
  relative_path: string;
  stems: {
    [key: string]: {
      stem: string;
      filename: string;
      stream_url: string;
      metadata: {
        duration_seconds: number;
        sample_rate: number;
        channels: number;
      };
    };
  };
}

export const App: React.FC = () => {
  // Application State
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('timeline');

  // Playback State (Web Audio API Synchronized)
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1.0);

  // Stem Sets & Demucs Separation State
  const [availableStemSets, setAvailableStemSets] = useState<StemSetInfo[]>([]);
  const [isSeparating, setIsSeparating] = useState<boolean>(false);
  const [activeStemSetName, setActiveStemSetName] = useState<string | null>(null);

  // Backend Connection Status
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    connected: false,
    status: 'checking',
    device: 'cpu',
    supportedFormats: ['.wav', '.mp3', '.flac'],
  });

  // UI State: Loading & Toast Notifications
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  // Project Management & Export Modals
  const [projectName, setProjectName] = useState<string>(projectManager.getCurrentProjectName());
  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [recoveryState, setRecoveryState] = useState<ProjectState | null>(null);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  // Subscribe to project name updates and verify auto-save crash recovery
  useEffect(() => {
    const unsubProj = projectManager.subscribe(() => {
      setProjectName(projectManager.getCurrentProjectName());
      const stemName = projectManager.getActiveStemSetName();
      if (stemName !== undefined) {
        setActiveStemSetName(stemName);
      }
      const activeId = projectManager.getActiveAssetId();
      if (activeId) {
        setActiveAssetId(activeId);
      }
      setDuration(timelineModel.getTotalDuration());
    });

    projectManager.checkRecovery().then((recovered) => {
      if (recovered) {
        setRecoveryState(recovered);
      }
    });

    return () => {
      unsubProj();
    };
  }, []);

  const handleRecoverSession = async () => {
    if (!recoveryState) return;
    try {
      await projectManager.recoverProject(recoveryState);
      setRecoveryState(null);
      showToast('Successfully recovered previous unsaved session!', 'success');
    } catch {
      showToast('Failed to restore session.', 'error');
    }
  };

  const handleDismissRecovery = async () => {
    await projectManager.dismissRecovery();
    setRecoveryState(null);
  };

  // 1. Check Backend Connection
  const checkBackendHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setBackendStatus({
          connected: true,
          status: data.status,
          device: data.device,
          supportedFormats: data.supported_formats || ['.wav', '.mp3', '.flac'],
        });
      } else {
        setBackendStatus((prev) => ({ ...prev, connected: false }));
      }
    } catch {
      setBackendStatus((prev) => ({ ...prev, connected: false }));
    }
  }, []);

  // 2. Fetch Available Pre-Separated Stem Sets
  const fetchAvailableStemSets = useCallback(async () => {
    try {
      const res = await fetch('/api/audio/stems/available');
      if (res.ok) {
        const data = await res.json();
        setAvailableStemSets(data.stem_sets || []);
      }
    } catch (err) {
      console.warn('Failed to fetch available stem sets:', err);
    }
  }, []);

  // 3. Select and Load Audio Asset into AudioEngine
  const selectAsset = useCallback(
    async (asset: AudioAsset) => {
      setActiveAssetId(asset.id);
      setActiveStemSetName(null);
      projectManager.setActiveAssetId(asset.id);
      projectManager.setActiveStemSetName(null);

      try {
        let rawBytes = await assetStorage.getAssetBinary(asset.id);

        if (!rawBytes) {
          const res = await fetch(asset.stream_url);
          if (!res.ok) throw new Error('Failed to fetch audio stream from backend.');
          rawBytes = await res.arrayBuffer();
          await assetStorage.saveAsset(asset, rawBytes);
        }

        const decodedBuffer = await audioEngine.decodeAudio(rawBytes);
        audioEngine.loadBuffer(decodedBuffer, 'master', asset.filename);
        
        // Register in TimelineModel
        timelineModel.clearAll();
        audioEngine.setTimelineModel(timelineModel);
        timelineModel.registerAsset(asset.id, decodedBuffer);
        timelineModel.addClip({
          id: `clip-${asset.id}`,
          trackId: 'vocals',
          assetId: asset.id,
          name: asset.filename,
          startOffset: 0,
          duration: decodedBuffer.duration,
          sourceOffset: 0,
          color: '#06b6d4',
        }, false);

        setDuration(decodedBuffer.duration);
        setCurrentTime(0);

        if (!asset.peaks || asset.peaks.length === 0) {
          const clientPeaks = WaveformExtractor.extractPeaksFromBuffer(decodedBuffer);
          asset.peaks = clientPeaks.peaks;
          asset.rms = clientPeaks.rms;
          asset.max_peak = clientPeaks.max_peak;
          await assetStorage.saveAsset(asset);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Audio decoding error: ${msg}`, 'error');
      }
    },
    [showToast]
  );

  // 4. Load 4 Separated Demucs Stems into the Mixer
  const loadStemSet = useCallback(
    async (stemSet: StemSetInfo) => {
      setIsImporting(true);
      showToast(`Loading 4 Demucs stems for '${stemSet.name}'...`, 'success');
      audioEngine.stop();
      audioEngine.clearAllTracks();

      try {
        timelineModel.clearAll();
        audioEngine.setTimelineModel(timelineModel);

        const stemKeys = ['vocals', 'drums', 'bass', 'other'];
        const trackMapping: { [key: string]: { trackId: string; color: string } } = {
          vocals: { trackId: 'vocals', color: '#06b6d4' },
          drums: { trackId: 'drums', color: '#f59e0b' },
          bass: { trackId: 'bass', color: '#a855f7' },
          other: { trackId: 'other', color: '#10b981' },
        };

        let maxDur = 0;

        for (const key of stemKeys) {
          const stemInfo = stemSet.stems[key];
          if (!stemInfo) continue;

          const res = await fetch(stemInfo.stream_url);
          if (!res.ok) throw new Error(`Failed to download stem ${key}`);
          const arrayBuf = await res.arrayBuffer();
          const decoded = await audioEngine.decodeAudio(arrayBuf);
          audioEngine.loadBuffer(decoded, key, key.toUpperCase());

          // Save stem asset and binary to IndexedDB for reliable offline restoration
          const stemAsset: AudioAsset = {
            id: key,
            filename: `${key}.wav`,
            stored_filename: `${stemSet.name}/${key}.wav`,
            stream_url: stemInfo.stream_url,
            metadata: {
              filename: `${key}.wav`,
              format: 'WAV',
              subtype: 'PCM_16',
              duration_seconds: decoded.duration,
              duration_formatted: `${Math.floor(decoded.duration / 60)}:${Math.floor(decoded.duration % 60).toString().padStart(2, '0')}`,
              sample_rate: decoded.sampleRate,
              channels: decoded.numberOfChannels,
              channel_type: decoded.numberOfChannels === 2 ? 'Stereo' : 'Mono',
              frames: decoded.length,
              file_size_bytes: arrayBuf.byteLength,
              file_size_formatted: `${(arrayBuf.byteLength / (1024 * 1024)).toFixed(2)} MB`,
            },
            peaks: [],
            rms: [],
            max_peak: 1.0,
            createdAt: Date.now(),
          };
          await assetStorage.saveAsset(stemAsset, arrayBuf);

          // Register in TimelineModel and add non-destructive clip to canonical stem track
          timelineModel.registerAsset(key, decoded);
          const map = trackMapping[key] || { trackId: key, color: '#06b6d4' };
          timelineModel.addClip(
            {
              id: `clip-${key}-${Date.now()}`,
              trackId: map.trackId,
              assetId: key,
              name: `${key.toUpperCase()}`,
              startOffset: 0,
              duration: decoded.duration,
              sourceOffset: 0,
              color: map.color,
            },
            false
          );

          if (decoded.duration > maxDur) maxDur = decoded.duration;
        }

        setDuration(maxDur);
        setCurrentTime(0);
        setActiveStemSetName(stemSet.name);
        projectManager.setActiveStemSetName(stemSet.name);
        showToast(
          `Successfully loaded 4 synchronized stems (${stemSet.name}): Vocals, Drums, Bass, Other.`,
          'success'
        );
      } catch (err) {
        showToast(`Error loading stems: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        setIsImporting(false);
      }
    },
    [showToast]
  );

  // 5. Run AI Stem Separation on Current Audio File
  const handleSeparateCurrentTrack = useCallback(async () => {
    const active = assets.find((a) => a.id === activeAssetId);
    if (!active) {
      showToast('Please import and select an audio track first.', 'error');
      return;
    }

    setIsSeparating(true);
    showToast('Running Demucs AI separation on CPU. Please wait 15-30s...', 'success');

    try {
      const res = await fetch(`/api/audio/separate/${active.stored_filename}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Separation failed on server.');
      }
      const data = await res.json();
      await fetchAvailableStemSets();
      await loadStemSet(data);
      showToast('Demucs separation finished! Stems loaded into Mixer.', 'success');
    } catch (err) {
      showToast(`Separation failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setIsSeparating(false);
    }
  }, [activeAssetId, assets, fetchAvailableStemSets, loadStemSet, showToast]);

  // 6. Load Stored Assets from IndexedDB on Initial Mount
  const loadStoredAssets = useCallback(async () => {
    try {
      const stored = await assetStorage.getAllAssets();
      setAssets(stored);
      if (stored.length > 0 && !activeAssetId) {
        selectAsset(stored[0]);
      }
    } catch (err) {
      console.error('Failed to load assets from IndexedDB:', err);
    }
  }, [activeAssetId, selectAsset]);

  useEffect(() => {
    checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 10000);
    loadStoredAssets();
    fetchAvailableStemSets();

    return () => clearInterval(interval);
  }, [checkBackendHealth, loadStoredAssets, fetchAvailableStemSets]);

  // 7. Audio Engine Time & Play State Subscriptions
  useEffect(() => {
    const unsubTime = audioEngine.onTimeUpdate((cur, dur) => {
      setCurrentTime(cur);
      setDuration(dur);
    });

    const unsubState = audioEngine.onPlayStateChange((playing) => {
      setIsPlaying(playing);
    });

    return () => {
      unsubTime();
      unsubState();
    };
  }, []);

  // 8. Keyboard Spacebar Play/Pause & Arrow Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (audioEngine.getDuration() <= 0) {
          showToast('Please import or select an audio file first.', 'error');
          return;
        }
        audioEngine.togglePlay();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        audioEngine.seek(audioEngine.getCurrentTime() - 2.0);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        audioEngine.seek(audioEngine.getCurrentTime() + 2.0);
      } else if (e.code === 'Home') {
        e.preventDefault();
        audioEngine.seek(0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showToast]);

  // 9. Real Audio File Import
  const handleImportFile = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    const validExts = ['.wav', '.mp3', '.flac'];
    if (!validExts.includes(ext)) {
      showToast(`Invalid format '${ext}'. Only WAV, MP3, and FLAC supported.`, 'error');
      return;
    }

    setIsImporting(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/audio/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || `Upload failed with status ${res.status}`);
      }

      const uploadedData = await res.json();
      const rawBytes = await file.arrayBuffer();

      const newAsset: AudioAsset = {
        id: uploadedData.id,
        filename: uploadedData.filename,
        stored_filename: uploadedData.stored_filename,
        stream_url: uploadedData.stream_url,
        metadata: uploadedData.metadata,
        peaks: uploadedData.peaks,
        rms: uploadedData.rms,
        max_peak: uploadedData.max_peak,
        createdAt: Date.now(),
      };

      await assetStorage.saveAsset(newAsset, rawBytes);
      setAssets((prev) => [newAsset, ...prev]);

      const decodedBuffer = await audioEngine.decodeAudio(rawBytes);
      audioEngine.loadBuffer(decodedBuffer, 'master', newAsset.filename);
      setDuration(decodedBuffer.duration);
      setCurrentTime(0);
      setActiveAssetId(newAsset.id);
      setActiveStemSetName(null);

      showToast(`Successfully imported ${newAsset.filename}!`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Import error: ${msg}`, 'error');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDropFiles = (files: FileList) => {
    if (files.length > 0) {
      handleImportFile(files[0]);
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    try {
      await assetStorage.deleteAsset(assetId);
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
      if (activeAssetId === assetId) {
        audioEngine.stop();
        audioEngine.removeTrack('master');
        setActiveAssetId(null);
        setDuration(0);
        setCurrentTime(0);
      }
      showToast('Asset removed from library and storage.', 'success');
    } catch {
      showToast('Failed to delete asset from storage.', 'error');
    }
  };

  const handleTogglePlay = () => {
    if (duration <= 0) {
      showToast('Please import or select an audio file first.', 'error');
      return;
    }
    audioEngine.togglePlay();
  };

  const handleStop = () => {
    audioEngine.stop();
  };

  const handleSeek = (time: number) => {
    audioEngine.seek(time);
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    audioEngine.setMasterVolume(newVol);
  };

  const activeAsset = assets.find((a) => a.id === activeAssetId) || null;

  return (
    <div className="h-screen w-screen flex flex-col bg-studio-950 text-zinc-100 overflow-hidden font-sans">
      {/* 0. Crash Recovery Notification Banner */}
      {recoveryState && (
        <div className="bg-amber-950/90 border-b border-amber-600/50 px-5 py-2.5 flex items-center justify-between text-xs text-amber-200 z-40 shadow-lg">
          <div className="flex items-center space-x-2">
            <RotateCcw className="w-4 h-4 text-amber-400 animate-spin" />
            <span>
              <strong>Crash Recovery Detected:</strong> Unsaved changes from session &quot;
              <strong>{recoveryState.metadata.name}</strong>&quot; (
              {new Date(recoveryState.metadata.updatedAt).toLocaleTimeString()}) are available.
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleRecoverSession}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-md shadow-sm transition"
            >
              Restore Session
            </button>
            <button
              onClick={handleDismissRecovery}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* 1. Top Navigation & Status */}
      <TopNav
        backendStatus={backendStatus}
        isImporting={isImporting}
        activeView={workspaceView}
        projectName={projectName}
        onViewChange={setWorkspaceView}
        onOpenProjects={() => setShowProjectModal(true)}
        onOpenExport={() => setShowExportModal(true)}
        onFileSelected={handleImportFile}
        onError={(msg) => showToast(msg, 'error')}
      />

      {/* 2. Main Studio Area: Left Library + Central Workspace (Timeline / Remix / Routing / Mixer) + Right Properties */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Audio Library Panel */}
        <AudioLibrary
          assets={assets}
          selectedAssetId={activeAssetId}
          onSelectAsset={selectAsset}
          onDeleteAsset={handleDeleteAsset}
          isImporting={isImporting}
        />

        {/* Center: Active Workspace View */}
        <div className="flex-1 flex flex-col overflow-hidden bg-studio-900 border-x border-[#1e2333]">
          {workspaceView === 'timeline' && (
            <>
              {/* Stem Presets Quick Action Bar */}
              <div className="bg-[#11141c] border-b border-[#222838] px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-300 uppercase tracking-wide">
                    Stem Separation Sets:
                  </span>
                  {availableStemSets.length === 0 ? (
                    <span className="text-gray-500 italic">No separated sets found yet</span>
                  ) : (
                    availableStemSets.map((stemSet) => (
                      <button
                        key={stemSet.id}
                        onClick={() => loadStemSet(stemSet)}
                        className={`px-2.5 py-1 rounded-md font-mono font-medium border transition-all ${
                          activeStemSetName === stemSet.name
                            ? 'bg-blue-600/30 text-blue-300 border-blue-500 shadow-sm shadow-blue-500/20'
                            : 'bg-[#181d2a] hover:bg-[#202738] text-gray-300 border-[#2d374e]'
                        }`}
                        title={`Load all 4 Demucs stems for ${stemSet.name}`}
                      >
                        Load Stems: <span className="font-bold text-white">{stemSet.name}</span>
                      </button>
                    ))
                  )}
                </div>

                {activeStemSetName && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-mono">
                    Currently Mixing: {activeStemSetName} (4 Stems)
                  </span>
                )}
              </div>

              {/* Timeline Workspace */}
              <div className="flex-1 min-h-[220px] overflow-hidden">
                <TimelineWorkspace
                  activeAsset={activeAsset}
                  currentTime={currentTime}
                  duration={duration}
                  isPlaying={isPlaying}
                  onSeek={handleSeek}
                  onDropFiles={handleDropFiles}
                />
              </div>

              {/* Multi-Stem Mixer Section */}
              <div className="p-3 bg-[#0d1017] border-t border-[#1e2333] max-h-[340px] overflow-y-auto">
                <StemMixer
                  onSeparateRequest={activeAsset ? handleSeparateCurrentTrack : undefined}
                  isSeparating={isSeparating}
                />
              </div>
            </>
          )}

          {workspaceView === 'remix' && (
            <RemixComposer
              activeAsset={activeAsset}
              isPlaying={isPlaying}
              currentTime={currentTime}
              onSeek={handleSeek}
              showToast={showToast}
            />
          )}

          {workspaceView === 'routing' && <AudioRoutingGraph />}

          {workspaceView === 'mixer' && (
            <div className="flex-1 p-5 overflow-y-auto bg-[#0a0c10]">
              <StemMixer
                onSeparateRequest={activeAsset ? handleSeparateCurrentTrack : undefined}
                isSeparating={isSeparating}
              />
            </div>
          )}

          {workspaceView === 'analyzer' && (
            <SongAnalyzerView
              activeAsset={activeAsset}
              onNavigateToRemix={() => setWorkspaceView('remix')}
              showToast={showToast}
            />
          )}

          {workspaceView === 'effects' && (
            <EffectsStudio
              activeAsset={activeAsset}
              isPlaying={isPlaying}
              showToast={showToast}
            />
          )}
        </div>

        {/* Right: Technical Audio Properties Panel */}
        <PropertiesPanel activeAsset={activeAsset} />
      </div>

      {/* 3. Bottom: Playback Transport Controls */}
      <PlaybackControls
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
      />

      {/* 4. Toast Notification Box */}
      {toast && (
        <div
          className={`fixed bottom-20 right-6 px-4 py-2.5 rounded-xl border text-xs font-medium flex items-center space-x-2 shadow-2xl z-50 transition transform animate-fade-in ${
            toast.type === 'error'
              ? 'bg-red-950/90 text-red-200 border-red-500/50'
              : 'bg-emerald-950/90 text-emerald-200 border-emerald-500/50'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* 5. Project Management Modal */}
      <ProjectModal
        isOpen={showProjectModal}
        onClose={() => setShowProjectModal(false)}
        showToast={showToast}
      />

      {/* 6. Multi-Format Audio Export Modal */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        tracks={timelineModel.getTracks()}
        showToast={showToast}
      />
    </div>
  );
};
