import React, { useState } from 'react';
import { X, FolderOpen, Download, Trash2, Archive, Play, Pause, Music, Search } from 'lucide-react';

export interface AudioFileItem {
  name: string;
  category: 'part' | 'joined' | 'master';
  size_kb: number;
  url: string;
  modified?: number;
}

interface AudioFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: AudioFileItem[];
  onDeleteAll: () => Promise<void>;
  onDownloadAllZip: () => Promise<void>;
  isDeleting?: boolean;
  isZipping?: boolean;
}

export const AudioFolderModal: React.FC<AudioFolderModalProps> = ({
  isOpen,
  onClose,
  files,
  onDeleteAll,
  onDownloadAllZip,
  isDeleting = false,
  isZipping = false,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'joined' | 'part' | 'master'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [playingFile, setPlayingFile] = useState<string | null>(null);

  if (!isOpen) return null;

  const filteredFiles = files.filter((f) => {
    if (filterType !== 'all' && f.category !== filterType) return false;
    if (searchTerm && !f.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const totalSizeKb = files.reduce((acc, curr) => acc + (curr.size_kb || 0), 0);
  const totalSizeMb = (totalSizeKb / 1024).toFixed(2);

  const togglePlay = (url: string) => {
    if (playingFile === url) {
      setPlayingFile(null);
    } else {
      setPlayingFile(url);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border border-[#223048] bg-[#0c121d] shadow-2xl shadow-cyan-950/40 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1b2536] bg-[#0f1726]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <FolderOpen className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Carpeta de Audios Generados</span>
                <span className="text-xs font-mono font-normal text-cyan-400 bg-cyan-950/60 border border-cyan-500/30 px-2 py-0.5 rounded">
                  /outputs/
                </span>
              </h2>
              <p className="text-xs text-[#94a3b8]">
                {files.length} archivos WAV encontrados ({totalSizeMb} MB total)
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:text-white hover:bg-[#1a2332] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar & Filters */}
        <div className="px-6 py-3.5 border-b border-[#182233] bg-[#0a0f18] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Buscar archivo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#101726] border border-[#223048] rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Categorías */}
          <div className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                filterType === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Todos ({files.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('joined')}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                filterType === 'joined'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Escenas ({files.filter((f) => f.category === 'joined').length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('part')}
              className={`px-3 py-1 rounded-md font-semibold transition-all ${
                filterType === 'part'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Partes ({files.filter((f) => f.category === 'part').length})
            </button>
          </div>

          {/* Acciones principales */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={files.length === 0 || isZipping}
              onClick={onDownloadAllZip}
              className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-extrabold text-xs px-3.5 py-1.5 flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Archive className="h-3.5 w-3.5" />
              <span>{isZipping ? 'Comprimiendo...' : 'Descargar ZIP'}</span>
            </button>

            <button
              type="button"
              disabled={files.length === 0 || isDeleting}
              onClick={onDeleteAll}
              className="rounded-lg border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 hover:text-white disabled:opacity-40 text-xs font-semibold px-3 py-1.5 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{isDeleting ? 'Borrando...' : 'Borrar todos'}</span>
            </button>
          </div>
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2">
          {filteredFiles.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Music className="h-12 w-12 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-400">
                No hay archivos WAV {searchTerm ? 'que coincidan con la búsqueda' : 'en la carpeta todavía'}
              </p>
              <p className="text-xs text-slate-500">
                Genera tu guion o regenera partes para ver los archivos de audio aquí.
              </p>
            </div>
          ) : (
            filteredFiles.map((file) => {
              const isPlaying = playingFile === file.url;

              return (
                <div
                  key={file.name}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-[#1b2536] bg-[#0f1624] hover:border-[#263750] transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => togglePlay(file.url)}
                      className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                        isPlaying
                          ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30'
                          : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500 hover:text-slate-950'
                      }`}
                    >
                      {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
                    </button>

                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate font-mono" title={file.name}>
                        {file.name}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                        <span
                          className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                            file.category === 'master'
                              ? 'bg-purple-950 text-purple-300 border border-purple-800'
                              : file.category === 'joined'
                              ? 'bg-blue-950 text-blue-300 border border-blue-800'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}
                        >
                          {file.category === 'master' ? 'Master WAV' : file.category === 'joined' ? 'Escena WAV' : 'Parte WAV'}
                        </span>
                        <span>{file.size_kb} KB</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {/* Audio element for inline playback */}
                    {isPlaying && (
                      <audio
                        src={file.url}
                        autoPlay
                        onEnded={() => setPlayingFile(null)}
                        className="hidden"
                      />
                    )}

                    <a
                      href={file.url}
                      download={file.name}
                      className="rounded-lg bg-[#141d2b] hover:bg-[#1e2b40] border border-[#223048] hover:border-cyan-500/50 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:text-white transition-all flex items-center gap-1.5"
                      title="Descargar este archivo WAV"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Descargar WAV</span>
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-[#1b2536] bg-[#0c121d] flex items-center justify-between text-xs text-slate-400">
          <span>
            {files.length} archivos &bull; {totalSizeMb} MB
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold px-4 py-1.5 transition-all"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
