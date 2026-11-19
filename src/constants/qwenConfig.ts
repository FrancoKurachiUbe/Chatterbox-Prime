import { QwenGenerationSettings, QwenLanguageInfo, QwenModelInfo } from '../types';

export const DEFAULT_QWEN_MODELS: QwenModelInfo[] = [
  {
    id: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
    label: 'Qwen3-TTS 12Hz 1.7B Base (Principal)',
    size_gb_approx: 4.2,
    recommended_vram_gb: 6.0,
    recommended_ram_gb: 12.0,
    description: 'Máxima fidelidad de clonación vocal y prosodia natural para narración documental.',
  },
  {
    id: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
    label: 'Qwen3-TTS 12Hz 0.6B Base (Alternativo / CPU)',
    size_gb_approx: 1.8,
    recommended_vram_gb: 3.0,
    recommended_ram_gb: 8.0,
    description: 'Modelo compacto y más rápido en CPU o sistemas con recursos limitados.',
  },
];

export const QWEN_LANGUAGES: QwenLanguageInfo[] = [
  { id: 'Spanish', code: 'es', label: 'Español', native: 'Español' },
  { id: 'English', code: 'en', label: 'Inglés', native: 'English' },
  { id: 'Portuguese', code: 'pt', label: 'Portugués', native: 'Português' },
  { id: 'French', code: 'fr', label: 'Francés', native: 'Français' },
  { id: 'Italian', code: 'it', label: 'Italiano', native: 'Italiano' },
  { id: 'German', code: 'de', label: 'Alemán', native: 'Deutsch' },
  { id: 'Russian', code: 'ru', label: 'Ruso', native: 'Русский' },
  { id: 'Japanese', code: 'ja', label: 'Japonés', native: '日本語' },
  { id: 'Korean', code: 'ko', label: 'Coreano', native: '한국어' },
  { id: 'Chinese', code: 'zh', label: 'Chino', native: '中文' },
];

export const DEFAULT_SETTINGS: QwenGenerationSettings = {
  model_id: 'Qwen/Qwen3-TTS-12Hz-1.7B-Base',
  device: 'auto',
  language: 'Spanish',
  voice_name: 'Brian Warm Clonacion Voz',
  max_chars: 250,
  do_sample: true,
  temperature: 0.75,
  top_p: 0.9,
  top_k: 50,
  repetition_penalty: 1.05,
  max_new_tokens: 2048,
  subtalker_dosample: true,
  subtalker_temperature: 0.75,
  subtalker_top_p: 0.9,
  subtalker_top_k: 50,
  seed: 737219296,
  keep_seed_on_regenerate: true,
  x_vector_only_mode: false,
  sentence_pause_ms: 140,
  part_pause_ms: 220,
  section_pause_ms: 650,
  trim_silence: true,
  silence_threshold_db: -42,
  strip_leading_artifact: true,
};

export const SAMPLE_SCRIPT_ES = `ESCENA 1 — INTRODUCCIÓN
En el corazón del año 1492, un puñado de navegantes zarpó hacia lo desconocido convencido de que más allá del horizonte aguardaba una nueva ruta comercial. Más de 90 tripulantes enfrentaron el silencio del océano Atlántico.

ESCENA 2 — DESARROLLO
Durante 35 días de travesía continua, las corrientes cambiaron de rumbo y la incertidumbre puso a prueba la disciplina a bordo. Cada milla recorrida reescribía los mapas conocidos hasta entonces.

ESCENA 3 — CONCLUSIÓN
Al amanecer del 12 de octubre, un grito desde la cofa anunció tierra firme. Ese instante conectó 2 mundos separados por milenios y abrió un capítulo definitivo en la historia universal.`;
