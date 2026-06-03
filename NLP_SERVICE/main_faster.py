"""
BPMS NLP Service — CU21 (faster-whisper edition)
Puerto: 8001

Inicio rápido:
  pip install faster-whisper fastapi uvicorn[standard] python-multipart python-dotenv
  python main_faster.py

Ventajas vs openai-whisper:
  - Compatible con Python 3.13+
  - 2-4× más rápido en CPU
  - Menor uso de memoria
  - No necesita compilar desde source
"""

import asyncio
import os
import tempfile
import logging
from contextlib import asynccontextmanager
from typing import Optional

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
MAX_CONCURRENT    = int(os.getenv("MAX_CONCURRENT_TRANSCRIPTIONS", "2"))
_sem              = asyncio.Semaphore(MAX_CONCURRENT)

_raw_origins  = os.getenv("ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

_whisper_model = None   # WhisperModel instance (faster-whisper)


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        log.info(f"Cargando modelo faster-whisper '{WHISPER_MODEL_SIZE}'…")
        # device="cpu" + compute_type="int8" → óptimo para CPU sin GPU
        _whisper_model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device="cpu",
            compute_type="int8"
        )
        log.info("Modelo faster-whisper listo.")
    return _whisper_model


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        get_whisper()
    except Exception as exc:
        log.warning(f"No se pre-cargó el modelo: {exc}")
    yield


# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="BPMS NLP Service — CU21 (faster-whisper)",
    description="Transcripción de audio para llenado de formularios por voz",
    version="2.0.0",
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


# ─── Modelos Pydantic ─────────────────────────────────────────────────────────
class TranscripcionResponse(BaseModel):
    transcript: str
    idioma:     str
    duracion:   float
    exito:      bool
    advertencia: Optional[str] = None


class HealthResponse(BaseModel):
    status:       str
    modelo:       str
    servicio:     str
    slots_libres: int


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["Sistema"])
def health():
    return HealthResponse(
        status       = "ok",
        modelo       = WHISPER_MODEL_SIZE,
        servicio     = "BPMS NLP CU21 (faster-whisper)",
        slots_libres = _sem._value,
    )


@app.post(
    "/api/v1/formulario/transcribir",
    response_model=TranscripcionResponse,
    tags=["CU21"],
    summary="Transcribe audio a texto (faster-whisper)",
)
async def transcribir_audio(
    file: UploadFile = File(..., description="Archivo de audio (webm, wav, ogg, mp3, mp4, m4a)")
):
    filename = file.filename or "audio.webm"
    ext      = filename.rsplit(".", 1)[-1].lower() if "." in filename else "webm"

    if ext not in EXTENSIONES_VALIDAS:
        raise HTTPException(
            status_code=415,
            detail=f"Formato no soportado: '.{ext}'. Usa: {', '.join(sorted(EXTENSIONES_VALIDAS))}",
        )

    contenido = await file.read()
    tamano    = len(contenido)
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

        # faster-whisper devuelve un generador de segmentos
        segments, info = modelo.transcribe(
            tmp_path,
            language="es",
            task="transcribe",
            beam_size=5,
            initial_prompt=(
                "Formulario oficial de trámites gubernamentales. "
                "Nombres propios, fechas, números y datos personales."
            ),
            vad_filter=True,           # filtra silencios automáticamente
            vad_parameters=dict(min_silence_duration_ms=500),
        )

        # Materializar el generador
        segs    = list(segments)
        transcript: str   = " ".join(s.text.strip() for s in segs).strip()
        idioma:     str   = info.language or "es"
        duracion:   float = round(segs[-1].end if segs else 0.0, 2)

        advertencia = None
        if not transcript:
            advertencia = "No se detectó habla. Habla con claridad y cerca del micrófono."
        elif len(transcript) < 5:
            advertencia = "Transcript muy corto. Considera volver a grabar."

        log.info(
            f"Transcript ({idioma}, {duracion}s): '{transcript[:80]}'"
            if len(transcript) > 80 else f"Transcript: '{transcript}'"
        )

        return TranscripcionResponse(
            transcript   = transcript,
            idioma       = idioma,
            duracion     = duracion,
            exito        = True,
            advertencia  = advertencia,
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
    log.info(f"Iniciando BPMS NLP Service CU21 (faster-whisper) en puerto {port}…")
    uvicorn.run("main_faster:app", host="0.0.0.0", port=port, reload=True)
