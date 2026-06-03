import json
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from nlp_service import AudioProcesamientoError, IntencionNoReconocidaError, VoiceAssistantService
from schemas import CandidatoTramite, NlpAudioResponse, NlpErrorResponse

router = APIRouter()

_voice_service = VoiceAssistantService()


def get_voice_service() -> VoiceAssistantService:
    return _voice_service


# ── Health check ─────────────────────────────────────────────────────────────

@router.get("/health", summary="Estado del microservicio NLP.")
def health_check():
    return {
        "status": "ok",
        "model_loaded": _voice_service._embeddings is not None,
        "procesos_indexados": len(_voice_service._codigos),
    }


# ── Helper ────────────────────────────────────────────────────────────────────

def _cargar_catalogo(catalogo: Optional[str], service: VoiceAssistantService) -> None:
    if catalogo:
        try:
            service.cargar_catalogo_dinamico(json.loads(catalogo))
        except Exception as e:
            print(f"⚠️ [NLP] No se pudo parsear el catálogo: {e}.")


def _construir_respuesta(
    texto: str,
    intencion: str,
    codigo: Optional[str],
    confianza: float,
    alternativos: List[dict],
) -> NlpAudioResponse:
    candidatos = [
        CandidatoTramite(codigo=c["codigo"], nivel_confianza=c["nivel_confianza"])
        for c in alternativos
    ]
    return NlpAudioResponse(
        texto_transcrito=texto,
        intencion_detectada=intencion,
        id_tramite_sugerido=codigo,
        nivel_confianza=confianza,
        candidatos_alternativos=candidatos,
    )


# ── Endpoint: audio binario ───────────────────────────────────────────────────

@router.post(
    "/tramites/voz",
    response_model=NlpAudioResponse,
    responses={400: {"model": NlpErrorResponse}},
    summary="Transcribe audio y clasifica la intención.",
)
async def analizar_intencion_voz(
    file: Annotated[UploadFile, File(description="Audio grabado (webm/wav).")],
    catalogo: Annotated[Optional[str], Form(description="JSON de procesos activos.")] = None,
    service: Annotated[VoiceAssistantService, Depends(get_voice_service)] = None,
):
    _cargar_catalogo(catalogo, service)
    texto_transcrito = ""
    try:
        texto_transcrito = service.transcribir_audio(await file.read())
        intencion, codigo, confianza, alternativos = service.clasificar_intencion(texto_transcrito)
        return _construir_respuesta(texto_transcrito, intencion, codigo, confianza, alternativos)

    except AudioProcesamientoError as e:
        raise HTTPException(status_code=400, detail={"codigo_error": "AUDIO_ININTELIGIBLE", "mensaje": str(e)})

    except IntencionNoReconocidaError:
        return NlpAudioResponse(
            texto_transcrito=texto_transcrito,
            intencion_detectada="NO_RECONOCIDO",
            id_tramite_sugerido=None,
            nivel_confianza=0.0,
            candidatos_alternativos=[],
        )


# ── Endpoint: texto directo (Web Speech API) ──────────────────────────────────

@router.post(
    "/tramites/nlp",
    response_model=NlpAudioResponse,
    summary="Clasifica la intención de texto ya transcrito por el navegador.",
)
async def clasificar_desde_texto(
    texto: Annotated[str, Form(description="Texto del usuario.")],
    catalogo: Annotated[Optional[str], Form(description="JSON de procesos activos.")] = None,
    service: Annotated[VoiceAssistantService, Depends(get_voice_service)] = None,
):
    _cargar_catalogo(catalogo, service)
    try:
        intencion, codigo, confianza, alternativos = service.clasificar_intencion(texto)
        return _construir_respuesta(texto, intencion, codigo, confianza, alternativos)

    except IntencionNoReconocidaError:
        return NlpAudioResponse(
            texto_transcrito=texto,
            intencion_detectada="NO_RECONOCIDO",
            id_tramite_sugerido=None,
            nivel_confianza=0.0,
            candidatos_alternativos=[],
        )
