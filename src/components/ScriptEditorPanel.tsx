import React, { useRef } from 'react';
import { Clapperboard, FileText, Upload, Save, RotateCcw, Scissors } from 'lucide-react';
import { ProcessingMode, ProjectSummaryMetrics } from '../types';
import { SAMPLE_SCRIPT_ES } from '../constants/qwenConfig';

interface ScriptEditorPanelProps {
  scriptText: string;
  processingMode: ProcessingMode;
  maxChars: number;
  summary: ProjectSummaryMetrics;
  isSaving: boolean;
  onScriptChange: (text: string) => void;
  onModeChange: (mode: ProcessingMode) => void;
  onMaxCharsChange: (val: number) => void;
  onSaveScript: () => void;
}

export const ScriptEditorPanel: React.FC<ScriptEditorPanelProps> = ({
  scriptText,
  processingMode,
  maxChars,
  summary,
  isSaving,
  onScriptChange,
  onModeChange,
  onMaxCharsChange,
  onSaveScript,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const wordsCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
  const charsCount = scriptText.length;

  const handleImportTxt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    onScriptChange(content);
    e.target.value = '';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Editor de Guiones</h2>
          <p className="text-xs text-[#94a3b8] mt-0.5">
            Pega guiones extensos (25–40 min) o importa archivos TXT. Los números se normalizan fonéticamente en español al sintetizar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            onChange={handleImportTxt}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#121722] hover:bg-[#1a2232] px-3 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            <Upload className="h-3.5 w-3.5 text-cyan-400" />
            <span>Importar TXT</span>
          </button>
          <button
            type="button"
            onClick={() => onScriptChange(SAMPLE_SCRIPT_ES)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#223048] bg-[#121722] hover:bg-[#1a2232] px-3 py-2 text-xs font-semibold text-[#94a3b8] hover:text-white cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Cargar ejemplo</span>
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onSaveScript}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-4 py-2 text-xs font-bold text-white cursor-pointer"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{isSaving ? 'Guardando...' : 'Guardar y Segmentar'}</span>
          </button>
        </div>
      </div>

      {/* Mode & Segmentation Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-[#1b2333] bg-[#121722] p-4 space-y-2.5">
          <div className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
            Modo de Segmentación
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onModeChange('scene')}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                processingMode === 'scene'
                  ? 'border-cyan-500 bg-cyan-950/30 text-white'
                  : 'border-[#1b2333] bg-[#090c12] text-[#94a3b8] hover:text-white'
              }`}
            >
              <Clapperboard className="h-5 w-5 text-cyan-400 shrink-0" />
              <div>
                <div className="text-xs font-bold">Modo Escenas</div>
                <div className="text-[11px] text-[#64748b]">
                  Detecta encabezados ESCENA 1 — Título
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onModeChange('paragraph')}
              className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                processingMode === 'paragraph'
                  ? 'border-cyan-500 bg-cyan-950/30 text-white'
                  : 'border-[#1b2333] bg-[#090c12] text-[#94a3b8] hover:text-white'
              }`}
            >
              <FileText className="h-5 w-5 text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-bold">Modo Párrafos</div>
                <div className="text-[11px] text-[#64748b]">
                  Separa secciones por líneas en blanco
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#94a3b8] flex items-center gap-1.5">
              <Scissors className="h-3.5 w-3.5 text-cyan-400" /> Longitud de Parte
            </span>
            <span className="font-mono text-xs font-bold text-cyan-400">{maxChars} chars</span>
          </div>
          <input
            type="range"
            min={120}
            max={450}
            step={10}
            value={maxChars}
            onChange={(e) => onMaxCharsChange(parseInt(e.target.value, 10))}
            className="w-full accent-cyan-500 cursor-pointer"
          />
          <p className="text-[11px] text-[#64748b] leading-snug">
            Recomendado ~250 caracteres. Respeta límites de oraciones para no cortar palabras ni frases.
          </p>
        </div>
      </div>

      {/* Textarea */}
      <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 space-y-3">
        <textarea
          value={scriptText}
          onChange={(e) => onScriptChange(e.target.value)}
          rows={16}
          placeholder={
            processingMode === 'scene'
              ? 'ESCENA 1 — INTRODUCCIÓN\nEscribe o pega aquí tu narración...'
              : 'Pega aquí tu guion separando cada párrafo con una línea en blanco...'
          }
          className="w-full rounded-xl border border-[#1b2333] bg-[#090c12] p-4 text-sm text-[#f8fafc] leading-relaxed outline-none focus:border-cyan-500 font-sans"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[#64748b]">
          <div className="flex flex-wrap items-center gap-4">
            <span>{charsCount.toLocaleString()} caracteres</span>
            <span>&bull;</span>
            <span>{wordsCount.toLocaleString()} palabras</span>
            <span>&bull;</span>
            <span>
              {summary.total_sections} {processingMode === 'scene' ? 'escenas' : 'párrafos'} / {summary.total_parts} partes
            </span>
          </div>
          <span className="text-emerald-400 font-sans font-medium">
            Guardado automático por proyecto
          </span>
        </div>
      </div>
    </div>
  );
};
