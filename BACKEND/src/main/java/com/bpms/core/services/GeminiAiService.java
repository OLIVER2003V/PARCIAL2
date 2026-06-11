package com.bpms.core.services;

import com.bpms.core.dto.ia.EdicionFlujoResponse;
import com.bpms.core.dto.ia.FlujoGeneradoIA;
import com.bpms.core.dto.ia.FlujoGeneradoResponse;
import com.bpms.core.dto.ia.OperacionDiagrama;
import com.bpms.core.models.Departamento;
import com.bpms.core.repositories.DepartamentoRepository;

import com.bpms.core.dto.ia.ChatbotResponse;
import com.bpms.core.dto.ia.RequisitoCampo;
import com.bpms.core.models.CampoFormulario;
import com.bpms.core.services.AuditService;
import com.bpms.core.models.EstadoProceso;
import com.bpms.core.models.Paso;
import com.bpms.core.models.ProcesoDefinicion;
import com.bpms.core.models.Tramite;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import com.bpms.core.repositories.TramiteRepository;

import org.springframework.beans.factory.annotation.Autowired;
import java.text.Normalizer;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class GeminiAiService {

    @Value("${gemini.api.key:}")
    private String apiKey;

    @Value("${nlp.service.url:http://127.0.0.1:8000/api/v1}")
    private String nlpServiceUrl;

    // FIX #13: movido aquí desde el medio de los métodos
    @Value("${nlp.formulario.url:http://127.0.0.1:8001/api/v1}")
    private String nlpFormularioUrl;

    // FIX #5: timeout dedicado para llamadas Whisper (CPU puede tardar 20-40s)
    @Value("${nlp.formulario.timeout-ms:45000}")
    private int nlpFormularioTimeoutMs;

    @Autowired
    private AuditService auditService;

    // 👇 NUEVO: Definimos la ruta base donde ArchivoController guarda los archivos.
    private static final String CARPETA_BASE = "uploads";

    private final RestTemplate restTemplate;

    // 👇 NUEVO: ArchivoService para subir archivos asignados por el Asistente IA
    @Autowired
    private ArchivoService archivoService;

    // 👇 NUEVO CU17
    @Autowired
    private DepartamentoRepository departamentoRepository;

    // 👇 NUEVO Asistente IA Cliente
    @Autowired
    private ProcesoDefinicionRepository procesoRepository;

    // 👇 NUEVO Asistente IA Cliente
    @Autowired
    private TramiteRepository tramiteRepository;
    // 👇 NUEVO CU17

    public GeminiAiService() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        // Aumentamos el timeout a 15s porque subir PDFs en Base64 toma un poco más.
        factory.setConnectTimeout(60000);
        factory.setReadTimeout(60000);
        this.restTemplate = new RestTemplate(factory);
    }

    @jakarta.annotation.PostConstruct
    void validarApiKey() {
        if (apiKey == null || apiKey.isBlank()) {
            throw new IllegalStateException(
                "[GeminiAiService] GEMINI_API_KEY está vacía. " +
                "Asegúrate de que BACKEND/.env existe con GEMINI_API_KEY " +
                "y arranca el backend desde el directorio BACKEND/.");
        }
    }

    // 👇 NUEVO: Ahora recibimos la lista de rutas relativas de los archivos.
    // 👇 NUEVO: Eliminamos 'nombreCampo' de los parámetros
    // 👇 NUEVO: sin ofuscación, prompt explícito por tipo de campo
    public String generarSugerencia(String contextoFormulario, String descripcionTramite, List<String> urlsArchivos) {

        // 👇 NUEVO: Prompt estricto que le enseña a Gemini cómo formatear cada tipo
        String promptText = String.format(
                "Eres un analista experto de un sistema BPMS. Analiza el relato del trámite " +
                        "y los documentos adjuntos, luego rellena el formulario que te paso.\n\n" +
                        "RELATO DEL TRÁMITE:\n%s\n\n" +
                        "FORMULARIO A RELLENAR (array de campos con su definición):\n%s\n\n" +
                        "REGLAS ESTRICTAS:\n" +
                        "1. Devuelve SOLO un objeto JSON válido, sin markdown ni texto extra.\n" +
                        "2. Las CLAVES del JSON deben ser EXACTAMENTE el valor del campo `id` de cada objeto del formulario. NUNCA uses la `etiqueta` como clave.\n"
                        +
                        "3. Los VALORES deben respetar estrictamente el `tipo` de cada campo:\n" +
                        "   - texto, textarea, email, telefono: string breve y relevante.\n" +
                        "   - numero: número (no string, sin comillas).\n" +
                        "   - fecha: string formato 'YYYY-MM-DD'.\n" +
                        "   - hora: string formato 'HH:mm'.\n" +
                        "   - fecha_hora: string formato 'YYYY-MM-DDTHH:mm'.\n" +
                        "   - si_no: exactamente la string 'SI' o 'NO' (en mayúsculas, sin tildes).\n" +
                        "   - calificacion: número entero entre 1 y `escalaMax` (por defecto 1..5). NUNCA devuelvas texto ni explicación aquí, SOLO el número.\n"
                        +
                        "   - seleccion, radio: uno de los `valor` presentes en el array `opcionesList` del campo.\n" +
                        "   - checkbox: array de strings, cada uno siendo un `valor` del `opcionesList`.\n" +
                        "   - tabla: array de objetos. Cada objeto usa los `id` de `columnasTabla` como claves.\n" +
                        "4. Si un campo es del tipo `archivo` o `imagen`, OMÍTELO del JSON (no puedes generar archivos).\n"
                        +
                        "5. Si no puedes inferir un valor razonable para un campo, OMÍTELO (no inventes datos sin sustento).\n"
                        +
                        "6. Basa tus respuestas en el relato Y en el contenido de los documentos adjuntos (PDFs/imágenes).",
                descripcionTramite == null ? "" : descripcionTramite,
                contextoFormulario == null ? "" : contextoFormulario);

        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("text", promptText));

        if (urlsArchivos != null) {
            for (String urlRelativa : urlsArchivos) {
                Map<String, Object> filePart = procesarArchivoParaGemini(urlRelativa);
                if (filePart != null) {
                    parts.add(filePart);
                }
            }
        }

        // 👇 NUEVO: construir request body + headers + entity ANTES del loop
        Map<String, Object> generationConfig = Map.of(
                "responseMimeType", "application/json");

        Map<String, Object> requestBody = Map.of(
                "contents", List.of(Map.of("parts", parts)),
                "generationConfig", generationConfig);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        // 👇 NUEVO: lista de modelos con fallback automático si uno está saturado
        String[] modelos = {
                "gemini-2.5-flash",
                "gemini-2.5-flash-lite",
                "gemini-2.0-flash"
        };

        Exception ultimoError = null;
        for (String modelo : modelos) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + modelo + ":generateContent?key=" + apiKey;
            try {
                Map response = restTemplate.postForObject(url, entity, Map.class);
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
                Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                List<Map<String, Object>> responseParts = (List<Map<String, Object>>) content.get("parts");
                return (String) responseParts.get(0).get("text");
            } catch (Exception e) {
                ultimoError = e;
                // Si es 503/429/UNAVAILABLE, reintentar con siguiente modelo
                String msg = e.getMessage() != null ? e.getMessage() : "";
                if (msg.contains("503") || msg.contains("429") || msg.contains("UNAVAILABLE")
                        || msg.contains("overloaded")) {
                    System.err.println("⚠️ Modelo " + modelo + " saturado, probando siguiente...");
                    continue;
                }
                // Otro tipo de error: no tiene sentido reintentar con otro modelo
                throw new RuntimeException("Error en API de IA: " + e.getMessage());
            }
        }
        throw new RuntimeException("Todos los modelos Gemini están saturados. Intenta en unos minutos. Último error: "
                + (ultimoError != null ? ultimoError.getMessage() : "desconocido"));
    }

    // 👇 NUEVO: Función para leer el archivo del disco y pasarlo al formato Gemini
    /**
     * 👇 NUEVO S3: Lee un archivo (desde URL de S3 o desde filesystem legacy)
     * y lo convierte a formato inlineData para mandárselo a Gemini.
     *
     * Soporta DOS modalidades:
     *  - URLs absolutas de S3: https://bpms-core-archivos-oliver.s3.us-east-2.amazonaws.com/...
     *  - URLs relativas legacy: /api/archivos/ver/uuid.pdf (filesystem viejo)
     */
    private Map<String, Object> procesarArchivoParaGemini(String url) {
        if (url == null || url.isBlank()) return null;

        try {
            byte[] fileBytes;
            String mimeType;

            if (url.startsWith("http://") || url.startsWith("https://")) {
                // 👇 NUEVO: descargar desde URL pública (S3, CloudFront, etc.)
                java.net.URL urlObj = java.net.URI.create(url).toURL();
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) urlObj.openConnection();
                conn.setRequestMethod("GET");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);

                if (conn.getResponseCode() != 200) {
                    System.err.println("[Gemini] No se pudo descargar archivo S3 (" + conn.getResponseCode() + "): " + url);
                    return null;
                }

                mimeType = conn.getContentType();
                if (mimeType == null) mimeType = inferirMimeDesdeUrl(url);

                try (java.io.InputStream is = conn.getInputStream();
                     java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = is.read(buffer)) != -1) bos.write(buffer, 0, n);
                    fileBytes = bos.toByteArray();
                }
            } else {
                // 👇 LEGACY: archivo en filesystem (compatibilidad con archivos viejos)
                String rutaLogica = url.replace("/api/archivos/ver/", "");
                Path filePath = Paths.get(CARPETA_BASE, rutaLogica);
                if (!Files.exists(filePath)) {
                    System.err.println("[Gemini] Archivo legacy no encontrado: " + filePath);
                    return null;
                }
                mimeType = Files.probeContentType(filePath);
                if (mimeType == null) mimeType = inferirMimeDesdeUrl(url);
                fileBytes = Files.readAllBytes(filePath);
            }

            String base64Data = Base64.getEncoder().encodeToString(fileBytes);
            Map<String, String> inlineData = new HashMap<>();
            inlineData.put("mimeType", mimeType);
            inlineData.put("data", base64Data);

            return Map.of("inlineData", inlineData);

        } catch (Exception e) {
            System.err.println("[Gemini] No se pudo procesar archivo para IA: " + url + " — " + e.getMessage());
            return null;
        }
    }

    /** 👇 NUEVO: infiere el mime type a partir de la extensión del archivo si no viene del header HTTP. */
    private String inferirMimeDesdeUrl(String url) {
        String lower = url.toLowerCase();
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        return "application/octet-stream";
    }

    private String ofuscarDatosSensibles(String texto) {
        if (texto == null)
            return "";
        texto = texto.replaceAll("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", "[CORREO_OCULTO]");
        texto = texto.replaceAll("\\b\\d{7,15}\\b", "[NUMERO_OCULTO]");
        return texto;
    }

    // 👇 NUEVO CU17: método robusto que valida, matchea y enriquece la respuesta de la IA
    public FlujoGeneradoResponse generarFlujoBpmn(String promptAdmin, String departamentosDisponibles) {

        // 1. Llamar a la IA y obtener el JSON crudo
        String jsonCrudo = invocarGeminiParaFlujo(promptAdmin, departamentosDisponibles);

        // 2. Parsear el JSON a estructura tipada
        // 2. Parsear el JSON a estructura tipada
        // 2. Parsear el JSON a estructura tipada (usando JsonParserFactory de Spring Boot)
        FlujoGeneradoIA flujo;
        try {
            flujo = parsearJsonAFlujo(jsonCrudo);
        } catch (Exception e) {
            throw new RuntimeException("FLUJO_INCOHERENTE: La IA devolvió un JSON inválido. " + e.getMessage());
        }

        // 3. Validar estructura mínima
        if (flujo.getDepartamentos() == null || flujo.getDepartamentos().isEmpty()) {
            throw new RuntimeException("FLUJO_INCOHERENTE: La IA no identificó ningún departamento.");
        }
        if (flujo.getNodos() == null || flujo.getNodos().size() < 2) {
            throw new RuntimeException("FLUJO_INCOHERENTE: La IA no generó suficientes nodos para construir un flujo.");
        }
        if (flujo.getConexiones() == null || flujo.getConexiones().isEmpty()) {
            throw new RuntimeException("FLUJO_INCOHERENTE: La IA no generó conexiones entre los nodos.");
        }

        // 4. Validar que tenga StartEvent y EndEvent
        boolean tieneStart = flujo.getNodos().stream().anyMatch(n -> "StartEvent".equalsIgnoreCase(n.getTipo()));
        boolean tieneEnd = flujo.getNodos().stream().anyMatch(n -> "EndEvent".equalsIgnoreCase(n.getTipo()));
        if (!tieneStart || !tieneEnd) {
            throw new RuntimeException("FLUJO_INCOHERENTE: El flujo debe tener al menos un inicio y un fin.");
        }

        // 5. Matchear departamentos contra BD y construir respuesta enriquecida
        FlujoGeneradoResponse response = new FlujoGeneradoResponse();
        List<String> advertencias = new ArrayList<>();
        List<String> noMatcheados = new ArrayList<>();

        // Cargar departamentos reales de BD (incluyendo el "Cliente" virtual)
        List<Departamento> deptosBD = departamentoRepository.findAll();

        // Matchear cada departamento que devolvió la IA
        List<String> deptosNormalizados = new ArrayList<>();
        for (String deptoIA : flujo.getDepartamentos()) {
            String matcheado = matchearDepartamento(deptoIA, deptosBD);
            if (matcheado == null) {
                // No hubo match → registrar en no-matcheados
                noMatcheados.add(deptoIA);
                advertencias.add("⚠️ El departamento \"" + deptoIA + "\" no existe en BD. Crea uno nuevo o reasigna manualmente.");
                deptosNormalizados.add(deptoIA); // se mantiene el nombre original
            } else if (!matcheado.equalsIgnoreCase(deptoIA)) {
                // Match parcial → avisar
                advertencias.add("ℹ️ Asigné \"" + deptoIA + "\" → \"" + matcheado + "\" por similitud.");
                deptosNormalizados.add(matcheado);
            } else {
                // Match exacto, no hace falta avisar
                deptosNormalizados.add(matcheado);
            }
        }
        flujo.setDepartamentos(deptosNormalizados);

        // 6. Reemplazar también las referencias en cada nodo (deptos viejos → matcheados)
        for (FlujoGeneradoIA.NodoIA nodo : flujo.getNodos()) {
            String deptoIA = nodo.getDepartamento();
            if (deptoIA == null) continue;
            String matcheado = matchearDepartamento(deptoIA, deptosBD);
            if (matcheado != null) {
                nodo.setDepartamento(matcheado);
            }
        }

        response.setFlujo(flujo);
        response.setAdvertencias(advertencias);
        response.setDepartamentosNoMatcheados(noMatcheados);
        response.setTotalNodos(flujo.getNodos().size());
        response.setTotalConexiones(flujo.getConexiones().size());

        return response;
    }

    /**
     * 👇 NUEVO CU17: matchea el nombre de la IA contra los departamentos reales en BD.
     *
     * Estrategia:
     * 1. Match exacto case-insensitive
     * 2. Match exacto sin tildes ni espacios extras
     * 3. Match por inclusión (BD contiene IA o viceversa)
     * 4. Match especial: "Cliente / Solicitante" → "Cliente / Solicitante" (virtual)
     *
     * Retorna el nombre canónico del departamento, o null si no encuentra match.
     */
    private String matchearDepartamento(String nombreIA, List<Departamento> deptosBD) {
        if (nombreIA == null || nombreIA.isBlank()) return null;

        String iaNorm = normalizar(nombreIA);

        // Caso especial: cliente virtual
        if (iaNorm.contains("cliente") || iaNorm.contains("solicitante")) {
            return "Cliente / Solicitante";
        }

        // 1. Match exacto case-insensitive
        for (Departamento d : deptosBD) {
            if (d.getNombre().equalsIgnoreCase(nombreIA)) {
                return d.getNombre();
            }
        }

        // 2. Match exacto normalizado
        for (Departamento d : deptosBD) {
            if (normalizar(d.getNombre()).equals(iaNorm)) {
                return d.getNombre();
            }
        }

        // 3. Match por inclusión
        for (Departamento d : deptosBD) {
            String bdNorm = normalizar(d.getNombre());
            if (bdNorm.contains(iaNorm) || iaNorm.contains(bdNorm)) {
                return d.getNombre();
            }
        }

        return null;
    }

    /**
     * Normaliza para comparar: minúsculas, sin tildes, sin espacios extras.
     */
    private String normalizar(String s) {
        if (s == null) return "";
        String sinTildes = Normalizer.normalize(s, Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
        return sinTildes.toLowerCase().trim().replaceAll("\\s+", " ");
    }

    /**
     * Llama a Gemini para GENERAR un flujo nuevo. Construye el prompt y delega en invocarGeminiConPrompt.
     */
    private String invocarGeminiParaFlujo(String promptAdmin, String departamentosDisponibles) {
        String promptText = "Eres un experto arquitecto de procesos de negocio (BPMN). " +
                "Basado en la siguiente descripción del administrador, genera una estructura JSON estricta " +
                "que represente el flujo de trabajo.\n\n" +
                "DESCRIPCIÓN DEL FLUJO:\n" + promptAdmin + "\n\n" +
                "REGLAS ESTRICTAS:\n" +
                "1. Devuelve SOLO un objeto JSON válido, sin markdown ni comillas invertidas.\n" +
                "2. El JSON debe tener exactamente 3 claves: 'departamentos', 'nodos' y 'conexiones'.\n" +
                "3. 'departamentos': Array de strings. SOLO puedes usar nombres de esta lista exacta: [" + departamentosDisponibles + "]. NUNCA inventes nombres nuevos. Si no hay match perfecto, usa el más parecido de la lista.\n" +
                "4. 'nodos': Array de objetos. Cada objeto debe tener:\n" +
                "   - 'id': identificador único alfanumérico (ej: StartEvent_1, Task_1, Gateway_1, EndEvent_1)\n" +
                "   - 'tipo': SOLO uno de: StartEvent, UserTask, ExclusiveGateway, ParallelGateway, EndEvent\n" +
                "   - 'nombre': etiqueta descriptiva (ej: 'Revisar documentos', '¿Está aprobado?')\n" +
                "   - 'departamento': nombre EXACTO de uno del array 'departamentos' anterior.\n" +
                "5. 'conexiones': Array de objetos con:\n" +
                "   - 'origen': id del nodo de salida\n" +
                "   - 'destino': id del nodo de llegada\n" +
                "   - 'nombre': texto de la flecha. OBLIGATORIO si origen es ExclusiveGateway (usar 'APROBADO'/'RECHAZADO' o 'SI'/'NO'). Para los demás, déjalo vacío ''.\n\n" +
                "REGLAS LÓGICAS:\n" +
                "- DEBE haber EXACTAMENTE UN StartEvent y AL MENOS UN EndEvent.\n" +
                "- Todo nodo (excepto EndEvent) debe tener al menos una conexión saliente.\n" +
                "- Todo ExclusiveGateway debe tener AL MENOS 2 conexiones salientes con nombres distintos.\n" +
                "- Si la descripción es ambigua o no se puede inferir un flujo lógico, devuelve un JSON con array 'nodos' vacío.";
        return invocarGeminiConPrompt(promptText);
    }
    // =========================================================================
    //  IA Colaborativa — editar un diagrama existente
    // =========================================================================

    /**
     * Recibe el contexto JSON del diagrama actual (nodos + conexiones serializados
     * por el frontend) y una instrucción en lenguaje natural. Devuelve una lista
     * de operaciones delta para que el frontend las aplique sobre el grafo.
     */
    public EdicionFlujoResponse editarFlujo(String contextoJson,
                                             String instruccion,
                                             String departamentosDisponibles) {

        String promptText =
            "Eres un editor experto de diagramas de actividades UML por calles (swimlane).\n" +
            "El usuario tiene el siguiente diagrama:\n\n" +
            "DIAGRAMA ACTUAL (JSON):\n" + contextoJson + "\n\n" +
            "DEPARTAMENTOS DISPONIBLES: [" + (departamentosDisponibles != null ? departamentosDisponibles : "") + "]\n\n" +
            "INSTRUCCIÓN DEL USUARIO: " + instruccion + "\n\n" +
            "Devuelve SOLO un objeto JSON válido sin markdown con esta estructura:\n" +
            "{\n" +
            "  \"operaciones\": [...],\n" +
            "  \"advertencias\": [...],\n" +
            "  \"resumen\": \"...\"\n" +
            "}\n\n" +
            "Cada operación en el array 'operaciones' debe ser uno de estos objetos:\n" +
            "  { \"tipo\": \"AGREGAR_DEPARTAMENTO\", \"nombre\": \"...\" }\n" +
            "  { \"tipo\": \"AGREGAR_NODO\", \"id\": \"Task_NEW_1\", \"nombre\": \"...\", \"tipoNodo\": \"UserTask|ExclusiveGateway|ParallelGateway|StartEvent|EndEvent\", \"departamento\": \"...\" }\n" +
            "  { \"tipo\": \"AGREGAR_CONEXION\", \"origen\": \"...\", \"destino\": \"...\", \"condicion\": \"\" }\n" +
            "  { \"tipo\": \"ACTUALIZAR_NODO\", \"id\": \"...\", \"nombre\": \"...\", \"departamento\": \"...\" }\n" +
            "  { \"tipo\": \"ELIMINAR_NODO\", \"id\": \"...\" }\n" +
            "  { \"tipo\": \"ELIMINAR_CONEXION\", \"origen\": \"...\", \"destino\": \"...\" }\n\n" +
            "REGLAS:\n" +
            "1. Usa los IDs existentes al referenciar nodos ya en el diagrama.\n" +
            "2. Para nodos nuevos usa IDs únicos como Task_NEW_1, Gateway_NEW_1, etc.\n" +
            "3. Si necesitas un departamento nuevo, pon PRIMERO la operación AGREGAR_DEPARTAMENTO.\n" +
            "4. El array 'advertencias' lista avisos no críticos (ej: departamento no encontrado).\n" +
            "5. 'resumen' es una oración corta describiendo qué se cambió.\n" +
            "6. Si la instrucción no tiene sentido para este diagrama, devuelve operaciones vacías y explica en advertencias.";

        String jsonCrudo = invocarGeminiConPrompt(promptText);

        try {
            return parsearEdicionFlujo(jsonCrudo);
        } catch (Exception e) {
            throw new RuntimeException("FLUJO_INCOHERENTE: La IA devolvió una respuesta de edición inválida. " + e.getMessage());
        }
    }

    /** Llama a Gemini con un prompt arbitrario y devuelve el texto de la respuesta. */
    private String invocarGeminiConPrompt(String promptText) {
        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("text", promptText));

        Map<String, Object> generationConfig = Map.of("responseMimeType", "application/json");
        Map<String, Object> requestBody = Map.of(
                "contents", List.of(Map.of("parts", parts)),
                "generationConfig", generationConfig);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        String[] modelos = { "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash" };
        Exception ultimoError = null;
        for (String modelo : modelos) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + modelo + ":generateContent?key=" + apiKey;
            try {
                Map response = restTemplate.postForObject(url, entity, Map.class);
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
                Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                List<Map<String, Object>> responseParts = (List<Map<String, Object>>) content.get("parts");
                String result = (String) responseParts.get(0).get("text");
                return result.replace("```json", "").replace("```", "").trim();
            } catch (Exception e) {
                ultimoError = e;
                String msg = e.getMessage() != null ? e.getMessage() : "";
                if (msg.contains("503") || msg.contains("429") || msg.contains("UNAVAILABLE") || msg.contains("overloaded")) {
                    continue;
                }
                throw new RuntimeException("Error en API de IA: " + e.getMessage());
            }
        }
        throw new RuntimeException("IA_SATURADA: Todos los modelos Gemini están saturados.");
    }

    @SuppressWarnings("unchecked")
    private EdicionFlujoResponse parsearEdicionFlujo(String jsonCrudo) {
        org.springframework.boot.json.JsonParser parser =
                org.springframework.boot.json.JsonParserFactory.getJsonParser();
        Map<String, Object> raw = parser.parseMap(jsonCrudo);

        EdicionFlujoResponse resp = new EdicionFlujoResponse();

        // operaciones
        Object opsObj = raw.get("operaciones");
        if (opsObj instanceof List) {
            List<OperacionDiagrama> ops = new ArrayList<>();
            for (Object o : (List<?>) opsObj) {
                Map<String, Object> m = (Map<String, Object>) o;
                OperacionDiagrama op = new OperacionDiagrama();
                op.setTipo(strOrNull(m.get("tipo")));
                op.setId(strOrNull(m.get("id")));
                op.setNombre(strOrNull(m.get("nombre")));
                op.setTipoNodo(strOrNull(m.get("tipoNodo")));
                op.setDepartamento(strOrNull(m.get("departamento")));
                op.setOrigen(strOrNull(m.get("origen")));
                op.setDestino(strOrNull(m.get("destino")));
                op.setCondicion(strOrNull(m.get("condicion")));
                ops.add(op);
            }
            resp.setOperaciones(ops);
        }

        // advertencias
        Object advObj = raw.get("advertencias");
        if (advObj instanceof List) {
            List<String> advs = new ArrayList<>();
            for (Object o : (List<?>) advObj) advs.add(String.valueOf(o));
            resp.setAdvertencias(advs);
        }

        // resumen
        resp.setResumen(strOrNull(raw.get("resumen")));

        return resp;
    }

    /**
     * 👇 NUEVO CU17: parseo manual del JSON usando JsonParserFactory de Spring Boot.
     * Evita la dependencia directa con Jackson ObjectMapper.
     */
    @SuppressWarnings("unchecked")
    private FlujoGeneradoIA parsearJsonAFlujo(String jsonCrudo) {
        org.springframework.boot.json.JsonParser jsonParser =
                org.springframework.boot.json.JsonParserFactory.getJsonParser();
        Map<String, Object> raw = jsonParser.parseMap(jsonCrudo);

        FlujoGeneradoIA flujo = new FlujoGeneradoIA();

        // departamentos
        Object deptsObj = raw.get("departamentos");
        if (deptsObj instanceof List) {
            List<String> deptos = new ArrayList<>();
            for (Object o : (List<?>) deptsObj) deptos.add(String.valueOf(o));
            flujo.setDepartamentos(deptos);
        }

        // nodos
        Object nodosObj = raw.get("nodos");
        if (nodosObj instanceof List) {
            List<FlujoGeneradoIA.NodoIA> nodos = new ArrayList<>();
            for (Object o : (List<?>) nodosObj) {
                Map<String, Object> m = (Map<String, Object>) o;
                FlujoGeneradoIA.NodoIA nodo = new FlujoGeneradoIA.NodoIA();
                nodo.setId(strOrNull(m.get("id")));
                nodo.setTipo(strOrNull(m.get("tipo")));
                nodo.setNombre(strOrNull(m.get("nombre")));
                nodo.setDepartamento(strOrNull(m.get("departamento")));
                nodos.add(nodo);
            }
            flujo.setNodos(nodos);
        }

        // conexiones
        Object connObj = raw.get("conexiones");
        if (connObj instanceof List) {
            List<FlujoGeneradoIA.ConexionIA> conns = new ArrayList<>();
            for (Object o : (List<?>) connObj) {
                Map<String, Object> m = (Map<String, Object>) o;
                FlujoGeneradoIA.ConexionIA c = new FlujoGeneradoIA.ConexionIA();
                c.setOrigen(strOrNull(m.get("origen")));
                c.setDestino(strOrNull(m.get("destino")));
                c.setNombre(strOrNull(m.get("nombre")));
                conns.add(c);
            }
            flujo.setConexiones(conns);
        }

        return flujo;
    }

    private String strOrNull(Object o) {
        return o == null ? null : String.valueOf(o);
    }
    /**
     * 👇 NUEVO Asistente IA Cliente: chatbot conversacional para clientes.
     * Construye contexto con catálogo de trámites ACTIVAS + trámites del cliente,
     * limita el dominio mediante prompt, y responde en JSON estructurado.
     */
    public ChatbotResponse chatbotCliente(String mensaje, List<Map<String, String>> historial, String clienteId) {

        // 1. Cargar catálogo de trámites ACTIVAS
        List<ProcesoDefinicion> activas = procesoRepository.findByEstado(EstadoProceso.ACTIVA);

        // 2. Cargar trámites del cliente (solo si está logueado como cliente)
        List<Tramite> misTramites = (clienteId != null && !clienteId.equals("SISTEMA"))
                ? tramiteRepository.findByClienteIdOrderByFechaCreacionDesc(clienteId)
                : new ArrayList<>();

        // 3. Construir el "system prompt" en español, acotado al dominio
        StringBuilder ctx = new StringBuilder();
        ctx.append("Eres el asistente virtual oficial del sistema BPMS Core de la institución. ");
        ctx.append("Tu misión es ayudar a los CIUDADANOS/CLIENTES a entender qué trámites pueden iniciar, ");
        ctx.append("cómo se procesan y a consultar el estado de sus solicitudes.\n\n");

        ctx.append("=== CATÁLOGO DE TRÁMITES DISPONIBLES ===\n");
        if (activas.isEmpty()) {
            ctx.append("(No hay trámites activos en este momento.)\n");
        } else {
            for (ProcesoDefinicion p : activas) {
                ctx.append("• ").append(p.getNombre()).append("\n");
                if (p.getDescripcion() != null && !p.getDescripcion().isBlank()) {
                    ctx.append("   ").append(p.getDescripcion()).append("\n");
                }
            }
        }

        if (!misTramites.isEmpty()) {
            ctx.append("\n=== TRÁMITES DEL USUARIO ACTUAL (").append(clienteId).append(") ===\n");
            for (Tramite t : misTramites) {
                ctx.append("• Código de seguimiento: ").append(t.getCodigoSeguimiento());
                if (t.getDescripcion() != null) ctx.append(" — ").append(t.getDescripcion());
                if (t.getEstadoSemaforo() != null) ctx.append(" — Estado: ").append(t.getEstadoSemaforo());
                ctx.append("\n");
            }
        } else if (clienteId != null && !clienteId.equals("SISTEMA")) {
            ctx.append("\n=== TRÁMITES DEL USUARIO ACTUAL ===\n");
            ctx.append("(El usuario aún no tiene trámites iniciados.)\n");
        }

        ctx.append("\n=== REGLAS ESTRICTAS ===\n");
        ctx.append("1. Tu dominio de respuesta incluye TODO lo relacionado con los trámites de esta institución:\n");
        ctx.append("   - Qué son los trámites, para qué sirven, cómo solicitarlos y cuánto tardan.\n");
        ctx.append("   - Explicar qué es o cómo obtener cualquier DOCUMENTO o REQUISITO mencionado en los formularios\n");
        ctx.append("     (ej: DPI, NIT, patente de sociedad, acta de constitución, colegiatura, escritura pública, paz y salvo, etc.).\n");
        ctx.append("   - Orientar sobre el estado de los trámites del usuario actual.\n");
        ctx.append("2. NUNCA menciones códigos internos, IDs técnicos, nombres de pasos del flujo ni estructura interna del sistema. Esa información es confidencial.\n");
        ctx.append("3. Cuando menciones un trámite, usa SIEMPRE su nombre oficial. NUNCA repitas literalmente su campo descripción como si fuera el nombre.\n");
        ctx.append("4. NUNCA inventes trámites que no estén en el catálogo. Si no existe lo que busca, dilo y sugiere los más parecidos.\n");
        ctx.append("5. NUNCA reveles datos de OTROS usuarios. Solo del usuario actual.\n");
        ctx.append("6. SOLO rechaza preguntas completamente ajenas al ámbito institucional: recetas, deportes, entretenimiento, política, etc.\n");
        ctx.append("   Si hay alguna relación con un trámite o un requisito — aunque sea indirecta — RESPONDE de forma útil.\n");
        ctx.append("7. Tono: amable, claro y profesional. Máximo 3 párrafos cortos. Usa emojis con moderación (máx 1-2 por mensaje).\n");
        ctx.append("8. Si el usuario pregunta por el ESTADO de un trámite, indícale que haga clic en '🔍 Rastrear Trámite' en el menú lateral izquierdo con su código de seguimiento.\n");
        ctx.append("9. Devuelve la respuesta SIEMPRE en JSON válido con esta forma base:\n");
        ctx.append("   {\"respuesta\": \"texto al usuario\", \"sugerenciasRapidas\": [\"pregunta 1\", \"pregunta 2\"]}\n");
        ctx.append("10. Las sugerencias deben ser preguntas cortas (máx 7 palabras) relevantes al hilo. Genera exactamente 2 sugerencias.\n");
        ctx.append("11. DETECCIÓN DE INTENCIÓN: Si el usuario quiere INICIAR un trámite ESPECÍFICO del catálogo (ejemplo: 'quiero hacer el trámite X', 'necesito iniciar X', 'cómo inicio X'), agrega al JSON:\n");
        ctx.append("    \"accion\": \"INICIAR_TRAMITE\", \"procesoNombre\": \"[nombre exacto del trámite del catálogo]\"\n");
        ctx.append("    En la respuesta de texto, confirma brevemente el trámite y dile que puede iniciarlo con el botón que aparecerá. NO digas 'haz clic en Nuevo Trámite'.\n");
        ctx.append("    Si quiere iniciar un trámite pero no especifica cuál, NO incluyas accion ni procesoNombre — oriéntalo a '📝 Nuevo Trámite' en el menú lateral.\n");
        ctx.append("12. CONSULTA DE REQUISITOS: Si el usuario pregunta qué documentos, campos o requisitos necesita para un trámite ESPECÍFICO del catálogo\n");
        ctx.append("    (ej: '¿qué necesito para X?', '¿qué documentos pide X?', '¿cuáles son los requisitos de X?', '¿cómo aplico para X?'), agrega al JSON:\n");
        ctx.append("    \"accion\": \"MOSTRAR_REQUISITOS\", \"procesoNombre\": \"[nombre exacto del trámite del catálogo]\"\n");
        ctx.append("    En la respuesta de texto, confirma brevemente qué trámite es y que se mostrarán sus requisitos. NO inventes los campos — el sistema los cargará.\n");
        ctx.append("    IMPORTANTE: MOSTRAR_REQUISITOS e INICIAR_TRAMITE son mutuamente excluyentes — usa solo uno por mensaje.\n");

        // 4. Armar la lista de contents para Gemini (formato role/parts)
        List<Map<String, Object>> contents = new ArrayList<>();
        contents.add(Map.of(
                "role", "user",
                "parts", List.of(Map.of("text", ctx.toString()))
        ));
        contents.add(Map.of(
                "role", "model",
                "parts", List.of(Map.of("text",
                        "Entendido. Estoy listo para ayudar al ciudadano con consultas sobre los trámites disponibles y el estado de sus solicitudes, respetando las reglas."))
        ));

        // 5. Agregar historial reciente (últimos 10 turnos máximo)
        if (historial != null) {
            int desde = Math.max(0, historial.size() - 10);
            for (int i = desde; i < historial.size(); i++) {
                Map<String, String> m = historial.get(i);
                String rolMsg = "user".equalsIgnoreCase(m.get("rol")) ? "user" : "model";
                String contenido = m.get("contenido");
                if (contenido == null || contenido.isBlank()) continue;
                contents.add(Map.of(
                        "role", rolMsg,
                        "parts", List.of(Map.of("text", contenido))
                ));
            }
        }

        // 6. Mensaje actual del usuario
        contents.add(Map.of(
                "role", "user",
                "parts", List.of(Map.of("text", mensaje))
        ));

        Map<String, Object> generationConfig = Map.of("responseMimeType", "application/json");
        Map<String, Object> requestBody = Map.of(
                "contents", contents,
                "generationConfig", generationConfig
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        // 7. Llamar a Gemini con fallback de 3 modelos
        String[] modelos = { "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash" };
        Exception ultimoError = null;

        for (String modelo : modelos) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + modelo + ":generateContent?key=" + apiKey;
            try {
                Map response = restTemplate.postForObject(url, entity, Map.class);
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
                Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                List<Map<String, Object>> responseParts = (List<Map<String, Object>>) content.get("parts");
                String jsonResult = ((String) responseParts.get(0).get("text"))
                        .replace("```json", "").replace("```", "").trim();
                ChatbotResponse chatResp = parsearChatbotResponse(jsonResult);
                resolverProcesoId(chatResp, activas);
                resolverRequisitos(chatResp, activas);
                return chatResp;
            } catch (Exception e) {
                ultimoError = e;
                String msg = e.getMessage() != null ? e.getMessage() : "";
                if (msg.contains("503") || msg.contains("429") || msg.contains("UNAVAILABLE")
                        || msg.contains("overloaded")) {
                    System.err.println("⚠️ Modelo " + modelo + " saturado en chatbot, probando siguiente...");
                    continue;
                }
                throw new RuntimeException("Error en chatbot IA: " + e.getMessage());
            }
        }
        throw new RuntimeException("IA_SATURADA: Todos los modelos Gemini están saturados. Intenta en unos segundos. Último error: "
                + (ultimoError != null ? ultimoError.getMessage() : "desconocido"));
    }

    /**
     * 👇 NUEVO Asistente IA Cliente: parseo del JSON de respuesta usando JsonParserFactory.
     */
    @SuppressWarnings("unchecked")
    private ChatbotResponse parsearChatbotResponse(String jsonCrudo) {
        org.springframework.boot.json.JsonParser jsonParser =
                org.springframework.boot.json.JsonParserFactory.getJsonParser();
        Map<String, Object> raw = jsonParser.parseMap(jsonCrudo);

        ChatbotResponse resp = new ChatbotResponse();
        resp.setRespuesta(strOrNull(raw.get("respuesta")));
        resp.setAccion(strOrNull(raw.get("accion")));
        resp.setProcesoNombre(strOrNull(raw.get("procesoNombre")));

        Object sugObj = raw.get("sugerenciasRapidas");
        List<String> sugs = new ArrayList<>();
        if (sugObj instanceof List) {
            for (Object o : (List<?>) sugObj) {
                if (o != null) sugs.add(String.valueOf(o));
            }
        }
        resp.setSugerenciasRapidas(sugs);

        return resp;
    }

    // Busca el procesoId por nombre cuando Gemini detectó intención INICIAR_TRAMITE
    private void resolverProcesoId(ChatbotResponse resp, List<ProcesoDefinicion> activas) {
        if (!"INICIAR_TRAMITE".equals(resp.getAccion()) || resp.getProcesoNombre() == null) return;
        String nombreBuscado = normalizar(resp.getProcesoNombre());
        activas.stream()
            .filter(p -> normalizar(p.getNombre()).equals(nombreBuscado)
                      || normalizar(p.getNombre()).contains(nombreBuscado)
                      || nombreBuscado.contains(normalizar(p.getNombre())))
            .findFirst()
            .ifPresentOrElse(
                p -> { resp.setProcesoId(p.getId()); resp.setProcesoNombre(p.getNombre()); },
                () -> resp.setAccion(null) // No encontrado → no mostrar botón
            );
    }

    // Resuelve procesoId + extrae campos del paso inicial cuando Gemini detectó MOSTRAR_REQUISITOS
    private void resolverRequisitos(ChatbotResponse resp, List<ProcesoDefinicion> activas) {
        if (!"MOSTRAR_REQUISITOS".equals(resp.getAccion()) || resp.getProcesoNombre() == null) return;
        String nombreBuscado = normalizar(resp.getProcesoNombre());
        activas.stream()
            .filter(p -> normalizar(p.getNombre()).equals(nombreBuscado)
                      || normalizar(p.getNombre()).contains(nombreBuscado)
                      || nombreBuscado.contains(normalizar(p.getNombre())))
            .findFirst()
            .ifPresentOrElse(
                p -> {
                    resp.setProcesoId(p.getId());
                    resp.setProcesoNombre(p.getNombre());
                    resp.setRequisitos(extraerCamposIniciales(p));
                },
                () -> resp.setAccion(null)
            );
    }

    // Extrae los campos del paso inicial de un proceso (los que el cliente debe rellenar)
    private List<RequisitoCampo> extraerCamposIniciales(ProcesoDefinicion proceso) {
        List<RequisitoCampo> resultado = new ArrayList<>();
        if (proceso.getPasos() == null || proceso.getPasos().isEmpty()) return resultado;

        String pasoInicialId = proceso.getPasoInicialId();
        Paso pasoInicial = proceso.getPasos().stream()
            .filter(p -> p.getId() != null && p.getId().equals(pasoInicialId))
            .findFirst()
            .orElse(proceso.getPasos().get(0));

        if (pasoInicial.getCampos() == null) return resultado;

        for (CampoFormulario campo : pasoInicial.getCampos()) {
            // Ignorar campos decorativos sin valor de datos
            String tipo = campo.getTipo();
            if ("titulo".equals(tipo) || "separador".equals(tipo) || "texto_estatico".equals(tipo)) continue;
            if (campo.getEtiqueta() == null || campo.getEtiqueta().isBlank()) continue;
            resultado.add(new RequisitoCampo(campo.getEtiqueta(), tipo, campo.isRequerido()));
        }
        return resultado;
    }

    /**
     * CU17: Orquestador del Asistente de Voz.
     * Flujo:
     *  1. Carga el catálogo activo desde MongoDB y lo serializa como JSON.
     *  2. Envía el audio + catálogo al microservicio Python/FastAPI.
     *  3. Evalúa la intención y el nivel de confianza recibidos.
     *  4. Si confianza >= 0.65 e intención == INICIAR_TRAMITE → redirige al formulario.
     *  5. Si confianza baja o NO_RECONOCIDO → envía al catálogo manual.
     *  6. Si es conversación → delega a Gemini chatbot.
     */
    public Map<String, Object> procesarComandoVoz(org.springframework.web.multipart.MultipartFile archivoAudio, String clienteId) {

        // Validación de tamaño mínimo (seguridad: el frontend ya lo valida, esto es doble check)
        if (archivoAudio.isEmpty() || archivoAudio.getSize() < 1000) {
            return Map.of(
                "exito", false,
                "accion", "AUDIO_INVALIDO",
                "mensaje", "La grabación fue muy corta. Mantén presionado y habla claramente.",
                "textoTranscrito", ""
            );
        }

        // 1. Cargar catálogo activo para enviar a Python (evita el hardcoding en nlp_service.py)
        List<ProcesoDefinicion> activas = procesoRepository.findByEstado(EstadoProceso.ACTIVA);
        String catalogoJson = buildCatalogoJson(activas);

        // 2. Enviar audio + catálogo al microservicio NLP Python
        String nlpUrl = nlpServiceUrl + "/tramites/voz";
        Map<String, Object> nlpResponse;
        String textoTranscrito = "";

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            org.springframework.util.MultiValueMap<String, Object> body = new org.springframework.util.LinkedMultiValueMap<>();
            final String catalogoJsonFinal = catalogoJson;
            org.springframework.core.io.ByteArrayResource fileAsResource = new org.springframework.core.io.ByteArrayResource(archivoAudio.getBytes()) {
                @Override
                public String getFilename() {
                    return archivoAudio.getOriginalFilename() != null ? archivoAudio.getOriginalFilename() : "audio_cliente.webm";
                }
            };
            body.add("file",     fileAsResource);
            body.add("catalogo", catalogoJsonFinal);

            HttpEntity<org.springframework.util.MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);
            nlpResponse = restTemplate.postForObject(nlpUrl, requestEntity, Map.class);

        } catch (Exception e) {
            System.err.println("⚠️ [CU17] Error conectando al microservicio NLP: " + e.getMessage());
            ChatbotResponse chatResp = chatbotCliente("Hola, necesito ayuda con un trámite.", new ArrayList<>(), clienteId);
            return Map.of("exito", false, "accion", "CHARLAR", "mensaje", chatResp.getRespuesta(), "textoTranscrito", "");
        }

        // 3. Extraer campos de la respuesta Python
        String intencion    = (String) nlpResponse.get("intencion_detectada");
        String codigoTramite = (String) nlpResponse.get("id_tramite_sugerido");
        textoTranscrito     = (String) nlpResponse.getOrDefault("texto_transcrito", "");

        Double confianza = null;
        Object confObj = nlpResponse.get("nivel_confianza");
        if (confObj instanceof Number) {
            confianza = ((Number) confObj).doubleValue();
        }

        Map<String, Object> resultado = new HashMap<>();
        resultado.put("textoTranscrito", textoTranscrito != null ? textoTranscrito : "");

        // 4. Intención INICIAR_TRAMITE con confianza suficiente → buscar proceso y redirigir
        if ("INICIAR_TRAMITE".equals(intencion) && codigoTramite != null
                && (confianza == null || confianza >= 0.65)) {

            ProcesoDefinicion procesoElegido = activas.stream()
                    .filter(p -> codigoTramite.equalsIgnoreCase(p.getCodigo())
                              || codigoTramite.equalsIgnoreCase(p.getId()))
                    .findFirst()
                    .orElse(null);

            if (procesoElegido != null) {
                resultado.put("exito",    true);
                resultado.put("accion",   "REDIRECCIONAR_FORMULARIO");
                resultado.put("procesoId", procesoElegido.getId());
                resultado.put("mensaje",  "Entendido. Preparando el trámite: " + procesoElegido.getNombre() + ".");
                return resultado;
            }
        }

        // 5. Confianza baja o intención no reconocida → catálogo manual (fallback del CU17)
        if ("NO_RECONOCIDO".equals(intencion) || (confianza != null && confianza < 0.65)) {
            resultado.put("exito",   true);
            resultado.put("accion",  "CATALOGO_MANUAL");
            resultado.put("mensaje", "No pude identificar el trámite con claridad. Aquí tienes el catálogo completo.");
            return resultado;
        }

        // 6. Fallback conversacional con Gemini
        String textoChatbot = (textoTranscrito != null && !textoTranscrito.isEmpty()) ? textoTranscrito : "Hola";
        ChatbotResponse chatResp = chatbotCliente(textoChatbot, new ArrayList<>(), clienteId);
        resultado.put("exito",   true);
        resultado.put("accion",  "CHARLAR");
        resultado.put("mensaje", chatResp.getRespuesta());
        return resultado;
    }

    /**
     * CU17 (Opción B): texto transcrito por Web Speech API → NLP Python → respuesta.
     * Usa URL configurable, devuelve candidatos alternativos y registra en auditoría.
     */
    public Map<String, Object> procesarComandoVozTexto(String texto, String clienteId, List<Map<String, String>> historial) {

        if (texto == null || texto.trim().length() < 3) {
            return Map.of(
                "exito", false, "accion", "TEXTO_INVALIDO",
                "mensaje", "No recibí texto. Intenta de nuevo.", "textoTranscrito", ""
            );
        }

        List<ProcesoDefinicion> activas = procesoRepository.findByEstado(EstadoProceso.ACTIVA);
        String catalogoJson = buildCatalogoJson(activas);
        Map<String, Object> nlpResponse;

        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);
            org.springframework.util.MultiValueMap<String, Object> body = new org.springframework.util.LinkedMultiValueMap<>();
            body.add("texto",    texto.trim());
            body.add("catalogo", catalogoJson);
            nlpResponse = restTemplate.postForObject(
                nlpServiceUrl + "/tramites/nlp",
                new HttpEntity<>(body, headers), Map.class);

        } catch (Exception e) {
            System.err.println("⚠️ [CU17] NLP caído, usando Gemini como fallback: " + e.getMessage());
            auditService.registrar(clienteId, "TRAMITE", "VOZ_NLP_FALLBACK",
                "Python inaccesible. Texto: " + texto.trim());
            ChatbotResponse chatResp = chatbotCliente(texto.trim(), historial, clienteId);
            return Map.of("exito", false, "accion", "CHARLAR",
                          "mensaje", chatResp.getRespuesta(), "textoTranscrito", texto.trim());
        }

        String intencion     = (String) nlpResponse.get("intencion_detectada");
        String codigoTramite = (String) nlpResponse.get("id_tramite_sugerido");
        String textoDevuelto = (String) nlpResponse.getOrDefault("texto_transcrito", texto.trim());

        Double confianza = null;
        Object confObj = nlpResponse.get("nivel_confianza");
        if (confObj instanceof Number) confianza = ((Number) confObj).doubleValue();

        // Mapear candidatos alternativos: código → {procesoId, nombre, confianza}
        List<Map<String, Object>> candidatosMapeados = new ArrayList<>();
        Object altObj = nlpResponse.get("candidatos_alternativos");
        if (altObj instanceof List<?> alts) {
            for (Object item : alts) {
                if (item instanceof Map<?, ?> alt) {
                    String cod  = strOrNull(alt.get("codigo"));
                    Object conf = alt.get("nivel_confianza");
                    if (cod == null) continue;
                    activas.stream()
                        .filter(p -> cod.equalsIgnoreCase(p.getCodigo()) || cod.equalsIgnoreCase(p.getId()))
                        .findFirst()
                        .ifPresent(proc -> {
                            Map<String, Object> c = new HashMap<>();
                            c.put("procesoId", proc.getId());
                            c.put("nombre",    proc.getNombre());
                            c.put("confianza", conf instanceof Number ? ((Number) conf).doubleValue() : 0.0);
                            candidatosMapeados.add(c);
                        });
                }
            }
        }

        Map<String, Object> resultado = new HashMap<>();
        resultado.put("textoTranscrito",        textoDevuelto != null ? textoDevuelto : texto.trim());
        resultado.put("candidatosAlternativos", candidatosMapeados);

        if ("INICIAR_TRAMITE".equals(intencion) && codigoTramite != null
                && (confianza == null || confianza >= 0.65)) {

            ProcesoDefinicion procesoElegido = activas.stream()
                .filter(p -> codigoTramite.equalsIgnoreCase(p.getCodigo())
                          || codigoTramite.equalsIgnoreCase(p.getId()))
                .findFirst().orElse(null);

            if (procesoElegido != null) {
                resultado.put("exito",    true);
                resultado.put("accion",   "REDIRECCIONAR_FORMULARIO");
                resultado.put("procesoId", procesoElegido.getId());
                resultado.put("procesoNombre", procesoElegido.getNombre());
                resultado.put("mensaje",  "Encontré el trámite: " + procesoElegido.getNombre() + ". ¿Deseas iniciarlo?");
                auditService.registrar(clienteId, "TRAMITE", "VOZ_CLASIFICADO",
                    "Proceso: " + procesoElegido.getNombre() + " | Confianza: " + confianza);
                return resultado;
            }
        }

        // NLP no clasificó con confianza suficiente → Gemini responde con contexto
        String textoParaGemini = (textoDevuelto != null && !textoDevuelto.isEmpty()) ? textoDevuelto : texto.trim();
        ChatbotResponse chatResp = chatbotCliente(textoParaGemini, historial, clienteId);
        resultado.put("exito",   true);
        resultado.put("mensaje", chatResp.getRespuesta());
        if (chatResp.getSugerenciasRapidas() != null) {
            resultado.put("sugerenciasRapidas", chatResp.getSugerenciasRapidas());
        }

        // Si Gemini detectó intención de iniciar un trámite → redirigir directamente
        if ("INICIAR_TRAMITE".equals(chatResp.getAccion()) && chatResp.getProcesoId() != null) {
            resultado.put("accion",       "REDIRECCIONAR_FORMULARIO");
            resultado.put("procesoId",    chatResp.getProcesoId());
            resultado.put("procesoNombre", chatResp.getProcesoNombre());
            auditService.registrar(clienteId, "TRAMITE", "VOZ_CLASIFICADO",
                "Gemini detectó: " + chatResp.getProcesoNombre());
            return resultado;
        }

        // Si Gemini detectó consulta de requisitos → devolver campos del formulario inicial
        if ("MOSTRAR_REQUISITOS".equals(chatResp.getAccion()) && chatResp.getProcesoId() != null) {
            resultado.put("accion",       "MOSTRAR_REQUISITOS");
            resultado.put("procesoId",    chatResp.getProcesoId());
            resultado.put("procesoNombre", chatResp.getProcesoNombre());
            if (chatResp.getRequisitos() != null) {
                resultado.put("requisitos", chatResp.getRequisitos());
            }
            return resultado;
        }

        // Si NLP tenía intención de tramite pero baja confianza → mostrar catálogo
        // Si NLP no reconoció intención de tramite en absoluto → solo conversación
        boolean queriaTramite = "INICIAR_TRAMITE".equals(intencion);
        resultado.put("accion", queriaTramite ? "CATALOGO_MANUAL" : "CONVERSACION");
        if (queriaTramite) {
            auditService.registrar(clienteId, "TRAMITE", "VOZ_NO_RECONOCIDO",
                "Texto: " + texto.trim() + " | Confianza: " + confianza);
        }
        return resultado;
    }

    // =========================================================================
    //  CU21 — Completar Formulario mediante Voz (NLP)
    // =========================================================================

    /**
     * CU21: Transcribe audio al microservicio Python (Whisper) y luego extrae
     * los valores de campos del formulario usando Gemini.
     *
     * @param archivoAudio  audio grabado por el usuario (webm/wav/ogg/mp3)
     * @param schemaCampos  JSON array con la definición completa de los campos del formulario
     * @return { transcript, camposLlenados: {id→valor}, confianza, camposDetectados, camposTotales }
     */
    public Map<String, Object> procesarAudioFormulario(
            org.springframework.web.multipart.MultipartFile archivoAudio,
            String schemaCampos) {

        // 1. Transcribir con Whisper vía el microservicio Python CU21
        String transcript = transcribirConWhisper(archivoAudio);

        // 2. Extraer campos con Gemini
        return extraerCamposFormulario(transcript, schemaCampos);
    }

    /**
     * CU21 (modo texto): extrae campos directamente desde texto libre (sin audio).
     * Permite al usuario escribir un prompt en lugar de dictar.
     */
    public Map<String, Object> procesarTextoFormulario(String textoUsuario, String schemaCampos) {
        if (textoUsuario == null || textoUsuario.trim().length() < 3) {
            throw new RuntimeException("El texto es demasiado corto para procesarse.");
        }
        return extraerCamposFormulario(textoUsuario.trim(), schemaCampos);
    }

    // FIX #5: RestTemplate con timeout específico para el microservicio Whisper
    private RestTemplate buildNlpRestTemplate() {
        SimpleClientHttpRequestFactory f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(5_000);
        f.setReadTimeout(nlpFormularioTimeoutMs);
        return new RestTemplate(f);
    }

    private String transcribirConWhisper(org.springframework.web.multipart.MultipartFile archivoAudio) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            org.springframework.core.io.ByteArrayResource audioResource =
                    new org.springframework.core.io.ByteArrayResource(archivoAudio.getBytes()) {
                        @Override
                        public String getFilename() {
                            String fn = archivoAudio.getOriginalFilename();
                            return (fn != null && !fn.isBlank()) ? fn : "audio.webm";
                        }
                    };

            org.springframework.util.MultiValueMap<String, Object> body =
                    new org.springframework.util.LinkedMultiValueMap<>();
            body.add("file", audioResource);

            HttpEntity<org.springframework.util.MultiValueMap<String, Object>> entity =
                    new HttpEntity<>(body, headers);

            // FIX #5: usar RestTemplate con timeout para no bloquear el hilo
            Map response = buildNlpRestTemplate().postForObject(
                    nlpFormularioUrl + "/formulario/transcribir", entity, Map.class);

            if (response == null) {
                throw new RuntimeException("El servicio NLP no devolvió respuesta.");
            }

            String transcript = (String) response.get("transcript");
            if (transcript == null || transcript.isBlank()) {
                String advertencia = (String) response.get("advertencia");
                throw new RuntimeException(
                        advertencia != null ? advertencia
                                : "No se detectó habla en el audio. Habla con claridad y cerca del micrófono.");
            }
            return transcript;

        // FIX #3: errores 4xx del microservicio Python (422=audio corto, 415=formato inválido)
        // se extraen y muestran directamente al usuario, NO se tratan como "servicio caído"
        } catch (org.springframework.web.client.HttpClientErrorException e) {
            String detalle = e.getResponseBodyAsString();
            try {
                Map<String, Object> bodyPython =
                    new org.springframework.boot.json.BasicJsonParser().parseMap(detalle);
                detalle = (String) bodyPython.getOrDefault("detail", detalle);
            } catch (Exception ignored) {}
            throw new RuntimeException(detalle);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("NLP_SERVICE_CAIDO: No se pudo conectar al servicio de transcripción. " + e.getMessage());
        }
    }

    /**
     * CU21 núcleo: envía el texto + schema del formulario a Gemini con un prompt
     * de alta precisión para extraer exactamente los valores de cada campo.
     */
    private Map<String, Object> extraerCamposFormulario(String textoUsuario, String schemaCampos) {
        String prompt = construirPromptExtraccionCampos(textoUsuario, schemaCampos);

        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("text", prompt));

        Map<String, Object> generationConfig = Map.of("responseMimeType", "application/json");
        Map<String, Object> requestBody = Map.of(
                "contents", List.of(Map.of("parts", parts)),
                "generationConfig", generationConfig);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        String[] modelos = {"gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"};
        Exception ultimoError = null;

        for (String modelo : modelos) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + modelo + ":generateContent?key=" + apiKey;
            try {
                Map response = restTemplate.postForObject(url, entity, Map.class);
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
                Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                List<Map<String, Object>> responseParts = (List<Map<String, Object>>) content.get("parts");
                String jsonResult = ((String) responseParts.get(0).get("text"))
                        .replace("```json", "").replace("```", "").trim();

                return parsearRespuestaCampos(jsonResult, textoUsuario);

            } catch (Exception e) {
                ultimoError = e;
                String msg = e.getMessage() != null ? e.getMessage() : "";
                if (msg.contains("503") || msg.contains("429") || msg.contains("UNAVAILABLE") || msg.contains("overloaded")) {
                    System.err.println("⚠️ [CU21] Modelo " + modelo + " saturado, probando siguiente…");
                    continue;
                }
                throw new RuntimeException("Error en extracción de campos CU21: " + e.getMessage());
            }
        }
        throw new RuntimeException("IA_SATURADA: " +
                (ultimoError != null ? ultimoError.getMessage() : "Todos los modelos saturados."));
    }

    /**
     * Construye el prompt de Gemini para CU21 con máxima precisión.
     * Incluye instrucciones detalladas para cada tipo de campo, opciones válidas
     * y reglas de conversión de fechas/números/selecciones.
     */
    private String construirPromptExtraccionCampos(String textoUsuario, String schemaCampos) {
        String hoy = java.time.LocalDate.now().toString();
        return "Eres un sistema experto en extracción de información de texto para rellenar formularios oficiales.\n"
                + "Tu precisión es crítica: los datos se almacenarán directamente en un sistema gubernamental.\n\n"
                + "══════════════════════════════════════════════════════\n"
                + "TEXTO DEL USUARIO (dictado o escrito):\n"
                + "\"" + textoUsuario.replace("\"", "'") + "\"\n"
                + "══════════════════════════════════════════════════════\n\n"
                + "DEFINICIÓN DE LOS CAMPOS DEL FORMULARIO:\n"
                + schemaCampos + "\n\n"
                + "══════════════════════════════════════════════════════\n"
                + "REGLAS DE EXTRACCIÓN (cumplir al 100%):\n\n"
                + "A. CLAVES DEL JSON:\n"
                + "   - USA EXACTAMENTE el valor del campo 'id' como clave. NUNCA la etiqueta.\n\n"
                + "B. VALORES POR TIPO:\n"
                + "   - texto, textarea, email, telefono → string\n"
                + "   - numero → number (sin comillas, sin unidades de medida)\n"
                + "   - fecha → 'YYYY-MM-DD' (hoy = " + hoy + ")\n"
                + "   - hora → 'HH:mm'\n"
                + "   - fecha_hora → 'YYYY-MM-DDTHH:mm'\n"
                + "   - si_no → exactamente 'SI' o 'NO' (mayúsculas, sin tilde)\n"
                + "   - calificacion → integer entre 1 y escalaMax\n"
                + "   - seleccion, radio → EXACTAMENTE uno de los valores en opcionesList[].valor\n"
                + "   - checkbox → array de strings, cada uno es un valor en opcionesList[].valor\n"
                + "   - tabla → array de objetos, claves = id de cada columna en columnasTabla\n\n"
                + "C. MAPEO INTELIGENTE:\n"
                + "   - Para seleccion/radio/checkbox: si el usuario usa sinónimos o frases equivalentes,\n"
                + "     mapea al valor de opcionesList más cercano semánticamente.\n"
                + "   - Para fechas relativas: 'ayer'='" + java.time.LocalDate.now().minusDays(1) + "', "
                + "'mañana'='" + java.time.LocalDate.now().plusDays(1) + "', etc.\n"
                + "   - Para números escritos en palabras: 'dos mil quinientos' → 2500.\n"
                + "   - Para texto/textarea: extrae el fragmento más relevante del texto del usuario.\n\n"
                + "D. CALIDAD:\n"
                + "   - OMITE (no incluyas) campos cuya información NO aparece en el texto.\n"
                + "   - NUNCA inventes datos. Si hay duda, omite el campo.\n"
                + "   - Para email: solo incluir si el texto contiene un formato email válido.\n"
                + "   - Para telefono: solo incluir si el texto contiene una secuencia numérica de 7+ dígitos.\n\n"
                + "E. MÉTRICAS (obligatorias en la respuesta):\n"
                + "   - '__confianza': float 0.0-1.0 (qué tan seguro estás de las extracciones)\n"
                + "   - '__camposDetectados': integer (cuántos campos llenaste)\n"
                + "   - '__transcript': string (el texto original del usuario, sin modificar)\n\n"
                + "RESPONDE ÚNICAMENTE CON UN JSON VÁLIDO. Sin explicaciones, sin markdown.\n"
                + "Ejemplo de estructura:\n"
                + "{\n"
                + "  \"campo_001\": \"Juan Pérez\",\n"
                + "  \"campo_003\": \"RENOVACION\",\n"
                + "  \"campo_005\": \"2025-03-15\",\n"
                + "  \"__confianza\": 0.92,\n"
                + "  \"__camposDetectados\": 3,\n"
                + "  \"__transcript\": \"me llamo Juan Pérez, quiero renovar mi licencia para el 15 de marzo\"\n"
                + "}";
    }

    /**
     * Parsea la respuesta JSON de Gemini para CU21 y la transforma en un Map
     * con los campos detectados y las métricas separadas.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> parsearRespuestaCampos(String jsonCrudo, String textoOriginal) {
        org.springframework.boot.json.JsonParser parser =
                org.springframework.boot.json.JsonParserFactory.getJsonParser();

        Map<String, Object> raw;
        try {
            raw = parser.parseMap(jsonCrudo);
        } catch (Exception e) {
            throw new RuntimeException("Gemini devolvió JSON inválido: " + e.getMessage()
                    + " | Raw: " + jsonCrudo.substring(0, Math.min(200, jsonCrudo.length())));
        }

        // Extraer métricas internas (prefijo __)
        double confianza = 0.0;
        Object confObj = raw.get("__confianza");
        if (confObj instanceof Number) confianza = ((Number) confObj).doubleValue();

        int camposDetectados = 0;
        Object detObj = raw.get("__camposDetectados");
        if (detObj instanceof Number) camposDetectados = ((Number) detObj).intValue();

        String transcriptGemini = (String) raw.getOrDefault("__transcript", textoOriginal);

        // Construir mapa de campos (sin las métricas internas)
        Map<String, Object> camposLlenados = new HashMap<>();
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            if (!entry.getKey().startsWith("__") && entry.getValue() != null) {
                camposLlenados.put(entry.getKey(), entry.getValue());
            }
        }

        // Si Gemini no reportó camposDetectados, contarlos manualmente
        if (camposDetectados == 0) camposDetectados = camposLlenados.size();

        Map<String, Object> resultado = new HashMap<>();
        resultado.put("camposLlenados", camposLlenados);
        resultado.put("transcript", transcriptGemini != null ? transcriptGemini : textoOriginal);
        resultado.put("confianza", confianza);
        resultado.put("camposDetectados", camposDetectados);
        resultado.put("exito", !camposLlenados.isEmpty());
        return resultado;
    }

    // =========================================================================
    //  CU21 — Modo Archivo (imagen/PDF → Gemini Vision)
    // =========================================================================

    /**
     * CU21 (modo archivo): recibe un MultipartFile (imagen JPG/PNG/WebP/HEIC o PDF),
     * lo codifica en Base64 y lo manda a Gemini Vision con un prompt de dos pasos
     * (transcripción completa del documento → extracción de campos del formulario).
     *
     * Precisión objetivo: ≥ 95% gracias al enfoque "leer primero, extraer después".
     *
     * @param archivo      imagen o PDF subido por el usuario
     * @param schemaCampos JSON array con la definición de los campos del formulario
     * @return mismo formato que procesarAudioFormulario / procesarTextoFormulario
     */
    public Map<String, Object> procesarArchivoFormulario(
            org.springframework.web.multipart.MultipartFile archivo,
            String schemaCampos) {

        // ── 1. Validar tipo ───────────────────────────────────────────────────
        String contentType = archivo.getContentType();
        String filename    = archivo.getOriginalFilename() != null
                           ? archivo.getOriginalFilename().toLowerCase() : "";

        // Si el browser envió application/octet-stream, inferir por extensión
        if (contentType == null || "application/octet-stream".equals(contentType)) {
            contentType = inferirMimeDesdeUrl(filename);
        }

        java.util.Set<String> tiposPermitidos = java.util.Set.of(
            "image/jpeg", "image/jpg", "image/png", "image/webp",
            "image/gif",  "image/heic", "image/heif", "application/pdf"
        );
        if (!tiposPermitidos.contains(contentType)) {
            throw new RuntimeException(
                "Tipo de archivo no soportado: '" + contentType + "'. " +
                "Usa JPG, PNG, WebP, HEIC o PDF.");
        }

        // ── 2. Validar tamaño (máx 20 MB — límite de Gemini Vision inlineData) ─
        long maxBytes = 20L * 1024 * 1024;
        if (archivo.getSize() > maxBytes) {
            throw new RuntimeException(
                "Archivo demasiado grande (" + (archivo.getSize() / 1_048_576) + " MB). " +
                "Máximo permitido: 20 MB.");
        }

        // ── 3. Leer y codificar en Base64 ─────────────────────────────────────
        byte[] bytes;
        try {
            bytes = archivo.getBytes();
        } catch (java.io.IOException e) {
            throw new RuntimeException("No se pudo leer el archivo: " + e.getMessage());
        }
        String base64Data = Base64.getEncoder().encodeToString(bytes);

        // ── 4. Construir prompt de dos pasos ──────────────────────────────────
        String prompt = construirPromptExtraccionDesdeArchivo(schemaCampos, contentType);

        // ── 5. Armar la petición Gemini con inlineData ────────────────────────
        // El archivo va DESPUÉS del texto del prompt para que Gemini lo "lea" al
        // procesar el contexto inmediatamente antes de generar la respuesta.
        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("text", prompt));
        Map<String, String> inlineData = new HashMap<>();
        inlineData.put("mimeType", contentType);
        inlineData.put("data", base64Data);
        parts.add(Map.of("inlineData", inlineData));

        Map<String, Object> generationConfig = Map.of("responseMimeType", "application/json");
        Map<String, Object> requestBody = Map.of(
            "contents", List.of(Map.of("parts", parts)),
            "generationConfig", generationConfig);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        // Solo modelos con soporte Vision/multimodal; gemini-2.5-flash-lite no soporta inlineData grande
        String[] modelos = { "gemini-2.5-flash", "gemini-2.0-flash" };
        Exception ultimoError = null;

        for (String modelo : modelos) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + modelo + ":generateContent?key=" + apiKey;
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> response = restTemplate.postForObject(url, entity, Map.class);
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
                @SuppressWarnings("unchecked")
                Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> responseParts = (List<Map<String, Object>>) content.get("parts");
                String jsonResult = ((String) responseParts.get(0).get("text"))
                    .replace("```json", "").replace("```", "").trim();

                return parsearRespuestaCamposArchivo(jsonResult);

            } catch (Exception e) {
                ultimoError = e;
                String msg = e.getMessage() != null ? e.getMessage() : "";
                if (msg.contains("503") || msg.contains("429") ||
                    msg.contains("UNAVAILABLE") || msg.contains("overloaded")) {
                    System.err.println("⚠️ [CU21-Archivo] Modelo " + modelo + " saturado, probando siguiente…");
                    continue;
                }
                throw new RuntimeException("Error en extracción desde archivo CU21: " + e.getMessage());
            }
        }
        throw new RuntimeException("IA_SATURADA: " +
            (ultimoError != null ? ultimoError.getMessage() : "Todos los modelos saturados."));
    }

    /**
     * Construye el prompt de dos pasos para extracción desde imagen/PDF.
     *
     * PASO 1 — Transcripción completa del documento:
     *   Fuerza a Gemini a "leer" todo el texto visible antes de extraer, lo que
     *   mejora la precisión al tener el OCR completo en el contexto de la respuesta.
     *
     * PASO 2 — Extracción de campos del formulario:
     *   Usa el texto transcrito (ahora en contexto) para llenar los campos con
     *   reglas estrictas de tipo, formato y validación.
     *
     * Precisión objetivo: ≥ 95% sobre documentos gubernamentales en español.
     */
    private String construirPromptExtraccionDesdeArchivo(String schemaCampos, String contentType) {
        String hoy     = java.time.LocalDate.now().toString();
        String ayer    = java.time.LocalDate.now().minusDays(1).toString();
        String manana  = java.time.LocalDate.now().plusDays(1).toString();
        boolean esPdf  = "application/pdf".equals(contentType);

        return "Eres un sistema experto en análisis de documentos y extracción de datos para formularios oficiales.\n"
            + "Tu precisión es crítica: los datos se almacenarán directamente en un sistema gubernamental.\n"
            + "Tipo de archivo recibido: " + (esPdf ? "PDF" : "Imagen") + "\n\n"

            + "══════════════════════════════════════════════════════════════\n"
            + "PASO 1 — ANÁLISIS COMPLETO DEL DOCUMENTO (obligatorio, no omitir)\n"
            + "══════════════════════════════════════════════════════════════\n\n"

            + "Examina con MÁXIMO DETALLE el " + (esPdf ? "PDF" : "imagen del documento") + " adjunto.\n\n"

            + "1.1 TRANSCRIPCIÓN COMPLETA:\n"
            + "    Lee y transcribe en orden TODO el texto visible:\n"
            + "    - Texto impreso, mecanografiado y manuscrito (si es legible)\n"
            + "    - Cabeceras, sellos, membretes, logos con texto\n"
            + "    - Números, fechas, códigos, series, folios\n"
            + "    - Tablas: transcribe fila por fila\n"
            + "    - Para PDFs: transcribe TODAS las páginas\n"
            + "    - Si hay texto parcialmente ilegible, transcribe lo que puedas y usa [ilegible] para el resto\n\n"

            + "1.2 TIPO DE DOCUMENTO:\n"
            + "    Identifica el tipo más específico posible:\n"
            + "    - Documento de identidad: DPI / cédula / pasaporte / licencia de conducir\n"
            + "    - Documento fiscal: NIT / RTU / patente / factura / recibo\n"
            + "    - Certificado / constancia / acta / título\n"
            + "    - Contrato / escritura pública / poder notarial\n"
            + "    - Formulario institucional / solicitud\n"
            + "    - Comprobante de pago / depósito bancario\n"
            + "    - Otro (sé específico)\n\n"

            + "1.3 PARES CLAVE-VALOR DETECTADOS:\n"
            + "    Lista todos los campos visibles en formato 'Etiqueta: Valor'\n\n"

            + "══════════════════════════════════════════════════════════════\n"
            + "PASO 2 — EXTRACCIÓN PARA EL FORMULARIO\n"
            + "══════════════════════════════════════════════════════════════\n\n"

            + "Usando EXCLUSIVAMENTE el texto que transcribiste en el PASO 1,\n"
            + "rellena los campos del formulario según las definiciones a continuación.\n"
            + "Fecha de hoy: " + hoy + " | Ayer: " + ayer + " | Mañana: " + manana + "\n\n"

            + "DEFINICIÓN DE LOS CAMPOS DEL FORMULARIO:\n"
            + schemaCampos + "\n\n"

            + "══════════════════════════════════════════════════════════════\n"
            + "REGLAS DE EXTRACCIÓN (cumplir al 100%):\n\n"

            + "A. CLAVES DEL JSON:\n"
            + "   USA EXACTAMENTE el valor del campo 'id'. NUNCA la etiqueta.\n\n"

            + "B. VALORES SEGÚN TIPO:\n"
            + "   - texto, textarea, email, telefono → string\n"
            + "   - numero → number (sin comillas, sin unidades de medida)\n"
            + "   - fecha → 'YYYY-MM-DD' (hoy=" + hoy + ")\n"
            + "   - hora → 'HH:mm' en formato 24h\n"
            + "   - fecha_hora → 'YYYY-MM-DDTHH:mm'\n"
            + "   - si_no → exactamente 'SI' o 'NO' (sin tilde, mayúsculas)\n"
            + "   - calificacion → integer entre 1 y escalaMax\n"
            + "   - seleccion, radio → EXACTAMENTE uno de los valores en opcionesList[].valor\n"
            + "   - checkbox → array de strings, cada uno presente en opcionesList[].valor\n"
            + "   - tabla → array de objetos; claves = id de cada columna en columnasTabla\n\n"

            + "C. MAPEO INTELIGENTE PARA DOCUMENTOS GUBERNAMENTALES:\n"
            + "   NOMBRES:\n"
            + "   - 'Primer nombre' + 'Segundo nombre' + 'Apellidos' → concatenar con espacio\n"
            + "   - Mayúsculas: convertir a título (JUAN PÉREZ → Juan Pérez)\n\n"
            + "   FECHAS (múltiples formatos de entrada → ISO 8601 de salida):\n"
            + "   - DD/MM/YYYY, DD-MM-YYYY, D de [mes] de YYYY, [mes] DD, YYYY → YYYY-MM-DD\n"
            + "   - Meses en español: enero=01, febrero=02, marzo=03, abril=04, mayo=05,\n"
            + "     junio=06, julio=07, agosto=08, septiembre=09, octubre=10, noviembre=11, diciembre=12\n\n"
            + "   NÚMEROS IDENTIFICADORES:\n"
            + "   - DPI/CUI con espacios o guiones (1234 56789 0101) → solo dígitos: 1234567890101\n"
            + "   - NIT con guión (1234567-8) → preservar como string: '1234567-8'\n"
            + "   - Números con punto como separador de miles (1.234.567) → número: 1234567\n\n"
            + "   SELECCIÓN:\n"
            + "   - Si el usuario usa sinónimos ('masculino' para 'Hombre') → mapear al valor más cercano en opcionesList\n\n"

            + "D. CALIDAD:\n"
            + "   - OMITE campos cuya info NO aparece en el documento (no inventes)\n"
            + "   - Si el texto está parcialmente ilegible, incluye lo que sí puedas leer\n"
            + "   - Para email: solo incluir si ves formato email claramente (contiene @)\n"
            + "   - Para telefono: solo incluir si hay 7+ dígitos consecutivos\n"
            + "   - NUNCA inventes datos sin respaldo explícito en el documento\n\n"

            + "E. MÉTRICAS (obligatorias en la respuesta):\n"
            + "   - '__transcripcion': string con TODO el texto leído del documento (del PASO 1.1)\n"
            + "   - '__tipo_documento': string con el tipo identificado (del PASO 1.2)\n"
            + "   - '__confianza': float 0.0-1.0 (qué tan seguro estás de cada extracción)\n"
            + "   - '__camposDetectados': integer (cuántos campos llenaste)\n\n"

            + "RESPONDE ÚNICAMENTE CON UN JSON VÁLIDO. Sin explicaciones, sin markdown.\n"
            + "Ejemplo:\n"
            + "{\n"
            + "  \"campo_nombre\": \"Juan Pérez García\",\n"
            + "  \"campo_fecha_nac\": \"1990-03-15\",\n"
            + "  \"campo_dpi\": \"1234567890101\",\n"
            + "  \"__transcripcion\": \"REGISTRO NACIONAL DE PERSONAS. DOCUMENTO PERSONAL DE IDENTIFICACIÓN. Nombre: JUAN PÉREZ GARCÍA. Fecha de nacimiento: 15 de marzo de 1990...\",\n"
            + "  \"__tipo_documento\": \"Documento de identidad (DPI - Guatemala)\",\n"
            + "  \"__confianza\": 0.97,\n"
            + "  \"__camposDetectados\": 3\n"
            + "}";
    }

    /**
     * Parsea la respuesta JSON de Gemini Vision para CU21-Archivo.
     * Extrae métricas internas (__) y construye el mismo mapa que los otros modos.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> parsearRespuestaCamposArchivo(String jsonCrudo) {
        org.springframework.boot.json.JsonParser parser =
            org.springframework.boot.json.JsonParserFactory.getJsonParser();

        Map<String, Object> raw;
        try {
            raw = parser.parseMap(jsonCrudo);
        } catch (Exception e) {
            throw new RuntimeException(
                "Gemini Vision devolvió JSON inválido: " + e.getMessage()
                + " | Raw (200 chars): " + jsonCrudo.substring(0, Math.min(200, jsonCrudo.length())));
        }

        // Métricas internas
        double confianza = 0.0;
        Object confObj = raw.get("__confianza");
        if (confObj instanceof Number n) confianza = n.doubleValue();

        int camposDetectados = 0;
        Object detObj = raw.get("__camposDetectados");
        if (detObj instanceof Number n) camposDetectados = n.intValue();

        String transcripcion  = strOrNull(raw.get("__transcripcion"));
        String tipoDocumento  = strOrNull(raw.get("__tipo_documento"));

        // Campos de datos (sin prefijo __)
        Map<String, Object> camposLlenados = new HashMap<>();
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            if (!entry.getKey().startsWith("__") && entry.getValue() != null) {
                camposLlenados.put(entry.getKey(), entry.getValue());
            }
        }
        if (camposDetectados == 0) camposDetectados = camposLlenados.size();

        Map<String, Object> resultado = new HashMap<>();
        resultado.put("camposLlenados",  camposLlenados);
        resultado.put("transcript",      transcripcion != null ? transcripcion : "");
        resultado.put("tipoDocumento",   tipoDocumento != null ? tipoDocumento : "documento");
        resultado.put("confianza",       confianza);
        resultado.put("camposDetectados", camposDetectados);
        resultado.put("exito",           !camposLlenados.isEmpty());
        return resultado;
    }

    // =========================================================================
    //  Fin CU21
    // =========================================================================

    /**
     * Serializa la lista de procesos a JSON sin depender de Jackson directamente.
     * Solo escapa comillas dobles dentro de los valores de texto.
     */
    private String buildCatalogoJson(List<ProcesoDefinicion> procesos) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < procesos.size(); i++) {
            ProcesoDefinicion p = procesos.get(i);
            String codigo      = escapeJson(p.getCodigo());
            String nombre      = escapeJson(p.getNombre());
            String descripcion = escapeJson(p.getDescripcion());
            sb.append("{\"codigo\":\"").append(codigo)
              .append("\",\"nombre\":\"").append(nombre)
              .append("\",\"descripcion\":\"").append(descripcion)
              .append("\"}");
            if (i < procesos.size() - 1) sb.append(",");
        }
        sb.append("]");
        return sb.toString();
    }

    private String escapeJson(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"")
                    .replace("\n", "\\n").replace("\r", "\\r");
    }

    // =========================================================================
    //  CU21 — Asistente Formulario Multimodal (texto + N archivos combinados)
    // =========================================================================

    /**
     * Procesa en una sola llamada a Gemini Vision:
     *  - Texto libre del usuario (opcional)
     *  - Hasta N archivos adjuntos (imágenes o PDFs), donde cada archivo puede:
     *      (A) Ser FUENTE DE DATOS → Gemini extrae valores de texto/fechas/selecciones.
     *      (B) Ser VALOR DE CAMPO  → Gemini asigna el archivo al campo tipo 'archivo' o 'imagen' correspondiente.
     *      (A+B) Ambas cosas simultáneamente (ej: foto del DNI → extrae datos Y va al campo foto_ci).
     *
     * Respuesta:
     * {
     *   "camposLlenados":  { "id": valor, ... },          ← campos de datos
     *   "archivosSubidos": { "id": { url, nombre, tamano } },  ← campos de archivo
     *   "transcript":      "texto procesado",
     *   "confianza":       0.91,
     *   "camposDetectados": 5,
     *   "archivosAsignados": 2,
     *   "exito":           true
     * }
     */
    public Map<String, Object> procesarAsistenteFormulario(
            String texto,
            List<org.springframework.web.multipart.MultipartFile> archivos,
            String schemaCampos) {

        boolean tieneTexto    = texto != null && !texto.isBlank();
        boolean tieneArchivos = archivos != null && !archivos.isEmpty();

        if (!tieneTexto && !tieneArchivos) {
            throw new RuntimeException("Debe enviar texto o al menos un archivo.");
        }

        // ── 1. Construir descripción de archivos para el prompt ──────────────
        StringBuilder archivosDesc = new StringBuilder();
        if (tieneArchivos) {
            archivosDesc.append("ARCHIVOS ADJUNTOS RECIBIDOS (").append(archivos.size()).append(" archivo(s)):\n");
            for (int i = 0; i < archivos.size(); i++) {
                org.springframework.web.multipart.MultipartFile f = archivos.get(i);
                archivosDesc.append("  - archivo_").append(i).append(": \"")
                    .append(f.getOriginalFilename()).append("\" (")
                    .append(f.getContentType()).append(", ")
                    .append(f.getSize() / 1024).append(" KB)\n");
            }
            archivosDesc.append("\n");
        }

        String hoy   = java.time.LocalDate.now().toString();
        String ayer  = java.time.LocalDate.now().minusDays(1).toString();
        String manana = java.time.LocalDate.now().plusDays(1).toString();

        // ── 2. Prompt multimodal de alta precisión ───────────────────────────
        String prompt =
            "Eres un sistema experto en análisis multimodal de datos para formularios oficiales.\n"
          + "Tu tarea es TANTO extraer valores de texto COMO asignar archivos a campos de tipo archivo/imagen.\n"
          + "Fecha de hoy: " + hoy + " | Ayer: " + ayer + " | Mañana: " + manana + "\n\n"

          + "══════════════════════════════════════════════════════════════\n"
          + "INPUTS RECIBIDOS:\n"
          + "══════════════════════════════════════════════════════════════\n\n"
          + (tieneTexto ? "TEXTO DEL USUARIO:\n\"" + texto.replace("\"", "'") + "\"\n\n" : "")
          + (tieneArchivos ? archivosDesc.toString() : "")

          + "══════════════════════════════════════════════════════════════\n"
          + "DEFINICIÓN DE LOS CAMPOS DEL FORMULARIO (SCHEMA COMPLETO):\n"
          + "══════════════════════════════════════════════════════════════\n"
          + schemaCampos + "\n\n"

          + "══════════════════════════════════════════════════════════════\n"
          + "DOS TAREAS QUE DEBES EJECUTAR:\n"
          + "══════════════════════════════════════════════════════════════\n\n"

          + "TAREA A — CAMPOS DE DATOS (tipo: texto, textarea, numero, decimal, email, telefono,\n"
          + "  fecha, hora, fecha_hora, si_no, seleccion, radio, checkbox, calificacion, tabla):\n"
          + "  Extrae valores desde el texto del usuario Y/O leyendo el contenido de los archivos.\n"
          + "  Reglas de formato:\n"
          + "    * texto/textarea/email/telefono → string\n"
          + "    * numero/decimal → number (sin comillas)\n"
          + "    * fecha → 'YYYY-MM-DD' | hora → 'HH:mm' | fecha_hora → 'YYYY-MM-DDTHH:mm'\n"
          + "    * si_no → exactamente 'SI' o 'NO' (sin tilde, mayúsculas)\n"
          + "    * seleccion/radio → EXACTAMENTE uno de los valores en opcionesList[].valor\n"
          + "    * checkbox → array de strings de opcionesList[].valor\n"
          + "    * tabla → array de objetos; claves = id de columna en columnasTabla\n"
          + "  Mapeo inteligente de fechas (DD/MM/YYYY, D de mes de YYYY → YYYY-MM-DD).\n"
          + "  Nombres en MAYÚSCULAS → convertir a Título (JUAN PÉREZ → Juan Pérez).\n\n"

          + "TAREA B — CAMPOS DE ARCHIVO/IMAGEN (tipo: archivo, imagen):\n"
          + "  Determina qué archivo adjunto (archivo_0, archivo_1, ...) corresponde a cada campo.\n"
          + "  Para asignar un archivo a un campo usa el valor especial: { \"__archivo_idx\": N }\n"
          + "  donde N es el índice del archivo (0, 1, 2...).\n"
          + "  Criterios de asignación (por orden de prioridad):\n"
          + "    1. El usuario menciona explícitamente en su texto para qué sirve el archivo.\n"
          + "    2. El nombre del archivo coincide semánticamente con el campo (ej: 'dni.jpg' → campo 'Foto de CI').\n"
          + "    3. El tipo MIME del archivo es compatible con los tipos aceptados del campo.\n"
          + "    4. Si hay más archivos que campos de upload: el excedente se usa solo para extracción.\n"
          + "    5. Si no puedes asignar con certeza, NO asignes (omite ese campo).\n\n"

          + "REGLA ESPECIAL — ARCHIVO AMBIGUO:\n"
          + "  Si un archivo sirve TANTO para extraer datos COMO para asignarse a un campo de upload,\n"
          + "  entonces realiza AMBAS acciones: extrae datos de él (Tarea A) Y asígnalo (Tarea B).\n\n"

          + "MÉTRICAS OBLIGATORIAS en la respuesta:\n"
          + "  '__confianza': float 0.0-1.0\n"
          + "  '__camposDetectados': integer (suma campos de texto + archivos asignados)\n"
          + "  '__transcript': string (texto del usuario si lo hay, o descripción breve de lo procesado)\n\n"

          + "CALIDAD: OMITE campos sin certeza. NUNCA inventes datos sin respaldo explícito.\n\n"

          + "RESPONDE SOLO CON JSON VÁLIDO, sin markdown.\n"
          + "Ejemplo:\n"
          + "{\n"
          + "  \"campo_nombre\": \"Juan Pérez\",\n"
          + "  \"campo_fecha_nac\": \"1990-03-15\",\n"
          + "  \"campo_foto_ci\": { \"__archivo_idx\": 0 },\n"
          + "  \"campo_contrato\": { \"__archivo_idx\": 1 },\n"
          + "  \"__confianza\": 0.91,\n"
          + "  \"__camposDetectados\": 4,\n"
          + "  \"__transcript\": \"Juan Pérez, 15/03/1990. 2 archivos adjuntos.\"\n"
          + "}";

        // ── 3. Construir parts: prompt texto + archivos como inlineData ───────
        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("text", prompt));

        if (tieneArchivos) {
            java.util.Set<String> mimesSoportados = java.util.Set.of(
                "image/jpeg","image/jpg","image/png","image/webp",
                "image/gif","image/heic","image/heif","application/pdf"
            );

            for (org.springframework.web.multipart.MultipartFile archivo : archivos) {
                try {
                    String ct = archivo.getContentType();
                    if (ct == null || "application/octet-stream".equals(ct)) {
                        ct = inferirMimeDesdeUrl(archivo.getOriginalFilename() != null
                                ? archivo.getOriginalFilename() : "");
                    }

                    if (!mimesSoportados.contains(ct)) {
                        System.err.println("[Asistente] Tipo no soportado por Gemini Vision: "
                            + ct + " — " + archivo.getOriginalFilename());
                        // Agregar aviso textual para que Gemini sepa que recibió este archivo
                        parts.add(Map.of("text",
                            "[Archivo recibido pero no analizable por IA: "
                            + archivo.getOriginalFilename() + " — tipo " + ct + "]"));
                        continue;
                    }

                    long maxBytes = 20L * 1024 * 1024;
                    if (archivo.getSize() > maxBytes) {
                        System.err.println("[Asistente] Archivo demasiado grande: "
                            + archivo.getOriginalFilename());
                        continue;
                    }

                    byte[] bytes = archivo.getBytes();
                    String base64 = Base64.getEncoder().encodeToString(bytes);
                    Map<String, String> inlineData = new HashMap<>();
                    inlineData.put("mimeType", ct);
                    inlineData.put("data", base64);
                    parts.add(Map.of("inlineData", inlineData));

                } catch (Exception e) {
                    System.err.println("[Asistente] Error procesando archivo '"
                        + archivo.getOriginalFilename() + "': " + e.getMessage());
                }
            }
        }

        // ── 4. Llamar a Gemini ────────────────────────────────────────────────
        Map<String, Object> generationConfig = Map.of("responseMimeType", "application/json");
        Map<String, Object> requestBody = Map.of(
            "contents", List.of(Map.of("parts", parts)),
            "generationConfig", generationConfig);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        // Usar solo modelos con soporte Vision cuando hay archivos
        String[] modelos = tieneArchivos
            ? new String[]{ "gemini-2.5-flash", "gemini-2.0-flash" }
            : new String[]{ "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash" };

        Exception ultimoError = null;
        String jsonResult = null;

        for (String modelo : modelos) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + modelo + ":generateContent?key=" + apiKey;
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> response = restTemplate.postForObject(url, entity, Map.class);
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
                @SuppressWarnings("unchecked")
                Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> responseParts = (List<Map<String, Object>>) content.get("parts");
                jsonResult = ((String) responseParts.get(0).get("text"))
                    .replace("```json", "").replace("```", "").trim();
                break;
            } catch (Exception e) {
                ultimoError = e;
                String msg = e.getMessage() != null ? e.getMessage() : "";
                if (msg.contains("503") || msg.contains("429")
                        || msg.contains("UNAVAILABLE") || msg.contains("overloaded")) {
                    System.err.println("⚠️ [Asistente] Modelo " + modelo + " saturado, probando siguiente…");
                    continue;
                }
                throw new RuntimeException("Error en asistente formulario IA: " + e.getMessage());
            }
        }

        if (jsonResult == null) {
            throw new RuntimeException("IA_SATURADA: " +
                (ultimoError != null ? ultimoError.getMessage() : "Todos los modelos saturados."));
        }

        // ── 5. Parsear, subir archivos asignados y devolver resultado ─────────
        return parsearRespuestaAsistente(jsonResult, texto, archivos);
    }

    /**
     * Parsea la respuesta JSON del asistente multimodal.
     * Para cada campo donde Gemini devolvió { "__archivo_idx": N },
     * sube el archivo correspondiente y reemplaza con { url, nombreOriginal, tamano }.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> parsearRespuestaAsistente(
            String jsonCrudo,
            String textoOriginal,
            List<org.springframework.web.multipart.MultipartFile> archivos) {

        org.springframework.boot.json.JsonParser parser =
            org.springframework.boot.json.JsonParserFactory.getJsonParser();

        Map<String, Object> raw;
        try {
            raw = parser.parseMap(jsonCrudo);
        } catch (Exception e) {
            throw new RuntimeException("Gemini devolvió JSON inválido: " + e.getMessage()
                + " | Raw: " + jsonCrudo.substring(0, Math.min(300, jsonCrudo.length())));
        }

        // Métricas internas
        double confianza = 0.0;
        Object confObj = raw.get("__confianza");
        if (confObj instanceof Number) confianza = ((Number) confObj).doubleValue();

        int camposDetectados = 0;
        Object detObj = raw.get("__camposDetectados");
        if (detObj instanceof Number) camposDetectados = ((Number) detObj).intValue();

        String transcript = strOrNull(raw.get("__transcript"));
        if (transcript == null || transcript.isBlank()) {
            transcript = textoOriginal != null ? textoOriginal : "";
        }

        // Separar campos de datos vs asignaciones de archivo
        Map<String, Object> camposLlenados  = new HashMap<>();
        Map<String, Object> archivosSubidos = new HashMap<>();

        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            String key   = entry.getKey();
            Object value = entry.getValue();
            if (key.startsWith("__")) continue;   // métricas internas

            if (value instanceof Map<?, ?> valueMap) {
                Object archivoIdxObj = valueMap.get("__archivo_idx");
                if (archivoIdxObj instanceof Number) {
                    // Gemini quiere asignar este archivo al campo `key`
                    int idx = ((Number) archivoIdxObj).intValue();
                    if (archivos != null && idx >= 0 && idx < archivos.size()) {
                        try {
                            Map<String, Object> uploadResult = archivoService.subirArchivo(
                                archivos.get(idx), null, null, "asistente-ia", "Asignado por Asistente IA", null, null, null);
                            // Devolver solo los campos que el frontend espera
                            Map<String, Object> refArchivo = new HashMap<>();
                            refArchivo.put("url",            uploadResult.get("url"));
                            refArchivo.put("nombreOriginal", uploadResult.get("nombreOriginal"));
                            refArchivo.put("tamano",         uploadResult.get("tamano"));
                            archivosSubidos.put(key, refArchivo);
                        } catch (Exception e) {
                            System.err.println("[Asistente] No se pudo subir archivo " + idx
                                + " para campo '" + key + "': " + e.getMessage());
                        }
                    }
                } else {
                    // Mapa normal (puede ser una fila de tabla u objeto de campo)
                    camposLlenados.put(key, value);
                }
            } else if (value instanceof List) {
                // Arrays (tabla, checkbox)
                camposLlenados.put(key, value);
            } else if (value != null) {
                camposLlenados.put(key, value);
            }
        }

        if (camposDetectados == 0) {
            camposDetectados = camposLlenados.size() + archivosSubidos.size();
        }

        Map<String, Object> resultado = new HashMap<>();
        resultado.put("camposLlenados",   camposLlenados);
        resultado.put("archivosSubidos",  archivosSubidos);
        resultado.put("transcript",       transcript);
        resultado.put("confianza",        confianza);
        resultado.put("camposDetectados", camposDetectados);
        resultado.put("archivosAsignados", archivosSubidos.size());
        resultado.put("exito", !camposLlenados.isEmpty() || !archivosSubidos.isEmpty());
        return resultado;
    }

    // =========================================================================
    //  Fin Asistente Formulario Multimodal
    // =========================================================================

    // =========================================================================
    //  CU23: Interpretación de consulta NLP para reportes dinámicos
    // =========================================================================

    private static final String ESQUEMA_REPORTES =
        "Colecciones disponibles en MongoDB:\n" +
        "1. tramites: { codigoSeguimiento, estadoSemaforo(EN_REVISION|APROBADO|RECHAZADO), " +
        "   fechaCreacion(ISO date), departamentoActualId, nombreProceso, clienteId, pasoActualId }\n" +
        "2. procesos: { nombre, codigo, activo(true|false) }\n" +
        "3. departamentos: { nombre, activo(true|false) }\n" +
        "4. usuarios: { username, nombre, rol(ADMIN|FUNCIONARIO|CLIENTE) }\n" +
        "5. auditoria: { accion, entidad, actor(username), timestamp, detalles }\n\n" +
        "Valores posibles de agrupacion: estado | departamento | proceso | mes | semana | dia | usuario\n" +
        "Valores posibles de tipoVisualizacion: bar | line | pie | doughnut | tabla | mixed\n" +
        "Valores posibles de coleccion: tramites | usuarios | auditoria | procesos\n" +
        "Valores posibles de metrica: count | promedioDias\n";

    public String interpretarConsultaNlp(String consultaUsuario) {
        String fechaHoy = java.time.LocalDate.now().toString();
        // Primer día del mes actual y último día del mes actual, calculados dinámicamente
        java.time.LocalDate hoy = java.time.LocalDate.now();
        String primerDiaMes = hoy.withDayOfMonth(1).toString();
        String ultimoDiaMes = hoy.withDayOfMonth(hoy.lengthOfMonth()).toString();
        String primerDiaAnio = hoy.withDayOfYear(1).toString();

        String prompt = String.format(
            "Eres un motor de inteligencia de negocios. Interpreta la siguiente consulta en lenguaje natural " +
            "de un administrador de sistema y devuelve ÚNICAMENTE un objeto JSON válido (sin markdown, sin texto extra).\n\n" +
            "FECHA ACTUAL: %s\n\n" +
            "CONSULTA DEL USUARIO: \"%s\"\n\n" +
            "CONTEXTO DEL SISTEMA:\n%s\n" +
            "ESTRUCTURA DEL JSON A DEVOLVER (todos los campos son opcionales excepto titulo):\n" +
            "{\n" +
            "  \"titulo\": \"<título descriptivo del reporte>\",\n" +
            "  \"tipoVisualizacion\": \"<bar|line|pie|doughnut|tabla|mixed>\",\n" +
            "  \"coleccion\": \"<tramites|usuarios|auditoria|procesos>\",\n" +
            "  \"filtros\": {\n" +
            "    \"fechaDesde\": \"<YYYY-MM-DD o null>\",\n" +
            "    \"fechaHasta\": \"<YYYY-MM-DD o null>\",\n" +
            "    \"estado\": \"<EN_REVISION|APROBADO|RECHAZADO o null>\",\n" +
            "    \"departamentoNombre\": \"<nombre parcial o null>\",\n" +
            "    \"procesoNombre\": \"<nombre parcial o null>\",\n" +
            "    \"usuarioUsername\": \"<username o null>\"\n" +
            "  },\n" +
            "  \"agrupacion\": \"<estado|departamento|proceso|mes|semana|dia|usuario>\",\n" +
            "  \"metrica\": \"<count|promedioDias>\",\n" +
            "  \"ordenar\": \"<desc|asc>\",\n" +
            "  \"limite\": <número entre 5 y 50>\n" +
            "}\n\n" +
            "REGLAS IMPORTANTES:\n" +
            "- 'este mes' = fechaDesde:%s, fechaHasta:%s\n" +
            "- 'este año' = fechaDesde:%s, fechaHasta:%s\n" +
            "- Para consultas de tendencia temporal usa tipoVisualizacion 'line' con agrupacion 'mes' o 'semana'.\n" +
            "- Para distribuciones porcentuales usa 'pie' o 'doughnut'.\n" +
            "- Para comparaciones entre categorías usa 'bar'.\n" +
            "- Para listas de datos usa 'tabla'.\n\n" +
            "EJEMPLOS:\n" +
            "Consulta: \"Trámites aprobados en abril 2026 por departamento\"\n" +
            "Respuesta: {\"titulo\":\"Trámites aprobados en abril 2026 por departamento\"," +
            "\"tipoVisualizacion\":\"bar\",\"coleccion\":\"tramites\"," +
            "\"filtros\":{\"fechaDesde\":\"2026-04-01\",\"fechaHasta\":\"2026-04-30\"," +
            "\"estado\":\"APROBADO\"},\"agrupacion\":\"departamento\",\"ordenar\":\"desc\"}\n\n" +
            "Consulta: \"Evolución mensual de solicitudes en 2026\"\n" +
            "Respuesta: {\"titulo\":\"Evolución mensual de solicitudes 2026\"," +
            "\"tipoVisualizacion\":\"line\",\"coleccion\":\"tramites\"," +
            "\"filtros\":{\"fechaDesde\":\"2026-01-01\",\"fechaHasta\":\"2026-12-31\"}," +
            "\"agrupacion\":\"mes\",\"ordenar\":\"asc\"}\n\n" +
            "Consulta: \"Distribución de trámites por estado\"\n" +
            "Respuesta: {\"titulo\":\"Distribución de trámites por estado\"," +
            "\"tipoVisualizacion\":\"doughnut\",\"coleccion\":\"tramites\"," +
            "\"filtros\":{},\"agrupacion\":\"estado\"}\n\n" +
            "Si no puedes interpretar la consulta, devuelve: " +
            "{\"error\": \"consulta_ambigua\", \"sugerencia\": \"<sugerencia en español>\"}",
            fechaHoy, consultaUsuario, ESQUEMA_REPORTES,
            primerDiaMes, ultimoDiaMes, primerDiaAnio, fechaHoy);

        Map<String, Object> generationConfig = Map.of("responseMimeType", "application/json");
        Map<String, Object> requestBody = Map.of(
            "contents", List.of(Map.of("parts", List.of(Map.of("text", prompt)))),
            "generationConfig", generationConfig);

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(requestBody, headers);

        String[] modelos = { "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash" };
        Exception ultimoError = null;
        for (String modelo : modelos) {
            String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                    + modelo + ":generateContent?key=" + apiKey;
            try {
                Map response = restTemplate.postForObject(url, entity, Map.class);
                List<Map<String, Object>> candidates = (List<Map<String, Object>>) response.get("candidates");
                Map<String, Object> content = (Map<String, Object>) candidates.get(0).get("content");
                List<Map<String, Object>> parts = (List<Map<String, Object>>) content.get("parts");
                return (String) parts.get(0).get("text");
            } catch (Exception e) {
                ultimoError = e;
                String msg = e.getMessage() != null ? e.getMessage() : "";
                if (msg.contains("503") || msg.contains("429") || msg.contains("UNAVAILABLE") || msg.contains("overloaded")) {
                    continue;
                }
                throw new RuntimeException("Error en API de IA: " + e.getMessage());
            }
        }
        throw new RuntimeException("Todos los modelos Gemini están saturados. " + ultimoError.getMessage());
    }
}
