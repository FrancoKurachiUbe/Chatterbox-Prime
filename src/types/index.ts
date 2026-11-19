export type StudioSectionTab =
  | 'dashboard'
  | 'editor'
  | 'voices'
  | 'settings'
  | 'production'
  | 'player'
  | 'projects';

export type ProcessingMode = 'scene' | 'paragraph';

export type PartStatus = 'pending' | 'generating' | 'ready' | 'failed' | 'stale';

export interface HardwareInfo {
  os: string;
  python_version: string;
  cpu_cores: number;
  ram_total_gb: number;
  ram_available_gb: number;
  torch_installed: boolean;
  torch_version: string | null;
  qwen_tts_installed: boolean;
  flash_attn_installed: boolean;
  soundfile_installed: boolean;
  cuda_available: boolean;
  gpu_name: string | null;
  vram_total_gb: number;
  vram_free_gb: number;
  recommended_device: 'cpu' | 'cuda';
  recommended_model: string;
  warnings: string[];
}

export interface ModelStatusInfo {
  loaded: boolean;
  active_model_id: string | null;
  active_device: string | null;
  status_text: string;
}

export interface ProductionStateInfo {
  is_generating: boolean;
  active_project_id: string | null;
  current_step: number;
  total_steps: number;
  current_label: string;
  message: string;
  started_at: number | null;
  elapsed_sec: number;
  errors: string[];
}

export interface SystemStatusResponse {
  status: 'online' | 'offline';
  app_name: string;
  version: string;
  hardware: HardwareInfo;
  model: ModelStatusInfo;
  production: ProductionStateInfo;
}

export interface QwenModelInfo {
  id: string;
  label: string;
  size_gb_approx: number;
  recommended_vram_gb: number;
  recommended_ram_gb: number;
  description: string;
}

export interface QwenLanguageInfo {
  id: string;
  code: string;
  label: string;
  native: string;
}

export interface QwenGenerationSettings {
  model_id: string;
  device: 'auto' | 'cpu' | 'cuda';
  language: string;
  voice_name: string;
  max_chars: number;
  do_sample: boolean;
  temperature: number;
  top_p: number;
  top_k: number;
  repetition_penalty: number;
  max_new_tokens: number;
  subtalker_dosample: boolean;
  subtalker_temperature: number;
  subtalker_top_p: number;
  subtalker_top_k: number;
  seed: number;
  keep_seed_on_regenerate: boolean;
  x_vector_only_mode: boolean;
  sentence_pause_ms: number;
  part_pause_ms: number;
  section_pause_ms: number;
  trim_silence: boolean;
  silence_threshold_db: number;
  strip_leading_artifact: boolean;
}

export interface VoiceRecord {
  name: string;
  filename: string;
  size_kb: number;
  duration_sec?: number | null;
  sample_rate?: number | null;
  channels?: number | null;
  ref_text: string;
  x_vector_only_mode: boolean;
  is_default: boolean;
  exists_on_disk: boolean;
  preview_url: string;
  prompt_ready_models: string[];
  prompt_status: 'ready' | 'not_prepared' | 'missing_audio' | 'needs_transcript';
}

export interface ScriptPartItem {
  number: number;
  text: string;
  normalized_text: string;
  content_hash: string;
  filename: string;
  audio_url: string | null;
  has_audio: boolean;
  duration_sec?: number | null;
  status: PartStatus;
  error_message?: string | null;
  generated_hash?: string | null;
  updated_at?: number | null;
}

export interface ScriptSectionItem {
  number: number;
  title: string;
  text: string;
  normalized_text: string;
  joined_filename: string;
  joined_audio_url: string | null;
  has_joined: boolean;
  parts: ScriptPartItem[];
}

export interface ProjectSummaryMetrics {
  mode: ProcessingMode;
  mode_label: string;
  total_sections: number;
  total_parts: number;
  ready_parts: number;
  pending_parts: number;
  failed_parts: number;
  stale_parts: number;
  percent: number;
}

export interface StudioProject {
  id: string;
  name: string;
  script_text: string;
  processing_mode: ProcessingMode;
  settings: QwenGenerationSettings;
  sections: ScriptSectionItem[];
  master_audio_url: string | null;
  master_filename: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectListItem {
  id: string;
  name: string;
  processing_mode: ProcessingMode;
  voice_name: string;
  model_id: string;
  total_sections: number;
  total_parts: number;
  ready_parts: number;
  percent: number;
  has_master: boolean;
  created_at: number;
  updated_at: number;
}
