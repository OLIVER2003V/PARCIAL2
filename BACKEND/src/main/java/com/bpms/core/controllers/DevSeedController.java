package com.bpms.core.controllers;

import com.bpms.core.models.*;
import com.bpms.core.repositories.AuditLogRepository;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import com.bpms.core.repositories.TramiteRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Endpoints de semilla de datos para testing en entorno de desarrollo.
 * ELIMINAR o deshabilitar antes de desplegar a producción.
 *
 * POST   /dev/seed/mineria?procesoId=<id>&cantidad=15  → genera trámites finalizados
 * DELETE /dev/seed/mineria?procesoId=<id>              → elimina los datos generados
 * GET    /dev/seed/mineria?procesoId=<id>              → cuántos registros seed existen
 */
@RestController
@RequestMapping("/dev")
public class DevSeedController {

    private static final String SEED_CLIENTE = "seed-dev";

    @Autowired private ProcesoDefinicionRepository procesoRepo;
    @Autowired private TramiteRepository           tramiteRepo;
    @Autowired private AuditLogRepository          auditLogRepo;

    // ── POST /dev/seed/mineria ────────────────────────────────────────────────

    /**
     * Genera {cantidad} trámites finalizados con distribuciones de tiempo
     * diseñadas para producir los tres semáforos del análisis de cuellos de botella:
     *
     *  VERDE    → paso inicial/final:   uniforme 1–5 h   (avg ≈ mediana)
     *  AMARILLO → paso previo al cuello: 80 % en 3–7 h + 20 % outlier 12–20 h  → ratio ≈ 1.20
     *  ROJO     → paso central (cuello): 60 % en 1–5 h + 40 % outlier 60–200 h → ratio >> 1.30
     */
    @PostMapping("/seed/mineria")
    public ResponseEntity<Map<String, Object>> sembrar(
            @RequestParam String procesoId,
            @RequestParam(defaultValue = "15") int cantidad) {

        ProcesoDefinicion proceso = procesoRepo.findById(procesoId)
                .orElseThrow(() -> new RuntimeException("Proceso no encontrado: " + procesoId));

        List<Paso> pasosTarea = proceso.getPasos().stream()
                .filter(p -> !p.getTipo().name().contains("GATEWAY"))
                .collect(Collectors.toList());

        if (pasosTarea.isEmpty()) {
            return ResponseEntity.badRequest()
                    .body(Map.of("error", "El proceso no tiene pasos de tipo TAREA"));
        }

        int idxBottleneck = pasosTarea.size() / 2;
        int idxAmarillo   = Math.max(0, idxBottleneck - 1);

        Random rnd = new Random();
        int logsCreados = 0;
        List<Map<String, Object>> resumenPasos = new ArrayList<>();

        for (int i = 0; i < cantidad; i++) {

            // ── Crear trámite ────────────────────────────────────────────────
            Tramite tramite = new Tramite();
            tramite.setProcesoDefinicionId(procesoId);
            tramite.setNombreProceso(proceso.getNombre());
            tramite.setCodigoSeguimiento("TRM-SEED-" + (5000 + i));
            tramite.setClienteId(SEED_CLIENTE);
            tramite.setDescripcion("[SEED] Trámite de prueba #" + (i + 1));
            tramite.setEstadoSemaforo(EstadoTramite.APROBADO);
            tramite.setPasoActualId("FIN");
            tramite.setDepartamentoActualId("ARCHIVADO");

            // Escalonar las fechas de creación en los últimos 30 días
            LocalDateTime inicio = LocalDateTime.now()
                    .minusDays(30)
                    .plusHours((long)(i * (30.0 * 24 / cantidad)));
            tramite.setFechaCreacion(inicio);
            tramite.setFechaInicioStepActual(inicio);

            List<String> completados = pasosTarea.stream()
                    .map(Paso::getId).collect(Collectors.toList());
            tramite.setPasosCompletadosIds(completados);
            tramite.setPasosActivosIds(new ArrayList<>());

            Tramite guardado = tramiteRepo.save(tramite);

            // ── Generar audit logs con timestamps acumulados ─────────────────
            LocalDateTime cursor = inicio;

            for (int j = 0; j < pasosTarea.size(); j++) {
                Paso paso = pasosTarea.get(j);
                double horas = generarHoras(j, idxBottleneck, idxAmarillo, rnd, i, paso);
                cursor = cursor.plusMinutes((long)(horas * 60));

                AuditLog log = new AuditLog();
                log.setTramiteId(guardado.getId());
                log.setPasoId(paso.getId());
                log.setPasoNombre(paso.getNombre());
                log.setUsuarioId(SEED_CLIENTE);
                log.setDepartamentoId(paso.getDepartamentoAsignadoId() != null
                        ? paso.getDepartamentoAsignadoId() : "SEED_DEPT");
                log.setAccion("APROBADO");
                log.setFechaTimestamp(cursor);
                log.setDetalle("[SEED] Paso completado");
                log.setCategoria("TRAMITE");
                auditLogRepo.save(log);
                logsCreados++;
            }

            // Actualizar timestamp final del trámite
            guardado.setFechaUltimaActualizacion(cursor);
            tramiteRepo.save(guardado);
        }

        // ── Resumen de los perfiles asignados a cada paso ────────────────────
        for (int j = 0; j < pasosTarea.size(); j++) {
            String perfil;
            if      (j == idxBottleneck)                                  perfil = "ROJO    — cuello de botella";
            else if (j == idxAmarillo && idxAmarillo != idxBottleneck)    perfil = "AMARILLO — moderado";
            else                                                           perfil = "VERDE   — rápido";

            Map<String, Object> info = new LinkedHashMap<>();
            info.put("indice", j);
            info.put("nombre", pasosTarea.get(j).getNombre());
            info.put("perfilEsperado", perfil);
            resumenPasos.add(info);
        }

        Map<String, Object> resultado = new LinkedHashMap<>();
        resultado.put("procesoId",       procesoId);
        resultado.put("nombreProceso",   proceso.getNombre());
        resultado.put("tramitesCreados", cantidad);
        resultado.put("logsCreados",     logsCreados);
        resultado.put("pasos",           resumenPasos);
        resultado.put("nota", "Ahora ve a Minería de Procesos y selecciona este proceso.");
        return ResponseEntity.ok(resultado);
    }

    // ── DELETE /dev/seed/mineria ──────────────────────────────────────────────

    @DeleteMapping("/seed/mineria")
    public ResponseEntity<Map<String, Object>> limpiar(@RequestParam String procesoId) {
        List<Tramite> seed = tramiteRepo.findByProcesoDefinicionId(procesoId).stream()
                .filter(t -> SEED_CLIENTE.equals(t.getClienteId()))
                .collect(Collectors.toList());

        int logsBorrados = 0;
        for (Tramite t : seed) {
            List<AuditLog> logs = auditLogRepo.findByTramiteIdOrderByFechaTimestampAsc(t.getId());
            logsBorrados += logs.size();
            auditLogRepo.deleteAll(logs);
        }
        tramiteRepo.deleteAll(seed);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("tramitesBorrados", seed.size());
        res.put("logsBorrados",     logsBorrados);
        return ResponseEntity.ok(res);
    }

    // ── GET /dev/seed/mineria ─────────────────────────────────────────────────

    @GetMapping("/seed/mineria")
    public ResponseEntity<Map<String, Object>> contar(@RequestParam String procesoId) {
        long total = tramiteRepo.findByProcesoDefinicionId(procesoId).stream()
                .filter(t -> SEED_CLIENTE.equals(t.getClienteId()))
                .count();
        return ResponseEntity.ok(Map.of("tramitesSeed", total, "procesoId", procesoId));
    }

    // ── Generación de horas por perfil ────────────────────────────────────────

    /**
     * Genera tiempos calibrados al SLA real del paso para garantizar cada semáforo.
     *
     * CON SLA manual (slaHoras > 0) — compara avg vs slaHoras:
     *   ROJO:     tramites 0-6 → 2.0x–3.0x SLA  |  tramites 7-14 → 0.3x–0.8x SLA
     *             avg = (7×2.5 + 8×0.55)/15 × SLA ≈ 1.46× SLA → ratio > 1.30 → ROJO
     *   AMARILLO: tramites con %10<7 (12 de 15) → 1.2x–1.6x SLA  |  resto → 0.1x–0.4x SLA
     *             avg ≈ 1.17× SLA → 1.0 < ratio < 1.30 → AMARILLO
     *   VERDE:    todos → 0.1x–0.3x SLA  →  avg ≈ 0.2× SLA → ratio << 1.0 → VERDE
     *
     * SIN SLA manual — compara avg vs mediana (auto-SLA):
     *   ROJO:     30 % extremo (60–200 h) vs 70 % rápido (1–5 h) — bimodal fuerte
     *   AMARILLO: 20 % moderado (8–14 h)  vs 80 % rápido (3–7 h)
     *   VERDE:    uniforme 1–5 h
     */
    private double generarHoras(int idx, int idxBottleneck, int idxAmarillo,
                                 Random rnd, int tramiteNum, Paso paso) {

        double sla = (paso.getSlaHoras() != null && paso.getSlaHoras() > 0)
                ? paso.getSlaHoras() : -1;

        if (idx == idxBottleneck) {
            if (sla > 0) {
                boolean esLento = tramiteNum < 7;
                return esLento
                        ? sla * (2.0 + rnd.nextDouble() * 1.0)   // 2x–3x SLA (bloqueado)
                        : sla * (0.3 + rnd.nextDouble() * 0.5);  // 0.3x–0.8x SLA (rápido)
            }
            boolean esLento = (tramiteNum % 10) < 3;
            return esLento
                    ? 60 + rnd.nextDouble() * 140   // 60–200 h
                    :  1 + rnd.nextDouble() *   4;  //  1–5 h
        }

        if (idx == idxAmarillo && idxAmarillo != idxBottleneck) {
            if (sla > 0) {
                boolean esLento = (tramiteNum % 10) < 7;
                return esLento
                        ? sla * (1.2 + rnd.nextDouble() * 0.4)   // 1.2x–1.6x SLA
                        : sla * (0.1 + rnd.nextDouble() * 0.3);  // 0.1x–0.4x SLA
            }
            boolean esOutlier = (tramiteNum % 5) == 0;
            return esOutlier
                    ? 8 + rnd.nextDouble() * 6   // 8–14 h
                    : 3 + rnd.nextDouble() * 4;  // 3–7 h
        }

        // VERDE
        return sla > 0
                ? sla * (0.1 + rnd.nextDouble() * 0.2)  // 0.1x–0.3x SLA
                :  1  + rnd.nextDouble() * 4;            // 1–5 h
    }
}
