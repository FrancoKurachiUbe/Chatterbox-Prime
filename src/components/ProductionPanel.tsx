import React, { useState, useRef } from 'react';
import {
  Play,
  Pause,
  RotateCw,
  StopCircle,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Eye,
  X,
  Link as LinkIcon,
  RefreshCw,
} from 'lucide-react';
import {
  ModelStatusInfo,
  ProcessingMode,
  ProductionStateInfo,
  ProjectSummaryMetrics,
  ScriptPartItem,
  ScriptSectionItem,
} from '../types';

interface ProductionPanelProps {
  sections: ScriptSectionItem[];
  processingMode: ProcessingMode;
  summary: ProjectSummaryMetrics;
  production: ProductionStateInfo;
  modelStatus: ModelStatusInfo;
  onStartPending: () => void;
  onRetryFailed: () => void;
  onCancel: () => void;
  onRegenerateSection: (sectionNumber: number) => void;
  onRegeneratePart: (sectionNumber: number, partNumber: number) => void;
  onRegenerateBatch: (items: Array<[number, number]>) => void;
  onJoinSection: (sectionNumber: number) => void;
  onDownloadCompleteSection: (sectionNumber: number) => void;
  onJoinMaster: () => void;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const ProductionPanel: React.FC<ProductionPanelProps> = ({
  sections,
  processingMode,
  summary,
  production,
  modelStatus,
  onStartPending,
  onRetryFailed,
  onCancel,
  onRegenerateSection,
  onRegeneratePart,
  onRegenerateBatch,
  onJoinSection,
  onDownloadCompleteSection,
  onJoinMaster,
}) => {
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [inspectedPart, setInspectedPart] = useState<{
    secNum: number;
    part: ScriptPartItem;
  } | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  const isGenerating = production.is_generating;
  const sectionLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';

  const togglePart = (secNum: number, partNum: number) => {
    const key = `${secNum}-${partNum}`;
    setSelectedParts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSelectPendingOrFailed = () => {
    const keys = new Set<string>();
    sections.forEach((s) =>
      s.parts.forEach((p) => {
        if (p.status !== 'ready') keys.add(`${s.number}-${p.number}`);
      })
    );
    setSelectedParts(keys);
  };

  const handleTogglePlay = (key: string) => {
    const el = audioRefs.current[key];
    if (!el) return;
    if (playingKey === key) {
      el.pause();
      setPlayingKey(null);
    } else {
      Object.entries(audioRefs.current).forEach(([k, a]) => {
        if (a && k !== key) a.pause();
      });
      el.currentTime = 0;
      el.play().catch(() => {});
      setPlayingKey(key);
    }
  };

  const handleBatchSubmit = () => {
    if (selectedParts.size === 0) return;
    const items: Array<[number, number]> = Array.from(selectedParts).map((k) => {
      const [s, p] = k.split('-').map((n) => parseInt(n, 10));
      return [s, p];
    });
    onRegenerateBatch(items);
    setSelectedParts(new Set());
  };

  const renderPartStatus = (status: ScriptPartItem['status']) => {
    switch (status) {
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-950/70 border border-emerald-700/50 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Listo
          </span>
        );
      case 'generating':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-cyan-950/70 border border-cyan-600/50 px-2 py-0.5 text-[10px] font-bold text-cyan-300 animate-pulse">
            <RotateCw className="h-3 w-3 animate-spin" /> Generando
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-rose-950/70 border border-rose-700/50 px-2 py-0.5 text-[10px] font-bold text-rose-300">
            <AlertTriangle className="h-3 w-3" /> Fallida
          </span>
        );
      case 'stale':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-amber-950/70 border border-amber-700/50 px-2 py-0.5 text-[10px] font-bold text-amber-300">
            <RefreshCw className="h-3 w-3" /> Desactualizada
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded bg-[#182233] border border-[#243248] px-2 py-0.5 text-[10px] font-bold text-[#94a3b8]">
            <Clock className="h-3 w-3" /> Pendiente
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Global Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Producción de Audio</h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            Generación secuencial con recuperación por hash, reanudación automática y control por parte o escena.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isGenerating || summary.total_parts === 0}
            onClick={onStartPending}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:opacity-40 px-4 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg shadow-cyan-500/20 cursor-pointer"
          >
            <Play className="h-4 w-4 fill-current" />
            <span>
              {summary.ready_parts > 0 && summary.pending_parts + summary.stale_parts > 0
                ? 'Continuar desde 1ª pendiente'
                : 'Generar Narración'}
            </span>
          </button>

          {summary.failed_parts > 0 && !isGenerating && (
            <button
              type="button"
              onClick={onRetryFailed}
              className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-950/40 hover:bg-amber-900/50 px-3.5 py-2.5 text-xs font-bold text-amber-200 cursor-pointer"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Reintentar fallidas ({summary.failed_parts})</span>
            </button>
          )}

          {isGenerating && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/50 px-4 py-2.5 text-xs font-bold text-rose-200 cursor-pointer"
            >
              <StopCircle className="h-4 w-4" />
              <span>Cancelar</span>
            </button>
          )}

          <button
            type="button"
            disabled={isGenerating || summary.ready_parts === 0}
            onClick={onJoinMaster}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#223048] bg-[#121722] hover:bg-[#1a2434] disabled:opacity-40 px-3.5 py-2.5 text-xs font-bold text-cyan-300 cursor-pointer"
          >
            <LinkIcon className="h-3.5 w-3.5" />
            <span>Unir Master WAV</span>
          </button>
        </div>
      </div>

      {/* Metrics Dashboard */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">{summary.mode_label}</div>
          <div className="text-lg font-extrabold text-white font-mono">{summary.total_sections}</div>
        </div>
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">Total Partes</div>
          <div className="text-lg font-extrabold text-white font-mono">{summary.total_parts}</div>
        </div>
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">Completadas</div>
          <div className="text-lg font-extrabold text-emerald-400 font-mono">{summary.ready_parts}</div>
        </div>
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">Pendientes</div>
          <div className="text-lg font-extrabold text-amber-400 font-mono">
            {summary.pending_parts + summary.stale_parts}
          </div>
        </div>
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">Fallidas</div>
          <div className="text-lg font-extrabold text-rose-400 font-mono">{summary.failed_parts}</div>
        </div>
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">Progreso</div>
          <div className="text-lg font-extrabold text-cyan-400 font-mono">{summary.percent}%</div>
        </div>
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">Tiempo</div>
          <div className="text-lg font-extrabold text-white font-mono">
            {formatElapsed(production.elapsed_sec)}
          </div>
        </div>
        <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3">
          <div className="text-[10px] font-bold uppercase text-[#64748b]">Modelo</div>
          <div className="text-xs font-bold text-cyan-300 truncate mt-1" title={modelStatus.status_text}>
            {modelStatus.loaded ? 'Cargado' : 'En reposo'}
          </div>
        </div>
      </div>

      {/* Active Segment Progress */}
      <div className="rounded-xl border border-[#1b2333] bg-[#0e121a] p-3.5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-white">
            {isGenerating
              ? `Generando: ${production.current_label || production.message}`
              : production.message || 'Listo para producir'}
          </span>
          <span className="font-mono text-cyan-400">
            {production.total_steps > 0
              ? `${production.current_step}/${production.total_steps}`
              : `${summary.ready_parts}/${summary.total_parts}`}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-[#1b2333] overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${summary.percent}%` }}
          />
        </div>
      </div>

      {/* Batch Toolbar */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Layers className="h-4 w-4 text-cyan-400" />
          <span className="font-semibold text-white">
            {selectedParts.size} parte(s) seleccionada(s)
          </span>
          <button
            type="button"
            onClick={handleSelectPendingOrFailed}
            className="rounded-lg border border-[#223048] bg-[#090c12] hover:bg-[#161f2e] px-2.5 py-1 text-xs text-[#94a3b8] hover:text-white cursor-pointer"
          >
            Seleccionar pendientes/fallidas
          </button>
          {selectedParts.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedParts(new Set())}
              className="rounded-lg border border-[#223048] bg-[#090c12] hover:bg-[#161f2e] px-2.5 py-1 text-xs text-[#94a3b8] hover:text-white cursor-pointer"
            >
              Limpiar
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={selectedParts.size === 0 || isGenerating}
          onClick={handleBatchSubmit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 cursor-pointer"
        >
          <RotateCw className="h-3.5 w-3.5" />
          <span>Regenerar seleccionadas ({selectedParts.size})</span>
        </button>
      </div>

      {/* Sections & Parts */}
      <div className="space-y-4">
        {sections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#223048] p-10 text-center text-xs text-[#64748b]">
            No hay partes segmentadas todavía. Ve al <strong>Editor de Guiones</strong> y guarda tu guion.
          </div>
        ) : (
          sections.map((sec) => {
            const allReady = sec.parts.length > 0 && sec.parts.every((p) => p.status === 'ready');
            const secKey = `sec-${sec.number}`;
            const secStamp = sec.parts.reduce((m, p) => Math.max(m, p.updated_at || 0), 0);
            const completeLabel = processingMode === 'scene' ? 'Escena Completa' : 'Párrafo Completo';

            return (
              <div
                key={sec.number}
                className="rounded-xl border border-[#1b2333] bg-[#121722] overflow-hidden"
              >
                {/* Section Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0e131d] px-4 py-3 border-b border-[#1b2333]">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-extrabold text-cyan-400 font-mono">
                      {sectionLabel.toUpperCase()} {sec.number}
                    </span>
                    <span className="text-sm font-bold text-white">{sec.title}</span>
                    <span className="text-xs text-[#64748b]">({sec.parts.length} partes internas)</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {sec.joined_audio_url && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleTogglePlay(secKey)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 cursor-pointer"
                        >
                          {playingKey === secKey ? (
                            <>
                              <Pause className="h-3.5 w-3.5 fill-current" /> Pausa
                            </>
                          ) : (
                            <>
                              <Play className="h-3.5 w-3.5 fill-current" /> Reproducir {sectionLabel}
                            </>
                          )}
                        </button>
                        <audio
                          ref={(el) => {
                            audioRefs.current[secKey] = el;
                          }}
                          src={`${sec.joined_audio_url}?t=${secStamp}`}
                          onEnded={() => setPlayingKey((c) => (c === secKey ? null : c))}
                          className="hidden"
                        />
                        <a
                          href={`${sec.joined_audio_url}?t=${secStamp}`}
                          download={sec.joined_filename}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 px-3 py-1.5 text-xs font-bold text-emerald-300"
                        >
                          <Download className="h-3.5 w-3.5" /> Descargar {completeLabel}
                        </a>
                      </>
                    )}

                    {allReady && !sec.joined_audio_url && (
                      <button
                        type="button"
                        disabled={isGenerating}
                        onClick={() => onDownloadCompleteSection(sec.number)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 disabled:opacity-40 px-3 py-1.5 text-xs font-bold text-emerald-300 cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Descargar {completeLabel}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={!allReady || isGenerating}
                      onClick={() => onJoinSection(sec.number)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#141c28] hover:bg-[#1b2536] disabled:opacity-40 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    >
                      <LinkIcon className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Unir {sectionLabel}</span>
                    </button>

                    <button
                      type="button"
                      disabled={isGenerating}
                      onClick={() => onRegenerateSection(sec.number)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/30 hover:bg-cyan-900/40 disabled:opacity-40 px-3 py-1.5 text-xs font-bold text-cyan-200 cursor-pointer"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      <span>Regenerar {sectionLabel}</span>
                    </button>
                  </div>
                </div>

                {/* Parts */}
                <div className="p-3 space-y-2">
                  {sec.parts.map((part) => {
                    const partKey = `${sec.number}-${part.number}`;
                    const isChecked = selectedParts.has(partKey);

                    return (
                      <div
                        key={part.number}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3 ${
                          isChecked
                            ? 'border-cyan-500/50 bg-[#141d2e]'
                            : 'border-[#1b2333] bg-[#090c12]'
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => togglePart(sec.number, part.number)}
                            className="mt-1 h-4 w-4 accent-cyan-500 cursor-pointer shrink-0"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-bold font-mono text-cyan-400">
                                Parte {String(part.number).padStart(2, '0')}
                              </span>
                              {renderPartStatus(part.status)}
                              {part.duration_sec ? (
                                <span className="text-[11px] font-mono text-[#64748b]">
                                  {part.duration_sec.toFixed(1)}s
                                </span>
                              ) : null}
                            </div>
                            <p className="text-xs text-[#e2e8f0] leading-relaxed line-clamp-2">
                              {part.text}
                            </p>
                            {part.error_message && (
                              <p className="text-[11px] text-rose-400 font-mono">
                                Error: {part.error_message}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          <button
                            type="button"
                            onClick={() => setInspectedPart({ secNum: sec.number, part })}
                            className="rounded-lg border border-[#223048] bg-[#141c28] hover:bg-[#1c2638] p-2 text-[#94a3b8] hover:text-white cursor-pointer"
                            title="Consultar texto completo y hash"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={!part.has_audio || !part.audio_url}
                            onClick={() => handleTogglePlay(partKey)}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-3 py-1.5 text-xs font-bold text-slate-950 cursor-pointer"
                          >
                            {playingKey === partKey ? (
                              <>
                                <Pause className="h-3.5 w-3.5 fill-current" /> Pausa
                              </>
                            ) : (
                              <>
                                <Play className="h-3.5 w-3.5 fill-current" /> Reproducir
                              </>
                            )}
                          </button>

                          {part.audio_url && (
                            <audio
                              ref={(el) => {
                                audioRefs.current[partKey] = el;
                              }}
                              src={`${part.audio_url}?t=${part.updated_at || 0}`}
                              onEnded={() => setPlayingKey((c) => (c === partKey ? null : c))}
                              className="hidden"
                            />
                          )}

                          <button
                            type="button"
                            disabled={isGenerating}
                            onClick={() => onRegeneratePart(sec.number, part.number)}
                            className="inline-flex items-center gap-1 rounded-lg border border-[#223048] bg-[#141c28] hover:bg-[#1c2638] disabled:opacity-40 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                          >
                            <RotateCw className="h-3.5 w-3.5 text-cyan-400" />
                            <span>Regenerar</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Text & Hash Inspection Modal */}
      {inspectedPart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-2xl border border-[#1b2333] bg-[#0e121a] p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1b2333] pb-3">
              <div className="text-sm font-bold text-white">
                {sectionLabel} {inspectedPart.secNum} — Parte {inspectedPart.part.number}
              </div>
              <button
                type="button"
                onClick={() => setInspectedPart(null)}
                className="rounded-lg p-1 text-[#94a3b8] hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase text-[#64748b]">Texto visible</div>
              <div className="rounded-lg border border-[#1b2333] bg-[#090c12] p-3 text-xs text-white leading-relaxed">
                {inspectedPart.part.text}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase text-[#64748b]">
                Texto normalizado enviado a Qwen3-TTS
              </div>
              <div className="rounded-lg border border-[#1b2333] bg-[#090c12] p-3 text-xs text-cyan-200 leading-relaxed">
                {inspectedPart.part.normalized_text}
              </div>
            </div>
            <div className="text-[11px] font-mono text-[#64748b] space-y-1">
              <div>Archivo: {inspectedPart.part.filename}</div>
              <div>Hash actual: {inspectedPart.part.content_hash}</div>
              <div>Hash generado: {inspectedPart.part.generated_hash || 'Ninguno'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
