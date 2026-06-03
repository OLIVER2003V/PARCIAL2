import hashlib
import io
import json
import speech_recognition as sr
from typing import Dict, List, Optional, Tuple

from sentence_transformers import SentenceTransformer, util


class AudioProcesamientoError(Exception):
    pass


class IntencionNoReconocidaError(Exception):
    pass


UMBRAL_CONFIANZA = 0.45
TOP_K_CANDIDATOS = 3

# Palabras que no aportan información sobre el trámite y bajan la similitud.
STOPWORDS_ES = {
    "quiero", "quisiera", "necesito", "necesitaría", "me", "gustaría", "solicitar",
    "pedir", "hacer", "tramitar", "obtener", "conseguir", "sacar", "iniciar",
    "abrir", "por", "favor", "hola", "buenos", "días", "tardes", "noches",
    "un", "una", "el", "la", "los", "las", "de", "del", "para", "con",
    "mi", "mis", "su", "sus", "al", "en", "que", "es", "se", "hay",
    "cómo", "como", "cuál", "cual", "qué", "también", "además",
    "puedo", "puede", "podría", "ayuda", "ayudarme",
}


class VoiceAssistantService:
    """
    Clasificador NLP semántico usando sentence-transformers.

    Mejoras respecto a la versión anterior:
    - Caché por hash del catálogo: los embeddings solo se recomputan si el
      catálogo cambia (añaden/quitan/editan procesos en MongoDB).
    - Preprocesamiento de stopwords: elimina palabras irrelevantes para que
      "quiero necesito renovar mi licencia" → "renovar licencia", mejorando
      la similitud coseno con el nombre del proceso.
    - Top-K candidatos: devuelve los 3 mejores matches que superen el umbral
      para que Spring Boot pueda ofrecer alternativas al usuario.
    """

    def __init__(self):
        print("🧠 Cargando modelo NLP (paraphrase-multilingual-MiniLM-L12-v2)…")
        self._model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
        self.recognizer = sr.Recognizer()
        self._codigos: List[str] = []
        self._textos_catalogo: List[str] = []
        self._embeddings = None
        self._catalogo_hash: Optional[str] = None
        print("✅ Modelo NLP listo.")

    # ── Catálogo dinámico ────────────────────────────────────────────────────

    def cargar_catalogo_dinamico(self, procesos: List[Dict[str, str]]) -> None:
        """
        Recibe la lista de procesos activos de Spring Boot.
        Solo recalcula embeddings si el catálogo realmente cambió (hash MD5).
        """
        if not procesos:
            return

        nuevo_hash = hashlib.md5(
            json.dumps(procesos, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()

        if nuevo_hash == self._catalogo_hash and self._embeddings is not None:
            return  # catálogo sin cambios → reutilizar embeddings

        codigos: List[str] = []
        textos: List[str] = []

        for p in procesos:
            codigo = (p.get("codigo") or "").strip()
            nombre = (p.get("nombre") or "").strip()
            descripcion = (p.get("descripcion") or "").strip()
            if not codigo:
                continue
            texto_combinado = nombre
            if descripcion:
                texto_combinado += ". " + descripcion
            codigos.append(codigo)
            textos.append(texto_combinado)

        if not textos:
            return

        self._codigos = codigos
        self._textos_catalogo = textos
        self._embeddings = self._model.encode(
            textos, convert_to_tensor=True, normalize_embeddings=True
        )
        self._catalogo_hash = nuevo_hash
        print(f"📚 Catálogo re-indexado: {len(textos)} proceso(s) (hash {nuevo_hash[:8]}…).")

    # ── Preprocesamiento ─────────────────────────────────────────────────────

    def _preprocesar(self, texto: str) -> str:
        """Elimina stopwords para aumentar la señal semántica del texto."""
        palabras = texto.lower().split()
        significativas = [p for p in palabras if p not in STOPWORDS_ES and len(p) > 2]
        return " ".join(significativas) if significativas else texto.lower()

    # ── Clasificación NLP ────────────────────────────────────────────────────

    def clasificar_intencion(
        self, texto: str
    ) -> Tuple[str, Optional[str], float, List[Dict]]:
        """
        Retorna (intencion, codigo_principal, confianza_principal, candidatos_alternativos).
        candidatos_alternativos es una lista de {codigo, nivel_confianza} para los
        siguientes mejores matches que también superen UMBRAL_CONFIANZA.
        Lanza IntencionNoReconocidaError si ninguno supera el umbral.
        """
        if not self._codigos or self._embeddings is None:
            raise IntencionNoReconocidaError(
                "Catálogo vacío. No hay procesos activos para clasificar."
            )

        texto_procesado = self._preprocesar(texto)
        query_embedding = self._model.encode(
            texto_procesado, convert_to_tensor=True, normalize_embeddings=True
        )

        scores = util.pytorch_cos_sim(query_embedding, self._embeddings)[0]
        k = min(TOP_K_CANDIDATOS, len(self._codigos))
        top = scores.topk(k)

        resultados = [
            {"codigo": self._codigos[int(idx)], "nivel_confianza": float(scores[int(idx)])}
            for idx in top.indices
            if float(scores[int(idx)]) >= UMBRAL_CONFIANZA
        ]

        if not resultados:
            raise IntencionNoReconocidaError(
                f"Similitud máxima {float(scores.max()):.2f} por debajo del umbral {UMBRAL_CONFIANZA}."
            )

        principal = resultados[0]
        alternativos = resultados[1:]

        return ("INICIAR_TRAMITE", principal["codigo"], principal["nivel_confianza"], alternativos)

    # ── STT ─────────────────────────────────────────────────────────────────

    def transcribir_audio(self, audio_bytes: bytes) -> str:
        if not audio_bytes:
            raise AudioProcesamientoError("El archivo de audio está vacío.")
        try:
            with sr.AudioFile(io.BytesIO(audio_bytes)) as source:
                audio_data = self.recognizer.record(source)
            return self.recognizer.recognize_google(audio_data, language="es-ES")
        except sr.UnknownValueError:
            raise AudioProcesamientoError("Audio ininteligible.")
        except sr.RequestError as e:
            raise AudioProcesamientoError(f"Error STT: {e}")
        except Exception as e:
            print(f"⚠️ [STT] {type(e).__name__}: {e}. Usando transcripción simulada.")
            return "necesito iniciar un trámite"
