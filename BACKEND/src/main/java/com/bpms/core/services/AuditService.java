package com.bpms.core.services;

import com.bpms.core.models.AuditLog;
import com.bpms.core.repositories.AuditLogRepository;

import jakarta.servlet.http.HttpServletRequest;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 👇 NUEVO CU16: Servicio centralizado de auditoría.
 *
 * Centraliza la creación de logs (con captura automática de IP)
 * y provee la consulta paginada con filtros para el módulo "Log de Auditoría".
 *
 * El registro es INMUTABLE: este servicio NO expone update ni delete públicos.
 */
@Service
public class AuditService {

    // === Categorías estandarizadas (para filtros del frontend) ===
    public static final String CAT_AUTH = "AUTH";
    public static final String CAT_POLITICA = "POLITICA";
    public static final String CAT_USUARIO = "USUARIO";
    public static final String CAT_DEPARTAMENTO = "DEPARTAMENTO";
    public static final String CAT_TRAMITE = "TRAMITE";
    public static final String CAT_SISTEMA = "SISTEMA";

    @Autowired
    private AuditLogRepository auditLogRepository;

    @Autowired
    private MongoTemplate mongoTemplate;

    // ========================================================================
    // ESCRITURA — Métodos de registro
    // ========================================================================

    /**
     * Registra una acción genérica. Captura IP automáticamente desde el request
     * HTTP en curso (si lo hay).
     */
    public void registrar(String usuarioId, String categoria, String accion, String detalle) {
        crearLog(usuarioId, categoria, accion, detalle, null, null, null);
    }

    /** Variante con entidad vinculada (CU20 — trazabilidad por proceso/trámite). */
    public void registrar(String usuarioId, String categoria, String accion, String detalle,
                          String entidadId, String entidadTipo) {
        crearLog(usuarioId, categoria, accion, detalle, null, entidadId, entidadTipo);
    }

    /** Variante con payload (sanitizado por el caller — NO mandar passwords aquí). */
    public void registrarConPayload(String usuarioId, String categoria, String accion,
                                    String detalle, Map<String, Object> payload) {
        crearLog(usuarioId, categoria, accion, detalle, payload, null, null);
    }

    /** Variante con payload + entidad vinculada. */
    public void registrarConPayload(String usuarioId, String categoria, String accion,
                                    String detalle, Map<String, Object> payload,
                                    String entidadId, String entidadTipo) {
        crearLog(usuarioId, categoria, accion, detalle, payload, entidadId, entidadTipo);
    }

    private void crearLog(String usuarioId, String categoria, String accion,
                          String detalle, Map<String, Object> payload,
                          String entidadId, String entidadTipo) {
        try {
            AuditLog log = new AuditLog();
            log.setUsuarioId(usuarioId != null ? usuarioId : "ANONIMO");
            log.setCategoria(categoria);
            log.setAccion(accion);
            log.setDetalle(detalle);
            log.setIpOrigen(extraerIpDelRequestActual());
            log.setFechaTimestamp(LocalDateTime.now());
            log.setDepartamentoId("SISTEMA");
            log.setEntidadId(entidadId);
            log.setEntidadTipo(entidadTipo);
            if ("TRAMITE".equalsIgnoreCase(entidadTipo)) {
                log.setTramiteId(entidadId);
            }

            if (payload != null && !payload.isEmpty()) {
                Map<String, Object> seguro = new HashMap<>(payload);
                seguro.remove("password");
                seguro.remove("contraseña");
                log.setDatosFormulario(seguro);
            }

            auditLogRepository.save(log);
        } catch (Exception e) {
            System.err.println("⚠️ Error registrando auditoría: " + e.getMessage());
        }
    }

    // ========================================================================
    // CAPTURA DE IP
    // ========================================================================

    /**
     * Extrae la IP del request HTTP en curso. Lee X-Forwarded-For primero
     * (despliegues detrás de proxy/load balancer en AWS), con fallback a
     * RemoteAddr.
     */
    public String extraerIpDelRequestActual() {
        try {
            ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.currentRequestAttributes();
            HttpServletRequest request = attrs.getRequest();
            return extraerIpDelRequest(request);
        } catch (IllegalStateException e) {
            // Llamada fuera de contexto HTTP (ej: scheduler, async)
            return null;
        }
    }

    public static String extraerIpDelRequest(HttpServletRequest request) {
        if (request == null) return null;

        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            // Puede venir como "client, proxy1, proxy2" → la primera es la real
            return xff.split(",")[0].trim();
        }

        String realIp = request.getHeader("X-Real-IP");
        if (realIp != null && !realIp.isBlank()) {
            return realIp.trim();
        }

        return request.getRemoteAddr();
    }

    // ========================================================================
    // LECTURA — Consulta paginada con filtros (CU16)
    // ========================================================================

    /**
     * Consulta logs con filtros opcionales y paginación.
     * Cualquier filtro nulo o vacío se ignora.
     */
    public Map<String, Object> consultar(
            String usuarioId,
            String categoria,
            String accion,
            String ipOrigen,
            LocalDateTime desde,
            LocalDateTime hasta,
            String textoLibre,
            String entidadId,
            int pagina,
            int tamano) {

        Query query = new Query();
        List<Criteria> criterios = new java.util.ArrayList<>();

        if (usuarioId != null && !usuarioId.isBlank()) {
            // match exacto case-insensitive
            criterios.add(Criteria.where("usuarioId").regex("^" + java.util.regex.Pattern.quote(usuarioId) + "$", "i"));
        }
        if (categoria != null && !categoria.isBlank()) {
            criterios.add(Criteria.where("categoria").is(categoria));
        }
        if (accion != null && !accion.isBlank()) {
            criterios.add(Criteria.where("accion").is(accion));
        }
        if (ipOrigen != null && !ipOrigen.isBlank()) {
            criterios.add(Criteria.where("ipOrigen").regex(java.util.regex.Pattern.quote(ipOrigen)));
        }
        if (desde != null || hasta != null) {
            Criteria fecha = Criteria.where("fechaTimestamp");
            if (desde != null) fecha = fecha.gte(desde);
            if (hasta != null) fecha = fecha.lte(hasta);
            criterios.add(fecha);
        }
        if (textoLibre != null && !textoLibre.isBlank()) {
            String regex = java.util.regex.Pattern.quote(textoLibre);
            criterios.add(new Criteria().orOperator(
                Criteria.where("detalle").regex(regex, "i"),
                Criteria.where("accion").regex(regex, "i"),
                Criteria.where("usuarioId").regex(regex, "i")
            ));
        }
        if (entidadId != null && !entidadId.isBlank()) {
            criterios.add(Criteria.where("entidadId").is(entidadId));
        }

        if (!criterios.isEmpty()) {
            query.addCriteria(new Criteria().andOperator(criterios.toArray(new Criteria[0])));
        }

        // Total ANTES de paginar
        long total = mongoTemplate.count(query, AuditLog.class);

        // Paginación
        int p = Math.max(0, pagina);
        int t = Math.min(Math.max(1, tamano), 200); // máximo 200 por página
        query.with(PageRequest.of(p, t, Sort.by(Sort.Direction.DESC, "fechaTimestamp")));

        List<AuditLog> items = mongoTemplate.find(query, AuditLog.class);

        Map<String, Object> resultado = new HashMap<>();
        resultado.put("items", items);
        resultado.put("total", total);
        resultado.put("pagina", p);
        resultado.put("tamano", t);
        resultado.put("totalPaginas", (long) Math.ceil((double) total / t));
        return resultado;
    }

    /**
     * Genera un CSV con todos los registros que coincidan con los filtros dados.
     * Máximo 5 000 filas para proteger memoria — si se necesita más, paginar.
     */
    public byte[] exportarCsv(
            String usuarioId, String categoria, String accion, String ipOrigen,
            LocalDateTime desde, LocalDateTime hasta, String textoLibre, String entidadId) {

        // Reusar consultar() con página 0 y límite alto
        Map<String, Object> resultado = consultar(
                usuarioId, categoria, accion, ipOrigen, desde, hasta, textoLibre, entidadId, 0, 5000);

        @SuppressWarnings("unchecked")
        List<AuditLog> items = (List<AuditLog>) resultado.get("items");

        StringBuilder sb = new StringBuilder();
        sb.append("ID,Fecha,IP,Usuario,Categoria,Accion,EntidadTipo,EntidadId,Detalle\n");

        for (AuditLog log : items) {
            sb.append(csv(log.getId())).append(',')
              .append(csv(log.getFechaTimestamp() != null ? log.getFechaTimestamp().toString() : "")).append(',')
              .append(csv(log.getIpOrigen())).append(',')
              .append(csv(log.getUsuarioId())).append(',')
              .append(csv(log.getCategoria())).append(',')
              .append(csv(log.getAccion())).append(',')
              .append(csv(log.getEntidadTipo())).append(',')
              .append(csv(log.getEntidadId())).append(',')
              .append(csv(log.getDetalle())).append('\n');
        }

        return sb.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String csv(String valor) {
        if (valor == null) return "";
        String escapado = valor.replace("\"", "\"\"");
        return (escapado.contains(",") || escapado.contains("\"") || escapado.contains("\n"))
               ? "\"" + escapado + "\""
               : escapado;
    }

    /**
     * Listas distintas para poblar dropdowns del filtro en el frontend.
     */
    public Map<String, Object> obtenerOpcionesFiltro() {
        Map<String, Object> opciones = new HashMap<>();

        List<String> usuarios = mongoTemplate.findDistinct("usuarioId", AuditLog.class, String.class);
        List<String> acciones = mongoTemplate.findDistinct("accion", AuditLog.class, String.class);
        List<String> categorias = mongoTemplate.findDistinct("categoria", AuditLog.class, String.class);

        // Limpiar nulls y ordenar
        usuarios.removeIf(s -> s == null || s.isBlank());
        acciones.removeIf(s -> s == null || s.isBlank());
        categorias.removeIf(s -> s == null || s.isBlank());

        java.util.Collections.sort(usuarios, String.CASE_INSENSITIVE_ORDER);
        java.util.Collections.sort(acciones, String.CASE_INSENSITIVE_ORDER);
        java.util.Collections.sort(categorias, String.CASE_INSENSITIVE_ORDER);

        opciones.put("usuarios", usuarios);
        opciones.put("acciones", acciones);
        opciones.put("categorias", categorias);
        return opciones;
    }
}
