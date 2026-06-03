from pydantic import BaseModel, Field
from typing import Optional, List


class CandidatoTramite(BaseModel):
    """Un trámite candidato con su código y nivel de confianza."""
    codigo: str = Field(..., description="Código del proceso en MongoDB.")
    nivel_confianza: float = Field(..., description="Similitud coseno con la consulta (0.0–1.0).")


class NlpAudioResponse(BaseModel):
    """Respuesta exitosa del procesamiento NLP."""
    texto_transcrito: str = Field(..., description="Texto procesado.")
    intencion_detectada: str = Field(..., description="Intención principal (INICIAR_TRAMITE | NO_RECONOCIDO).")
    id_tramite_sugerido: Optional[str] = Field(None, description="Código del trámite con mayor confianza.")
    nivel_confianza: float = Field(..., description="Confianza del match principal (0.0–1.0).")
    candidatos_alternativos: List[CandidatoTramite] = Field(
        default_factory=list,
        description="Hasta 2 trámites alternativos si la similitud también supera el umbral."
    )


class NlpErrorResponse(BaseModel):
    """Error de dominio (audio incomprensible, intención no encontrada, etc.)."""
    error: bool = Field(default=True)
    mensaje: str = Field(..., description="Mensaje amigable para el cliente.")
    detalle_tecnico: Optional[str] = Field(None)
    codigo_error: str = Field(..., description="Código interno (ej. AUDIO_ININTELIGIBLE).")
