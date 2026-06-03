package com.bpms.core.services;

import com.bpms.core.dto.PrediccionDTO;
import com.bpms.core.models.Tramite;
import com.bpms.core.repositories.TramiteRepository;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;

/**
 * CU24 — Llama al microservicio Python de predicción ML.
 *
 * Si el servicio no responde en 3 segundos, devuelve una predicción
 * vacía (NORMAL) para no bloquear el flujo de trabajo.
 */
@Service
public class PredictorService {

    private final String urlPredecir;
    private final String urlSalud;
    private final String urlEstadisticas;

    private final RestTemplate restTemplate;

    @Autowired
    private TramiteRepository tramiteRepository;

    public PredictorService(@org.springframework.beans.factory.annotation.Value("${ml.service.url:http://localhost:5001}") String mlServiceUrl) {
        this.urlPredecir     = mlServiceUrl + "/predecir";
        this.urlSalud        = mlServiceUrl + "/salud";
        this.urlEstadisticas = mlServiceUrl + "/estadisticas";

        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(3000);
        factory.setReadTimeout(3000);
        this.restTemplate = new RestTemplate(factory);
    }

    // ── DTO de request (snake_case para que Python lo lea directamente) ────────

    @Data
    public static class PeticionML {
        @JsonProperty("tipo_proceso")        private String tipoProceso        = "";
        @JsonProperty("paso_actual_idx")     private int    pasoActualIdx      = 0;
        @JsonProperty("num_pasos_total")     private int    numPasosTotal      = 1;
        @JsonProperty("dias_en_paso_actual") private double diasEnPasoActual   = 0;
        @JsonProperty("hora_dia")            private int    horaDia            = 12;
        @JsonProperty("dia_semana")          private int    diaSemana          = 1;
        @JsonProperty("carga_departamento")  private int    cargaDepartamento  = 0;
        @JsonProperty("pasos_completados")   private int    pasosCompletados   = 0;
        @JsonProperty("dias_desde_inicio")   private double diasDesdeInicio    = 0;
    }

    // ── API pública ───────────────────────────────────────────────────────────

    /**
     * Realiza la predicción para el trámite dado.
     * Nunca lanza excepción: en caso de error devuelve predicción NORMAL.
     */
    public PrediccionDTO predecir(Tramite tramite) {
        try {
            PeticionML req = construirPeticion(tramite);
            PrediccionDTO resp = restTemplate.postForObject(urlPredecir, req, PrediccionDTO.class);
            return resp != null ? resp : prediccionDefault();
        } catch (Exception e) {
            System.err.println("[CU24-Predictor] Microservicio no disponible: " + e.getMessage());
            return prediccionDefault();
        }
    }

    /** Comprueba si el microservicio Python está activo. */
    public boolean estaDisponible() {
        try {
            restTemplate.getForObject(urlSalud, String.class);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** Devuelve las estadísticas del microservicio (predicciones, métricas de entrenamiento). */
    @SuppressWarnings("unchecked")
    public java.util.Map<String, Object> obtenerEstadisticas() {
        try {
            java.util.Map<String, Object> resp =
                restTemplate.getForObject(urlEstadisticas, java.util.Map.class);
            if (resp == null) resp = new java.util.HashMap<>();
            resp.put("servicioOnline", true);
            return resp;
        } catch (Exception e) {
            java.util.Map<String, Object> fallback = new java.util.HashMap<>();
            fallback.put("servicioOnline", false);
            return fallback;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private PeticionML construirPeticion(Tramite tramite) {
        PeticionML req = new PeticionML();
        LocalDateTime ahora = LocalDateTime.now();

        req.setTipoProceso(tramite.getNombreProceso() != null ? tramite.getNombreProceso() : "");

        int completados = tramite.getPasosCompletadosIds() != null ? tramite.getPasosCompletadosIds().size() : 0;
        int activos     = tramite.getPasosActivosIds()     != null ? tramite.getPasosActivosIds().size()     : 0;
        int total       = Math.max(completados + activos, 1);

        req.setPasosCompletados(completados);
        req.setPasoActualIdx(completados);
        req.setNumPasosTotal(total);

        // Días exactos desde que el trámite entró en el paso actual
        LocalDateTime inicioStep = tramite.getFechaInicioStepActual() != null
                ? tramite.getFechaInicioStepActual()
                : (tramite.getFechaCreacion() != null ? tramite.getFechaCreacion() : ahora);
        req.setDiasEnPasoActual(ChronoUnit.HOURS.between(inicioStep, ahora) / 24.0);

        // Días desde la creación del trámite
        LocalDateTime creacion = tramite.getFechaCreacion() != null ? tramite.getFechaCreacion() : ahora;
        req.setDiasDesdeInicio(ChronoUnit.HOURS.between(creacion, ahora) / 24.0);

        req.setHoraDia(ahora.getHour());
        req.setDiaSemana(ahora.getDayOfWeek().getValue()); // 1=Lun … 7=Dom

        // Carga real del departamento: solo trámites en curso (excluye APROBADO/RECHAZADO)
        if (tramite.getDepartamentoActualId() != null) {
            long carga = tramiteRepository.contarActivosPorDepartamento(tramite.getDepartamentoActualId());
            req.setCargaDepartamento((int) Math.min(carga, 50));
        }

        return req;
    }

    private PrediccionDTO prediccionDefault() {
        PrediccionDTO d = new PrediccionDTO();
        d.setRiesgoDemora(0.0);
        d.setEsAnomalia(false);
        d.setNivelPrioridad("NORMAL");
        d.setConfianza(0.0);
        d.setMotivo("Predictor no disponible – enrutamiento estándar");
        return d;
    }
}
