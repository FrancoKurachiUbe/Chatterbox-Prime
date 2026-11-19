import React, { useState } from 'react';
import {
  Mic,
  Upload,
  Play,
  Square,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  Save,
} from 'lucide-react';
import { VoiceRecord } from '../types';

interface VoiceLibraryPanelProps {
  voices: VoiceRecord[];
  selectedVoiceName: string;
  activeModelId: string;
  onSelectVoice: (voiceName: string) => void;
  onUploadVoice: (file: File, name: string, refText: string) => Promise<void>;
  onUpdateVoiceMeta: (
    voiceName: string,
    payload: { new_name?: string; ref_text?: string; x_vector_only_mode?: boolean }
  ) => Promise<void>;
  onPreparePrompt: (voiceName: string, forceRebuild?: boolean) => Promise<void>;
  onDeleteVoice: (voiceName: string) => Promise<void>;
}

export const VoiceLibraryPanel: React.FC<VoiceLibraryPanelProps> = ({
  voices,
  selectedVoiceName,
  activeModelId,
  onSelectVoice,
  onUploadVoice,
  onUpdateVoiceMeta,
  onPreparePrompt,
  onDeleteVoice,
}) => {
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceRefText, setNewVoiceRefText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [editingTranscript, setEditingTranscript] = useState<Record<string, string>>({});
  const [preparingVoice, setPreparingVoice] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setSelectedFile(f);
    if (!newVoiceName.trim()) {
      setNewVoiceName(f.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      await onUploadVoice(
        selectedFile,
        newVoiceName.trim() || selectedFile.name.replace(/\.[^/.]+$/, ''),
        newVoiceRefText.trim()
      );
      setSelectedFile(null);
      setNewVoiceName('');
      setNewVoiceRefText('');
    } finally {
      setIsUploading(false);
    }
  };

  const handleTogglePlay = (voice: VoiceRecord) => {
    if (audioEl) {
      audioEl.pause();
      setAudioEl(null);
    }
    if (playingVoice === voice.name) {
      setPlayingVoice(null);
      return;
    }
    const audio = new Audio(`${voice.preview_url}?t=${Date.now()}`);
    audio.onended = () => setPlayingVoice(null);
    audio.onerror = () => setPlayingVoice(null);
    audio.play().catch(() => setPlayingVoice(null));
    setPlayingVoice(voice.name);
    setAudioEl(audio);
  };

  const renderStatusBadge = (v: VoiceRecord) => {
    if (v.prompt_status === 'ready') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-950/50 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
          <CheckCircle2 className="h-3 w-3" /> Prompt listo ({activeModelId.split('/').pop()})
        </span>
      );
    }
    if (v.prompt_status === 'missing_audio') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-950/50 px-2 py-0.5 text-[11px] font-bold text-rose-300">
          <AlertCircle className="h-3 w-3" /> Falta archivo WAV en voices/
        </span>
      );
    }
    if (v.prompt_status === 'needs_transcript') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 text-[11px] font-bold text-amber-300">
          <AlertCircle className="h-3 w-3" /> Falta transcripción exacta
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 text-[11px] font-bold text-cyan-300">
        <Clock className="h-3 w-3" /> Sin preparar
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-white tracking-tight">
          Biblioteca de Voces y Clonación Qwen3
        </h2>
        <p className="text-xs text-[#94a3b8] mt-0.5">
          Importa archivos WAV sin modificar los originales, introduce la transcripción exacta de la grabación y precalcula el{' '}
          <code>voice_clone_prompt</code> reutilizable para todas las escenas.
        </p>
      </div>

      <div className="rounded-xl border border-cyan-500/25 bg-[#0d1420] p-3.5 text-xs text-[#cbd5e1] space-y-1">
        <div className="font-bold text-cyan-300">
          Consejo contra eco o sílaba inicial (&ldquo;aba&rdquo; / &ldquo;saba&rdquo;):
        </div>
        <p className="text-[#94a3b8] leading-relaxed">
          Si el audio generado arranca con una sílaba del final de tu grabación de referencia antes de leer el guion, verifica que{' '}
          <strong className="text-white">Limpiar sílaba o eco inicial</strong> esté activo en{' '}
          <em>Configuración Qwen3</em> y pulsa <strong className="text-white">Regenerar prompt</strong> aquí abajo; o bien activa{' '}
          <strong className="text-white">Solo x-vector</strong> para eliminar de raíz el arrastre ICL.
        </p>
      </div>

      {/* Upload / Import New Voice */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
          <Upload className="h-4 w-4" />
          <span>Importar Nueva Voz de Referencia (WAV)</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#94a3b8]">Nombre personalizado</label>
            <input
              type="text"
              value={newVoiceName}
              onChange={(e) => setNewVoiceName(e.target.value)}
              placeholder="Ej: Brian Warm Clonacion Voz"
              className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#94a3b8]">Archivo WAV (3–15s recomendado, limpio)</label>
            <input
              type="file"
              accept=".wav,audio/wav"
              onChange={handleFileChange}
              className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-1.5 text-xs text-[#94a3b8] file:mr-3 file:rounded file:border-0 file:bg-cyan-500/20 file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-cyan-300"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#94a3b8]">
            Transcripción exacta de la grabación (ref_text para modo ICL de alta fidelidad)
          </label>
          <textarea
            rows={2}
            value={newVoiceRefText}
            onChange={(e) => setNewVoiceRefText(e.target.value)}
            placeholder="Escribe palabra por palabra lo que dice el audio de referencia..."
            className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] p-2.5 text-xs text-white outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            disabled={!selectedFile || isUploading}
            onClick={handleUpload}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-4 py-2 text-xs font-bold text-white cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>{isUploading ? 'Guardando...' : 'Guardar en Biblioteca de Voces'}</span>
          </button>
        </div>
      </div>

      {/* Voices List */}
      <div className="space-y-3">
        {voices.map((v) => {
          const isSelected = v.name === selectedVoiceName;
          const draftTranscript =
            editingTranscript[v.name] !== undefined ? editingTranscript[v.name] : v.ref_text;
          const isDirty = draftTranscript !== v.ref_text;

          return (
            <div
              key={v.name}
              className={`rounded-xl border p-4 space-y-3 transition-all ${
                isSelected
                  ? 'border-cyan-500/60 bg-[#121a28]'
                  : 'border-[#1b2333] bg-[#121722]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
                    <Mic className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">{v.name}</span>
                      {v.is_default && (
                        <span className="rounded bg-cyan-950 border border-cyan-800 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                          Voz Principal
                        </span>
                      )}
                      {renderStatusBadge(v)}
                    </div>
                    <div className="text-[11px] text-[#64748b] font-mono mt-0.5">
                      {v.filename} &bull; {v.size_kb} KB
                      {v.duration_sec ? ` • ${v.duration_sec.toFixed(1)}s` : ''}
                      {v.sample_rate ? ` • ${v.sample_rate} Hz` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!v.exists_on_disk}
                    onClick={() => handleTogglePlay(v)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#0e141f] hover:bg-[#172133] disabled:opacity-40 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                  >
                    {playingVoice === v.name ? (
                      <>
                        <Square className="h-3 w-3 fill-current text-amber-400" /> Detener
                      </>
                    ) : (
                      <>
                        <Play className="h-3 w-3 fill-current text-emerald-400" /> Escuchar
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelectVoice(v.name)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer ${
                      isSelected
                        ? 'bg-cyan-500 text-slate-950'
                        : 'border border-cyan-500/40 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/50'
                    }`}
                  >
                    {isSelected ? '✓ Seleccionada' : 'Usar esta voz'}
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteVoice(v.name)}
                    className="rounded-lg border border-rose-500/30 bg-rose-950/20 hover:bg-rose-900/40 p-1.5 text-rose-300 cursor-pointer"
                    title="Eliminar voz de la biblioteca"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Transcript & Prompt Preparation */}
              <div className="rounded-lg border border-[#1b2333] bg-[#090c12] p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]">
                    Transcripción exacta de la grabación (ref_text)
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-[#94a3b8] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={v.x_vector_only_mode}
                      onChange={(e) =>
                        onUpdateVoiceMeta(v.name, { x_vector_only_mode: e.target.checked })
                      }
                      className="accent-cyan-400"
                    />
                    <span>Solo x-vector (sin transcripción, menor fidelidad)</span>
                  </label>
                </div>

                <textarea
                  rows={2}
                  value={draftTranscript}
                  onChange={(e) =>
                    setEditingTranscript((prev) => ({ ...prev, [v.name]: e.target.value }))
                  }
                  placeholder="Introduce el texto exacto que se escucha en el WAV..."
                  className="w-full rounded-lg border border-[#1b2333] bg-[#121722] p-2.5 text-xs text-white outline-none focus:border-cyan-500"
                />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-[#64748b]">
                    El prompt se cachea con limpieza automática de bordes. Consejo: termina la transcripción con punto final exacto o activa &ldquo;Solo x-vector&rdquo; si notas alguna sílaba inicial residual.
                  </div>
                  <div className="flex items-center gap-2">
                    {isDirty && (
                      <button
                        type="button"
                        onClick={async () => {
                          await onUpdateVoiceMeta(v.name, { ref_text: draftTranscript });
                          setEditingTranscript((prev) => {
                            const next = { ...prev };
                            delete next[v.name];
                            return next;
                          });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 px-3 py-1.5 text-xs font-bold text-emerald-300 cursor-pointer"
                      >
                        <Save className="h-3.5 w-3.5" />
                        <span>Guardar transcripción</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!v.exists_on_disk || preparingVoice === v.name}
                      onClick={async () => {
                        setPreparingVoice(v.name);
                        try {
                          if (isDirty) {
                            await onUpdateVoiceMeta(v.name, { ref_text: draftTranscript });
                          }
                          await onPreparePrompt(v.name, v.prompt_status === 'ready');
                        } finally {
                          setPreparingVoice(null);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-3.5 py-1.5 text-xs font-bold text-white cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>
                        {preparingVoice === v.name
                          ? 'Preparando prompt...'
                          : v.prompt_status === 'ready'
                          ? 'Regenerar prompt'
                          : 'Preparar y guardar prompt'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
