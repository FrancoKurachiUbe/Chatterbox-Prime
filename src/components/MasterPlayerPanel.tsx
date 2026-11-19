import React from 'react';
import { Headphones, Download, Archive, Copy, Link as LinkIcon } from 'lucide-react';
import { ProcessingMode, ScriptSectionItem } from '../types';

interface MasterPlayerPanelProps {
  projectId: string;
  projectName: string;
  processingMode: ProcessingMode;
  sections: ScriptSectionItem[];
  masterAudioUrl: string | null;
  masterFilename: string | null;
  exportZipUrl: string;
  onJoinMaster: () => void;
  onCopyYouTubeTimestamps: () => void;
}

export const MasterPlayerPanel: React.FC<MasterPlayerPanelProps> = ({
  projectName,
  processingMode,
  sections,
  masterAudioUrl,
  masterFilename,
  exportZipUrl,
  onJoinMaster,
  onCopyYouTubeTimestamps,
}) => {
  const sectionLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';
  const readySections = sections.filter((s) => s.joined_audio_url);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">
            Reproductor y Exportación Master
          </h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            Escucha las secciones ensambladas, genera el audio maestro completo y copia marcas de tiempo para YouTube.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCopyYouTubeTimestamps}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#121722] hover:bg-[#1a2434] px-3 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5 text-cyan-400" />
            <span>Copiar marcas YouTube</span>
          </button>

          <a
            href={exportZipUrl}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/30 hover:bg-emerald-900/40 px-3.5 py-2 text-xs font-bold text-emerald-300"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Exportar Escenas y Master (ZIP)</span>
          </a>
        </div>
      </div>

      {/* Master Audio Card */}
      <div className="rounded-xl border border-cyan-500/35 bg-gradient-to-br from-[#0e1828] to-[#0b1019] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-400">
              <Headphones className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-extrabold text-white">
                Audio Maestro Completo — {projectName}
              </div>
              <div className="text-xs text-[#94a3b8]">
                {masterFilename || 'Ensambla todas las partes listas sin recodificación destructiva'}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onJoinMaster}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
          >
            <LinkIcon className="h-3.5 w-3.5" />
            <span>Ensamblar Master WAV</span>
          </button>
        </div>

        {masterAudioUrl ? (
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <audio controls src={`${masterAudioUrl}?t=${Date.now()}`} className="w-full h-10" />
            <a
              href={masterAudioUrl}
              download={masterFilename || 'Master_Qwen3Prime.wav'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 shrink-0"
            >
              <Download className="h-4 w-4" />
              <span>Descargar Master</span>
            </a>
          </div>
        ) : (
          <div className="rounded-lg border border-[#1b2333] bg-[#090c12] p-4 text-xs text-[#64748b] text-center">
            Aún no se ha ensamblado el Master WAV de este proyecto.
          </div>
        )}
      </div>

      {/* Sections Playlist */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-5 space-y-3">
        <div className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
          {sectionLabel}s Ensambladas ({readySections.length}/{sections.length})
        </div>

        {readySections.length === 0 ? (
          <p className="text-xs text-[#64748b] py-6 text-center">
            Cuando completes las partes de una {sectionLabel.toLowerCase()}, su audio unido aparecerá aquí.
          </p>
        ) : (
          <div className="space-y-2.5">
            {readySections.map((sec) => (
              <div
                key={sec.number}
                className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-[#1b2333] bg-[#090c12] p-3.5"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-cyan-400 font-mono">
                    {sectionLabel} {sec.number}
                  </div>
                  <div className="text-sm font-bold text-white truncate">{sec.title}</div>
                </div>
                <div className="flex items-center gap-3 flex-1 md:max-w-md justify-end">
                  <audio controls src={`${sec.joined_audio_url}?t=${Date.now()}`} className="w-full h-8" />
                  <a
                    href={sec.joined_audio_url!}
                    download={sec.joined_filename}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 px-2.5 py-1.5 text-xs font-bold text-emerald-300 shrink-0"
                    title={`Descargar ${sectionLabel} completa WAV`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{sectionLabel} Completa</span>
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
