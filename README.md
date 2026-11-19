# Qwen3Prime

Estudio local de narración documental y clonación de voz con interfaz web para **Windows 11**, impulsado por el motor oficial **Qwen3-TTS (`qwen-tts`)** y diseñado para producir locuciones largas (25 a 40+ minutos) de forma estable, recuperable y sin pérdida de calidad.

---

## Características principales

- **Clonación de voz 100 % local con Qwen3-TTS:** Compatible con `Qwen/Qwen3-TTS-12Hz-1.7B-Base` (máxima fidelidad) y `Qwen/Qwen3-TTS-12Hz-0.6B-Base` (ligero para CPU), reutilizando el `voice_clone_prompt` cacheado en memoria y disco (`voices/prompt_cache/`).
- **Soporte para los 10 idiomas nativos de Qwen3-TTS** (Español por defecto, Inglés, Portugués, Francés, Italiano, Alemán, Ruso, Japonés, Coreano y Chino).
- **Segmentación por Escenas o Párrafos:** Detecta encabezados (`ESCENA 1 — INTRODUCCIÓN`, etc.) o divide por párrafos respetando oraciones y palabras completas sin cortes bruscos.
- **Normalización inteligente para español:** Convierte internamente números, años, decimales, porcentajes y divisas antes de sintetizar sin modificar el texto visible de tu guion.
- **Recuperación exacta por hash SHA-256:** Cada segmento guarda su estado en disco tras generarse; si ocurre un corte o editas una frase, solo se marcan como *Desactualizadas* las partes afectadas y puedes reanudar desde la primera pendiente.
- **Limpieza automática de artefactos ICL:** Acondiciona una copia temporal del audio de referencia (sin modificar nunca el `.wav` original) y elimina ecos/sílabas iniciales aisladas antes de ensamblar.
- **Ensamblado sin pérdida y exportación de escenas completas:** Une automáticamente cada escena o párrafo en `.wav` PCM 16-bit con pausas configurables, genera el **Master WAV** completo y exporta un `.zip` con las escenas completas + master + guion.
- **Múltiples proyectos independientes:** Cada vídeo vive aislado en su carpeta dentro de `projects/<id>/`.
- **Arranque local seguro y tolerante a puertos ocupados:** Corre únicamente en `127.0.0.1` y, si el puerto `8000` está ocupado (`WinError 10048`), selecciona automáticamente el siguiente puerto libre (`8001`–`8019`).

---

## Requisitos del sistema

- **Sistema operativo:** Windows 11 (64 bits).
- **Python:** **Python 3.12** (64 bits, recomendado; compatible con 3.10–3.12).
- **Almacenamiento libre:** Al menos **10–15 GB** recomendados para `.venv`, caché de Hugging Face y archivos WAV.
- **Node.js (opcional):** Solo necesario si deseas modificar/recompilar la interfaz React/Vite; el instalador la compila automáticamente si `dist/` no existe y `npm` está disponible.
- **Internet:** Solo necesario durante la instalación y la primera descarga automática de los modelos Qwen3-TTS desde Hugging Face.

### Perfiles de hardware recomendados

| Perfil de hardware | Modo PyTorch | Precisión / Atención | Modelo recomendado |
| :--- | :--- | :--- | :--- |
| **Sin GPU dedicada (ej. Ryzen 5 5600G, 16 GB RAM)** | CPU | `float32` + `sdpa` | **`Qwen/Qwen3-TTS-12Hz-0.6B-Base`** (más ágil en CPU; `1.7B-Base` funciona pero es más lento) |
| **GPU NVIDIA CUDA (ej. RTX 30xx / 40xx / 5060)** | CUDA (`cu128`) | `bfloat16` + `sdpa` / `flash_attention_2` | **`Qwen/Qwen3-TTS-12Hz-1.7B-Base`** (máxima fidelidad y velocidad en GPU) |

---

## Instalación rápida (Windows 11)

1. Clona este repositorio o descárgalo como ZIP:
   ```bat
   git clone <URL_DE_TU_REPOSITORIO>
   cd Qwen3Prime
   ```
2. Haz doble clic en **`install.bat`**:
   - Detecta automáticamente Python 3.12 (o te ofrece instalarlo con `py install 3.12`).
   - Crea el entorno virtual aislado en `.venv\`.
   - Detecta si tienes GPU NVIDIA (`nvidia-smi`) para instalar PyTorch con **CUDA 12.8** o versión **CPU**.
   - Instala `qwen-tts`, `FastAPI`, `Uvicorn`, `soundfile`, `numpy`, `scipy` y `psutil`.
   - Compila el frontend en `dist\` si aún no existe y `npm` está disponible.
3. Coloca tu archivo de voz de referencia `.wav` (3–15 s, limpio, sin música) dentro de `voices\` (o súbelo desde la pestaña **Biblioteca de Voces**).

---

## Uso diario

Haz doble clic en **`Iniciar_Qwen3Prime.bat`**.

El servidor iniciará en `http://127.0.0.1:8000` (o en el siguiente puerto libre si el `8000` ya estuviera en uso) y abrirá automáticamente tu navegador.

### Flujo de trabajo recomendado

1. **Biblioteca de Voces:**
   - Selecciona o sube tu archivo `.wav` (el archivo original nunca se modifica).
   - Escribe la **transcripción exacta (`ref_text`)** terminada en punto final y pulsa **Preparar y guardar prompt** (modo ICL de alta fidelidad).
   - Si no tienes transcripción o prefieres evitar cualquier posible eco inicial ICL, activa **Solo x-vector** (`x_vector_only_mode`).
2. **Editor de Guiones:**
   - Pega tu guion en **Modo Escenas** (`ESCENA 1 — ...`) o **Modo Párrafos** y ajusta la longitud objetivo por parte (por defecto `250` caracteres).
3. **Configuración Qwen3:**
   - Elige el modelo (`1.7B-Base` o `0.6B-Base`), dispositivo (`auto`, `cpu`, `cuda`), idioma, semilla, limpieza de artefacto inicial y pausas entre oraciones/partes/escenas.
4. **Producción de Audio:**
   - Pulsa **Generar Narración** (o **Continuar desde 1ª pendiente** tras cualquier pausa o edición).
   - Al completarse una escena se ensambla automáticamente para descargar la **Escena Completa (.wav)** directamente.
5. **Reproductor y Exportación Master:**
   - Ensambla y descarga el **Master WAV**, copia las marcas de tiempo para YouTube o exporta un **`.zip`** con todas las escenas completas y el Master.

---

## Estructura del proyecto

```text
Qwen3Prime/
├── backend/
│   ├── api/                # Endpoints REST (estado, voces, proyectos, producción, exportación)
│   ├── core/               # Segmentador, normalizador ES, hashing SHA-256, runner y proyectos
│   ├── engine/             # Carga Qwen3-TTS, clonación/caché de prompts y procesador WAV
│   ├── config.py           # Rutas, hardware, modelos soportados y selección de puerto libre
│   └── main.py             # Servidor FastAPI + archivos estáticos del frontend
├── src/                    # Interfaz web React + TypeScript + Tailwind CSS (Vite)
├── tests/                  # Pruebas unitarias en Python (unittest)
├── voices/                 # Carpeta local para archivos .wav de referencia (ignorados en Git)
├── install.bat             # Instalador independiente para Windows 11 (.venv + PyTorch + qwen-tts)
├── Iniciar_Qwen3Prime.bat  # Lanzador local en Windows 11
├── requirements.txt        # Dependencias Python
├── package.json            # Scripts y dependencias del frontend
└── README.md
```

---

## Desarrollo del frontend (opcional)

Si deseas editar la interfaz en `src/`:

```bash
npm install
npm run dev       # Servidor de desarrollo Vite en http://127.0.0.1:3000
npm run lint      # Verificación de tipos TypeScript (tsc --noEmit)
npm run build     # Compila el frontend en dist/
```

---

## Pruebas automatizadas

Desde la raíz del proyecto:

```bat
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

En Linux/macOS:

```bash
python3 -m unittest discover -s tests -v
```

---

## Solución de problemas frecuentes

- **Error `[WinError 10048]` / Puerto 8000 ocupado:** Ocurre cuando quedó otra ventana previa del servidor abierta. `Qwen3Prime` detecta automáticamente el puerto ocupado y arranca en el siguiente disponible (`8001`, `8002`, etc.), o puedes cerrar las ventanas anteriores de Python.
- **El audio inicia con una sílaba residual (modo ICL):** Mantén activa la opción **Limpiar sílaba o eco inicial** en *Configuración Qwen3*, pulsa **Regenerar prompt** en *Biblioteca de Voces* y verifica que `ref_text` coincida exactamente con el audio y termine con punto final; como alternativa inmediata, activa **Solo x-vector** en la voz.
- **El navegador muestra servidor desconectado:** Verifica que la ventana de consola de `Iniciar_Qwen3Prime.bat` siga abierta sin errores.
- **Poca RAM disponible en CPU (16 GB) con el modelo 1.7B:** Usa el botón **Liberar memoria** en el Panel Principal o selecciona **`Qwen/Qwen3-TTS-12Hz-0.6B-Base`** para trabajar con mayor fluidez en CPU.
- **Error de descarga de Hugging Face:** Comprueba tu conexión a Internet la primera vez que cargas el modelo; una vez guardado en `%USERPROFILE%\.cache\huggingface`, funcionará sin conexión.
