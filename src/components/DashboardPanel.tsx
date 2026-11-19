import React from 'react';
import {
  Cpu,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  Zap,
  PlaySquare,
  FileText,
  Mic,
  Trash2,
  Download,
} from 'lucide-react';
import {
  ProjectSummaryMetrics,
  QwenGenerationSettings,
  StudioSectionTab,
  SystemStatusResponse,
  VoiceRecord,
} from '../types';

interface DashboardPanelProps {
  systemStatus: SystemStatusResponse;
  settings: QwenGenerationSettings;
  summary: ProjectSummaryMetrics;
  activeProjectName: string;
  voices: VoiceRecord[];
  onNavigate: (tab: StudioSectionTab) => void;
  onRefreshStatus: () => void;
  onLoadModel: () => void;
  onUnloadModel: () => void;
  isBusyModel: boolean;
}

export const DashboardPanel: React.FC<DashboardPanelProps> = ({
  systemStatus,
  settings,
  summary,
  activeProjectName,
  voices,
  onNavigate,
  onRefreshStatus,
  onLoadModel,
  onUnloadModel,
  isBusyModel,
}) => {
  const hw = systemStatus.hardware;
  const activeVoice = voices.find((v) => v.name === settings.voice_name);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">
            Panel Principal del Estudio
          </h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            Estado de hardware local, motor Qwen3-TTS y resumen de producción activa
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshStatus}
          className="rounded-lg border border-[#1b2333] bg-[#121722] hover:bg-[#182030] px-3.5 py-2 text-xs font-semibold text-cyan-300 transition-colors cursor-pointer"
        >
          Actualizar diagnóstico
        </button>
      </div>

      {/* Hardware & Model Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              Procesamiento (CPU / CUDA)
            </span>
            <Cpu className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-lg font-extrabold text-white">
            {hw.cuda_available ? hw.gpu_name || 'GPU NVIDIA CUDA' : `CPU (${hw.cpu_cores} hilos)`}
          </div>
          <div className="text-xs text-[#94a3b8] space-y-1 font-mono">
            <div>SO: {hw.os}</div>
            <div>Python: {hw.python_version}</div>
            <div>PyTorch: {hw.torch_version || 'No instalado'}</div>
            <div>qwen-tts: {hw.qwen_tts_installed ? 'Instalado' : 'Pendiente'}</div>
          </div>
        </div>

        <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              Memoria Disponible
            </span>
            <HardDrive className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-lg font-extrabold text-white font-mono">
            {hw.ram_available_gb} GB / {hw.ram_total_gb} GB RAM
          </div>
          <div className="text-xs text-[#94a3b8] space-y-1 font-mono">
            {hw.cuda_available ? (
              <div>
                VRAM GPU: {hw.vram_free_gb} GB libres / {hw.vram_total_gb} GB
              </div>
            ) : (
              <div>VRAM GPU: Sin GPU dedicada (modo CPU)</div>
            )}
            <div>FlashAttention: {hw.flash_attn_installed ? 'Disponible' : 'Opcional (usando SDPA/Eager)'}</div>
            <div>Recomendado: {hw.recommended_model.split('/').pop()}</div>
          </div>
        </div>

        <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
              Estado del Modelo Qwen3
            </span>
            <Zap className={`h-4 w-4 ${systemStatus.model.loaded ? 'text-emerald-400' : 'text-amber-400'}`} />
          </div>
          <div className="text-sm font-bold text-white truncate" title={settings.model_id}>
            {settings.model_id.split('/').pop()}
          </div>
          <div className="text-xs text-[#94a3b8]">{systemStatus.model.status_text}</div>
          <div className="flex flex-wrap gap-2 pt-1">
            {!systemStatus.model.loaded ? (
              <button
                type="button"
                disabled={isBusyModel || systemStatus.status !== 'online'}
                onClick={onLoadModel}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 px-3 py-1.5 text-xs font-bold text-white transition-colors cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                <span>{isBusyModel ? 'Cargando...' : 'Cargar modelo'}</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isBusyModel}
                onClick={onUnloadModel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 px-3 py-1.5 text-xs font-bold text-rose-200 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Liberar memoria</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Warnings */}
      {hw.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            <span>Avisos de Hardware y Entorno</span>
          </div>
          <ul className="space-y-1 text-xs text-amber-100/90 list-disc list-inside">
            {hw.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Active Project Summary */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2333] pb-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              Proyecto en Curso
            </div>
            <h3 className="text-lg font-extrabold text-white mt-0.5">{activeProjectName}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('editor')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#141c28] hover:bg-[#1a2434] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5 text-cyan-400" />
              <span>Editar guion</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('voices')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#141c28] hover:bg-[#1a2434] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
            >
              <Mic className="h-3.5 w-3.5 text-emerald-400" />
              <span>Biblioteca de voces</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('production')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3.5 py-1.5 text-xs font-bold text-white cursor-pointer"
            >
              <PlaySquare className="h-3.5 w-3.5" />
              <span>Ir a Producción</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <div className="rounded-lg border border-[#1b2333] bg-[#0b0f17] p-3">
            <div className="text-[10px] font-bold uppercase text-[#64748b]">{summary.mode_label}</div>
            <div className="text-xl font-extrabold text-white font-mono mt-1">{summary.total_sections}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0b0f17] p-3">
            <div className="text-[10px] font-bold uppercase text-[#64748b]">Partes Totales</div>
            <div className="text-xl font-extrabold text-white font-mono mt-1">{summary.total_parts}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0b0f17] p-3">
            <div className="text-[10px] font-bold uppercase text-[#64748b]">Completadas</div>
            <div className="text-xl font-extrabold text-emerald-400 font-mono mt-1">{summary.ready_parts}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0b0f17] p-3">
            <div className="text-[10px] font-bold uppercase text-[#64748b]">Pendientes</div>
            <div className="text-xl font-extrabold text-amber-400 font-mono mt-1">{summary.pending_parts}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0b0f17] p-3">
            <div className="text-[10px] font-bold uppercase text-[#64748b]">Fallidas</div>
            <div className="text-xl font-extrabold text-rose-400 font-mono mt-1">{summary.failed_parts}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0b0f17] p-3">
            <div className="text-[10px] font-bold uppercase text-[#64748b]">Progreso</div>
            <div className="text-xl font-extrabold text-cyan-400 font-mono mt-1">{summary.percent}%</div>
          </div>
        </div>

        {/* Selected Voice Checklist */}
        <div className="rounded-lg border border-[#1b2333] bg-[#090c12] p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            {activeVoice?.prompt_status === 'ready' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            )}
            <div>
              <span className="text-[#94a3b8]">Voz seleccionada: </span>
              <span className="font-bold text-white">{settings.voice_name}</span>
              <span className="text-[#64748b] ml-2">
                ({activeVoice?.prompt_status === 'ready' ? 'Prompt de clonación preparado' : 'Revisa la preparación de la voz antes de producir'})
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('voices')}
            className="text-xs font-semibold text-cyan-400 hover:underline cursor-pointer"
          >
            Configurar voz →
          </button>
        </div>
      </div>
    </div>
  );
};
