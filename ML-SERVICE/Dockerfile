# TensorFlow 2.18 necesita Python 3.11 — usamos slim para reducir tamaño
FROM python:3.11-slim

WORKDIR /app

# Copiar e instalar dependencias primero (aprovecha caché de Docker)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código fuente
COPY . .

# Entrenar el modelo durante la construcción de la imagen
# Así el modelo queda "horneado" dentro de la imagen y no hay que entrenarlo cada vez
RUN python train.py

EXPOSE 5001

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5001"]
