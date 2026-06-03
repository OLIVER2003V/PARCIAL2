package com.bpms.core.controllers;

import com.bpms.core.dto.ia.EdicionFlujoResponse;
import com.bpms.core.dto.ia.FlujoGeneradoResponse;
import com.bpms.core.services.AuditService;
import com.bpms.core.services.GeminiAiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import com.bpms.core.dto.ia.ChatbotResponse;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ia")
public class AiController {

    @Autowired
    private GeminiAiService aiService;

    // 👇 NUEVO CU17: para auditar el uso del copiloto
    @Autowired
    private AuditService auditService;

    @PostMapping("/sugerir")
    public ResponseEntity<?> sugerirRespuesta(@RequestBody Map<String, Object> payload) {
        try {
            String contexto = (String) payload.get("contexto");
            String descripcion = (String) payload.get("descripcion");
            List<String> archivos = (List<String>) payload.get("archivos");

            String sugerenciaJson = aiService.generarSugerencia(contexto, descripcion, archivos);
            return ResponseEntity.ok(Map.of("texto", sugerenciaJson.trim()));
        } catch (Exception e) {
            return ResponseEntity.ok(Map.of("error", "Asistente no disponible: " + e.getMessage()));
        }
    }

    /**
     * 👇 NUEVO CU17: Endpoint refactorizado — devuelve flujo validado + advertencias.
     * Cumple Flujo A1 del CU: si la IA no entiende, retorna 422 con mensaje específico.
     */
    @PostMapping("/generar-flujo")
    public ResponseEntity<?> generarFlujo(@RequestBody Map<String, Object> payload) {
        String promptAdmin = (String) payload.get("prompt");
        String deptosDisp = (String) payload.get("departamentosDisponibles");

        if (promptAdmin == null || promptAdmin.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "El prompt no puede estar vacío",
                    "tipo", "PROMPT_VACIO"
            ));
        }

        try {
            FlujoGeneradoResponse response = aiService.generarFlujoBpmn(promptAdmin, deptosDisp);

            // 👇 CU16: auditar uso del copiloto IA
            auditService.registrar(
                    actorActual(),
                    AuditService.CAT_POLITICA,
                    "IA_FLUJO_GENERADO",
                    "Copiloto IA generó flujo con " + response.getTotalNodos() + " nodos y "
                            + response.getTotalConexiones() + " conexiones. Prompt: \""
                            + (promptAdmin.length() > 100 ? promptAdmin.substring(0, 100) + "..." : promptAdmin) + "\""
            );

            return ResponseEntity.ok(response);

        } catch (RuntimeException e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";

            // Flujo A1: IA no pudo procesar la solicitud
            if (msg.startsWith("FLUJO_INCOHERENTE")) {
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(Map.of(
                        "error", "La IA no pudo procesar la solicitud. Por favor, sea más específico con los departamentos involucrados y las acciones del flujo.",
                        "tipo", "FLUJO_INCOHERENTE",
                        "detalle", msg
                ));
            }

            // IA saturada
            if (msg.startsWith("IA_SATURADA")) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                        "error", "La IA está temporalmente saturada. Intenta en unos minutos.",
                        "tipo", "IA_SATURADA"
                ));
            }

            // Otro error
            System.err.println("Error generando flujo con IA: " + msg);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "Error inesperado al generar el flujo: " + msg,
                    "tipo", "ERROR_INTERNO"
            ));
        }
    }

    /**
     * POST /api/ia/editar-flujo
     *
     * IA Colaborativa: el usuario tiene un diagrama parcial y pide a la IA que
     * lo continúe, modifique o extienda. En lugar de regenerar todo desde cero,
     * la IA devuelve una lista de operaciones delta que el frontend aplica
     * sobre el grafo maxGraph existente.
     *
     * Body: { "instruccion": "...", "contexto": "{ nodos:[...], conexiones:[...] }", "departamentosDisponibles": "..." }
     */
    @PostMapping("/editar-flujo")
    public ResponseEntity<?> editarFlujo(@RequestBody Map<String, Object> payload) {
        String instruccion            = (String) payload.get("instruccion");
        String contexto               = (String) payload.get("contexto");
        String deptosDisp             = (String) payload.get("departamentosDisponibles");

        if (instruccion == null || instruccion.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "La instrucción no puede estar vacía",
                    "tipo",  "PROMPT_VACIO"));
        }
        if (contexto == null || contexto.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "El contexto del diagrama es requerido",
                    "tipo",  "SIN_CONTEXTO"));
        }

        try {
            EdicionFlujoResponse response = aiService.editarFlujo(contexto, instruccion, deptosDisp);

            auditService.registrar(
                    actorActual(),
                    AuditService.CAT_POLITICA,
                    "IA_FLUJO_EDITADO",
                    "Copiloto IA editó diagrama con " + response.getOperaciones().size()
                            + " operaciones. Instrucción: \""
                            + (instruccion.length() > 100 ? instruccion.substring(0, 100) + "..." : instruccion) + "\""
            );

            return ResponseEntity.ok(response);

        } catch (RuntimeException e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            if (msg.startsWith("FLUJO_INCOHERENTE")) {
                return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(Map.of(
                        "error", "La IA no pudo interpretar la instrucción. Sé más específico.",
                        "tipo",  "FLUJO_INCOHERENTE",
                        "detalle", msg));
            }
            if (msg.startsWith("IA_SATURADA")) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                        "error", "La IA está temporalmente saturada. Intenta en unos minutos.",
                        "tipo",  "IA_SATURADA"));
            }
            System.err.println("Error editando flujo con IA: " + msg);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "Error inesperado al editar el flujo: " + msg,
                    "tipo",  "ERROR_INTERNO"));
        }
    }

    /**
     * 👇 NUEVO Asistente IA Cliente: chat conversacional.
     * Personaliza la respuesta usando el username actual (clienteId) y mantiene
     * dominio acotado a trámites de la institución.
     */
    @PostMapping("/chatbot-cliente")
    public ResponseEntity<?> chatbotCliente(@RequestBody Map<String, Object> payload) {
        try {
            String mensaje = (String) payload.get("mensaje");
            @SuppressWarnings("unchecked")
            List<Map<String, String>> historial = (List<Map<String, String>>) payload.get("historial");

            if (mensaje == null || mensaje.trim().isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of(
                        "error", "El mensaje no puede estar vacío",
                        "tipo", "MENSAJE_VACIO"
                ));
            }

            String clienteId = actorActual();
            ChatbotResponse response = aiService.chatbotCliente(mensaje, historial, clienteId);

            // 👇 CU16: auditar consulta al asistente IA
            try {
                String preview = mensaje.length() > 80 ? mensaje.substring(0, 80) + "..." : mensaje;
                auditService.registrar(
                        clienteId,
                        AuditService.CAT_SISTEMA,
                        "IA_CHATBOT_CONSULTA",
                        "Consulta al asistente IA: \"" + preview + "\""
                );
            } catch (Exception ignored) { /* no romper el flujo del chat por error de audit */ }

            return ResponseEntity.ok(response);

        } catch (RuntimeException e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";

            if (msg.startsWith("IA_SATURADA")) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                        "error", "El asistente IA está temporalmente saturado. Intenta de nuevo en unos segundos.",
                        "tipo", "IA_SATURADA"
                ));
            }

            System.err.println("Error en chatbot cliente: " + msg);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "El asistente no está disponible: " + msg,
                    "tipo", "ERROR_INTERNO"
            ));
        }
    }

    // =========================================================================
    //  CU21 — Completar Formulario mediante Voz (NLP)
    // =========================================================================

    /**
     * POST /api/ia/voz-formulario
     *
     * Modo audio : multipart con `audio` (archivo) + `campos` (JSON schema).
     *   1. Transcribe el audio con Whisper (Python NLP Service en :8001).
     *   2. Extrae valores de campos con Gemini.
     *
     * Modo texto : multipart con `texto` (string) + `campos` (JSON schema).
     *   1. Pasa el texto directamente a Gemini para extracción.
     *
     * Respuesta exitosa:
     * {
     *   "transcript"       : "texto original dictado/escrito",
     *   "camposLlenados"   : { "campo_id": valor, ... },
     *   "confianza"        : 0.92,
     *   "camposDetectados" : 3,
     *   "exito"            : true
     * }
     */
    @PostMapping(value = "/voz-formulario", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> vozFormulario(
            @RequestPart(value = "audio",  required = false) MultipartFile audio,
            @RequestPart(value = "texto",  required = false) String texto,
            @RequestPart(value = "campos", required = true)  String campos) {

        // Validar que llegó al menos una fuente de datos
        boolean tieneAudio = audio != null && !audio.isEmpty();
        boolean tieneTexto = texto != null && !texto.isBlank();

        if (!tieneAudio && !tieneTexto) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "Debes enviar 'audio' (archivo) o 'texto' (string).",
                    "tipo", "SIN_ENTRADA"));
        }

        if (campos == null || campos.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "El campo 'campos' con el schema del formulario es obligatorio.",
                    "tipo", "SIN_SCHEMA"));
        }

        try {
            Map<String, Object> resultado;

            if (tieneAudio) {
                // Modo voz: Python Whisper → Gemini extracción
                resultado = aiService.procesarAudioFormulario(audio, campos);
            } else {
                // Modo texto/prompt: Gemini extracción directo
                resultado = aiService.procesarTextoFormulario(texto, campos);
            }

            // Auditoría
            String actor = actorActual();
            int detectados = resultado.get("camposDetectados") instanceof Number n ? n.intValue() : 0;
            String modoStr = tieneAudio ? "VOZ" : "TEXTO";
            auditService.registrar(
                    actor,
                    AuditService.CAT_SISTEMA,
                    "CU21_FORMULARIO_VOZ",
                    String.format("Modo %s: llenó %d campo(s). Confianza: %.0f%%",
                            modoStr, detectados,
                            ((Number) resultado.getOrDefault("confianza", 0.0)).doubleValue() * 100)
            );

            return ResponseEntity.ok(resultado);

        } catch (RuntimeException e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";

            if (msg.startsWith("NLP_SERVICE_CAIDO")) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                        "error", "El servicio de transcripción no está disponible. Puedes escribir el texto manualmente.",
                        "tipo", "NLP_CAIDO",
                        "detalle", msg));
            }
            if (msg.startsWith("IA_SATURADA")) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                        "error", "La IA está temporalmente saturada. Intenta en unos segundos.",
                        "tipo", "IA_SATURADA"));
            }
            // Audio sin habla detectada u otros errores de usuario
            return ResponseEntity.badRequest().body(Map.of(
                    "error", msg,
                    "tipo", "ERROR_PROCESAMIENTO"));
        }
    }

    // =========================================================================
    //  CU21 — Modo Archivo (imagen / PDF → Gemini Vision)
    // =========================================================================

    /**
     * POST /api/ia/archivo-formulario
     *
     * Extrae valores de campos de un formulario a partir de una imagen o PDF.
     * Usa Gemini Vision con prompt de dos pasos (transcripción + extracción)
     * para alcanzar una precisión ≥ 95%.
     *
     * Parámetros multipart:
     *   - archivo (requerido): imagen JPG/PNG/WebP/HEIC o PDF (máx 20 MB)
     *   - campos  (requerido): JSON array con la definición del formulario
     *
     * Respuesta exitosa (mismo formato que /voz-formulario):
     * {
     *   "transcript"       : "texto transcrito del documento",
     *   "tipoDocumento"    : "Documento de identidad (DPI)",
     *   "camposLlenados"   : { "campo_id": valor, ... },
     *   "confianza"        : 0.96,
     *   "camposDetectados" : 3,
     *   "exito"            : true
     * }
     */
    @PostMapping(value = "/archivo-formulario", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> archivoFormulario(
            @RequestPart(value = "archivo", required = true) MultipartFile archivo,
            @RequestPart(value = "campos",  required = true) String campos) {

        if (archivo.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "El archivo no puede estar vacío.",
                "tipo", "ARCHIVO_INVALIDO"));
        }
        if (campos == null || campos.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "El schema de campos es obligatorio.",
                "tipo", "SIN_SCHEMA"));
        }

        try {
            Map<String, Object> resultado = aiService.procesarArchivoFormulario(archivo, campos);

            String actor      = actorActual();
            int    detectados = resultado.get("camposDetectados") instanceof Number n ? n.intValue() : 0;
            double confianza  = resultado.get("confianza") instanceof Number n ? n.doubleValue() : 0.0;
            String tipoDoc    = (String) resultado.getOrDefault("tipoDocumento", "?");

            auditService.registrar(actor, AuditService.CAT_SISTEMA, "CU21_FORMULARIO_ARCHIVO",
                String.format("Archivo '%s' (%s): %d campo(s). Confianza: %.0f%%. Tipo: %s",
                    archivo.getOriginalFilename(),
                    archivo.getContentType(),
                    detectados,
                    confianza * 100,
                    tipoDoc));

            return ResponseEntity.ok(resultado);

        } catch (RuntimeException e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            if (msg.startsWith("IA_SATURADA")) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                    "error", "La IA está temporalmente saturada. Intenta en unos segundos.",
                    "tipo", "IA_SATURADA"));
            }
            // Tipo inválido, archivo muy grande, error de lectura, JSON inválido, etc.
            return ResponseEntity.badRequest().body(Map.of(
                "error", msg,
                "tipo", "ERROR_PROCESAMIENTO"));
        }
    }

    // =========================================================================
    //  CU21 — Asistente Formulario Multimodal (texto + N archivos combinados)
    // =========================================================================

    /**
     * POST /api/ia/asistente-formulario
     *
     * Combina en una sola llamada: texto libre + N archivos adjuntos.
     * Para cada archivo Gemini decide autónomamente:
     *   (A) Extraer datos de él para rellenar campos de texto/fecha/selección.
     *   (B) Asignarlo directamente a un campo tipo 'archivo' o 'imagen'.
     *   (A+B) Ambas simultáneamente (ej: foto del DNI → extrae nombre Y ocupa el campo 'foto_ci').
     *
     * Parámetros multipart:
     *   campos    (obligatorio) — JSON array con la definición COMPLETA del formulario
     *                             (debe incluir campos tipo 'archivo' e 'imagen')
     *   texto     (opcional)   — descripción libre del usuario (puede venir de voz o teclado)
     *   archivos  (opcional)   — uno o más archivos (imágenes JPG/PNG/WebP/HEIC o PDFs, máx 20 MB c/u)
     *
     * Respuesta:
     * {
     *   "camposLlenados":   { "campo_id": valor, ... },
     *   "archivosSubidos":  { "campo_id": { "url": "...", "nombreOriginal": "...", "tamano": N }, ... },
     *   "transcript":       "texto procesado",
     *   "confianza":        0.91,
     *   "camposDetectados": 5,
     *   "archivosAsignados": 2,
     *   "exito":            true
     * }
     */
    @PostMapping(value = "/asistente-formulario", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> asistenteFormulario(
            @RequestPart(value = "campos",   required = true)  String campos,
            @RequestPart(value = "texto",    required = false) String texto,
            @RequestPart(value = "archivos", required = false) List<MultipartFile> archivos) {

        if (campos == null || campos.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "El campo 'campos' con el schema del formulario es obligatorio.",
                "tipo",  "SIN_SCHEMA"));
        }

        boolean tieneTexto    = texto    != null && !texto.isBlank();
        boolean tieneArchivos = archivos != null && !archivos.isEmpty();

        if (!tieneTexto && !tieneArchivos) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Debes enviar al menos 'texto' o un archivo en 'archivos'.",
                "tipo",  "SIN_ENTRADA"));
        }

        // Validar límite de archivos (máx 10 para no saturar Gemini)
        if (tieneArchivos && archivos.size() > 10) {
            return ResponseEntity.badRequest().body(Map.of(
                "error", "Máximo 10 archivos por solicitud.",
                "tipo",  "DEMASIADOS_ARCHIVOS"));
        }

        try {
            Map<String, Object> resultado = aiService.procesarAsistenteFormulario(texto, archivos, campos);

            // Auditoría
            String actor          = actorActual();
            int    detectados     = resultado.get("camposDetectados")  instanceof Number n ? n.intValue() : 0;
            int    asignados      = resultado.get("archivosAsignados") instanceof Number n ? n.intValue() : 0;
            double confianza      = resultado.get("confianza")         instanceof Number n ? n.doubleValue() : 0.0;
            int    numArchivos    = tieneArchivos ? archivos.size() : 0;

            auditService.registrar(actor, AuditService.CAT_SISTEMA, "CU21_ASISTENTE_FORMULARIO",
                String.format("Texto: %s | Archivos: %d | Campos extraídos: %d | Archivos asignados: %d | Confianza: %.0f%%",
                    tieneTexto ? "sí" : "no", numArchivos, detectados - asignados, asignados, confianza * 100));

            return ResponseEntity.ok(resultado);

        } catch (RuntimeException e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            if (msg.startsWith("IA_SATURADA")) {
                return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                    "error", "La IA está temporalmente saturada. Intenta en unos segundos.",
                    "tipo",  "IA_SATURADA"));
            }
            System.err.println("[AsistenteFormulario] Error: " + msg);
            return ResponseEntity.badRequest().body(Map.of(
                "error", msg,
                "tipo",  "ERROR_PROCESAMIENTO"));
        }
    }

    private String actorActual() {
        try {
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.isAuthenticated()) {
                String name = auth.getName();
                return (name != null && !name.equals("anonymousUser")) ? name : "SISTEMA";
            }
        } catch (Exception ignored) {}
        return "SISTEMA";
    }
}