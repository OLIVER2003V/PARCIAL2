package com.bpms.core.controllers;

import com.bpms.core.repositories.DepartamentoRepository;
import com.bpms.core.repositories.TramiteRepository;
import com.bpms.core.services.PredictorService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * CU24 — Endpoints de monitoreo del subsistema de predicción IA.
 * Solo accesibles por ADMIN.
 */
@RestController
@RequestMapping("/api/ia")
@CrossOrigin
public class IaMonitorController {

    @Autowired private PredictorService      predictorService;
    @Autowired private TramiteRepository     tramiteRepository;
    @Autowired private DepartamentoRepository departamentoRepository;

    /** Estado del microservicio Python + métricas de entrenamiento + contadores. */
    @GetMapping("/estado")
    public ResponseEntity<Map<String, Object>> estado() {
        return ResponseEntity.ok(predictorService.obtenerEstadisticas());
    }

    /** Lanza el entrenamiento del modelo en el microservicio Python. */
    @PostMapping("/entrenar")
    public ResponseEntity<Map<String, Object>> entrenar() {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> resp =
                new org.springframework.web.client.RestTemplate()
                    .postForObject("http://localhost:5001/entrenar", null, Map.class);
            return ResponseEntity.ok(resp != null ? resp : Map.of("estado", "desconocido"));
        } catch (Exception e) {
            Map<String, Object> err = new java.util.HashMap<>();
            err.put("estado", "error");
            err.put("mensaje", "Microservicio no disponible: " + e.getMessage());
            return ResponseEntity.status(503).body(err);
        }
    }

    /** Distribución de niveles de prioridad — usa queries de conteo, no findAll(). */
    @GetMapping("/distribucion")
    public ResponseEntity<Map<String, Object>> distribucion() {
        long total     = tramiteRepository.count();
        long alto      = tramiteRepository.contarPorNivel("ALTO");
        long critico   = tramiteRepository.contarPorNivel("CRITICO");
        // Normal incluye trámites con campo null (anteriores a CU24)
        long normal    = total - alto - critico;
        long anomalias = tramiteRepository.contarAnomalias();

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("normal",    normal);
        resp.put("alto",      alto);
        resp.put("critico",   critico);
        resp.put("anomalias", anomalias);
        resp.put("total",     total);

        return ResponseEntity.ok(resp);
    }

    /** Listado de los 20 trámites más recientes marcados como anomalía por el modelo. */
    @GetMapping("/anomalias")
    public ResponseEntity<List<Map<String, Object>>> anomalias() {
        List<Map<String, Object>> result = tramiteRepository.findByEsAnomaliaTrue()
            .stream()
            .sorted(Comparator.comparing(
                t -> t.getFechaUltimaActualizacion() != null
                     ? t.getFechaUltimaActualizacion()
                     : t.getFechaCreacion(),
                Comparator.reverseOrder()
            ))
            .limit(20)
            .map(t -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id",                       t.getId());
                item.put("codigoSeguimiento",        nvl(t.getCodigoSeguimiento()));
                item.put("clienteId",                nvl(t.getClienteId()));
                item.put("nombreProceso",            nvl(t.getNombreProceso()));
                item.put("riesgoDemora",             t.getRiesgoDemora());
                item.put("nivelPrioridad",           nvl(t.getNivelPrioridad(), "NORMAL"));
                item.put("motivoPrediccion",         nvl(t.getMotivoPrediccion()));
                item.put("fechaUltimaActualizacion",
                    t.getFechaUltimaActualizacion() != null
                        ? t.getFechaUltimaActualizacion().toString() : "");
                return item;
            })
            .collect(Collectors.toList());

        return ResponseEntity.ok(result);
    }

    /** Top-10 trámites con nivel CRITICO ordenados por fecha desc. */
    @GetMapping("/criticos")
    public ResponseEntity<List<Map<String, Object>>> criticos() {
        List<Map<String, Object>> result = tramiteRepository
            .findTop10ByNivelPrioridadOrderByFechaUltimaActualizacionDesc("CRITICO")
            .stream()
            .map(t -> {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id",                       t.getId());
                item.put("codigoSeguimiento",        nvl(t.getCodigoSeguimiento()));
                item.put("clienteId",                nvl(t.getClienteId()));
                item.put("nombreProceso",            nvl(t.getNombreProceso()));
                item.put("riesgoDemora",             t.getRiesgoDemora());
                item.put("nivelPrioridad",           nvl(t.getNivelPrioridad(), "CRITICO"));
                item.put("motivoPrediccion",         nvl(t.getMotivoPrediccion()));
                item.put("fechaUltimaActualizacion",
                    t.getFechaUltimaActualizacion() != null
                        ? t.getFechaUltimaActualizacion().toString() : "");
                return item;
            })
            .collect(Collectors.toList());
        return ResponseEntity.ok(result);
    }

    /** Distribución de niveles agrupada por departamento. */
    @GetMapping("/por-departamento")
    public ResponseEntity<List<Map<String, Object>>> porDepartamento() {
        List<Map<String, Object>> result = departamentoRepository.findAll()
            .stream()
            .map(dept -> {
                long total   = tramiteRepository.contarPorDepartamento(dept.getId());
                long alto    = tramiteRepository.contarPorDepartamentoYNivel(dept.getId(), "ALTO");
                long critico = tramiteRepository.contarPorDepartamentoYNivel(dept.getId(), "CRITICO");
                long normal  = total - alto - critico;

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("departamento", dept.getNombre());
                item.put("total",    total);
                item.put("normal",   normal);
                item.put("alto",     alto);
                item.put("critico",  critico);
                return item;
            })
            .filter(item -> (long) item.get("total") > 0)
            .collect(Collectors.toList());
        return ResponseEntity.ok(result);
    }

    private String nvl(String s)            { return s != null ? s : ""; }
    private String nvl(String s, String def){ return s != null ? s : def; }
}
