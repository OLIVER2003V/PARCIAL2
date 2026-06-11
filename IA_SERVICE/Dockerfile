# Imagen base Python 3.11 liviana (sin GUI, sin extras)
FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema que necesita SpeechRecognition para leer audio
RUN apt-get update && apt-get install -y --no-install-recommends \
    flac \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copiar e instalar dependencias Python ANTES del código fuente
# (si requirements.txt no cambia, Docker reutiliza esta capa cacheada)
COPY requirements.txt .
RUN pip install --no-cache-dir "numpy<2" \
    && pip install --no-cache-dir torch==2.4.1+cpu --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt \
    && python -c \
        "from sentence_transformers import SentenceTransformer; \
SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')"

# Copiar el código fuente
COPY main.py nlp_service.py routes.py schemas.py ./

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
