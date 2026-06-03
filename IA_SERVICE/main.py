from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import router

app = FastAPI(
    title="Microservicio NLP - BPMS",
    description="API de IA experta en entender las intenciones de los clientes.",
    version="1.0.0"
)

# Configuración estricta de CORS para Angular
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"], # Dominios permitidos
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"], # Para subida de archivos POST y pre-flights
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")

@app.get("/")
def root():
    return {"estado": "en_linea", "mensaje": "Microservicio NLP funcionando correctamente."}

@app.get("/health", summary="Endpoint de diagnóstico")
def health_check():
    return {"status": "ok", "service": "nlp_asistente_voz"}