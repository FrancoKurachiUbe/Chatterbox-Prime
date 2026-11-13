# Chatterbox Prime — AI Narration Studio

Estudio profesional de producción de narraciones con IA para documentales, audiolibros y YouTube.  
Arquitectura unificada con **un solo servidor (FastAPI)** que sirve la interfaz web moderna, expone la **API REST**, procesa la síntesis de voz con **Chatterbox Multilingual TTS** (clonación de voz en CPU o GPU CUDA) y mantiene **Gradio** como interfaz alternativa.

---

## ✨ Características principales

- **División inteligente del guion:** Por escenas (`ESCENA 1 — Título`) o por párrafos.
- **Síntesis robusta para frases largas:** Segmentación automática por oraciones y recorte de silencios muertos para evitar cortes o pausas largas.
- **Clonación de voz local:** Sube o guarda muestras `.wav` en `voices/` y úsalas como referencia.
- **Regeneración flexible:** Regenera partes individuales, lotes seleccionados o escenas completas manteniendo la **semilla fija** (para conservar tono/estilo) o usando **semilla aleatoria**.
- **Ensamblado y exportación:** Une partes en escenas completas, escucha desde el navegador, explora los archivos generados, borra los `.wav` para reiniciar o descarga todo en un `.zip`.

---

## 📋 Requisitos previos

Antes de instalar, asegúrate de tener en tu PC:

1. **Python 3.10 o 3.11** (recomendado para compatibilidad con PyTorch y Chatterbox TTS).
2. **Git** (opcional, si clonas el repositorio desde terminal).
3. **Tarjeta gráfica NVIDIA con CUDA** *(opcional pero recomendada)*: funciona también en **CPU**, aunque la generación será más lenta.
4. **Node.js 18+** *(solo si deseas modificar/compilar el frontend React en `src/`)*. Para usar la aplicación normalmente **no necesitas Node.js**, ya que Python sirve directamente `templates/index.html`.

---

## 🚀 Instalación desde cero (Primera vez)

### 1. Descargar el proyecto
Clona el repositorio o descárgalo como ZIP desde GitHub y descomprímelo:

```bash
git clone https://github.com/TU_USUARIO/TU_REPOSITORIO.git
cd TU_REPOSITORIO
```

### 2. Crear y activar el entorno virtual de Python

**En Windows (CMD o PowerShell):**
```bash
python -m venv .venv
.venv\Scripts\activate
```

**En Linux / macOS:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Instalar PyTorch (CPU o GPU NVIDIA)
Elige **una** de las dos opciones según tu computadora:

- **Si tienes GPU NVIDIA (recomendado, más rápido):**
  ```bash
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
  ```
- **Si solo usarás CPU:**
  ```bash
  pip install torch torchaudio
  ```

### 4. Instalar dependencias del proyecto y Chatterbox TTS
```bash
pip install -r requirements.txt
```
*(Si `chatterbox-tts` requiere instalación directa desde su repositorio oficial, puedes instalarlo con `pip install git+https://github.com/resemble-ai/chatterbox.git`).*

> 💡 **Descarga del modelo:** La primera vez que presiones **Generar Audio**, el sistema descargará automáticamente los pesos de **Chatterbox Multilingual TTS** desde Hugging Face. Asegúrate de tener conexión a internet y espacio libre en disco (~3–5 GB).

---

## 🎙️ Configurar voces de referencia

1. Coloca tus archivos de voz de referencia (`.wav` limpio de 5 a 15 segundos) dentro de la carpeta `voices/`.
2. Si agregas el archivo `voices/Brian Warm Clonacion Voz.wav`, el sistema lo detectará automáticamente como voz predeterminada.
3. También puedes subir o eliminar voces directamente desde la interfaz web con el botón **Administrar Voces**.

---

## ▶️ Cómo iniciar la aplicación

### Opción A: Un solo clic en Windows
Haz doble clic en el lanzador incluido en la carpeta raíz:
```text
Iniciar_Chatterbox_Prime.bat
```
*(También puedes usar `Iniciar_Cronicas_Mundiales.bat` o `Iniciar_Cronicas_Mundiales.ps1`).*

El script detectará automáticamente tu entorno `.venv`, levantará el servidor en el puerto `8000` y te indicará la dirección para abrir en tu navegador:
- **Interfaz principal:** `http://localhost:8000`
- **Interfaz alternativa (Gradio):** `http://localhost:8000/gradio`

### Opción B: Desde la terminal (Windows / Linux / macOS)
Con tu entorno `.venv` activado:
```bash
python multilingual_app.py --port 8000
```
*Opciones adicionales:*
- Solo Gradio: `python multilingual_app.py --gradio-only`
- Sin abrir el navegador automáticamente: `python multilingual_app.py --no-browser`

---

## 💻 Modo Desarrollo (Opcional — Solo si modificas `src/`)

El proyecto incluye además una interfaz fuente en React + Vite + TypeScript dentro de `src/`. Si deseas editarla y compilarla hacia `dist/`:

```bash
npm install
npm run dev     # Servidor de desarrollo en http://localhost:3000
npm run build   # Compila la versión de producción en dist/
```

---

## 📡 Endpoints principales de la API REST

- `GET /api/status` — Estado del motor, dispositivo (`CPU`/`CUDA`) y carga del modelo.
- `GET /api/progress` — Progreso en tiempo real de la generación.
- `GET /api/voices`, `POST /api/voices/upload`, `DELETE /api/voices/{name}` — Gestión de voces en `voices/`.
- `GET /api/languages` — Idiomas soportados por Chatterbox.
- `GET /api/project`, `POST /api/project` — Carga y guardado del guion y parámetros en `outputs/project.json`.
- `POST /api/generate` — Inicia la producción secuencial en segundo plano.
- `POST /api/regenerate`, `POST /api/regenerate-section`, `POST /api/regenerate-batch` — Regeneración con soporte de `keep_seed`.
- `POST /api/join`, `POST /api/join-all` — Unión de partes por escena o master completo.
- `GET /api/outputs`, `POST /api/delete-all-wavs`, `GET /api/download-all-zip` — Explorador, limpieza y descarga ZIP de los `.wav`.

