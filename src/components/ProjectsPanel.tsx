import React, { useState } from 'react';
import { FolderKanban, Plus, FolderOpen, Edit3, Trash2, Archive, Check } from 'lucide-react';
import { ProjectListItem } from '../types';

interface ProjectsPanelProps {
  projects: ProjectListItem[];
  activeProjectId: string | null;
  onCreateProject: (name: string) => Promise<void>;
  onOpenProject: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string, newName: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  getExportZipUrl: (projectId: string) => string;
}

export const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  projects,
  activeProjectId,
  onCreateProject,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
  getExportZipUrl,
}) => {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await onCreateProject(newName.trim());
      setNewName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-white tracking-tight">
          Gestión de Proyectos Independientes
        </h2>
        <p className="text-xs text-[#94a3b8] mt-0.5">
          Cada vídeo tiene su propia carpeta aislada con guion, audios WAV, estado de recuperación y configuración. Cambiar de proyecto nunca borra trabajos anteriores.
        </p>
      </div>

      {/* Create New Project */}
      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nombre del nuevo vídeo o documental (ej: El Imperio Bizantino Ep. 12)"
          className="flex-1 rounded-lg border border-[#1b2333] bg-[#090c12] px-3.5 py-2 text-xs text-white outline-none focus:border-cyan-500"
        />
        <button
          type="submit"
          disabled={!newName.trim() || creating}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-4 py-2 text-xs font-bold text-white cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          <span>{creating ? 'Creando...' : 'Nuevo Proyecto'}</span>
        </button>
      </form>

      {/* Projects List */}
      <div className="space-y-3">
        {projects.map((proj) => {
          const isActive = proj.id === activeProjectId;
          const isEditing = editingId === proj.id;

          return (
            <div
              key={proj.id}
              className={`rounded-xl border p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-all ${
                isActive
                  ? 'border-cyan-500/60 bg-[#121b2b]'
                  : 'border-[#1b2333] bg-[#121722]'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                  <FolderKanban className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        className="rounded-lg border border-cyan-500 bg-[#090c12] px-2.5 py-1 text-xs text-white outline-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (renameDraft.trim()) {
                            await onRenameProject(proj.id, renameDraft.trim());
                          }
                          setEditingId(null);
                        }}
                        className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-slate-950 cursor-pointer"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white truncate">{proj.name}</span>
                      {isActive && (
                        <span className="rounded bg-cyan-950 border border-cyan-700 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                          Activo
                        </span>
                      )}
                    </div>
                  )}

                  <div className="text-[11px] text-[#94a3b8] font-mono mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    <span>Modo: {proj.processing_mode === 'scene' ? 'Escenas' : 'Párrafos'}</span>
                    <span>&bull;</span>
                    <span>Voz: {proj.voice_name}</span>
                    <span>&bull;</span>
                    <span>Modelo: {proj.model_id.split('/').pop()}</span>
                    <span>&bull;</span>
                    <span className="text-cyan-400">
                      {proj.ready_parts}/{proj.total_parts} partes ({proj.percent}%)
                    </span>
                    <span>&bull;</span>
                    <span>
                      Modificado: {new Date(proj.updated_at * 1000).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => onOpenProject(proj.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Abrir</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setEditingId(proj.id);
                    setRenameDraft(proj.name);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#223048] bg-[#141c28] hover:bg-[#1c2638] px-2.5 py-1.5 text-xs font-semibold text-white cursor-pointer"
                >
                  <Edit3 className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Renombrar</span>
                </button>

                <a
                  href={getExportZipUrl(proj.id)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-950/30 hover:bg-emerald-900/40 px-2.5 py-1.5 text-xs font-semibold text-emerald-300"
                >
                  <Archive className="h-3.5 w-3.5" />
                  <span>Exportar ZIP</span>
                </a>

                <button
                  type="button"
                  onClick={() => onDeleteProject(proj.id)}
                  className="rounded-lg border border-rose-500/35 bg-rose-950/20 hover:bg-rose-900/40 p-1.5 text-rose-300 cursor-pointer"
                  title="Eliminar este proyecto"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
