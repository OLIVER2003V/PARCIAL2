"""
BPMS NLP Service — CU21: Completar Formulario mediante Voz
Puerto: 8001  (el servicio CU17 corre en 8000)

Inicio rápido:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""

import asyncio
import os
import tempfile
import logging
from contextlib import asynccontextmanager
from typing import Optional

# ─── FIX ffmpeg: imageio-ffmpeg tiene el binario como "ffmpeg-win-x86_64-vX.Y.exe"
# Whisper llama subprocess.Popen(['ffmpeg', ...]) y busca exactamente "ffmpeg.exe".
# Solución: copiar el binario bundleado como "ffmpeg.exe" en un directorio del PATH.
import shutil as _shutil

def _setup_ffmpeg() -> None:
    _log = logging.getLogger("nlp_cu21")
    try:
        import imageio_ffmpeg as _iio_ffmpeg
        _src = _iio_ffmpeg.get_ffmpeg_exe()           # e.g. ffmpeg-win-x86_64-v7.1.exe
        # Destino: carpeta del propio script como "ffmpeg.exe"
        _dst_dir = os.path.dirname(os.path.abspath(__file__))
        _dst = os.path.join(_dst_dir, "ffmpeg.exe")
        if not os.path.exists(_dst):
            _shutil.copy2(_src, _dst)
            _log.info(f"ffmpeg copiado como ffmpeg.exe en {_dst_dir}")
        else:
            _log.info(f"ffmpeg.exe ya existe en {_dst_dir}")
        # Asegurar que la carpeta esté al inicio del PATH
        os.environ["PATH"] = _dst_dir + os.pathsep + os.environ.get("PATH", "")
        _log.info(f"PATH actualizado: ffmpeg.exe = {_dst}")
    except Exception as _e:
        _log.warning(f"No se pudo configurar ffmpeg bundleado: {_e}. Se usará el ffmpeg del sistema.")

_setup_ffmpeg()

import whisper
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("nlp_cu21")

# ─── Configuración ────────────────────────────────────────────────────────────
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL", "medium")

# FIX #12: semáforo para limitar transcripciones simultáneas (Whisper es CPU-intensivo)
MAX_CONCURRENT = int(os.getenv("MAX_CONCURRENT_TRANSCRIPTIONS", "2"))
_sem = asyncio.Semaphore(MAX_CONCURRENT)

# FIX #10: CORS restringido al host de Spring Boot, no wildcard
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

_whisper_model: Optional[whisper.Whisper] = None


def get_whisper() -> whisper.Whisper:
    global _whisper_model
    if _whisper_model is None:
        log.info(f"Cargando modelo Whisper '{WHISPER_MODEL_SIZE}'…")
        _whisper_model = whisper.load_model(WHISPER_MODEL_SIZE)
        log.info("Modelo Whisper listo.")
    return _whisper_model


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        get_whisper()
    except Exception as exc:
        log.warning(f"No se pre-cargó Whisper: {exc}")
    yield


# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="BPMS NLP Service — CU21",
    description="Transcripción de audio para llenado de formularios por voz",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ─── Constantes ───────────────────────────────────────────────────────────────
EXTENSIONES_VALIDAS  = {"webm", "wav", "ogg", "mp3", "mp4", "m4a", "flac", "aac"}
TAMANO_MINIMO_BYTES  = 2_000
TAMANO_MAXIMO_BYTES  = 25_000_000


# ─── Modelos ──────────────────────────────────────────────────────────────────
class TranscripcionResponse(BaseModel):
    transcript: str
    idioma: str
    duracion: float
    exito: bool
    advertencia: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    modelo: str
    servicio: str
    slots_libres: int


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["Sistema"])
def health():
    return HealthResponse(
        status="ok",
        modelo=WHISPER_MODEL_SIZE,
        servicio="BPMS NLP CU21",
        slots_libres=_sem._value,
    )


@app.post(
    "/api/v1/formulario/transcribir",
    response_model=TranscripcionResponse,
    tags=["CU21"],
    summary="Transcribe audio a texto (Whisper)",
)
async def transcribir_audio(
    file: UploadFile = File(..., description="Archivo de audio (webm, wav, ogg, mp3, mp4, m4a)")
):
    # ── Validar extensión ─────────────────────────────────────────────────────
    filename = file.filename or "audio.webm"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"
    if ext not in EXTENSIONES_VALIDAS:
        raise HTTPException(
            status_code=415,
            detail=f"Formato no soportado: '.{ext}'. Usa: {', '.join(sorted(EXTENSIONES_VALIDAS))}",
        )

    # ── Leer contenido ────────────────────────────────────────────────────────
    contenido = await file.read()
    tamano = len(contenido)
    log.info(f"Audio recibido: {filename} ({tamano:,} bytes)")

    if tamano < TAMANO_MINIMO_BYTES:
        raise HTTPException(
            status_code=422,
            detail="Grabación demasiado corta (< 2 KB). Habla con más claridad o mantén el botón presionado.",
        )
    if tamano > TAMANO_MAXIMO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Archivo demasiado grande ({tamano // 1_000_000} MB). Máximo: 25 MB.",
        )

    # FIX #12: adquirir semáforo — si ya hay MAX_CONCURRENT transcripciones activas, esperar
    if _sem._value == 0:
        log.warning("Semáforo lleno, request en cola de espera.")

    async with _sem:
        return await _transcribir(contenido, ext)


async def _transcribir(contenido: bytes, ext: str) -> TranscripcionResponse:
    tmp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
            tmp.write(contenido)
            tmp_path = tmp.name

        modelo = get_whisper()
        log.info(f"Transcribiendo {tmp_path}…")

        resultado = modelo.transcribe(
            tmp_path,
            language="es",
            task="transcribe",
            fp16=False,
            verbose=False,
            temperature=0,
            best_of=1,
            beam_size=5,
            word_timestamps=False,
            condition_on_previous_text=True,
            initial_prompt=(
                "Formulario oficial de trámites gubernamentales. "
                "Nombres propios, fechas, números y datos personales."
            ),
        )

        transcript: str = (resultado.get("text") or "").strip()
        idioma: str = resultado.get("language", "es")
        segmentos = resultado.get("segments") or []
        duracion: float = round(segmentos[-1]["end"] if segmentos else 0.0, 2)

        advertencia = None
        if not transcript:
            advertencia = "No se detectó habla. Habla con claridad y cerca del micrófono."
        elif len(transcript) < 5:
            advertencia = "Transcript muy corto. Considera volver a grabar."

        log.info(f"Transcript ({idioma}, {duracion}s): '{transcript[:80]}'" if len(transcript) > 80 else f"Transcript: '{transcript}'")

        return TranscripcionResponse(
            transcript=transcript,
            idioma=idioma,
            duracion=duracion,
            exito=True,
            advertencia=advertencia,
        )

    except HTTPException:
        raise
    except Exception as exc:
        log.error(f"Error en transcripción: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Error interno en transcripción: {str(exc)}",
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


# ─── Punto de entrada ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("NLP_PORT", "8001"))
    log.info(f"Iniciando BPMS NLP Service CU21 en puerto {port} (max {MAX_CONCURRENT} concurrent)…")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
