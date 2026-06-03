"""
app.py — Microservicio de predicción ML para BPMS (CU24).

Endpoints:
    GET  /salud         → health-check, el backend Java lo consulta periódicamente
    POST /predecir      → recibe metadatos del trámite y devuelve predicción

Inicio rápido:
    pip install -r requirements.txt
    python train.py           # entrena el modelo (solo la primera vez)
    uvicorn app:app --host 0.0.0.0 --port 5001 --reload
"""

from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel, Field
from typing import Optional
import numpy as np
import os
import json
import subprocess
from datetime import datetime

app = FastAPI(
    title="BPMS ML Predictor",
    description="Predicción de demora y anomalías en trámites (CU24)",
    version="1.0.0"
)

# ── Estado global del modelo y contadores ────────────────────────────────────
_model  = None
_scaler = None

_STATS_PATH = "models/stats.json"

def _cargar_stats() -> dict:
    if os.path.exists(_STATS_PATH):
        try:
            with open(_STATS_PATH, "r") as f:
                data = json.load(f)
            data["inicio_servicio"] = datetime.now().isoformat()  # resetear por sesión
            return data
        except Exception:
            pass
    return {
        "total_predicciones":   0,
        "por_nivel":            {"NORMAL": 0, "ALTO": 0, "CRITICO": 0},
        "anomalias_detectadas": 0,
        "ultima_prediccion":    None,
        "inicio_servicio":      datetime.now().isoformat(),
    }

def _guardar_stats() -> None:
    try:
        with open(_STATS_PATH, "w") as f:
            json.dump(_stats, f)
    except Exception as exc:
        print(f"[ML-SERVICE] No se pudo guardar stats: {exc}")

_stats: dict      = _cargar_stats()
_entrenando: bool = False


@app.on_event("startup")
def cargar_modelos():
    global _model, _scaler
    model_path  = "models/delay_model.keras"
    scaler_path = "models/scaler.pkl"

    if os.path.exists(model_path) and os.path.exists(scaler_path):
        import tensorflow as tf
        import joblib
        _model  = tf.keras.models.load_model(model_path)
        _scaler = joblib.load(scaler_path)
        # Warm-up para evitar latencia en la primera predicción
        _dummy = _scaler.transform(np.zeros((1, 8)))
        _model.predict(_dummy, verbose=0)
        print("[ML-SERVICE] Modelo cargado y listo.")
    else:
        print("[ML-SERVICE] AVISO: modelo no encontrado. Ejecuta train.py primero.")


# ── DTOs ──────────────────────────────────────────────────────────────────────

class PeticionPrediccion(BaseModel):
    tipo_proceso:         str   = Field(default="",  description="Nombre del proceso/política")
    paso_actual_idx:      int   = Field(default=0,   description="Índice del paso actual (0-based)")
    num_pasos_total:      int   = Field(default=1,   description="Total de pasos del proceso")
    dias_en_paso_actual:  float = Field(default=0.0, description="Días que lleva en el paso actual")
    hora_dia:             int   = Field(default=12,  description="Hora del día (0-23)")
    dia_semana:           int   = Field(default=1,   description="Día de semana (1=Lun, 7=Dom)")
    carga_departamento:   int   = Field(default=0,   description="Trámites activos en el dpto")
    pasos_completados:    int   = Field(default=0,   description="Cantidad de pasos ya completados")
    dias_desde_inicio:    float = Field(default=0.0, description="Días desde que se creó el trámite")


class RespuestaPrediccion(BaseModel):
    riesgo_demora:              float          # 0.0 – 1.0
    es_anomalia:                bool
    nivel_prioridad:            str            # NORMAL | ALTO | CRITICO
    funcionario_recomendado_id: Optional[str] = None
    confianza:                  float
    motivo:                     str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _predicion_default() -> RespuestaPrediccion:
    return RespuestaPrediccion(
        riesgo_demora=0.0,
        es_anomalia=False,
        nivel_prioridad="NORMAL",
        funcionario_recomendado_id=None,
        confianza=0.0,
        motivo="Predictor no disponible – enrutamiento estándar aplicado"
    )


def _construir_features(req: PeticionPrediccion) -> np.ndarray:
    tipo_enc   = abs(hash(req.tipo_proceso)) % 10 / 10.0
    paso_ratio = req.paso_actual_idx / max(req.num_pasos_total, 1)
    dias_paso  = min(req.dias_en_paso_actual, 30) / 30.0
    hora_norm  = req.hora_dia / 24.0
    dia_norm   = req.dia_semana / 7.0
    carga_norm = min(req.carga_departamento, 50) / 50.0
    comp_norm  = min(req.pasos_completados, 10) / 10.0
    init_norm  = min(req.dias_desde_inicio, 60) / 60.0

    return np.array([[tipo_enc, paso_ratio, dias_paso,
                      hora_norm, dia_norm, carga_norm,
                      comp_norm, init_norm]], dtype=np.float32)


def _generar_motivo(req: PeticionPrediccion, riesgo: float) -> str:
    motivos = []
    if req.dias_en_paso_actual > 7:
        motivos.append(f"{int(req.dias_en_paso_actual)} días sin avance en el paso actual")
    if req.carga_departamento > 25:
        motivos.append(f"Alta carga departamental ({req.carga_departamento} trámites activos)")
    if req.dias_desde_inicio > 20:
        motivos.append(f"Trámite con {int(req.dias_desde_inicio)} días desde su inicio")
    if not motivos:
        if riesgo < 0.4:
            return "Flujo normal – sin indicadores de riesgo"
        return "Riesgo moderado detectado por el modelo"
    return " · ".join(motivos)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/salud", summary="Health-check del microservicio")
def salud():
    return {
        "estado": "ok",
        "modelo_cargado": _model is not None,
        "version": "1.0.0"
    }


@app.post("/predecir", response_model=RespuestaPrediccion,
          summary="Predice riesgo de demora y anomalías para un trámite")
def predecir(req: PeticionPrediccion):
    if _model is None or _scaler is None:
        return _predicion_default()

    try:
        X      = _construir_features(req)
        x_sc   = _scaler.transform(X)
        riesgo = float(_model.predict(x_sc, verbose=0)[0][0])
        riesgo = round(min(max(riesgo, 0.0), 1.0), 4)

        # Umbral de anomalía: riesgo alto Y días en paso superan el umbral
        es_anomalia = riesgo > 0.72 and req.dias_en_paso_actual > 5

        if riesgo > 0.70:
            nivel = "CRITICO"
        elif riesgo > 0.40:
            nivel = "ALTO"
        else:
            nivel = "NORMAL"

        # Confianza: cuanto más lejos de 0.5, más seguro está el modelo
        confianza = round(0.5 + abs(riesgo - 0.5), 3)

        # Actualizar contadores en memoria
        _stats["total_predicciones"] += 1
        _stats["por_nivel"][nivel] = _stats["por_nivel"].get(nivel, 0) + 1
        if es_anomalia:
            _stats["anomalias_detectadas"] += 1
        _stats["ultima_prediccion"] = datetime.now().isoformat()
        _guardar_stats()

        return RespuestaPrediccion(
            riesgo_demora=riesgo,
            es_anomalia=es_anomalia,
            nivel_prioridad=nivel,
            funcionario_recomendado_id=None,
            confianza=confianza,
            motivo=_generar_motivo(req, riesgo)
        )

    except Exception as e:
        print(f"[ML-SERVICE] Error en predicción: {e}")
        return _predicion_default()


def _ejecutar_entrenamiento() -> None:
    """Tarea en segundo plano: entrena el modelo y recarga en memoria."""
    global _entrenando, _model, _scaler
    _entrenando = True
    try:
        subprocess.run(["python", "train.py"], check=True, timeout=300)
        import tensorflow as tf
        import joblib as jl
        _model  = tf.keras.models.load_model("models/delay_model.keras")
        _scaler = jl.load("models/scaler.pkl")
        _model.predict(_scaler.transform(np.zeros((1, 8))), verbose=0)
        print("[ML-SERVICE] Modelo reentrenado y recargado.")
    except Exception as exc:
        print(f"[ML-SERVICE] Error en entrenamiento: {exc}")
    finally:
        _entrenando = False


@app.post("/entrenar", summary="Lanza el entrenamiento del modelo en segundo plano")
def entrenar(background_tasks: BackgroundTasks):
    if _entrenando:
        return {"estado": "en_progreso", "mensaje": "El entrenamiento ya está en curso, espera ~30 segundos"}
    background_tasks.add_task(_ejecutar_entrenamiento)
    return {"estado": "iniciado", "mensaje": "Entrenamiento iniciado. Tardará ~30 segundos."}


@app.get("/estadisticas", summary="Métricas del modelo y contadores de predicciones")
def estadisticas():
    metricas_entrenamiento: dict = {}
    metrics_path = "models/training_metrics.json"
    if os.path.exists(metrics_path):
        with open(metrics_path, "r") as f:
            metricas_entrenamiento = json.load(f)

    return {
        "servicioOnline": True,
        "servicio": {
            "estado":          "ok",
            "modelo_cargado":  _model is not None,
            "entrenando":      _entrenando,
            "version":         "1.0.0",
            "inicio_servicio": _stats["inicio_servicio"],
        },
        "predicciones": {
            "total":               _stats["total_predicciones"],
            "por_nivel":           _stats["por_nivel"],
            "anomalias_detectadas": _stats["anomalias_detectadas"],
            "ultima_prediccion":   _stats["ultima_prediccion"],
        },
        "entrenamiento": metricas_entrenamiento,
    }
