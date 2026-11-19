import React from 'react';
import { Sliders, Globe, Cpu, Info, RotateCcw, Volume2 } from 'lucide-react';
import {
  HardwareInfo,
  QwenGenerationSettings,
  QwenLanguageInfo,
  QwenModelInfo,
  VoiceRecord,
} from '../types';
import { DEFAULT_SETTINGS } from '../constants/qwenConfig';

interface QwenSettingsPanelProps {
  settings: QwenGenerationSettings;
  models: QwenModelInfo[];
  languages: QwenLanguageInfo[];
  voices: VoiceRecord[];
  hardware: HardwareInfo;
  onChange: (updated: QwenGenerationSettings) => void;
}

export const QwenSettingsPanel: React.FC<QwenSettingsPanelProps> = ({
  settings,
  models,
  languages,
  voices,
  hardware,
  onChange,
}) => {
  const update = <K extends keyof QwenGenerationSettings>(
    field: K,
    value: QwenGenerationSettings[K]
  ) => {
    onChange({ ...settings, [field]: value });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">
            Configuración del Motor Qwen3-TTS
          </h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            Selección de modelo, dispositivo, idioma, clonación vocal y ensamblado WAV sin pérdida.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_SETTINGS })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#121722] hover:bg-[#1a2232] px-3 py-2 text-xs font-semibold text-[#94a3b8] hover:text-white cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Restaurar recomendados</span>
        </button>
      </div>

      {/* Model, Device, Language, Voice */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
          <Cpu className="h-4 w-4" />
          <span>Modelo, Hardware, Idioma y Referencia Vocal</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#94a3b8]">Modelo Qwen3-TTS Base</label>
            <select
              value={settings.model_id}
              onChange={(e) => update('model_id', e.target.value)}
              className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} (~{m.size_gb_approx} GB)
                </option>
              ))}
            </select>
            <p className="text-[11px] text-[#64748b]">
              {models.find((m) => m.id === settings.model_id)?.description}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#94a3b8]">Dispositivo de Ejecución</label>
            <select
              value={settings.device}
              onChange={(e) => update('device', e.target.value as 'auto' | 'cpu' | 'cuda')}
              className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
            >
              <option value="auto">
                Automático ({hardware.cuda_available ? 'Usará CUDA' : 'Usará CPU'})
              </option>
              <option value="cpu">CPU (float32 — compatible sin GPU)</option>
              <option value="cuda" disabled={!hardware.cuda_available}>
                CUDA (GPU NVIDIA {hardware.cuda_available ? hardware.gpu_name : '— No detectada'})
              </option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#94a3b8] flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5 text-cyan-400" />
              <span>Idioma de Síntesis (10 nativos)</span>
            </label>
            <select
              value={settings.language}
              onChange={(e) => update('language', e.target.value)}
              className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
            >
              {languages.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label} — {lang.native} ({lang.id})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#94a3b8]">Voz de Referencia Activa</label>
            <select
              value={settings.voice_name}
              onChange={(e) => update('voice_name', e.target.value)}
              className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
            >
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} {v.is_default ? '(Principal)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Seed & Consistency */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
          <Sliders className="h-4 w-4" />
          <span>Consistencia de Voz y Semilla</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-[#94a3b8]">
              <span>Semilla (Seed)</span>
              <button
                type="button"
                onClick={() => update('seed', Math.floor(Math.random() * 1000000000))}
                className="text-[11px] text-cyan-400 hover:underline cursor-pointer"
              >
                Aleatoria
              </button>
            </div>
            <input
              type="number"
              value={settings.seed}
              onChange={(e) => update('seed', parseInt(e.target.value, 10) || 0)}
              className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white font-mono outline-none focus:border-cyan-500"
            />
          </div>

          <div className="space-y-2.5 pt-1">
            <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={settings.keep_seed_on_regenerate}
                onChange={(e) => update('keep_seed_on_regenerate', e.target.checked)}
                className="accent-cyan-400"
              />
              <span>Mantener semilla fija al regenerar partes</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-[#94a3b8] cursor-pointer">
              <input
                type="checkbox"
                checked={settings.do_sample}
                onChange={(e) => update('do_sample', e.target.checked)}
                className="accent-cyan-400"
              />
              <span>Prosodia natural (desmarcar para modo determinista estricto)</span>
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-cyan-500/25 bg-[#090c12] p-3 flex items-start gap-2.5 text-xs text-[#94a3b8]">
          <Info className="h-4 w-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-white">Reproducibilidad de Qwen3-TTS:</strong> El estudio aplica{' '}
            <code>torch.manual_seed</code> antes de cada segmento usando la configuración óptima nativa de{' '}
            <code>Qwen3TTSModel</code>. Con prosodia natural activa pueden existir ligeras variaciones entre CPU y GPU; desactívala para repetibilidad estricta.
          </span>
        </div>
      </div>

      {/* Audio Post-processing & Pauses */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-5 space-y-4">
        <div className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
          <Volume2 className="h-4 w-4" />
          <span>Procesamiento WAV y Pausas Naturales (Sin compresión destructiva)</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[#94a3b8]">
              <span>Pausa entre oraciones</span>
              <span className="font-mono text-cyan-400">{settings.sentence_pause_ms} ms</span>
            </div>
            <input
              type="range"
              min={0}
              max={600}
              step={20}
              value={settings.sentence_pause_ms}
              onChange={(e) => update('sentence_pause_ms', parseInt(e.target.value, 10))}
              className="w-full accent-cyan-400"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[#94a3b8]">
              <span>Pausa entre partes</span>
              <span className="font-mono text-cyan-400">{settings.part_pause_ms} ms</span>
            </div>
            <input
              type="range"
              min={0}
              max={1000}
              step={20}
              value={settings.part_pause_ms}
              onChange={(e) => update('part_pause_ms', parseInt(e.target.value, 10))}
              className="w-full accent-cyan-400"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-[#94a3b8]">
              <span>Pausa entre escenas/párrafos</span>
              <span className="font-mono text-cyan-400">{settings.section_pause_ms} ms</span>
            </div>
            <input
              type="range"
              min={0}
              max={2000}
              step={50}
              value={settings.section_pause_ms}
              onChange={(e) => update('section_pause_ms', parseInt(e.target.value, 10))}
              className="w-full accent-cyan-400"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 pt-2 border-t border-[#1b2333]">
          <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
            <input
              type="checkbox"
              checked={settings.strip_leading_artifact ?? true}
              onChange={(e) => update('strip_leading_artifact', e.target.checked)}
              className="accent-cyan-400"
            />
            <span>
              Limpiar sílaba o eco inicial artificial al comienzo de cada audio (evita arrastres ICL como &ldquo;aba...&rdquo;)
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={settings.trim_silence}
                onChange={(e) => update('trim_silence', e.target.checked)}
                className="accent-cyan-400"
              />
              <span>Recortar silencios artificiales excesivos al final de cada parte</span>
            </label>

            {settings.trim_silence && (
              <div className="flex items-center gap-3 text-xs text-[#94a3b8]">
                <span>Umbral:</span>
                <input
                  type="range"
                  min={-60}
                  max={-25}
                  step={1}
                  value={settings.silence_threshold_db}
                  onChange={(e) => update('silence_threshold_db', parseFloat(e.target.value))}
                  className="accent-cyan-400"
                />
                <span className="font-mono text-cyan-400">{settings.silence_threshold_db} dB</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
