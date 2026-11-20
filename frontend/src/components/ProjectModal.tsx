import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Save,
  FilePlus,
  Trash2,
  Clock,
  Layers,
  Edit2,
  Check,
  AlertCircle,
  Copy,
} from 'lucide-react';
import { projectManager } from '../audio/project/ProjectManager';
import { ProjectSummary } from '../types/project';

interface ProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (msg: string, type?: 'error' | 'success') => void;
}

export const ProjectModal: React.FC<ProjectModalProps> = ({ isOpen, onClose, showToast }) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentName, setCurrentName] = useState<string>(projectManager.getCurrentProjectName());
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [newNameInput, setNewNameInput] = useState<string>('');
  const [saveAsNameInput, setSaveAsNameInput] = useState<string>('');
  const [showSaveAs, setShowSaveAs] = useState<boolean>(false);

  const refreshList = async () => {
    const list = await projectManager.listProjects();
    setProjects(list);
    setCurrentName(projectManager.getCurrentProjectName());
  };

  useEffect(() => {
    if (isOpen) {
      refreshList();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      await projectManager.saveProject();
      showToast(`Project "${projectManager.getCurrentProjectName()}" saved successfully!`, 'success');
      await refreshList();
    } catch {
      showToast('Failed to save project to IndexedDB.', 'error');
    }
  };

  const handleSaveAs = async () => {
    if (!saveAsNameInput.trim()) return;
    try {
      await projectManager.saveAs(saveAsNameInput.trim());
      showToast(`Project saved as "${saveAsNameInput.trim()}"!`, 'success');
      setShowSaveAs(false);
      setSaveAsNameInput('');
      await refreshList();
    } catch {
      showToast('Failed to save project copy.', 'error');
    }
  };

  const handleOpen = async (projId: string) => {
    try {
      const report = await projectManager.openProject(projId);
      if (report.success) {
        if (report.missingAssets.length > 0 || report.corruptedAssets.length > 0) {
          const totalWarn = report.missingAssets.length + report.corruptedAssets.length;
          showToast(
            `Loaded "${report.projectName}" (${report.restoredClipsCount} clips, ${totalWarn} asset(s) replaced with silent placeholders).`,
            'success'
          );
        } else {
          showToast(
            `Loaded "${report.projectName}" (${report.restoredClipsCount} clips, ${report.restoredAssetsCount} audio sources restored).`,
            'success'
          );
        }
        onClose();
      } else {
        showToast(report.error || 'Project could not be found.', 'error');
      }
    } catch {
      showToast('Failed to open project.', 'error');
    }
  };

  const handleNew = () => {
    projectManager.newProject('Untitled Session');
    showToast('Created new session.', 'success');
    onClose();
  };

  const handleRename = async () => {
    if (!newNameInput.trim()) return;
    try {
      await projectManager.renameProject(newNameInput.trim());
      setIsEditingName(false);
      setCurrentName(newNameInput.trim());
      showToast(`Renamed project to "${newNameInput.trim()}".`, 'success');
      await refreshList();
    } catch {
      showToast('Failed to rename project.', 'error');
    }
  };

  const handleDelete = async (projId: string, projName: string) => {
    try {
      await projectManager.deleteProject(projId);
      showToast(`Deleted "${projName}".`, 'success');
      await refreshList();
    } catch {
      showToast('Failed to delete project.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#10141d] border border-[#222b3d] rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden select-none">
        {/* Header */}
        <div className="p-5 border-b border-[#1d2535] flex items-center justify-between shrink-0 bg-[#131824]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-md">
              <FolderOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white">Project Manager</h2>
              <p className="text-[11px] text-zinc-400">
                Manage sessions, versions, auto-save and persistence
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

        {/* Current Active Project Banner */}
        <div className="px-5 py-3 bg-[#161c2b] border-b border-[#212b3e] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Current Session:</span>
            {isEditingName ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newNameInput}
                  onChange={(e) => setNewNameInput(e.target.value)}
                  placeholder={currentName}
                  className="bg-[#0b0e15] border border-[#2d384f] rounded px-2 py-0.5 text-xs text-white outline-none"
                  autoFocus
                />
                <button
                  onClick={handleRename}
                  className="p-1 rounded bg-blue-600 text-white"
                >
                  <Check className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-bold text-cyan-300 text-sm">{currentName}</span>
                <button
                  onClick={() => {
                    setNewNameInput(currentName);
                    setIsEditingName(true);
                  }}
                  className="p-1 rounded hover:bg-[#202738] text-zinc-400 hover:text-white"
                  title="Rename Project"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save</span>
            </button>
            <button
              onClick={() => setShowSaveAs(!showSaveAs)}
              className="px-3 py-1.5 rounded-lg bg-[#1f2738] hover:bg-[#2a3449] text-zinc-200 border border-[#2d384d] font-medium flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5 text-cyan-400" />
              <span>Save As</span>
            </button>
            <button
              onClick={handleNew}
              className="px-3 py-1.5 rounded-lg bg-[#1f2738] hover:bg-[#2a3449] text-zinc-200 border border-[#2d384d] font-medium flex items-center gap-1.5"
            >
              <FilePlus className="w-3.5 h-3.5 text-emerald-400" />
              <span>New</span>
            </button>
          </div>
        </div>

        {/* Save As Inline Input */}
        {showSaveAs && (
          <div className="px-5 py-3 bg-[#131926] border-b border-[#212b3e] flex items-center gap-2 text-xs">
            <span className="text-zinc-300">New Session Name:</span>
            <input
              type="text"
              placeholder="e.g. My Song - Club Mix"
              value={saveAsNameInput}
              onChange={(e) => setSaveAsNameInput(e.target.value)}
              className="flex-1 bg-[#0b0e15] border border-[#2d384f] rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
            />
            <button
              onClick={handleSaveAs}
              className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
            >
              Confirm Save As
            </button>
          </div>
        )}

        {/* Saved Sessions List */}
        <div className="flex-1 p-5 overflow-y-auto space-y-2.5">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
            Saved Projects in Browser Storage ({projects.length})
          </h3>

          {projects.length === 0 ? (
            <div className="text-center py-12 text-zinc-500 text-xs border border-dashed border-[#202738] rounded-xl space-y-1">
              <AlertCircle className="w-6 h-6 mx-auto text-zinc-600" />
              <p>No saved projects in IndexedDB yet.</p>
              <p>Click "Save" above to persist your current session.</p>
            </div>
          ) : (
            projects.map((proj) => {
              const isCurrent = proj.id === projectManager.getCurrentProjectId();
              return (
                <div
                  key={proj.id}
                  className={`p-3.5 rounded-xl border flex items-center justify-between gap-4 transition-all ${
                    isCurrent
                      ? 'bg-blue-950/20 border-blue-500/50 shadow-md'
                      : 'bg-[#131722] hover:bg-[#181d2a] border-[#20283a]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-white truncate">{proj.name}</h4>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/40">
                          CURRENT
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-zinc-500">
                        v{proj.schemaVersion}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-zinc-500" />
                        {new Date(proj.updatedAt).toLocaleDateString()} {new Date(proj.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3 text-zinc-500" />
                        {proj.clipCount} clips / {proj.trackCount} tracks
                      </span>
                      <span>•</span>
                      <span>{proj.duration.toFixed(1)}s</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleOpen(proj.id)}
                      disabled={isCurrent}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1e2536] hover:bg-[#283248] text-cyan-300 border border-[#2b364e] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {isCurrent ? 'Active' : 'Open'}
                    </button>

                    <button
                      onClick={() => handleDelete(proj.id, proj.name)}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-950/30"
                      title="Delete Project"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
