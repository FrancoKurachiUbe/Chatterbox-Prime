"""
Punto de entrada principal del servidor local FastAPI para Qwen3Prime.
Se ejecuta exclusivamente en localhost por seguridad.
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

# Asegurar que la raíz del proyecto esté en sys.path al ejecutar como script
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.api.routes import project_manager, router as api_router
from backend.config import APP_NAME, APP_VERSION, DIST_DIR, find_available_port, get_hardware_info


def create_app() -> FastAPI:
    app = FastAPI(title=APP_NAME, version=APP_VERSION)

    # Permitir acceso local en cualquier puerto localhost/127.0.0.1 (ej. 8000, 8001, 3000)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    @app.get("/projects/{project_id}/{folder}/{filename}")
    def serve_project_audio(project_id: str, folder: str, filename: str):
        try:
            audio_path = project_manager.resolve_project_audio_path(project_id, folder, filename)
            return FileResponse(
                str(audio_path),
                media_type="audio/wav",
                filename=audio_path.name,
                headers={"Cache-Control": "no-store"},
            )
        except FileNotFoundError as err:
            raise HTTPException(status_code=404, detail=str(err))
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err))

    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/", response_class=HTMLResponse)
    def serve_root():
        index_file = DIST_DIR / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        return HTMLResponse(
            "<h2>Qwen3Prime</h2>"
            "<p>El frontend compilado no se encontró en <code>dist/index.html</code>. "
            "Ejecuta <code>npm run build</code> en la raíz del proyecto.</p>",
            status_code=200,
        )

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("projects/"):
            raise HTTPException(status_code=404, detail="Recurso no encontrado")
        candidate = DIST_DIR / full_path
        if candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        index_file = DIST_DIR / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
        raise HTTPException(status_code=404, detail="Frontend no compilado")

    return app


app = create_app()


def start_server(port: int = 8000, host: str = "127.0.0.1", open_browser: bool = True) -> None:
    import uvicorn

    chosen_port = find_available_port(host, port)
    hw = get_hardware_info()

    print("\n" + "=" * 68)
    print(f"  {APP_NAME} v{APP_VERSION}")
    if chosen_port != port:
        print(f"  [AVISO] El puerto {port} estaba ocupado (sesion previa u otro programa).")
        print(f"          Usando automaticamente puerto libre: {chosen_port}")
    print(f"  URL Local : http://127.0.0.1:{chosen_port}")
    print(f"  Sistema   : {hw['os']} | Python {hw['python_version']}")
    print(f"  Hardware  : {'CUDA: ' + str(hw['gpu_name']) if hw['cuda_available'] else 'CPU (' + str(hw['cpu_cores']) + ' hilos)'}")
    print(f"  RAM       : {hw['ram_available_gb']} GB libres / {hw['ram_total_gb']} GB totales")
    print("=" * 68 + "\n")

    if open_browser:
        def _open():
            time.sleep(1.5)
            try:
                webbrowser.open(f"http://127.0.0.1:{chosen_port}")
            except Exception:
                pass

        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(app, host=host, port=chosen_port, log_level="info")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", type=str, default="127.0.0.1")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    start_server(port=args.port, host=args.host, open_browser=not args.no_browser)
