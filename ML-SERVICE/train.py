"""
train.py — Genera datos sintéticos y entrena el modelo TensorFlow de predicción.

Uso:
    python train.py              # genera datos sintéticos y entrena
    python train.py --real       # (futuro) re-entrenar con datos reales de MongoDB

El modelo aprende a predecir el riesgo de demora de un trámite basándose en:
  - Tipo de proceso (codificado)
  - Proporción de avance (pasos completados / total)
  - Días sin avance en el paso actual
  - Hora del día y día de la semana
  - Carga del departamento
  - Días desde que se inició el trámite
"""

import os
import numpy as np
import tensorflow as tf
from sklearn.preprocessing import StandardScaler
import joblib

os.makedirs("models", exist_ok=True)

np.random.seed(42)
tf.random.set_seed(42)

N = 3000  # muestras sintéticas

# ── Generar features ──────────────────────────────────────────────────────────

tipo_proc     = np.random.randint(0, 10, N) / 10.0          # F0: tipo proceso (0-1)
paso_ratio    = np.random.uniform(0.0, 1.0, N)              # F1: avance del trámite
dias_paso     = np.random.exponential(3.5, N).clip(0, 30)   # F2: días en paso actual
hora_dia      = np.random.randint(7, 20, N) / 24.0          # F3: hora normalizada
dia_semana    = np.random.randint(0, 7, N) / 7.0            # F4: día de semana
carga_dept    = np.random.randint(0, 50, N) / 50.0          # F5: carga del dpto
pasos_comp    = np.random.randint(0, 10, N) / 10.0          # F6: pasos completados
dias_inicio   = (dias_paso * np.random.uniform(1, 4, N)).clip(0, 60) / 60.0  # F7

X = np.column_stack([
    tipo_proc, paso_ratio, dias_paso / 30.0,
    hora_dia, dia_semana, carga_dept,
    pasos_comp, dias_inicio
])

# ── Generar etiquetas (riesgo 0-1) con reglas de negocio ─────────────────────
# El riesgo sube cuando: muchos días sin avance, departamento saturado,
# paso avanzado del proceso (cerca del fin pero aún sin cerrar),
# inicio fue hace mucho tiempo.

riesgo = (
    (dias_paso > 5).astype(float)  * 0.35 +
    (dias_paso > 10).astype(float) * 0.20 +
    (carga_dept > 0.6).astype(float) * 0.25 +
    (dias_inicio > 0.5).astype(float) * 0.10 +
    (paso_ratio > 0.75).astype(float) * 0.05 +
    np.random.uniform(0, 0.05, N)        # ruido realista
)
riesgo = np.clip(riesgo, 0.0, 1.0)

# ── Preprocesado ──────────────────────────────────────────────────────────────
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
joblib.dump(scaler, "models/scaler.pkl")
print("Scaler guardado en models/scaler.pkl")

# ── Modelo TensorFlow (regresión) ─────────────────────────────────────────────
model = tf.keras.Sequential([
    tf.keras.layers.Input(shape=(8,)),
    tf.keras.layers.Dense(64, activation="relu"),
    tf.keras.layers.Dropout(0.2),
    tf.keras.layers.Dense(32, activation="relu"),
    tf.keras.layers.Dropout(0.1),
    tf.keras.layers.Dense(16, activation="relu"),
    tf.keras.layers.Dense(1,  activation="sigmoid"),
])

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
    loss="binary_crossentropy",
    metrics=["mae"]
)

history = model.fit(
    X_scaled, riesgo,
    epochs=60,
    batch_size=64,
    validation_split=0.2,
    callbacks=[
        tf.keras.callbacks.EarlyStopping(patience=8, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(factor=0.5, patience=4),
    ],
    verbose=1
)

model.save("models/delay_model.keras")
print("\nModelo guardado en models/delay_model.keras")
print(f"Loss final (val): {min(history.history['val_loss']):.4f}")

# ── Guardar métricas de entrenamiento (leídas por /estadisticas) ──────────────
import json
from datetime import datetime

metricas = {
    "fecha_entrenamiento":    datetime.now().strftime("%Y-%m-%d"),
    "muestras_total":         N,
    "muestras_entrenamiento": int(N * 0.8),
    "muestras_validacion":    int(N * 0.2),
    "epochs_ejecutados":      len(history.history["loss"]),
    "val_loss_final":         round(float(min(history.history["val_loss"])), 4),
    "val_mae_final":          round(float(min(history.history["val_mae"])),  4),
    "loss_history":           [round(float(v), 4) for v in history.history["loss"]],
    "val_loss_history":       [round(float(v), 4) for v in history.history["val_loss"]],
    "arquitectura": [
        "Input(8)",
        "Dense(64, relu)",
        "Dropout(0.2)",
        "Dense(32, relu)",
        "Dropout(0.1)",
        "Dense(16, relu)",
        "Dense(1, sigmoid)"
    ]
}

with open("models/training_metrics.json", "w") as f:
    json.dump(metricas, f, indent=2)
print("Métricas guardadas en models/training_metrics.json")
print("\nEntrenamiento completo. Ejecuta 'uvicorn app:app --port 5001' para iniciar el servidor.")
