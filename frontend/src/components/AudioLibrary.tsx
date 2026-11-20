import React, { useState, useMemo } from 'react';
import { AudioAsset } from '../types/audio';
import { Music, Trash2, Clock, HardDrive, Disc, Check, Radio, Search, Filter, X } from 'lucide-react';

interface AudioLibraryProps {
  assets: AudioAsset[];
  selectedAssetId: string | null;
  onSelectAsset: (asset: AudioAsset) => void;
  onDeleteAsset: (assetId: string) => void;
  isImporting: boolean;
}

type FormatFilter = 'ALL' | 'WAV' | 'MP3' | 'FLAC';

export const AudioLibrary: React.FC<AudioLibraryProps> = ({
  assets,
  selectedAssetId,
  onSelectAsset,
  onDeleteAsset,
  isImporting,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('ALL');

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      // 1. Search Query Filter
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        q === '' ||
        asset.filename.toLowerCase().includes(q) ||
        asset.metadata.format.toLowerCase().includes(q) ||
        asset.metadata.channel_type.toLowerCase().includes(q);

      // 2. Format Badge Filter
      const fmt = asset.metadata.format.toUpperCase();
      let matchesFormat = true;
      if (formatFilter === 'WAV') matchesFormat = fmt.includes('WAV');
      else if (formatFilter === 'MP3') matchesFormat = fmt.includes('MP3') || fmt.includes('MPEG');
      else if (formatFilter === 'FLAC') matchesFormat = fmt.includes('FLAC');

      return matchesSearch && matchesFormat;
    });
  }, [assets, searchQuery, formatFilter]);

  const getFormatBadgeColor = (format: string) => {
    const f = format.toLowerCase();
    if (f.includes('wav')) return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    if (f.includes('mp3') || f.includes('mpeg')) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    if (f.includes('flac')) return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
    return 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30';
  };

  return (
    <aside className="w-72 bg-studio-900 border-r border-studio-700/60 flex flex-col shrink-0 overflow-hidden select-none">
      {/* Panel Header */}
      <div className="h-10 border-b border-studio-700/50 px-4 flex items-center justify-between bg-studio-850 shrink-0">
        <div className="flex items-center space-x-2">
          <Disc className="w-4 h-4 text-zinc-400" />
          <h2 className="text-xs font-bold text-zinc-200 tracking-wide">Audio Library</h2>
        </div>
        <span className="text-[10px] font-mono text-zinc-400 bg-studio-800 px-1.5 py-0.5 rounded border border-studio-700">
          {filteredAssets.length} / {assets.length} {assets.length === 1 ? 'Track' : 'Tracks'}
        </span>
      </div>

      {/* Search Input & Format Filter Bar */}
      <div className="p-2.5 border-b border-studio-700/50 bg-studio-850/80 space-y-2 shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 pointer-events-none" />
          <input
            type="text"
            placeholder="Search library tracks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-studio-900 border border-studio-700/60 rounded-lg pl-8 pr-7 py-1 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 transition font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 text-zinc-400 hover:text-zinc-200"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Format Filter Badges */}
        <div className="flex items-center gap-1 text-[10px] font-mono font-bold">
          {(['ALL', 'WAV', 'MP3', 'FLAC'] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => setFormatFilter(fmt)}
              className={`flex-1 py-0.5 rounded transition ${
                formatFilter === fmt
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-studio-800 text-zinc-400 hover:bg-studio-750 hover:text-zinc-200'
              }`}
            >
              {fmt}
            </button>
          ))}
        </div>
      </div>

      {/* Asset List Container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Loading State during import */}
        {isImporting && (
          <div className="p-3 rounded-xl bg-studio-850 border border-blue-500/40 animate-pulse flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center">
              <Radio className="w-4 h-4 text-blue-400 animate-spin" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-blue-300 truncate">Importing audio file...</div>
              <div className="text-[10px] text-zinc-400 font-mono">Decoding Web Audio API samples</div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {assets.length === 0 && !isImporting && (
          <div className="h-64 flex flex-col items-center justify-center text-center p-4 text-zinc-500 border border-dashed border-studio-700/60 rounded-xl my-4">
            <Music className="w-8 h-8 mb-2 text-zinc-600" />
            <p className="text-xs font-medium text-zinc-400 mb-1">No audio imported</p>
            <p className="text-[11px] text-zinc-500 max-w-[180px]">
              Import a real WAV, MP3, or FLAC file to load into the workspace.
            </p>
          </div>
        )}

        {/* Filtered Empty State */}
        {assets.length > 0 && filteredAssets.length === 0 && (
          <div className="h-48 flex flex-col items-center justify-center text-center p-4 text-zinc-500 border border-dashed border-studio-700/60 rounded-xl my-2">
            <Filter className="w-6 h-6 mb-2 text-zinc-600" />
            <p className="text-xs font-medium text-zinc-400 mb-0.5">No matching tracks</p>
            <p className="text-[10px] text-zinc-500">
              Try adjusting your search query or format filter.
            </p>
          </div>
        )}

        {/* Asset Cards */}
        {filteredAssets.map((asset) => {
          const isSelected = asset.id === selectedAssetId;
          const formatBadge = getFormatBadgeColor(asset.metadata.format);

          return (
            <div
              key={asset.id}
              onClick={() => onSelectAsset(asset)}
              className={`p-3 rounded-xl border transition cursor-pointer flex flex-col justify-between group ${
                isSelected
                  ? 'bg-studio-800/90 border-blue-500/80 shadow-md shadow-blue-500/10'
                  : 'bg-studio-850 border-studio-700/60 hover:border-studio-600'
              }`}
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex items-center space-x-2 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-blue-600 text-white' : 'bg-studio-800 text-zinc-400'
                    }`}
                  >
                    <Music className="w-3.5 h-3.5" />
                  </div>
                  <h3
                    className={`text-xs font-medium truncate ${
                      isSelected ? 'text-blue-300 font-semibold' : 'text-zinc-200'
                    }`}
                    title={asset.filename}
                  >
                    {asset.filename}
                  </h3>
                </div>

                {/* Delete Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAsset(asset.id);
                  }}
                  title="Remove from library"
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-red-400 rounded transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Technical Metadata Badges */}
              <div className="flex items-center justify-between text-[10px] font-mono mt-1 text-zinc-400">
                <span className={`px-1.5 py-0.5 rounded border uppercase text-[9px] font-bold ${formatBadge}`}>
                  {asset.metadata.format.split(' ')[0]}
                </span>

                <div className="flex items-center space-x-2">
                  <span className="flex items-center space-x-0.5">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    <span>{asset.metadata.duration_formatted}</span>
                  </span>
                  <span>•</span>
                  <span>{asset.metadata.channel_type}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-studio-700/50 bg-studio-850/60 text-[10px] font-mono text-zinc-500 flex items-center justify-between shrink-0">
        <span className="flex items-center space-x-1">
          <HardDrive className="w-3 h-3" />
          <span>IndexedDB Persisted</span>
        </span>
        <Check className="w-3 h-3 text-emerald-400" />
      </div>
    </aside>
  );
};
