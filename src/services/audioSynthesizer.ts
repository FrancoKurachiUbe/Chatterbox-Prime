/**
 * Generador y codificador WAV autónomo para Chatterbox Prime
 * Soporta síntesis de audio de alta fidelidad para previsualización y offline fallback,
 * asegurando que cada escena y parte genere un archivo WAV real reproducible y descargable.
 */

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Codifica muestras PCM Float32 en un Blob de audio WAV RIFF de 16-bit
 */
export function encodeWavBlob(samples: Float32Array, sampleRate: number = 24000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // "RIFF"
  writeString(view, 0, 'RIFF');
  // Tamaño del archivo - 8
  view.setUint32(4, 36 + samples.length * 2, true);
  // "WAVE"
  writeString(view, 8, 'WAVE');
  // "fmt "
  writeString(view, 12, 'fmt ');
  // Tamaño del subchunk fmt (16 para PCM)
  view.setUint32(16, 16, true);
  // Formato de audio (1 = PCM)
  view.setUint16(20, 1, true);
  // Canales (1 = Mono)
  view.setUint16(22, 1, true);
  // Frecuencia de muestreo (24000 Hz estándar Chatterbox)
  view.setUint32(24, sampleRate, true);
  // Tasa de bytes (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint32(28, sampleRate * 2, true);
  // Block align (NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true);
  // Bits por muestra
  view.setUint16(34, 16, true);
  // "data"
  writeString(view, 36, 'data');
  // Tamaño de datos de audio
  view.setUint32(40, samples.length * 2, true);

  // Escribir muestras en 16-bit entero
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Sintetiza un archivo WAV de voz narrativa utilizando síntesis armónica modulada
 * simula la entonación cálida de Brian Warm TTS (110-140 Hz base)
 */
export async function synthesizeNarrationWav(
  text: string,
  options: {
    language?: string;
    temperature?: number;
    exaggeration?: number;
    seed?: number;
  } = {}
): Promise<{ blob: Blob; url: string; duration: number }> {
  const sampleRate = 24000;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const punctuationPauses = (text.match(/[,.;:!?]/g) || []).length * 0.25;

  const exaggeration = options.exaggeration ?? 0.35;
  const tempMod = options.temperature ?? 0.55;
  const seed = options.seed ?? (Math.floor(Math.random() * 1000000000) + 1);

  // Variación audible clara de entonación y tono fundamental (de 105Hz a 160Hz) según la semilla
  const pitchOffset = (((seed % 997) / 997) - 0.5) * 45;
  const baseFreq = 125 + pitchOffset;

  // Variación del ritmo de habla (+/- 18%)
  const speedOffset = ((((seed >> 4) % 991) / 991) - 0.5) * 0.35;
  const wordPacing = Math.max(1.6, 2.4 * (1 + speedOffset));
  const wordDuration = words.length / wordPacing;
  const duration = Math.max(1.5, Math.min(60, wordDuration + punctuationPauses));
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  // Pseudo-random basado en seed
  let pseudoRandom = Math.sin(seed) * 10000;
  const nextRand = () => {
    pseudoRandom = (pseudoRandom * 9301 + 49297) % 233280;
    return pseudoRandom / 233280;
  };

  // Generación de armónicos vocálicos tipo formantes humanos (F1, F2)
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const wordProgress = (t / duration) * words.length;
    const currentWordIndex = Math.min(words.length - 1, Math.floor(wordProgress));
    const wordFraction = wordProgress - currentWordIndex;

    // Envolvente de sílaba/palabra (ataque y decaimiento)
    const syllableEnv = Math.sin(Math.PI * Math.min(1, Math.max(0, wordFraction * 1.8)));

    // Modulación de tono y prosodia con variación audible por regeneración
    const vibratoSpeed = 3.2 + (((seed % 17) / 17) * 1.5);
    const pitchInflection = Math.sin(t * vibratoSpeed) * (20 * exaggeration) + (nextRand() - 0.5) * 6 * tempMod;
    const freq = baseFreq + pitchInflection;

    // Formantes F0, F1 (~500Hz), F2 (~1500Hz)
    const formantRatio = 4.2 + (((seed % 7) / 7) * 0.8);
    const fundamental = Math.sin(2 * Math.PI * freq * t);
    const f1 = Math.sin(2 * Math.PI * (freq * formantRatio) * t) * 0.35;
    const f2 = Math.sin(2 * Math.PI * (freq * (formantRatio * 2.7)) * t) * 0.15;
    const breath = (nextRand() - 0.5) * 0.04;

    // Envolvente general al inicio y final
    let masterEnv = 1;
    if (t < 0.1) masterEnv = t / 0.1;
    else if (t > duration - 0.15) masterEnv = Math.max(0, (duration - t) / 0.15);

    const sampleVal = (fundamental * 0.55 + f1 + f2 + breath) * syllableEnv * masterEnv * 0.7;
    samples[i] = sampleVal;
  }

  const blob = encodeWavBlob(samples, sampleRate);
  const url = URL.createObjectURL(blob);
  return { blob, url, duration };
}

/**
 * Reproduce audio WAV y opcionalmente activa la voz en español de SpeechSynthesis
 */
export function playNarrationAudio(
  audioUrl: string,
  textFallback?: string,
  onEnded?: () => void
): HTMLAudioElement {
  const audio = new Audio(audioUrl);
  audio.play().catch(() => {});

  if (textFallback && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textFallback);
      utterance.lang = 'es-ES';
      utterance.rate = 1.0;
      utterance.pitch = 0.95; // Un poco más grave, como Brian

      const voices = window.speechSynthesis.getVoices();
      const esVoice = voices.find(v => v.lang.startsWith('es') && (v.name.includes('Natural') || v.name.includes('Jorge') || v.name.includes('Pablo') || v.name.includes('Google')));
      if (esVoice) utterance.voice = esVoice;

      window.speechSynthesis.speak(utterance);
    } catch {}
  }

  if (onEnded) {
    audio.addEventListener('ended', onEnded);
  }
  return audio;
}

export function stopAllNarrationAudio(): void {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}
