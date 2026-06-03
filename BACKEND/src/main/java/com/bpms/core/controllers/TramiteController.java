package com.bpms.core.controllers;

import com.bpms.core.models.NuevoTramiteRequest;
import com.bpms.core.models.TipoResponsable;
import com.bpms.core.models.Tramite;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import com.bpms.core.repositories.TramiteRepository;
import com.bpms.core.services.ArchivoService;
import com.bpms.core.services.DocumentoColaborativoService;
import com.bpms.core.services.FlujoService;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.security.Principal;

@RestController
@RequestMapping("/api/tramites")
public class TramiteController {

    @Autowired
    private TramiteRepository tramiteRepository;

    @Autowired
    private ProcesoDefinicionRepository procesoRepository;

    @Autowired
    private com.bpms.core.services.FirebasePushService pushService;
    // Endpoint temporal para probar la notificación PUSH real
    @GetMapping("/test-push/{token}")
    public ResponseEntity<?> testPushNotification(@PathVariable String token) {
        pushService.enviarNotificacionPush(
            token, 
            "🚀 Trámite Actualizado", 
            "¡Magia! Tu trámite ahora está en Revisión."
        );
        return ResponseEntity.ok("Push intentado. Revisa la consola.");
    }

    // 1. Crear un trámite nuevo (Lo usará el CLIENTE)
    @PostMapping
    public Tramite crearTramite(@RequestBody Tramite tramite) {
        // Nos aseguramos de que nazca con la fecha exacta de hoy
        tramite.setFechaCreacion(LocalDateTime.now());
        tramite.setFechaUltimaActualizacion(LocalDateTime.now());
        return tramiteRepository.save(tramite);
    }

    // 2. Obtener trámites de una bandeja específica (Lo usará el FUNCIONARIO)
    @GetMapping("/bandeja/{departamentoId}")
    public List<Tramite> obtenerBandejaEntrada(@PathVariable String departamentoId) {
        return tramiteRepository.findByDepartamentoActualId(departamentoId);
    }

    // 3. Ver todos los trámites (Lo usará el ADMIN)
    @GetMapping
    public List<Tramite> obtenerTodos() {
        return tramiteRepository.findAll();
    }

    // 1. Método para buscar un trámite específico por su ID
    @GetMapping("/mis-tramites")
    public ResponseEntity<?> obtenerMisTramites(Principal principal) {
        if (principal == null || principal.getName() == null || principal.getName().isBlank()) {
            return ResponseEntity.status(401).body("Usuario no autenticado");
        }
        List<Tramite> tramites = tramiteRepository.findByClienteIdOrderByFechaCreacionDesc(principal.getName());
        tramites.forEach(t -> enriquecerNombreProceso(t));
        return ResponseEntity.ok(tramites);
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> obtenerTramitePorId(@PathVariable String id) {
        return tramiteRepository.findById(id)
                .map(tramite -> ResponseEntity.ok(tramite))
                .orElse(ResponseEntity.notFound().build());
    }

    @Autowired
    private FlujoService flujoService;

    @Autowired
    private ArchivoService archivoService;

    @Autowired
    private DocumentoColaborativoService docColabService;

    @Autowired
    private org.springframework.data.mongodb.core.MongoTemplate mongoTemplate;

    // 👇 NUEVO: Endpoint optimizado con Aggregation y Filtro de Fechas
    @GetMapping("/dashboard/stats")
    public ResponseEntity<?> getDashboardStats(
            @RequestParam(required = false) String fechaInicio,
            @RequestParam(required = false) String fechaFin) {
        try {
            org.springframework.data.mongodb.core.query.Criteria criteria = new org.springframework.data.mongodb.core.query.Criteria();

            // Filtro dinámico de fechas
            if (fechaInicio != null && !fechaInicio.isBlank() && fechaFin != null && !fechaFin.isBlank()) {
                criteria = org.springframework.data.mongodb.core.query.Criteria.where("fechaCreacion")
                        .gte(LocalDateTime.parse(fechaInicio + "T00:00:00"))
                        .lte(LocalDateTime.parse(fechaFin + "T23:59:59"));
            }

            org.springframework.data.mongodb.core.aggregation.MatchOperation matchStage = org.springframework.data.mongodb.core.aggregation.Aggregation
                    .match(criteria);

            // Pipeline de agrupación sumando estados
            org.springframework.data.mongodb.core.aggregation.GroupOperation groupStage = org.springframework.data.mongodb.core.aggregation.Aggregation
                    .group()
                    .count().as("total")
                    .sum(org.springframework.data.mongodb.core.aggregation.ConditionalOperators.when(
                            org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo").is("APROBADO"))
                            .then(1).otherwise(0))
                    .as("aprobados")
                    .sum(org.springframework.data.mongodb.core.aggregation.ConditionalOperators.when(
                            org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                    .is("RECHAZADO"))
                            .then(1).otherwise(0))
                    .as("rechazados")
                    .sum(org.springframework.data.mongodb.core.aggregation.ConditionalOperators.when(
                            new org.springframework.data.mongodb.core.query.Criteria().orOperator(
                                    org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                            .is("EN_REVISION"),
                                    org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                            .is("EN_TIEMPO"),
                                    org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                            .is("EN_PROCESO")))
                            .then(1).otherwise(0))
                    .as("enProceso");

            org.springframework.data.mongodb.core.aggregation.Aggregation aggregation = org.springframework.data.mongodb.core.aggregation.Aggregation
                    .newAggregation(matchStage, groupStage);

            org.springframework.data.mongodb.core.aggregation.AggregationResults<java.util.Map> results = mongoTemplate
                    .aggregate(aggregation, "tramites", java.util.Map.class);

            java.util.Map<String, Object> stats = results.getUniqueMappedResult();
            if (stats == null) {
                // Flujo A1: Sin Datos
                stats = java.util.Map.of("total", 0, "aprobados", 0, "rechazados", 0, "enProceso", 0);
            }

            return ResponseEntity.ok(stats);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Error al cargar estadísticas: " + e.getMessage());
        }
    }

    // 👇 NUEVO: Pipeline para agrupar por política (Evita el findAll en memoria)
    @GetMapping("/dashboard/por-politica")
    public ResponseEntity<?> getStatsPorPolitica(
            @RequestParam(required = false) String fechaInicio,
            @RequestParam(required = false) String fechaFin) {
        try {
            org.springframework.data.mongodb.core.query.Criteria criteria = org.springframework.data.mongodb.core.query.Criteria
                    .where("procesoDefinicionId").exists(true);

            if (fechaInicio != null && !fechaInicio.isBlank() && fechaFin != null && !fechaFin.isBlank()) {
                criteria.andOperator(
                        org.springframework.data.mongodb.core.query.Criteria.where("fechaCreacion")
                                .gte(LocalDateTime.parse(fechaInicio + "T00:00:00")),
                        org.springframework.data.mongodb.core.query.Criteria.where("fechaCreacion")
                                .lte(LocalDateTime.parse(fechaFin + "T23:59:59")));
            }

            org.springframework.data.mongodb.core.aggregation.MatchOperation match = org.springframework.data.mongodb.core.aggregation.Aggregation
                    .match(criteria);

            org.springframework.data.mongodb.core.aggregation.GroupOperation group = org.springframework.data.mongodb.core.aggregation.Aggregation
                    .group("procesoDefinicionId")
                    .count().as("total")
                    .sum(org.springframework.data.mongodb.core.aggregation.ConditionalOperators.when(
                            org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo").is("APROBADO"))
                            .then(1).otherwise(0))
                    .as("APROBADO")
                    .sum(org.springframework.data.mongodb.core.aggregation.ConditionalOperators.when(
                            org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                    .is("RECHAZADO"))
                            .then(1).otherwise(0))
                    .as("RECHAZADO")
                    .sum(org.springframework.data.mongodb.core.aggregation.ConditionalOperators.when(
                            new org.springframework.data.mongodb.core.query.Criteria().orOperator(
                                    org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                            .is("EN_REVISION"),
                                    org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                            .is("EN_TIEMPO"),
                                    org.springframework.data.mongodb.core.query.Criteria.where("estadoSemaforo")
                                            .is("EN_PROCESO")))
                            .then(1).otherwise(0))
                    .as("EN_REVISION");

            org.springframework.data.mongodb.core.aggregation.Aggregation agg = org.springframework.data.mongodb.core.aggregation.Aggregation
                    .newAggregation(match, group);

            java.util.List<java.util.Map> results = mongoTemplate.aggregate(agg, "tramites", java.util.Map.class)
                    .getMappedResults();

            // Transformar al formato que espera el frontend: Map<String, Map<String, Long>>
            java.util.Map<String, java.util.Map<String, Object>> response = new java.util.HashMap<>();
            for (java.util.Map r : results) {
                String id = (String) r.get("_id");
                response.put(id, r);
            }

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Error: " + e.getMessage());
        }
    }

    // 2. Método para que el funcionario guarde su resolución (Actualizar)
    @PutMapping("/{id}")
    public ResponseEntity<?> actualizarTramite(@PathVariable String id,
            @RequestBody Tramite tramiteActualizado,
            Principal principal) { // Principal extrae al usuario del Token
        try {
            // Si hay un token válido, sacamos el username real. Si no, lo marcamos como
            // SISTEMA
            String usernameFuncionario = (principal != null) ? principal.getName() : "SISTEMA";

            // Le pasamos la pelota a nuestro nuevo servicio experto
            Tramite tramiteProcesado = flujoService.procesarResolucion(id, tramiteActualizado, usernameFuncionario);

            return ResponseEntity.ok(tramiteProcesado);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(e.getMessage());
        }
    }

    @GetMapping("/{id}/historial")
    public ResponseEntity<?> obtenerHistorial(@PathVariable String id) {
        try {
            // Llamamos al servicio que acabamos de crear
            return ResponseEntity.ok(flujoService.obtenerHistorialTramite(id));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Error al obtener el historial: " + e.getMessage());
        }
    }

    // Buscar trámite público por Código de Seguimiento
    @GetMapping("/rastrear/{codigo}")
    public ResponseEntity<?> rastrearTramite(@PathVariable String codigo) {
        return tramiteRepository.findByCodigoSeguimiento(codigo)
                .map(tramite -> { enriquecerNombreProceso(tramite); return ResponseEntity.ok(tramite); })
                .orElse(ResponseEntity.notFound().build());
    }

    private void enriquecerNombreProceso(Tramite tramite) {
        if (tramite.getNombreProceso() == null && tramite.getProcesoDefinicionId() != null) {
            procesoRepository.findById(tramite.getProcesoDefinicionId())
                    .ifPresent(p -> tramite.setNombreProceso(p.getNombre()));
        }
    }
    // Importa NuevoTramiteRequest arriba si es necesario

    @PostMapping("/iniciar")
    public ResponseEntity<?> iniciarTramite(@RequestBody NuevoTramiteRequest request) {
        try {
            Tramite nuevoTramite = flujoService.iniciarTramiteCliente(request);

            // Mover archivos del formulario inicial de sin-asignar/ → TRM-XXX/CLIENTE-xxx/
            var remapeo = archivoService.moverArchivosATramite(
                    nuevoTramite.getDatosFormularioInicial(),
                    nuevoTramite.getClienteId(),
                    nuevoTramite.getCodigoSeguimiento());
            docColabService.actualizarUrls(remapeo);

            return ResponseEntity.ok(nuevoTramite);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body("Error al iniciar trámite: " + e.getMessage());
        }
    }

    

    

    /**
     * Trámites donde el cliente tiene una solicitud pendiente (SOLICITUD_CLIENTE).
     * Se usa en la bandeja del cliente para mostrarle lo que debe atender.
     */
    @GetMapping("/cliente/{clienteId}/pendientes")
    public ResponseEntity<?> obtenerPendientesCliente(@PathVariable String clienteId, Principal principal) {
        if (!puedeConsultarCliente(clienteId, principal)) {
            return ResponseEntity.status(403).body("No autorizado");
        }
        return ResponseEntity.ok(tramiteRepository.findByClienteIdAndTipoResponsableActual(
                clienteId, TipoResponsable.SOLICITUD_CLIENTE));
    }

    /**
     * Todos los trámites iniciados por un cliente (para su historial).
     */
    @GetMapping("/cliente/{clienteId}")
    public ResponseEntity<?> obtenerTramitesDelCliente(@PathVariable String clienteId, Principal principal) {
        if (!puedeConsultarCliente(clienteId, principal)) {
            return ResponseEntity.status(403).body("No autorizado");
        }
        return ResponseEntity.ok(tramiteRepository.findByClienteIdOrderByFechaCreacionDesc(clienteId));
    }

    private boolean puedeConsultarCliente(String clienteId, Principal principal) {
        return principal != null && principal.getName() != null && principal.getName().equals(clienteId);
    }
}
