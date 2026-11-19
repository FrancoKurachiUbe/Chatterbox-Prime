import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { SidebarNav } from './components/SidebarNav';
import { DashboardPanel } from './components/DashboardPanel';
import { ScriptEditorPanel } from './components/ScriptEditorPanel';
import { VoiceLibraryPanel } from './components/VoiceLibraryPanel';
import { QwenSettingsPanel } from './components/QwenSettingsPanel';
import { ProductionPanel } from './components/ProductionPanel';
import { MasterPlayerPanel } from './components/MasterPlayerPanel';
import { ProjectsPanel } from './components/ProjectsPanel';
import {
  DEFAULT_QWEN_MODELS,
  DEFAULT_SETTINGS,
  QWEN_LANGUAGES,
  SAMPLE_SCRIPT_ES,
} from './constants/qwenConfig';
import { qwenApi } from './services/api';
import {
  ProcessingMode,
  ProjectListItem,
  ProjectSummaryMetrics,
  QwenGenerationSettings,
  StudioProject,
  StudioSectionTab,
  SystemStatusResponse,
  VoiceRecord,
} from './types';

const EMPTY_SUMMARY: ProjectSummaryMetrics = {
  mode: 'scene',
  mode_label: 'Escenas',
  total_sections: 0,
  total_parts: 0,
  ready_parts: 0,
  pending_parts: 0,
  failed_parts: 0,
  stale_parts: 0,
  percent: 0,
};

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<StudioSectionTab>('dashboard');
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse>({
    status: 'offline',
    app_name: 'Qwen3Prime',
    version: '1.0.0',
    hardware: {
      os: 'Detectando...',
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
      warnings: [],
    },
    model: {
      loaded: false,
      active_model_id: null,
      active_device: null,
      status_text: 'Comprobando estado...',
    },
    production: {
      is_generating: false,
      active_project_id: null,
      current_step: 0,
      total_steps: 0,
      current_label: '',
      message: 'Iniciando...',
      started_at: null,
      elapsed_sec: 0,
      errors: [],
    },
  });

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProject, setActiveProject] = useState<StudioProject | null>(null);
  const [summary, setSummary] = useState<ProjectSummaryMetrics>(EMPTY_SUMMARY);
  const [voices, setVoices] = useState<VoiceRecord[]>([]);

  const [scriptText, setScriptText] = useState<string>(SAMPLE_SCRIPT_ES);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('scene');
  const [settings, setSettings] = useState<QwenGenerationSettings>(DEFAULT_SETTINGS);

  const [isSaving, setIsSaving] = useState(false);
  const [isBusyModel, setIsBusyModel] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(
    null
  );

  const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.message === message ? null : curr));
    }, 4500);
  }, []);

  const refreshStatus = useCallback(async () => {
    const st = await qwenApi.getStatus();
    setSystemStatus(st);
    return st;
  }, []);

  const refreshVoices = useCallback(async (modelId?: string) => {
    try {
      const res = await qwenApi.listVoices(modelId);
      setVoices(res.voices || []);
    } catch {
      // Backend aún en etapa inicial o desconectado
    }
  }, []);

  const loadProjectById = useCallback(async (projectId: string) => {
    const res = await qwenApi.getProject(projectId);
    setActiveProject(res.project);
    setSummary(res.summary);
    setScriptText(res.project.script_text);
    setProcessingMode(res.project.processing_mode);
    setSettings(res.project.settings);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const res = await qwenApi.listProjects();
      setProjects(res.projects || []);
      const targetId = res.active_project_id || res.projects?.[0]?.id;
      if (targetId) {
        await loadProjectById(targetId);
      }
    } catch {
      // Etapa 4-7 completarán los endpoints de proyectos/voces
    }
  }, [loadProjectById]);

  useEffect(() => {
    refreshStatus();
    refreshVoices(settings.model_id);
    refreshProjects();
  }, [refreshStatus, refreshVoices, refreshProjects]);

  // Polling mientras haya producción activa
  useEffect(() => {
    if (!systemStatus.production.is_generating) return;
    const timer = setInterval(async () => {
      const st = await refreshStatus();
      if (activeProject) {
        await loadProjectById(activeProject.id).catch(() => {});
      }
      if (!st.production.is_generating) {
        notify(st.production.message || 'Producción finalizada', 'success');
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [systemStatus.production.is_generating, activeProject, refreshStatus, loadProjectById, notify]);

  const handleSaveProject = async (
    nextText = scriptText,
    nextMode = processingMode,
    nextSettings = settings,
    silent = false
  ) => {
    if (!activeProject) {
      if (!silent) notify('El proyecto aún se está cargando.', 'info');
      return;
    }
    setIsSaving(true);
    try {
      const res = await qwenApi.saveProject(activeProject.id, {
        script_text: nextText,
        processing_mode: nextMode,
        settings: nextSettings,
      });
      setActiveProject(res.project);
      setSummary(res.summary);
      if (!silent) {
        notify('Proyecto guardado y segmentado correctamente.', 'success');
      }
      const listRes = await qwenApi.listProjects();
      setProjects(listRes.projects || []);
    } catch (err: unknown) {
      if (!silent) {
        notify(err instanceof Error ? err.message : 'Error al guardar proyecto', 'error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Guardado automático silencioso al editar guion o longitud de parte
  useEffect(() => {
    if (!activeProject || systemStatus.production.is_generating) return;
    const dirty =
      scriptText !== activeProject.script_text ||
      settings.max_chars !== activeProject.settings.max_chars;
    if (!dirty) return;
    const timer = setTimeout(() => {
      handleSaveProject(scriptText, processingMode, settings, true);
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptText, settings.max_chars, activeProject?.id]);

  const handleSettingsChange = async (updated: QwenGenerationSettings) => {
    setSettings(updated);
    refreshVoices(updated.model_id);
    if (activeProject) {
      await handleSaveProject(scriptText, processingMode, updated);
    }
  };

  const handleCopyYouTube = () => {
    if (!activeProject || activeProject.sections.length === 0) {
      notify('No hay secciones para generar marcas de tiempo.', 'info');
      return;
    }
    let accSec = 0;
    const lines = activeProject.sections.map((sec) => {
      const m = Math.floor(accSec / 60);
      const s = Math.floor(accSec % 60);
      const line = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${sec.title}`;
      const secDur = sec.parts.reduce((sum, p) => sum + (p.duration_sec || 0), 0);
      accSec += secDur > 0 ? secDur : 30;
      return line;
    });
    navigator.clipboard.writeText(lines.join('\n'));
    notify('Marcas de tiempo copiadas al portapapeles.', 'success');
  };

  return (
    <div className="min-h-screen bg-[#080a0f] text-[#f8fafc] flex flex-col lg:flex-row">
      <SidebarNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        systemStatus={systemStatus}
        activeProjectName={activeProject?.name || 'Proyecto Inicial'}
        summary={summary}
      />

      {toast && (
        <div className="fixed top-5 right-5 z-50 max-w-md">
          <div
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-xs font-semibold shadow-2xl backdrop-blur ${
              toast.type === 'success'
                ? 'border-emerald-500/40 bg-[#0b1915] text-emerald-200'
                : toast.type === 'error'
                ? 'border-rose-500/40 bg-[#1d0d12] text-rose-200'
                : 'border-cyan-500/40 bg-[#0b1622] text-cyan-200'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : toast.type === 'error' ? (
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            ) : (
              <Info className="h-4 w-4 text-cyan-400 shrink-0" />
            )}
            <span>{toast.message}</span>
          </div>
        </div>
      )}

      <main className="flex-1 p-5 sm:p-8 max-w-6xl w-full mx-auto overflow-y-auto">
        {activeTab === 'dashboard' && (
          <DashboardPanel
            systemStatus={systemStatus}
            settings={settings}
            summary={summary}
            activeProjectName={activeProject?.name || 'Proyecto Inicial'}
            voices={voices}
            onNavigate={setActiveTab}
            onRefreshStatus={refreshStatus}
            isBusyModel={isBusyModel}
            onLoadModel={async () => {
              setIsBusyModel(true);
              try {
                const res = await qwenApi.loadModel(settings.model_id, settings.device);
                notify(res.message, 'success');
                await refreshStatus();
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error cargando modelo', 'error');
              } finally {
                setIsBusyModel(false);
              }
            }}
            onUnloadModel={async () => {
              setIsBusyModel(true);
              try {
                const res = await qwenApi.unloadModel();
                notify(res.message, 'info');
                await refreshStatus();
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error liberando memoria', 'error');
              } finally {
                setIsBusyModel(false);
              }
            }}
          />
        )}

        {activeTab === 'editor' && (
          <ScriptEditorPanel
            scriptText={scriptText}
            processingMode={processingMode}
            maxChars={settings.max_chars}
            summary={summary}
            isSaving={isSaving}
            onScriptChange={setScriptText}
            onModeChange={(mode) => {
              setProcessingMode(mode);
              handleSaveProject(scriptText, mode, settings);
            }}
            onMaxCharsChange={(val) => setSettings((s) => ({ ...s, max_chars: val }))}
            onSaveScript={() => handleSaveProject(scriptText, processingMode, settings)}
          />
        )}

        {activeTab === 'voices' && (
          <VoiceLibraryPanel
            voices={voices}
            selectedVoiceName={settings.voice_name}
            activeModelId={settings.model_id}
            onSelectVoice={(voiceName) => handleSettingsChange({ ...settings, voice_name: voiceName })}
            onUploadVoice={async (file, name, refText) => {
              try {
                await qwenApi.uploadVoice(file, name, refText);
                await refreshVoices(settings.model_id);
                notify(`Voz "${name}" guardada.`, 'success');
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error subiendo voz', 'error');
              }
            }}
            onUpdateVoiceMeta={async (voiceName, payload) => {
              try {
                await qwenApi.updateVoiceMeta(voiceName, payload);
                await refreshVoices(settings.model_id);
                notify('Metadatos de voz actualizados.', 'success');
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error actualizando voz', 'error');
              }
            }}
            onPreparePrompt={async (voiceName, force) => {
              try {
                const res = await qwenApi.prepareVoicePrompt(
                  voiceName,
                  settings.model_id,
                  settings.device,
                  force
                );
                await refreshVoices(settings.model_id);
                notify(res.message, 'success');
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error preparando prompt', 'error');
              }
            }}
            onDeleteVoice={async (voiceName) => {
              if (!window.confirm(`¿Eliminar la voz "${voiceName}"?`)) return;
              try {
                await qwenApi.deleteVoice(voiceName);
                await refreshVoices(settings.model_id);
                notify(`Voz "${voiceName}" eliminada.`, 'info');
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error eliminando voz', 'error');
              }
            }}
          />
        )}

        {activeTab === 'settings' && (
          <QwenSettingsPanel
            settings={settings}
            models={DEFAULT_QWEN_MODELS}
            languages={QWEN_LANGUAGES}
            voices={voices}
            hardware={systemStatus.hardware}
            onChange={handleSettingsChange}
          />
        )}

        {activeTab === 'production' && (
          <ProductionPanel
            sections={activeProject?.sections || []}
            processingMode={processingMode}
            summary={summary}
            production={systemStatus.production}
            modelStatus={systemStatus.model}
            onStartPending={async () => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.startProduction(activeProject.id, 'pending_only');
                notify(res.message, 'info');
                refreshStatus();
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error iniciando producción', 'error');
              }
            }}
            onRetryFailed={async () => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.startProduction(activeProject.id, 'retry_failed');
                notify(res.message, 'info');
                refreshStatus();
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error reintentando fallidas', 'error');
              }
            }}
            onCancel={async () => {
              await qwenApi.cancelProduction();
              notify('Cancelación solicitada.', 'info');
            }}
            onRegenerateSection={async (secNum) => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.startProduction(activeProject.id, 'all', secNum);
                notify(res.message, 'info');
                refreshStatus();
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error regenerando sección', 'error');
              }
            }}
            onRegeneratePart={async (secNum, partNum) => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.regeneratePart(activeProject.id, secNum, partNum);
                notify(res.message, 'success');
                await loadProjectById(activeProject.id);
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error regenerando parte', 'error');
              }
            }}
            onRegenerateBatch={async (items) => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.regenerateBatch(activeProject.id, items);
                notify(res.message, 'info');
                refreshStatus();
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error en regeneración por lote', 'error');
              }
            }}
            onJoinSection={async (secNum) => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.joinSection(activeProject.id, secNum);
                notify(`Sección unida: ${res.filename}`, 'success');
                await loadProjectById(activeProject.id);
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error uniendo sección', 'error');
              }
            }}
            onDownloadCompleteSection={async (secNum) => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.joinSection(activeProject.id, secNum);
                await loadProjectById(activeProject.id);
                const link = document.createElement('a');
                link.href = res.audio_url;
                link.download = res.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                notify(`Descargando completa: ${res.filename}`, 'success');
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error preparando escena completa', 'error');
              }
            }}
            onJoinMaster={async () => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.joinMaster(activeProject.id);
                notify(`Master WAV creado: ${res.filename}`, 'success');
                await loadProjectById(activeProject.id);
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error uniendo Master WAV', 'error');
              }
            }}
          />
        )}

        {activeTab === 'player' && (
          <MasterPlayerPanel
            projectId={activeProject?.id || ''}
            projectName={activeProject?.name || 'Proyecto Inicial'}
            processingMode={processingMode}
            sections={activeProject?.sections || []}
            masterAudioUrl={activeProject?.master_audio_url || null}
            masterFilename={activeProject?.master_filename || null}
            exportZipUrl={activeProject ? qwenApi.getExportProjectZipUrl(activeProject.id) : '#'}
            onJoinMaster={async () => {
              if (!activeProject) return;
              try {
                const res = await qwenApi.joinMaster(activeProject.id);
                notify(`Master creado: ${res.filename}`, 'success');
                await loadProjectById(activeProject.id);
              } catch (e: unknown) {
                notify(e instanceof Error ? e.message : 'Error creando Master', 'error');
              }
            }}
            onCopyYouTubeTimestamps={handleCopyYouTube}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectsPanel
            projects={projects}
            activeProjectId={activeProject?.id || null}
            onCreateProject={async (name) => {
              const res = await qwenApi.createProject({ name, processing_mode: 'scene' });
              setActiveProject(res.project);
              setSummary(res.summary);
              setScriptText(res.project.script_text);
              setProcessingMode(res.project.processing_mode);
              setSettings(res.project.settings);
              await refreshProjects();
              notify(`Proyecto "${name}" creado.`, 'success');
            }}
            onOpenProject={async (id) => {
              await loadProjectById(id);
              setActiveTab('editor');
              notify('Proyecto cargado.', 'success');
            }}
            onRenameProject={async (id, newName) => {
              await qwenApi.renameProject(id, newName);
              await refreshProjects();
              notify('Proyecto renombrado.', 'success');
            }}
            onDeleteProject={async (id) => {
              if (!window.confirm('¿Eliminar este proyecto y sus audios? Los demás proyectos no se verán afectados.')) {
                return;
              }
              await qwenApi.deleteProject(id);
              await refreshProjects();
              notify('Proyecto eliminado.', 'info');
            }}
            getExportZipUrl={(id) => qwenApi.getExportProjectZipUrl(id)}
          />
        )}
      </main>
    </div>
  );
};
