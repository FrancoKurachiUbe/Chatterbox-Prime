import {
  ProjectListItem,
  ProjectSummaryMetrics,
  QwenGenerationSettings,
  StudioProject,
  SystemStatusResponse,
  VoiceRecord,
} from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: `Error HTTP ${res.status}` }));
    throw new Error(body.detail || body.error || `Error HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const qwenApi = {
  async getStatus(): Promise<SystemStatusResponse> {
    try {
      return await requestJson<SystemStatusResponse>('/api/status');
    } catch {
      return {
        status: 'offline',
        app_name: 'Qwen3Prime',
        version: '1.0.0',
        hardware: {
          os: 'Desconocido',
          python_version: '-',
          cpu_cores: 0,
          ram_total_gb: 0,
          ram_available_gb: 0,
          torch_installed: false,
          torch_version: null,
          qwen_tts_installed: false,
          flash_attn_installed: false,
          soundfile_installed: false,
          cuda_available: false,
          gpu_name: null,
          vram_total_gb: 0,
          vram_free_gb: 0,
          recommended_device: 'cpu',
          recommended_model: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
          warnings: ['Servidor Python FastAPI no conectado en http://127.0.0.1:8000'],
        },
        model: {
          loaded: false,
          active_model_id: null,
          active_device: null,
          status_text: 'Sin conexión con backend Python',
        },
        production: {
          is_generating: false,
          active_project_id: null,
          current_step: 0,
          total_steps: 0,
          current_label: '',
          message: 'Desconectado',
          started_at: null,
          elapsed_sec: 0,
          errors: [],
        },
      };
    }
  },

  async unloadModel(): Promise<{ status: string; message: string }> {
    return requestJson('/api/model/unload', { method: 'POST' });
  },

  async loadModel(modelId: string, device: string): Promise<{ status: string; message: string }> {
    return requestJson('/api/model/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, device }),
    });
  },

  // Voces
  async listVoices(modelId?: string): Promise<{ voices: VoiceRecord[]; default_voice: string }> {
    const qs = modelId ? `?model_id=${encodeURIComponent(modelId)}` : '';
    return requestJson(`/api/voices${qs}`);
  },

  async uploadVoice(file: File, name: string, refText: string): Promise<{ voices: VoiceRecord[] }> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    fd.append('ref_text', refText);
    return requestJson('/api/voices/upload', { method: 'POST', body: fd });
  },

  async updateVoiceMeta(
    voiceName: string,
    payload: { new_name?: string; ref_text?: string; x_vector_only_mode?: boolean }
  ): Promise<{ voice: VoiceRecord }> {
    return requestJson(`/api/voices/${encodeURIComponent(voiceName)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async prepareVoicePrompt(
    voiceName: string,
    modelId: string,
    device: string,
    forceRebuild: boolean = false
  ): Promise<{ status: string; message: string; voice: VoiceRecord }> {
    return requestJson(`/api/voices/${encodeURIComponent(voiceName)}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: modelId, device, force_rebuild: forceRebuild }),
    });
  },

  async deleteVoice(voiceName: string): Promise<{ voices: VoiceRecord[] }> {
    return requestJson(`/api/voices/${encodeURIComponent(voiceName)}`, { method: 'DELETE' });
  },

  // Proyectos independientes
  async listProjects(): Promise<{ projects: ProjectListItem[]; active_project_id: string | null }> {
    return requestJson('/api/projects');
  },

  async createProject(payload: {
    name: string;
    script_text?: string;
    processing_mode?: 'scene' | 'paragraph';
    settings?: Partial<QwenGenerationSettings>;
  }): Promise<{ project: StudioProject; summary: ProjectSummaryMetrics }> {
    return requestJson('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async getProject(projectId: string): Promise<{ project: StudioProject; summary: ProjectSummaryMetrics }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}`);
  },

  async saveProject(
    projectId: string,
    payload: {
      name?: string;
      script_text?: string;
      processing_mode?: 'scene' | 'paragraph';
      settings?: QwenGenerationSettings;
    }
  ): Promise<{ project: StudioProject; summary: ProjectSummaryMetrics }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  async renameProject(projectId: string, name: string): Promise<{ project: StudioProject }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },

  async deleteProject(projectId: string): Promise<{ status: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  },

  getExportProjectZipUrl(projectId: string): string {
    return `/api/projects/${encodeURIComponent(projectId)}/export-zip`;
  },

  // Producción
  async startProduction(
    projectId: string,
    mode: 'pending_only' | 'retry_failed' | 'all' = 'pending_only',
    sectionNumber?: number
  ): Promise<{ status: string; message: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}/produce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, section_number: sectionNumber ?? null }),
    });
  },

  async cancelProduction(): Promise<{ status: string; message: string }> {
    return requestJson('/api/production/cancel', { method: 'POST' });
  },

  async regeneratePart(
    projectId: string,
    sectionNumber: number,
    partNumber: number
  ): Promise<{ status: string; message: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}/regenerate-part`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_number: sectionNumber, part_number: partNumber }),
    });
  },

  async regenerateBatch(
    projectId: string,
    items: Array<[number, number]>
  ): Promise<{ status: string; message: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}/regenerate-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  },

  async joinSection(projectId: string, sectionNumber: number): Promise<{ audio_url: string; filename: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}/join-section`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_number: sectionNumber }),
    });
  },

  async joinMaster(projectId: string): Promise<{ audio_url: string; filename: string }> {
    return requestJson(`/api/projects/${encodeURIComponent(projectId)}/join-master`, {
      method: 'POST',
    });
  },
};
