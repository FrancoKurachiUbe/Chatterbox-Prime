import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from './components/Header';
import { VoiceManagerModal } from './components/VoiceManagerModal';
import {
  ProcessingMode,
  ScriptSection,
  StudioSettings,
} from './types';
import {
  DEFAULT_SCRIPT_SAMPLE,
  SUPPORTED_LANGUAGES,
} from './constants/languages';
import {
  apiService,
  BackendStatus,
  GenerationProgress,
  VoiceOption,
  ProjectSummary,
} from './services/api';
import {
  AlertTriangle,
  CheckCircle,
  Info,
  Terminal,
  Play,
  Pause,
  RotateCw,
  FastForward,
  Download,
  Share2,
  Trash2,
  Sliders,
  Scissors,
  Layers,
  StopCircle,
  FolderOpen,
  Archive,
} from 'lucide-react';
import JSZip from 'jszip';
import { AudioFolderModal, AudioFileItem } from './components/AudioFolderModal';
import { synthesizeNarrationWav } from './services/audioSynthesizer';

// Parsers locales robustos para división fiel y compatible
function parseScenes(text: string): { number: number; title: string; text: string }[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  const scenePattern = /^\s*(?:ESCENA|Escena|SCENE|Scene|CAPÍTULO|Capítulo|PARTE|Parte)\s+(\d+)(?:\s*[—–:\-\.]\s*(.*))?\s*$/i;
  const scenes: { number: number; title: string; lines: string[] }[] = [];
  let current: { number: number; title: string; lines: string[] } | null = null;
  const preLines: string[] = [];

  for (const line of lines) {
    const match = line.match(scenePattern);
    if (match) {
      if (current) {
        scenes.push(current);
      }
      current = {
        number: parseInt(match[1], 10),
        title: (match[2] || '').trim(),
        lines: [],
      };
    } else {
      if (current) current.lines.push(line);
      else if (line.trim()) preLines.push(line);
    }
  }
  if (current) scenes.push(current);

  const result = scenes.map((s, idx) => ({
    number: idx + 1,
    title: s.title || `Escena ${idx + 1}`,
    text: s.lines.join('\n').trim(),
  }));

  if (preLines.length > 0) {
    const intro = preLines.join('\n').trim();
    if (result.length === 0) {
      result.push({ number: 1, title: 'Escena 1', text: intro });
    } else {
      result[0].text = `${intro}\n\n${result[0].text}`.trim();
    }
  }

  if (result.length === 0) {
    result.push({ number: 1, title: 'Escena 1', text: text.trim() });
  }
  return result;
}

function parseParagraphs(text: string): { number: number; title: string; text: string }[] {
  const paras = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n/);
  const valid = paras.filter(p => p.trim());
  if (valid.length === 0) return [{ number: 1, title: 'Párrafo 1', text: text.trim() }];
  return valid.map((p, idx) => ({
    number: idx + 1,
    title: `Párrafo ${idx + 1}`,
    text: p.trim(),
  }));
}

function splitTextChunks(text: string, maxChars: number = 140): string[] {
  const paras = text.split(/\n+/).filter(Boolean);
  const chunks: string[] = [];
  for (const para of paras) {
    const rawSentences = para.match(/[^.!?;\n]+(?:[.!?;\n]+["']?|$)/g) || [para];
    const sentences = rawSentences.map(s => s.trim()).filter(Boolean);

    // Si tiene una sola frase corta, conservar
    if (sentences.length <= 1 && para.length <= maxChars) {
      chunks.push(para);
      continue;
    }

    let cur = '';
    for (const s of sentences) {
      const clean = s.trim();
      if (!clean) continue;
      if (clean.length > maxChars) {
        if (cur) { chunks.push(cur.trim()); cur = ''; }
        const words = clean.split(/\s+/);
        let wordChunk = '';
        for (const w of words) {
          const cand = wordChunk ? `${wordChunk} ${w}` : w;
          if (cand.length <= maxChars) wordChunk = cand;
          else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = w;
          }
        }
        if (wordChunk) cur = wordChunk;
        continue;
      }
      const candidate = cur ? `${cur} ${clean}` : clean;
      if (candidate.length <= minMaxLimit(maxChars, 130)) cur = candidate;
      else {
        if (cur) chunks.push(cur.trim());
        cur = clean;
      }
    }
    if (cur) chunks.push(cur.trim());
  }
  return chunks.length > 0 ? chunks : [text];
}

function minMaxLimit(a: number, b: number): number {
  return Math.min(a, b);
}

export const App: React.FC = () => {
  const [processingMode, setProcessingMode] = useState<ProcessingMode>('scene');
  const [scriptText, setScriptText] = useState<string>(DEFAULT_SCRIPT_SAMPLE);
  const [settings, setSettings] = useState<StudioSettings>({
    language: 'es',
    voiceName: 'Brian Warm Clonacion Voz',
    refAudioUrl: '',
    refAudioName: 'Brian Warm Clonacion Voz.wav',
    exaggeration: 0.35,
    cfgWeight: 0.5,
    temperature: 0.55,
    seed: 737219296,
    keepSeedOnRegenerate: true,
  });

  const [sections, setSections] = useState<any[]>([]);
  const [summary, setSummary] = useState<ProjectSummary>({
    mode: 'scene',
    mode_label: 'Escenas',
    total_sections: 0,
    total_parts: 0,
    ready_parts: 0,
    pending_parts: 0,
    errors_count: 0,
    percent: 0,
  });

  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [masterAudioUrl, setMasterAudioUrl] = useState<string | null>(null);
  const [playingSceneId, setPlayingSceneId] = useState<number | null>(null);
  const [playingPartKey, setPlayingPartKey] = useState<string | null>(null);
  const [regeneratingSecId, setRegeneratingSecId] = useState<number | null>(null);
  const sceneAudioRefs = useRef<Record<number, HTMLAudioElement | null>>({});
  const partAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Cola de regeneración secuencial de partes
  const [activeRegeneratingPart, setActiveRegeneratingPart] = useState<string | null>(null);
  const [regenerationQueue, setRegenerationQueue] = useState<Array<{ secNum: number; partNum: number }>>([]);
  const [recentlyFinishedParts, setRecentlyFinishedParts] = useState<Set<string>>(new Set());
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [audioFolderFiles, setAudioFolderFiles] = useState<AudioFileItem[]>([]);
  const [isDeletingWavs, setIsDeletingWavs] = useState(false);
  const [isZippingWavs, setIsZippingWavs] = useState(false);
  const isProcessingQueueRef = useRef(false);
  const queueRef = useRef<Array<{ secNum: number; partNum: number }>>([]);
  const sectionsRef = useRef<any[]>([]);

  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  // Alerta sonora sutil y agradable al terminar una regeneración
  const playNotificationChime = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {}
  }, []);

  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    status: 'offline',
    device: 'desconocido',
    device_label: 'Comprobando conexión...',
    model_loaded: false,
    model_status: 'Iniciando',
    t3_model: 'v2',
    is_generating: false,
  });
  const [backendVoices, setBackendVoices] = useState<VoiceOption[]>([]);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress>({
    is_generating: false,
    current_step: 0,
    total_steps: 0,
    current_label: '',
    message: 'Inactivo',
    errors: [],
  });

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 4000);
  }, []);

  // 1. Comprobar estado del backend
  const checkBackendStatus = useCallback(async () => {
    try {
      const status = await apiService.checkStatus();
      setBackendStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  // 2. Cargar lista de voces
  const loadVoices = useCallback(async () => {
    try {
      const res = await apiService.getVoices();
      if (res && res.voices) {
        setBackendVoices(res.voices);
      }
    } catch {}
  }, []);

  // 3. Cargar proyecto desde el backend
  const loadProjectData = useCallback(async (mode: ProcessingMode) => {
    try {
      const res = await apiService.getProject(mode);
      if (res) {
        if (res.project) {
          if (res.project.last_script && res.project.last_script.trim()) {
            setScriptText(res.project.last_script);
          }
          if (res.project.settings) {
            const s = res.project.settings;
            setSettings((curr) => ({
              ...curr,
              language: s.language || curr.language,
              exaggeration: s.exaggeration ?? curr.exaggeration,
              temperature: s.temperature ?? curr.temperature,
              cfgWeight: s.cfg_weight ?? curr.cfgWeight,
              seed: s.seed ?? curr.seed,
              voiceName: s.voice_name || curr.voiceName,
            }));
          }
        }
        if (res.panel) {
          setSections(res.panel);
        }
        if (res.summary) {
          setSummary(res.summary);
        }
      }
    } catch {}
  }, []);

  // Polling de progreso
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isGenerating) {
      interval = setInterval(async () => {
        const prog = await apiService.getProgress();
        setGenerationProgress(prog);
        if (!prog.is_generating) {
          setIsGenerating(false);
          loadProjectData(processingMode);
          showNotification(prog.message || 'Producción finalizada', 'success');
        }
      }, 1200);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating, processingMode, loadProjectData, showNotification]);

  // Inicialización
  useEffect(() => {
    checkBackendStatus();
    loadVoices();
    loadProjectData(processingMode);
  }, [checkBackendStatus, loadVoices, loadProjectData, processingMode]);

  // Autosave con debounce
  const triggerAutosave = useCallback(
    (textToSave: string, modeToSave: ProcessingMode, settingsToSave: StudioSettings) => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = setTimeout(async () => {
        if (!textToSave.trim()) return;
        try {
          await apiService.saveProject({
            text: textToSave,
            processing_mode: modeToSave,
            language: settingsToSave.language,
            voice_name: settingsToSave.voiceName,
            exaggeration: settingsToSave.exaggeration,
            temperature: settingsToSave.temperature,
            cfg_weight: settingsToSave.cfgWeight,
            seed: settingsToSave.seed,
          });
        } catch {}
      }, 900);
    },
    []
  );

  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setScriptText(val);
    triggerAutosave(val, processingMode, settings);
  };

  const handleModeChange = (mode: ProcessingMode) => {
    setProcessingMode(mode);
    loadProjectData(mode);
    triggerAutosave(scriptText, mode, settings);
  };

  const handleSettingChange = (field: keyof StudioSettings, val: any) => {
    const updated = { ...settings, [field]: val };
    setSettings(updated);
    triggerAutosave(scriptText, processingMode, updated);
  };

  // Optimizar en bloques de 250 chars
  const handleAutoSplit = () => {
    const rawText = scriptText.trim();
    if (!rawText) return;

    const paragraphs = rawText.split(/\n\s*\n/);
    const chunks: string[] = [];
    let counter = 1;

    for (const p of paragraphs) {
      const cleanP = p.replace(/^ESCENA\s+\d+[:\s—-]*/i, '').trim();
      if (!cleanP) continue;

      if (cleanP.length <= 250) {
        if (processingMode === 'scene') chunks.push(`ESCENA ${counter} — Escena ${counter}\n${cleanP}`);
        else chunks.push(cleanP);
        counter++;
      } else {
        const sentences = cleanP.match(/[^.!?;\n]+(?:[.!?;\n]+|$)/g) || [cleanP];
        let currentChunk = '';
        for (let s of sentences) {
          s = s.trim();
          if (!s) continue;
          if ((currentChunk + ' ' + s).trim().length <= 250) {
            currentChunk = (currentChunk + ' ' + s).trim();
          } else {
            if (currentChunk) {
              if (processingMode === 'scene') chunks.push(`ESCENA ${counter} — Parte ${counter}\n${currentChunk}`);
              else chunks.push(currentChunk);
              counter++;
            }
            currentChunk = s;
          }
        }
        if (currentChunk) {
          if (processingMode === 'scene') chunks.push(`ESCENA ${counter} — Parte ${counter}\n${currentChunk}`);
          else chunks.push(currentChunk);
          counter++;
        }
      }
    }

    const nextScript = chunks.join('\n\n');
    setScriptText(nextScript);
    triggerAutosave(nextScript, processingMode, settings);
    showNotification('Guion optimizado en bloques de ~250 caracteres', 'info');
  };

  // Iniciar Producción (Dual: Backend Chatterbox Prime o Autónomo WAV)
  const handleGenerateAll = async () => {
    if (!scriptText.trim()) {
      showNotification('Introduce un guion antes de generar', 'error');
      return;
    }

    setIsGenerating(true);

    if (backendStatus.status === 'online') {
      try {
        await apiService.startGeneration({
          text: scriptText,
          processing_mode: processingMode,
          language: settings.language,
          voice_name: settings.voiceName,
          exaggeration: settings.exaggeration,
          temperature: settings.temperature,
          cfg_weight: settings.cfgWeight,
          seed: settings.seed,
        });
        showNotification('Producción de audio iniciada con Chatterbox Prime', 'info');
      } catch (err: unknown) {
        setIsGenerating(false);
        const msg = err instanceof Error ? err.message : String(err);
        showNotification(`Error: ${msg}`, 'error');
      }
      return;
    }

    // Modo Autónomo: sintetiza audios WAV de todas las escenas
    try {
      showNotification('🎙️ Sintetizando audios WAV para todas las escenas...', 'info');
      const rawSections =
        processingMode === 'scene'
          ? parseScenes(scriptText)
          : parseParagraphs(scriptText);

      const generatedSections: any[] = [];
      let totalPartsCount = 0;

      for (let sIdx = 0; sIdx < rawSections.length; sIdx++) {
        const s = rawSections[sIdx];
        const secLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';
        const chunks = splitTextChunks(s.text, 250);
        totalPartsCount += chunks.length;

        // Audio WAV completo de la escena
        const sceneWav = await synthesizeNarrationWav(s.text, {
          language: settings.language,
          temperature: settings.temperature,
          exaggeration: settings.exaggeration,
          seed: settings.seed + s.number,
        });

        const parts = await Promise.all(
          chunks.map(async (chunk, pIdx) => {
            const pNum = pIdx + 1;
            const partWav = await synthesizeNarrationWav(chunk, {
              language: settings.language,
              temperature: settings.temperature,
              exaggeration: settings.exaggeration,
              seed: settings.seed + s.number * 100 + pNum,
            });
            const pFilename = `${secLabel}_${String(s.number).padStart(3, '0')}_Parte_${String(pNum).padStart(2, '0')}.wav`;
            return {
              number: pNum,
              text: chunk,
              normalized_text: chunk,
              filename: pFilename,
              audio_url: partWav.url,
              has_audio: true,
              status: 'Listo',
            };
          })
        );

        const secFilename = `${secLabel}_${String(s.number).padStart(3, '0')}.wav`;
        generatedSections.push({
          number: s.number,
          title: s.title || `${secLabel} ${s.number}`,
          text: s.text,
          has_joined: true,
          has_audio: true,
          audio_url: sceneWav.url,
          joined_audio_url: sceneWav.url,
          joined_filename: secFilename,
          parts,
          updated_t: Date.now(),
        });
      }

      setSections(generatedSections);
      setSummary({
        mode: processingMode,
        mode_label: processingMode === 'scene' ? 'Escenas' : 'Párrafos',
        total_sections: generatedSections.length,
        total_parts: totalPartsCount,
        ready_parts: totalPartsCount,
        pending_parts: 0,
        errors_count: 0,
        percent: 100,
      });

      // Master audio
      const allText = generatedSections.map((s) => s.text).join(' ... \n\n ... ');
      const masterWav = await synthesizeNarrationWav(allText, {
        language: settings.language,
        temperature: settings.temperature,
        exaggeration: settings.exaggeration,
        seed: settings.seed,
      });
      setMasterAudioUrl(masterWav.url);

      showNotification('🎉 ¡Audio de todas las escenas generado con éxito! Haz clic en ▶️ Play para escucharlas.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Error: ${msg}`, 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // Reproducir audio de una escena completa
  const handlePlayScene = (secNum: number) => {
    const el = sceneAudioRefs.current[secNum];
    if (!el) return;

    if (playingSceneId === secNum) {
      el.pause();
      setPlayingSceneId(null);
    } else {
      // Pausar todos los demás reproductores
      Object.entries(sceneAudioRefs.current).forEach(([k, audio]) => {
        if (audio && parseInt(k, 10) !== secNum) audio.pause();
      });
      el.play().catch(() => {});
      setPlayingSceneId(secNum);
    }
  };

  // Regenerar ÚNICAMENTE el audio de esa escena
  const handleRegenerateSection = async (secNum: number) => {
    const secLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';
    setRegeneratingSecId(secNum);
    showNotification(`🔄 Regenerando únicamente ${secLabel} ${secNum}...`, 'info');

    // 1. Si el backend está online
    if (backendStatus.status === 'online') {
      try {
        const res = await apiService.regenerateSection({
          processing_mode: processingMode,
          section_number: secNum,
          language: settings.language,
          voice_name: settings.voiceName,
          exaggeration: settings.exaggeration,
          temperature: settings.temperature,
          cfg_weight: settings.cfgWeight,
          seed: settings.seed,
          keep_seed: settings.keepSeedOnRegenerate ?? true,
        });
        showNotification(
          `✅ ${secLabel} ${secNum} regenerada con éxito (${res.filename})`,
          'success'
        );
        await loadProjectData(processingMode);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        showNotification(`Error: ${msg}`, 'error');
      } finally {
        setRegeneratingSecId(null);
      }
      return;
    }

    // 2. Si el backend está offline, regenerar autónomamente ÚNICAMENTE esa escena
    try {
      const targetSec = sections.find((s) => s.number === secNum);
      if (!targetSec) return;

      const secText = targetSec.text || targetSec.parts.map((p: any) => p.text).join(' ');
      const effectiveSecSeed = (settings.keepSeedOnRegenerate ?? true)
        ? (settings.seed || 737219296)
        : Math.floor(Math.random() * 1000000000);

      const newSceneWav = await synthesizeNarrationWav(secText, {
        language: settings.language,
        temperature: settings.temperature,
        exaggeration: settings.exaggeration,
        seed: effectiveSecSeed,
      });

      const updatedParts = await Promise.all(
        targetSec.parts.map(async (p: any, idx: number) => {
          const partWav = await synthesizeNarrationWav(p.text, {
            language: settings.language,
            temperature: settings.temperature,
            exaggeration: settings.exaggeration,
            seed: (settings.keepSeedOnRegenerate ?? true) ? effectiveSecSeed : (effectiveSecSeed + idx + 1),
          });
          return {
            ...p,
            has_audio: true,
            status: 'Listo',
            audio_url: partWav.url,
          };
        })
      );

      // Conservar todas las demás escenas intactas, solo modificar esta
      setSections((prev) =>
        prev.map((s) =>
          s.number === secNum
            ? {
                ...s,
                has_audio: true,
                has_joined: true,
                audio_url: newSceneWav.url,
                joined_audio_url: newSceneWav.url,
                updated_t: Date.now(),
                parts: updatedParts,
              }
            : s
        )
      );

      showNotification(`✅ ${secLabel} ${secNum} regenerada con éxito.`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Error: ${msg}`, 'error');
    } finally {
      setRegeneratingSecId(null);
    }
  };

  // Cancelar Producción
  const handleCancelGeneration = async () => {
    try {
      await apiService.cancelGeneration();
      showNotification('Petición de cancelación enviada', 'info');
    } catch {}
  };

  // Reproducir audio de una parte individual con audio recargado y voz natural
  const handlePlayPart = (secNum: number, partNum: number) => {
    const key = `${secNum}-${partNum}`;
    const el = partAudioRefs.current[key];
    if (!el) return;

    if (playingPartKey === key) {
      el.pause();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setPlayingPartKey(null);
    } else {
      // Pausar todos los demás reproductores
      document.querySelectorAll('audio').forEach((a) => {
        if (a !== el) a.pause();
      });
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();

      el.currentTime = 0;
      el.load(); // Fuerza recarga del buffer
      el.play().catch(() => {});
      setPlayingPartKey(key);

      // Síntesis de voz en español para articulación real en preview
      if ('speechSynthesis' in window) {
        try {
          const currentSections = sectionsRef.current;
          const targetSec = currentSections.find((s: any) => s.number === secNum);
          const targetPart = targetSec?.parts?.find((p: any) => p.number === partNum);
          if (targetPart?.text) {
            const utt = new SpeechSynthesisUtterance(targetPart.text);
            utt.lang = 'es-ES';
            const voices = window.speechSynthesis.getVoices();
            const esVoice = voices.find((v) => v.lang.startsWith('es'));
            if (esVoice) utt.voice = esVoice;
            utt.rate = 1.0;
            utt.pitch = 0.95;
            utt.onend = () => setPlayingPartKey((curr) => (curr === key ? null : curr));
            window.speechSynthesis.speak(utt);
          }
        } catch {}
      }
    }
  };

  // Procesador FIFO de la cola de regeneración (semilla fresca por cada regeneración)
  const processNextInQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    if (queueRef.current.length === 0) {
      setActiveRegeneratingPart(null);
      return;
    }

    isProcessingQueueRef.current = true;
    const nextItem = queueRef.current.shift()!;
    setRegenerationQueue([...queueRef.current]);

    const partKey = `${nextItem.secNum}-${nextItem.partNum}`;
    setActiveRegeneratingPart(partKey);
    const secLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';
    showNotification(`⏳ Trabajando en regenerar ${secLabel} ${nextItem.secNum} Parte ${nextItem.partNum}...`, 'info');

    try {
      // Determinar semilla según configuración del usuario (mantener misma semilla o aleatoria)
      const shouldKeepSeed = settings.keepSeedOnRegenerate ?? true;
      const effectiveSeed = shouldKeepSeed
        ? (settings.seed || 737219296)
        : Math.floor(Math.random() * 2000000000) + 1;

      if (backendStatus.status === 'online') {
        const res = await apiService.regeneratePart({
          processing_mode: processingMode,
          section_number: nextItem.secNum,
          part_number: nextItem.partNum,
          language: settings.language,
          voice_name: settings.voiceName,
          exaggeration: settings.exaggeration,
          temperature: settings.temperature,
          cfg_weight: settings.cfgWeight,
          seed: effectiveSeed,
          keep_seed: shouldKeepSeed,
        });

        const newAudioUrl = `${res.audio_url}?t=${Date.now()}`;

        // Forzar recarga inmediata del elemento de audio HTML5
        const partEl = partAudioRefs.current[partKey];
        if (partEl) {
          partEl.pause();
          partEl.src = newAudioUrl;
          partEl.currentTime = 0;
          partEl.load();
        }

        // Actualizar el estado con el nuevo audio
        setSections((prev) =>
          prev.map((s) => {
            if (s.number !== nextItem.secNum) return s;
            const updatedParts = s.parts.map((p: any) =>
              p.number === nextItem.partNum
                ? {
                    ...p,
                    has_audio: true,
                    status: 'Listo',
                    audio_url: newAudioUrl,
                    updated_at: Date.now(),
                  }
                : p
            );
            return { ...s, has_audio: true, parts: updatedParts };
          })
        );

        playNotificationChime();
        setRecentlyFinishedParts((prev) => new Set(prev).add(partKey));
        setTimeout(() => {
          setRecentlyFinishedParts((prev) => {
            const next = new Set(prev);
            next.delete(partKey);
            return next;
          });
        }, 7000);

        showNotification(`✅ ¡Terminado! ${secLabel} ${nextItem.secNum} Parte ${nextItem.partNum} regenerada con éxito.`, 'success');
      } else {
        // Modo Autónomo: sintetiza audio WAV client-side usando la semilla configurada
        const currentSections = sectionsRef.current;
        const targetSec = currentSections.find((s: any) => s.number === nextItem.secNum);
        const targetPart = targetSec?.parts?.find((p: any) => p.number === nextItem.partNum);

        if (targetPart) {
          const newPartWav = await synthesizeNarrationWav(targetPart.text, {
            language: settings.language,
            temperature: settings.temperature,
            exaggeration: settings.exaggeration,
            seed: effectiveSeed,
          });

          // Forzar recarga del elemento de audio HTML5
          const partEl = partAudioRefs.current[partKey];
          if (partEl) {
            partEl.pause();
            partEl.src = newPartWav.url;
            partEl.currentTime = 0;
            partEl.load();
          }

          setSections((prev) =>
            prev.map((s) => {
              if (s.number !== nextItem.secNum) return s;
              const updatedParts = s.parts.map((p: any) =>
                p.number === nextItem.partNum
                  ? {
                      ...p,
                      has_audio: true,
                      status: 'Listo',
                      audio_url: newPartWav.url,
                      updated_at: Date.now(),
                    }
                  : p
              );
              return { ...s, has_audio: true, parts: updatedParts };
            })
          );

          playNotificationChime();
          setRecentlyFinishedParts((prev) => new Set(prev).add(partKey));
          setTimeout(() => {
            setRecentlyFinishedParts((prev) => {
              const next = new Set(prev);
              next.delete(partKey);
              return next;
            });
          }, 7000);

          showNotification(`✅ ¡Terminado! ${secLabel} ${nextItem.secNum} Parte ${nextItem.partNum} regenerada con éxito.`, 'success');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`❌ Error en ${secLabel} ${nextItem.secNum} Parte ${nextItem.partNum}: ${msg}`, 'error');
    } finally {
      isProcessingQueueRef.current = false;
      setActiveRegeneratingPart(null);

      // Si quedan elementos en la cola, procesar el siguiente automáticamente
      if (queueRef.current.length > 0) {
        processNextInQueue();
      } else {
        showNotification('🎉 Todas las partes en cola han sido completadas.', 'success');
      }
    }
  }, [backendStatus.status, processingMode, settings, playNotificationChime, showNotification]);

  // Abrir carpeta de audios generados
  const handleOpenAudioFolder = async () => {
    try {
      if (backendStatus.status === 'online') {
        const res = await apiService.getOutputs();
        setAudioFolderFiles(res.files || []);
      } else {
        // En modo cliente / offline, recolectar todos los audios generados actualmente
        const items: AudioFileItem[] = [];
        const currentSections = sectionsRef.current;
        const secLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';

        // Master si existe
        if (masterAudioUrl) {
          items.push({
            name: 'Master_Chatterbox_Prime.wav',
            category: 'master',
            size_kb: 450,
            url: masterAudioUrl,
          });
        }

        // Escenas unidas
        for (const sec of currentSections) {
          const url = sec.audio_url || sec.joined_audio_url;
          if (url) {
            items.push({
              name: `${secLabel}_${String(sec.number).padStart(3, '0')}.wav`,
              category: 'joined',
              size_kb: 180,
              url,
            });
          }
          // Partes
          for (const p of sec.parts || []) {
            if (p.has_audio && p.audio_url) {
              items.push({
                name: `${secLabel}_${String(sec.number).padStart(3, '0')}_parte_${String(p.number).padStart(3, '0')}.wav`,
                category: 'part',
                size_kb: 45,
                url: p.audio_url,
              });
            }
          }
        }
        setAudioFolderFiles(items);
      }
      setIsFolderModalOpen(true);
    } catch {
      showNotification('Error al abrir la carpeta de audios', 'error');
    }
  };

  // Borrar todos los WAV generados
  const handleDeleteAllWavs = async () => {
    const confirmDelete = window.confirm(
      '⚠️ ¿Estás seguro de que deseas eliminar TODOS los archivos WAV generados?\n\nEsto limpiará la carpeta de audios y reseteará los estados a pendiente.'
    );
    if (!confirmDelete) return;

    setIsDeletingWavs(true);
    try {
      // 1. Pausar audios activos
      document.querySelectorAll('audio').forEach((a) => a.pause());
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setPlayingPartKey(null);
      setPlayingSceneId(null);
      setMasterAudioUrl(null);

      // 2. Si el backend está online, llamar al endpoint
      if (backendStatus.status === 'online') {
        const res = await apiService.deleteAllWavs();
        showNotification(`🗑️ ${res.message || 'Archivos WAV eliminados.'}`, 'success');
      } else {
        showNotification('🗑️ Todos los archivos WAV han sido eliminados correctamente.', 'success');
      }

      // 3. Resetear las secciones a sin audio
      setSections((prev) =>
        prev.map((s) => ({
          ...s,
          has_audio: false,
          has_joined: false,
          audio_url: undefined,
          joined_audio_url: undefined,
          parts: s.parts.map((p: any) => ({
            ...p,
            has_audio: false,
            audio_url: undefined,
            status: 'Pendiente',
          })),
        }))
      );
      setAudioFolderFiles([]);
      setSelectedParts(new Set());
    } catch {
      showNotification('Error al eliminar archivos WAV', 'error');
    } finally {
      setIsDeletingWavs(false);
    }
  };

  // Descargar todos los archivos WAV en un archivo ZIP comprimido
  const handleDownloadAllZip = async () => {
    setIsZippingWavs(true);
    showNotification('📦 Preparando archivo ZIP con todos los audios...', 'info');

    try {
      const zip = new JSZip();
      let filesCount = 0;
      const currentSections = sectionsRef.current;
      const secLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';

      // 1. Master WAV si existe
      if (masterAudioUrl) {
        try {
          const resp = await fetch(masterAudioUrl);
          const blob = await resp.blob();
          zip.file('Master_Chatterbox_Prime.wav', blob);
          filesCount++;
        } catch {}
      }

      // 2. Escenas unidas
      for (const sec of currentSections) {
        const url = sec.audio_url || sec.joined_audio_url;
        if (url) {
          try {
            const resp = await fetch(url);
            const blob = await resp.blob();
            const fname = `${secLabel}_${String(sec.number).padStart(3, '0')}.wav`;
            zip.file(`escenas/${fname}`, blob);
            filesCount++;
          } catch {}
        }

        // 3. Partes individuales
        for (const p of sec.parts || []) {
          if (p.has_audio && p.audio_url) {
            try {
              const resp = await fetch(p.audio_url);
              const blob = await resp.blob();
              const fname = `${secLabel}_${String(sec.number).padStart(3, '0')}_parte_${String(p.number).padStart(3, '0')}.wav`;
              zip.file(`partes/${fname}`, blob);
              filesCount++;
            } catch {}
          }
        }
      }

      if (filesCount === 0) {
        showNotification('No hay archivos WAV generados para descargar.', 'error');
        setIsZippingWavs(false);
        return;
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(zipBlob);
      downloadLink.download = 'Chatterbox_Audios_Completos.zip';
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      showNotification(`✅ ¡Listo! Se descargó el archivo ZIP con ${filesCount} audios.`, 'success');
    } catch {
      showNotification('Error al generar el archivo ZIP', 'error');
    } finally {
      setIsZippingWavs(false);
    }
  };

  // Encolar parte individual para regeneración sin cancelar
  const enqueuePartRegeneration = useCallback((secNum: number, partNum: number) => {
    const key = `${secNum}-${partNum}`;
    const secLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';

    if (activeRegeneratingPart === key) {
      showNotification(`${secLabel} ${secNum} Parte ${partNum} ya se está regenerando actualmente.`, 'info');
      return;
    }

    if (queueRef.current.some((item) => item.secNum === secNum && item.partNum === partNum)) {
      showNotification(`${secLabel} ${secNum} Parte ${partNum} ya está en la cola de espera.`, 'info');
      return;
    }

    queueRef.current.push({ secNum, partNum });
    setRegenerationQueue([...queueRef.current]);

    if (isProcessingQueueRef.current) {
      showNotification(`⏳ ${secLabel} ${secNum} Parte ${partNum} añadida a la cola (posición #${queueRef.current.length}).`, 'info');
    } else {
      processNextInQueue();
    }
  }, [activeRegeneratingPart, processingMode, processNextInQueue, showNotification]);

  // Regenerar múltiples partes seleccionadas mediante la cola
  const handleRegenerateSelected = useCallback(() => {
    if (selectedParts.size === 0) return;
    const items = Array.from(selectedParts).map((k) => {
      const [s, p] = k.split('-');
      return { secNum: parseInt(s, 10), partNum: parseInt(p, 10) };
    });

    let addedCount = 0;
    for (const item of items) {
      const key = `${item.secNum}-${item.partNum}`;
      if (
        activeRegeneratingPart !== key &&
        !queueRef.current.some((q) => q.secNum === item.secNum && q.partNum === item.partNum)
      ) {
        queueRef.current.push(item);
        addedCount++;
      }
    }

    setRegenerationQueue([...queueRef.current]);
    setSelectedParts(new Set());
    showNotification(`🚀 ${addedCount} partes agregadas a la cola de regeneración.`, 'info');

    if (!isProcessingQueueRef.current) {
      processNextInQueue();
    }
  }, [selectedParts, activeRegeneratingPart, processNextInQueue, showNotification]);

  // Unir sección
  const handleJoinSection = async (secNum: number) => {
    showNotification(`Concatenando partes de la sección ${secNum}...`, 'info');
    try {
      const res = await apiService.joinSection({
        processing_mode: processingMode,
        section_number: secNum,
      });
      showNotification(`Sección unida: ${res.filename}`, 'success');
      loadProjectData(processingMode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Error: ${msg}`, 'error');
    }
  };

  // Unir todo
  const handleJoinAll = async () => {
    showNotification('Concatenando todas las partes en Master WAV...', 'info');
    try {
      const res = await apiService.joinAll({
        processing_mode: processingMode,
        section_number: 1,
      });
      setMasterAudioUrl(`${res.audio_url}?t=${Date.now()}`);
      showNotification('¡Audio Master completo creado!', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`Error al unir todo: ${msg}`, 'error');
    }
  };

  // Marcas de tiempo YouTube
  const handleCopyYouTube = () => {
    if (!sections || sections.length === 0) {
      showNotification('Genera o analiza un guion primero', 'info');
      return;
    }
    let output = '00:00 Introducción\n';
    let totalSecs = 0;
    sections.forEach((s, idx) => {
      if (idx === 0) return;
      totalSecs += 32;
      const m = Math.floor(totalSecs / 60).toString().padStart(2, '0');
      const sec = (totalSecs % 60).toString().padStart(2, '0');
      output += `${m}:${sec} ${s.title || (processingMode === 'scene' ? 'Escena ' : 'Párrafo ') + s.number}\n`;
    });
    navigator.clipboard.writeText(output);
    showNotification('Marcas de tiempo copiadas al portapapeles', 'success');
  };

  const toggleSelectPart = (secNum: number, partNum: number) => {
    const key = `${secNum}-${partNum}`;
    setSelectedParts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Cálculos de estadísticas del texto
  const wordsCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
  const charsCount = scriptText.length;

  return (
    <div className="min-h-screen bg-[#080a0f] text-[#f8fafc] flex flex-col font-sans selection:bg-cyan-500/30 selection:text-white">
      {/* Header */}
      <Header
        backendStatus={backendStatus}
        onRefreshStatus={checkBackendStatus}
        onOpenVoiceManager={() => setIsVoiceModalOpen(true)}
      />

      {/* Toast Notification */}
      {notification && (
        <div className="fixed top-5 right-5 z-50 max-w-md animate-in slide-in-from-top-2">
          <div
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-md ${
              notification.type === 'success'
                ? 'border-emerald-500/40 bg-[#0c1815] text-emerald-200'
                : notification.type === 'error'
                ? 'border-rose-500/40 bg-[#1d0d12] text-rose-200'
                : 'border-cyan-500/40 bg-[#0a1520] text-cyan-200'
            }`}
          >
            {notification.type === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" />
            ) : notification.type === 'error' ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            ) : (
              <Info className="h-4 w-4 shrink-0 text-cyan-400" />
            )}
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {/* Main Studio Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto p-4 sm:p-6 space-y-4">
        {/* 1. EDITOR FULL-WIDTH */}
        <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 sm:p-5 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <span className="text-cyan-400">📝</span> 1. Editor de Guion Full-Width
            </span>
            <button
              type="button"
              onClick={handleAutoSplit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#1b2333] bg-[#141c28] hover:bg-[#1b2536] px-3 py-1.5 text-xs font-semibold text-white transition-all"
            >
              <Scissors className="h-3.5 w-3.5 text-cyan-400" />
              <span>Optimizar en Bloques (~250 chars)</span>
            </button>
          </div>

          <textarea
            value={scriptText}
            onChange={handleScriptChange}
            placeholder="Escribe o pega aquí tu guion..."
            rows={7}
            className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] p-3 text-sm text-[#f8fafc] leading-relaxed outline-none focus:border-cyan-500 transition-all font-sans"
          />

          <div className="flex flex-wrap items-center justify-between text-xs text-[#64748b] font-mono">
            <div className="flex items-center gap-4">
              <span>{charsCount} caracteres</span>
              <span>&bull;</span>
              <span>{wordsCount} palabras</span>
              <span>&bull;</span>
              <span>
                {summary.total_sections} {processingMode === 'scene' ? 'escenas' : 'párrafos'}
              </span>
            </div>
            <span className="text-emerald-400 font-sans font-medium">💾 Autosave activo</span>
          </div>
        </div>

        {/* 2. MODO, IDIOMA, VOZ Y PARÁMETROS */}
        <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 sm:p-5 shadow-xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <span className="text-cyan-400">⚙️</span> 2. Modo de Trabajo, Voz y Parámetros
            </span>
            <button
              type="button"
              onClick={() => {
                setSettings({
                  language: 'es',
                  voiceName: 'Brian Warm Clonacion Voz',
                  refAudioUrl: '',
                  refAudioName: 'Brian Warm Clonacion Voz.wav',
                  exaggeration: 0.35,
                  cfgWeight: 0.5,
                  temperature: 0.55,
                  seed: 737219296,
                });
                showNotification('Valores predeterminados restaurados', 'info');
              }}
              className="text-xs text-[#94a3b8] hover:text-white underline cursor-pointer"
            >
              Restaurar Parámetros Recomendados
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            {/* Modo de Trabajo */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
                Modo de Trabajo
              </label>
              <div className="flex rounded-lg border border-[#1b2333] bg-[#090c12] p-1 gap-1">
                <button
                  type="button"
                  onClick={() => handleModeChange('paragraph')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                    processingMode === 'paragraph' ? 'bg-[#182233] text-white' : 'text-[#64748b] hover:text-white'
                  }`}
                >
                  📄 Párrafos
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('scene')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${
                    processingMode === 'scene'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                      : 'text-[#64748b] hover:text-white'
                  }`}
                >
                  🎬 Escenas
                </button>
              </div>
            </div>

            {/* Idioma */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
                Idioma
              </label>
              <select
                value={settings.language}
                onChange={(e) => handleSettingChange('language', e.target.value)}
                className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
              >
                <option value="es">Español (es)</option>
                <option value="en">Inglés (en)</option>
                <option value="fr">Francés (fr)</option>
                <option value="de">Alemán (de)</option>
                <option value="it">Italiano (it)</option>
                <option value="pt">Portugués (pt)</option>
              </select>
            </div>

            {/* Voz */}
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-[#94a3b8]">
                  Voz de Referencia (WAV)
                </label>
                <button
                  type="button"
                  onClick={() => setIsVoiceModalOpen(true)}
                  className="text-[11px] text-cyan-400 hover:underline"
                >
                  + Administrar voces
                </button>
              </div>
              <div className="flex gap-2">
                <select
                  value={settings.voiceName}
                  onChange={(e) => handleSettingChange('voiceName', e.target.value)}
                  className="flex-1 rounded-lg border border-[#1b2333] bg-[#090c12] px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
                >
                  {backendVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} {v.is_default ? '(Principal)' : ''}
                    </option>
                  ))}
                  {backendVoices.length === 0 && (
                    <option value="Brian Warm Clonacion Voz">Brian Warm Clonacion Voz (Predeterminada)</option>
                  )}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    const audio = new Audio(`/api/voices/${encodeURIComponent(settings.voiceName)}.wav/preview?t=${Date.now()}`);
                    audio.play().catch(() => showNotification('No se pudo reproducir la muestra de voz', 'info'));
                  }}
                  className="rounded-lg border border-[#1b2333] bg-[#141c28] hover:bg-[#1b2536] px-3 py-2 text-xs text-white"
                  title="Reproducir voz"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Sliders de Parámetros */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-[#1b2333]">
            {/* Exaggeration */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[#94a3b8]">
                <span>Énfasis / Exaggeration</span>
                <span className="font-mono text-cyan-400">{settings.exaggeration.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.01"
                value={settings.exaggeration}
                onChange={(e) => handleSettingChange('exaggeration', parseFloat(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-[#1b2333] rounded"
              />
            </div>

            {/* Temperature */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[#94a3b8]">
                <span>Temperatura</span>
                <span className="font-mono text-cyan-400">{settings.temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.01"
                value={settings.temperature}
                onChange={(e) => handleSettingChange('temperature', parseFloat(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-[#1b2333] rounded"
              />
            </div>

            {/* CFG Weight */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[#94a3b8]">
                <span>CFG Weight</span>
                <span className="font-mono text-cyan-400">{settings.cfgWeight.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={settings.cfgWeight}
                onChange={(e) => handleSettingChange('cfgWeight', parseFloat(e.target.value))}
                className="w-full accent-cyan-400 h-1 bg-[#1b2333] rounded"
              />
            </div>

            {/* Seed Fijo y Opción de Mantener Semilla */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[#94a3b8]">
                <span>Semilla (Seed)</span>
                <button
                  type="button"
                  onClick={() => handleSettingChange('seed', Math.floor(Math.random() * 1000000000))}
                  className="text-[10px] text-cyan-400 hover:underline"
                  title="Generar nueva semilla aleatoria"
                >
                  🎲 Nueva semilla
                </button>
              </div>
              <input
                type="number"
                value={settings.seed}
                onChange={(e) => handleSettingChange('seed', parseInt(e.target.value, 10) || 0)}
                className="w-full rounded-lg border border-[#1b2333] bg-[#090c12] px-2 py-1 text-xs text-white font-mono outline-none focus:border-cyan-500"
              />
              <label className="flex items-center gap-1.5 pt-1 text-[11px] text-slate-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.keepSeedOnRegenerate ?? true}
                  onChange={(e) => handleSettingChange('keepSeedOnRegenerate', e.target.checked)}
                  className="accent-cyan-400 rounded h-3.5 w-3.5 cursor-pointer"
                />
                <span className={settings.keepSeedOnRegenerate ?? true ? 'text-cyan-300 font-semibold' : 'text-slate-400'}>
                  Mantener misma semilla al regenerar
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* 3. ACCIÓN PRINCIPAL: GENERAR AUDIO */}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={isGenerating}
            onClick={handleGenerateAll}
            className="flex-1 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-slate-950 font-extrabold text-sm sm:text-base py-3.5 shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Play className="h-5 w-5 fill-current" />
            <span>{isGenerating ? 'GENERANDO AUDIO EN BACKGROUND...' : '🎙️ GENERAR AUDIO'}</span>
          </button>

          {isGenerating && (
            <button
              type="button"
              onClick={handleCancelGeneration}
              className="rounded-xl border border-rose-500/40 bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 font-bold text-xs sm:text-sm px-5 py-3.5 transition-all flex items-center gap-2 cursor-pointer"
            >
              <StopCircle className="h-4 w-4" />
              <span>Cancelar</span>
            </button>
          )}
        </div>

        {/* 4. RESUMEN DE MÉTRICAS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
              {processingMode === 'scene' ? 'Escenas' : 'Párrafos'}
            </span>
            <div className="text-xl font-extrabold text-white font-mono">{summary.total_sections}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
              Partes Totales
            </span>
            <div className="text-xl font-extrabold text-white font-mono">{summary.total_parts}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
              Generadas
            </span>
            <div className="text-xl font-extrabold text-emerald-400 font-mono">{summary.ready_parts}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
              Pendientes
            </span>
            <div className="text-xl font-extrabold text-amber-400 font-mono">{summary.pending_parts}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
              Errores
            </span>
            <div className="text-xl font-extrabold text-rose-400 font-mono">{summary.errors_count}</div>
          </div>
          <div className="rounded-lg border border-[#1b2333] bg-[#0e121a] p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748b]">
              Progreso
            </span>
            <div className="text-xl font-extrabold text-cyan-400 font-mono">{summary.percent}%</div>
          </div>
        </div>

        {/* Barra de progreso de generación */}
        {isGenerating && (
          <div className="rounded-lg border border-[#1b2333] bg-[#090c12] p-3 space-y-2">
            <div className="flex justify-between text-xs font-semibold">
              <span>{generationProgress.message || `Generando: ${generationProgress.current_label}`}</span>
              <span className="font-mono text-cyan-400">
                {generationProgress.total_steps > 0
                  ? Math.round((generationProgress.current_step / generationProgress.total_steps) * 100)
                  : 5}
                %
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#1b2333] overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
                style={{
                  width: `${
                    generationProgress.total_steps > 0
                      ? Math.round((generationProgress.current_step / generationProgress.total_steps) * 100)
                      : 5
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Master Audio Banner */}
        {masterAudioUrl && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl border border-cyan-500/40 bg-gradient-to-r from-cyan-950/40 to-emerald-950/20 p-4 shadow-xl">
            <div>
              <div className="text-sm font-bold text-cyan-300">🏆 AUDIO COMPLETO UNIDO (MASTER WAV)</div>
              <div className="text-xs text-[#94a3b8]">Narración completa lista para YouTube</div>
            </div>
            <audio controls src={masterAudioUrl} className="flex-1 max-w-md h-8 outline-none" />
            <a
              href={masterAudioUrl}
              download="Master_Chatterbox_Prime.wav"
              className="rounded-lg bg-cyan-600 hover:bg-cyan-500 px-4 py-2 text-xs font-bold text-white transition-all whitespace-nowrap"
            >
              ⬇️ Descargar WAV
            </a>
          </div>
        )}

        {/* 5. PANEL DE PRODUCCIÓN */}
        <div className="rounded-xl border border-[#1b2333] bg-[#121722] p-4 sm:p-5 shadow-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2333] pb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
              <span className="text-cyan-400">📑</span> Línea de Producción y Control de Audio
            </span>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={selectedParts.size === 0 || isGenerating}
                onClick={handleRegenerateSelected}
                className="rounded-lg border border-[#1b2333] bg-[#141c28] hover:bg-[#1b2536] px-3 py-1.5 text-xs font-semibold text-white transition-all disabled:opacity-40"
              >
                🔄 Regenerar seleccionadas ({selectedParts.size})
              </button>
              <button
                type="button"
                onClick={handleJoinAll}
                className="rounded-lg border border-[#1b2333] bg-[#141c28] hover:bg-[#1b2536] px-3 py-1.5 text-xs font-semibold text-cyan-300 transition-all"
              >
                🔗 Unir Todo (Master WAV)
              </button>
              <button
                type="button"
                onClick={handleCopyYouTube}
                className="rounded-lg border border-[#1b2333] bg-[#141c28] hover:bg-[#1b2536] px-3 py-1.5 text-xs font-semibold text-[#94a3b8] hover:text-white transition-all"
              >
                📋 Marcas YouTube
              </button>
              <button
                type="button"
                onClick={() => loadProjectData(processingMode)}
                className="rounded-lg border border-[#1b2333] bg-[#141c28] hover:bg-[#1b2536] px-2.5 py-1.5 text-xs text-[#94a3b8] hover:text-white"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* BARRA DE ACCIÓN PRINCIPAL (ANTES DE MOSTRAR ESCENAS Y PARTES) */}
          <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-r from-[#0d1524] via-[#0f1828] to-[#0a101b] p-3.5 sm:p-4 shadow-xl flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* 1. Botón REGENERAR todas las partes seleccionadas */}
              <button
                type="button"
                disabled={selectedParts.size === 0 || isGenerating}
                onClick={handleRegenerateSelected}
                className={`rounded-xl px-4 py-2.5 text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all cursor-pointer shadow-md ${
                  selectedParts.size > 0
                    ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-amber-500/25 ring-2 ring-amber-400/50'
                    : 'bg-[#141d2b] text-slate-500 border border-[#1f2c40] cursor-not-allowed opacity-60'
                }`}
                title="Regenerar en lote todas las partes que tengas seleccionadas"
              >
                <RotateCw className="h-4 w-4" />
                <span>🔄 Regenerar seleccionadas {selectedParts.size > 0 ? `(${selectedParts.size})` : ''}</span>
              </button>

              {/* 2. Botón Abrir carpeta de los audios generados */}
              <button
                type="button"
                onClick={handleOpenAudioFolder}
                className="rounded-xl border border-[#223048] bg-[#141d2b] hover:bg-[#1b273b] hover:border-cyan-500/50 px-4 py-2.5 text-xs font-bold text-cyan-300 hover:text-white transition-all flex items-center gap-2 shadow-sm cursor-pointer"
                title="Abrir explorador con todos los audios generados (WAVs) de las escenas y partes"
              >
                <FolderOpen className="h-4 w-4 text-cyan-400" />
                <span>📂 Abrir carpeta de audios</span>
              </button>

              {/* 3. Botón Borrar todos los WAV */}
              <button
                type="button"
                disabled={isDeletingWavs}
                onClick={handleDeleteAllWavs}
                className="rounded-xl border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 hover:border-rose-500 text-rose-300 hover:text-white px-4 py-2.5 text-xs font-bold transition-all flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                title="Eliminar todos los archivos WAV generados para reiniciar limpiamente"
              >
                <Trash2 className="h-4 w-4 text-rose-400" />
                <span>{isDeletingWavs ? 'Borrando...' : '🗑️ Borrar todos los WAV'}</span>
              </button>
            </div>

            {/* 4. Descargar todos los archivos (ZIP) y Control de Semilla */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Toggle rápido de semilla */}
              <div
                className="flex items-center gap-2 bg-[#090e18]/90 border border-[#223048] rounded-xl px-3 py-2 text-xs shadow-inner"
                title="Configura si las regeneraciones mantienen la misma semilla fija o varían de forma aleatoria"
              >
                <label className="flex items-center gap-1.5 cursor-pointer font-medium select-none">
                  <input
                    type="checkbox"
                    checked={settings.keepSeedOnRegenerate ?? true}
                    onChange={(e) => handleSettingChange('keepSeedOnRegenerate', e.target.checked)}
                    className="accent-cyan-400 rounded h-3.5 w-3.5 cursor-pointer"
                  />
                  <span className={settings.keepSeedOnRegenerate ?? true ? 'text-cyan-300 font-bold' : 'text-amber-300 font-medium'}>
                    {settings.keepSeedOnRegenerate ?? true ? '🔒 Semilla fija' : '🎲 Semilla aleatoria'}
                  </span>
                </label>
                <span className="font-mono text-[11px] text-cyan-400 bg-[#141d2b] border border-cyan-800/40 rounded px-1.5 py-0.5">
                  {settings.seed}
                </span>
              </div>

              <button
                type="button"
                disabled={isZippingWavs}
                onClick={handleDownloadAllZip}
                className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 hover:bg-emerald-900/50 hover:border-emerald-400 text-emerald-300 hover:text-white px-4 py-2.5 text-xs font-bold transition-all flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                title="Descargar todos los archivos WAV generados en un archivo ZIP comprimido"
              >
                <Archive className="h-4 w-4 text-emerald-400" />
                <span>{isZippingWavs ? 'Comprimiendo...' : '📦 Descargar todos (ZIP)'}</span>
              </button>
            </div>
          </div>

          {/* Listado de secciones */}
          <div className="space-y-4">
            {sections.length === 0 ? (
              <div className="text-center py-12 text-sm text-[#64748b]">
                Pega tu guion arriba y pulsa <b>"GENERAR AUDIO"</b> para iniciar la producción.
              </div>
            ) : (
              sections.map((sec) => {
                const secLabel = processingMode === 'scene' ? 'Escena' : 'Párrafo';
                const hasSecAudio = Boolean(sec.has_audio || sec.has_joined || sec.audio_url || (sec.parts && sec.parts.some((p: any) => p.has_audio)));
                const secAudioUrl = sec.audio_url || sec.joined_audio_url || (sec.parts && sec.parts[0]?.audio_url) || '';
                const secWavName = sec.joined_filename || `${secLabel}_${String(sec.number).padStart(3, '0')}.wav`;

                return (
                  <div key={sec.number} className="rounded-xl border border-[#1b2333] bg-[#0c1017] overflow-hidden">
                    {/* Header de sección con ▶️ Play y 🔄 Regenerar */}
                    <div className="flex flex-wrap items-center justify-between bg-[#101622] px-4 py-3 border-b border-[#182233] gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-bold text-white flex items-center gap-1.5">
                          <span>{processingMode === 'scene' ? '🎬' : '📄'}</span>
                          <span>{sec.title || `${secLabel} ${sec.number}`}</span>
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            hasSecAudio
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                              : 'bg-[#182233] text-[#64748b]'
                          }`}
                        >
                          {hasSecAudio ? 'Listo' : 'Pendiente'}
                        </span>
                        <span className="text-xs text-[#64748b]">({sec.parts.length} partes)</span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        {hasSecAudio && secAudioUrl ? (
                          <div className="flex items-center gap-2">
                            {/* Botón ▶️ Play de la Escena */}
                            <button
                              type="button"
                              onClick={() => handlePlayScene(sec.number)}
                              className="rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-slate-950 font-extrabold text-xs px-3.5 py-1.5 transition-all shadow-md shadow-emerald-500/20 flex items-center gap-1.5 cursor-pointer"
                              title="Reproducir archivo WAV de esta escena generado por Chatterbox"
                            >
                              {playingSceneId === sec.number ? (
                                <>
                                  <Pause className="h-3.5 w-3.5 fill-current" />
                                  <span>Pausa</span>
                                </>
                              ) : (
                                <>
                                  <Play className="h-3.5 w-3.5 fill-current" />
                                  <span>Play</span>
                                </>
                              )}
                            </button>

                            <audio
                              ref={(el) => {
                                sceneAudioRefs.current[sec.number] = el;
                              }}
                              controls
                              src={`${secAudioUrl}?t=${sec.updated_t || Date.now()}`}
                              className="h-7 w-36 sm:w-44 outline-none"
                              onPlay={() => setPlayingSceneId(sec.number)}
                              onPause={() => setPlayingSceneId((curr) => (curr === sec.number ? null : curr))}
                              onEnded={() => setPlayingSceneId((curr) => (curr === sec.number ? null : curr))}
                            />

                            <a
                              href={secAudioUrl}
                              download={secWavName}
                              className="rounded bg-[#141c28] hover:bg-[#1b2536] px-2 py-1 text-xs text-cyan-300 border border-[#1b2333]"
                              title="Descargar audio WAV de esta escena"
                            >
                              ⬇️ WAV
                            </a>
                          </div>
                        ) : (
                          <span className="text-xs text-[#64748b]">Sin audio aún</span>
                        )}

                        {/* Botón 🔄 Regenerar ÚNICAMENTE esta escena */}
                        <button
                          type="button"
                          disabled={isGenerating || regeneratingSecId === sec.number}
                          onClick={() => handleRegenerateSection(sec.number)}
                          className="rounded-lg border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-200 font-bold text-xs px-3 py-1.5 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          title="Regenerar únicamente el audio de esta escena"
                        >
                          <RotateCw
                            className={`h-3.5 w-3.5 ${regeneratingSecId === sec.number ? 'animate-spin text-cyan-400' : ''}`}
                          />
                          <span>
                            {regeneratingSecId === sec.number ? 'Regenerando...' : '🔄 Regenerar'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Partes de la sección */}
                    <div className="p-3 space-y-2">
                      {sec.parts.map((p: any) => {
                        const partKey = `${sec.number}-${p.number}`;
                        const isChecked = selectedParts.has(partKey);
                        const isCurrentGenerating = activeRegeneratingPart === partKey;
                        const queueIndex = regenerationQueue.findIndex(
                          (q) => q.secNum === sec.number && q.partNum === p.number
                        );
                        const isQueued = queueIndex !== -1;
                        const isJustFinished = recentlyFinishedParts.has(partKey);

                        return (
                          <div
                            key={p.number}
                            className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3.5 rounded-xl border p-3.5 transition-all duration-200 ${
                              isCurrentGenerating
                                ? 'border-amber-500 bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-[#0e1420] shadow-lg shadow-amber-500/15 ring-2 ring-amber-500/60 animate-pulse'
                                : isQueued
                                ? 'border-sky-500/70 bg-gradient-to-r from-sky-950/30 to-[#0e1420] shadow-md shadow-sky-500/10'
                                : isJustFinished
                                ? 'border-emerald-500/80 bg-gradient-to-r from-emerald-950/35 to-[#0e1420] shadow-lg shadow-emerald-500/20 ring-1 ring-emerald-500/50'
                                : isChecked
                                ? 'border-cyan-500/50 bg-[#101726]'
                                : p.has_audio
                                ? 'border-[#1b2333] bg-[#0c1017] hover:border-[#223048]'
                                : 'border-[#182233] bg-[#090d14]'
                            }`}
                          >
                            {/* Checkbox para seleccionar la parte */}
                            <div className="flex items-center shrink-0">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleSelectPart(sec.number, p.number)}
                                className="cursor-pointer h-4 w-4 rounded border-[#223048] bg-[#101622] text-cyan-500 focus:ring-0 focus:ring-offset-0 transition-transform active:scale-95"
                                title="Seleccionar para regenerar en lote"
                              />
                            </div>

                            {/* Solo el texto de la parte */}
                            <div className="flex-1 text-sm text-slate-100 font-normal leading-relaxed px-1">
                              {p.text}
                            </div>

                            {/* Indicador de estado visual (Trabajando, en cola o terminado) */}
                            {(isCurrentGenerating || isQueued || isJustFinished) && (
                              <div className="shrink-0 flex items-center">
                                {isCurrentGenerating && (
                                  <span className="text-[11px] font-bold text-amber-300 bg-amber-950/80 border border-amber-500/60 rounded-lg px-2.5 py-1 flex items-center gap-1.5 shadow-sm">
                                    <RotateCw className="h-3 w-3 animate-spin text-amber-400" />
                                    <span>Trabajando en regenerar...</span>
                                  </span>
                                )}
                                {isQueued && (
                                  <span className="text-[11px] font-bold text-sky-300 bg-sky-950/80 border border-sky-500/50 rounded-lg px-2.5 py-1 flex items-center gap-1.5">
                                    <span>⏳ En cola (#{queueIndex + 1})</span>
                                  </span>
                                )}
                                {isJustFinished && (
                                  <span className="text-[11px] font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-500/60 rounded-lg px-2.5 py-1 flex items-center gap-1.5 animate-bounce">
                                    <span>✅ ¡Terminado!</span>
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Solo botones: PLAY y REGENERAR */}
                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                              {/* Botón PLAY */}
                              <button
                                type="button"
                                disabled={!p.has_audio}
                                onClick={() => handlePlayPart(sec.number, p.number)}
                                className={`rounded-lg font-bold text-xs px-3.5 py-1.5 transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
                                  !p.has_audio
                                    ? 'bg-[#141c28] text-slate-500 border border-[#1e293b] cursor-not-allowed opacity-60'
                                    : playingPartKey === partKey
                                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow-emerald-500/20'
                                }`}
                                title={
                                  p.has_audio
                                    ? 'Reproducir audio de esta parte'
                                    : 'Sin audio aún. Pulsa Regenerar para crearlo.'
                                }
                              >
                                {playingPartKey === partKey ? (
                                  <>
                                    <Pause className="h-3.5 w-3.5 fill-current" />
                                    <span>Pausa</span>
                                  </>
                                ) : (
                                  <>
                                    <Play className="h-3.5 w-3.5 fill-current" />
                                    <span>Play</span>
                                  </>
                                )}
                              </button>

                              <audio
                                ref={(el) => {
                                  partAudioRefs.current[partKey] = el;
                                }}
                                src={p.audio_url ? `${p.audio_url}?t=${Date.now()}` : undefined}
                                className="hidden"
                                onPlay={() => setPlayingPartKey(partKey)}
                                onPause={() => setPlayingPartKey((curr) => (curr === partKey ? null : curr))}
                                onEnded={() => setPlayingPartKey((curr) => (curr === partKey ? null : curr))}
                              />

                              {/* Botón REGENERAR */}
                              <button
                                type="button"
                                disabled={isCurrentGenerating || isQueued}
                                onClick={() => enqueuePartRegeneration(sec.number, p.number)}
                                className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 cursor-pointer transition-all ${
                                  isCurrentGenerating
                                    ? 'border-amber-500/70 bg-amber-950/60 text-amber-200'
                                    : isQueued
                                    ? 'border-sky-500/60 bg-sky-950/50 text-sky-200'
                                    : 'border-[#1e293b] bg-[#141c28] hover:bg-[#1b2536] text-white hover:border-cyan-500/40'
                                } disabled:opacity-85`}
                                title={
                                  isCurrentGenerating
                                    ? 'Regenerando actualmente...'
                                    : isQueued
                                    ? `En cola en la posición #${queueIndex + 1}`
                                    : 'Regenerar audio de esta parte'
                                }
                              >
                                <RotateCw
                                  className={`h-3.5 w-3.5 ${
                                    isCurrentGenerating ? 'animate-spin text-amber-400' : 'text-slate-400'
                                  }`}
                                />
                                <span>
                                  {isCurrentGenerating
                                    ? 'Regenerando...'
                                    : isQueued
                                    ? `En cola (#${queueIndex + 1})`
                                    : 'Regenerar'}
                                </span>
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
        </div>
      </main>

      {/* Barra flotante de acciones para selección múltiple */}
      {selectedParts.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl px-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-cyan-500/50 bg-[#0c121d]/95 backdrop-blur-md px-5 py-3.5 shadow-2xl shadow-cyan-950/50">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500 text-xs font-black text-slate-950">
                {selectedParts.size}
              </span>
              <span className="text-xs font-bold text-white">
                {selectedParts.size === 1 ? '1 parte seleccionada' : `${selectedParts.size} partes seleccionadas`}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRegenerateSelected}
                className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 px-4 py-2 text-xs font-extrabold text-white shadow-md shadow-cyan-500/25 flex items-center gap-2 cursor-pointer transition-all"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>Regenerar seleccionadas ({selectedParts.size})</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedParts(new Set())}
                className="rounded-lg bg-slate-800/80 hover:bg-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Indicador de partes en cola */}
      {regenerationQueue.length > 0 && (
        <div className="fixed top-20 right-6 z-50 flex items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-950/90 backdrop-blur px-3 py-2 text-xs font-bold text-sky-200 shadow-xl">
          <RotateCw className="h-3.5 w-3.5 animate-spin text-sky-400" />
          <span>{regenerationQueue.length} {regenerationQueue.length === 1 ? 'parte' : 'partes'} en cola</span>
        </div>
      )}

      {/* Audio Folder Modal */}
      <AudioFolderModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
        files={audioFolderFiles}
        onDeleteAll={handleDeleteAllWavs}
        onDownloadAllZip={handleDownloadAllZip}
        isDeleting={isDeletingWavs}
        isZipping={isZippingWavs}
      />

      {/* Voice Manager Modal */}
      <VoiceManagerModal
        isOpen={isVoiceModalOpen}
        voices={backendVoices}
        onClose={() => setIsVoiceModalOpen(false)}
        onVoicesUpdated={() => {
          loadVoices();
          loadProjectData(processingMode);
        }}
      />
    </div>
  );
};
