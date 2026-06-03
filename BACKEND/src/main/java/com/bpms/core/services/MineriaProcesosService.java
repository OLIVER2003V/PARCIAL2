package com.bpms.core.services;

import com.bpms.core.dto.AnalisisCuellosBotellaDTO;
import com.bpms.core.dto.PasoMetricaDTO;
import com.bpms.core.models.AuditLog;
import com.bpms.core.models.Paso;
import com.bpms.core.models.ProcesoDefinicion;
import com.bpms.core.models.Tramite;
import com.bpms.core.repositories.AuditLogRepository;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import com.bpms.core.repositories.TramiteRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class MineriaProcesosService {

    @Autowired
    private TramiteRepository tramiteRepository;
    @Autowired
    private AuditLogRepository auditLogRepository;
    @Autowired
    private ProcesoDefinicionRepository procesoRepository;

    // Límite para el Flujo A1: Mínimo de trámites finalizados para que sea confiable
    private static final int UMBRAL_MINIMO_TRAMITES = 10; 

    public AnalisisCuellosBotellaDTO analizarCuellosBotella(String procesoId) {
        ProcesoDefinicion proceso = procesoRepository.findById(procesoId)
                .orElseThrow(() -> new RuntimeException("Política no encontrada"));

        // 1. Buscamos TODOS los trámites de esta política que ya hayan terminado ("FIN")
        List<Tramite> tramitesFinalizados = tramiteRepository.findByProcesoDefinicionId(procesoId).stream()
                .filter(t -> "FIN".equals(t.getPasoActualId()))
                .collect(Collectors.toList());

        AnalisisCuellosBotellaDTO analisis = new AnalisisCuellosBotellaDTO();
        analisis.setProcesoId(proceso.getId());
        analisis.setNombreProceso(proceso.getNombre());
        analisis.setTotalTramitesAnalizados(tramitesFinalizados.size());

        // 👇 Flujo Alternativo A1: Datos insuficientes
        if (tramitesFinalizados.size() < UMBRAL_MINIMO_TRAMITES) {
            analisis.setDatosInsuficientes(true);
            analisis.setMensajeAdvertencia("Atención: Hay solo " + tramitesFinalizados.size() + 
                " trámites finalizados. Se requiere un mínimo de " + UMBRAL_MINIMO_TRAMITES + 
                " para obtener promedios estadísticamente confiables.");
            // Igual calculamos para no dejar la pantalla en blanco
        } else {
            analisis.setDatosInsuficientes(false);
        }

        // 2. Extraer tiempos de los AuditLogs
        // Map<PasoId, Lista de Duraciones en Horas>
        Map<String, List<Double>> tiemposPorPaso = new HashMap<>();

        for (Tramite tramite : tramitesFinalizados) {
            List<AuditLog> logs = auditLogRepository.findByTramiteIdOrderByFechaTimestampAsc(tramite.getId());
            if (logs.isEmpty()) continue;

            LocalDateTime tiempoAnterior = tramite.getFechaCreacion(); // El reloj empieza cuando se crea

            for (AuditLog log : logs) {
                if (log.getPasoId() != null) {
                    // Duración desde el último evento hasta este
                    long minutos = Duration.between(tiempoAnterior, log.getFechaTimestamp()).toMinutes();
                    double horas = minutos / 60.0;

                    tiemposPorPaso.computeIfAbsent(log.getPasoId(), k -> new ArrayList<>()).add(horas);
                }
                tiempoAnterior = log.getFechaTimestamp(); // Reiniciar el reloj para el siguiente nodo
            }
        }

        // 3. Procesar matemáticas y semáforo térmico (Heatmap)
        List<PasoMetricaDTO> metricas = new ArrayList<>();

        for (Paso paso : proceso.getPasos()) {
            // Solo analizamos Tareas y Eventos, ignoramos Gateways (que son instantáneos)
            if (paso.getTipo().name().contains("GATEWAY")) continue;

            List<Double> tiempos = tiemposPorPaso.getOrDefault(paso.getId(), new ArrayList<>());
            if (tiempos.isEmpty()) continue;

            Collections.sort(tiempos); // Ordenamos de menor a mayor para calcular percentiles

            PasoMetricaDTO metrica = new PasoMetricaDTO();
            metrica.setPasoId(paso.getId());
            metrica.setNombrePaso(paso.getNombre());
            metrica.setCantidadTramites(tiempos.size());

            // Cálculos estadísticos básicos
            double sum = tiempos.stream().mapToDouble(Double::doubleValue).sum();
            metrica.setTiempoPromedioHoras(redondear(sum / tiempos.size()));
            metrica.setTiempoMedianaHoras(redondear(tiempos.get(tiempos.size() / 2)));
            metrica.setTiempoP75Horas(redondear(tiempos.get((int) (tiempos.size() * 0.75))));

            // 👇 La Opción B: Tomamos el SLA manual o autocalculamos con la Mediana
            if (paso.getSlaHoras() != null && paso.getSlaHoras() > 0) {
                metrica.setSlaObjetivoHoras(paso.getSlaHoras());
                metrica.setSlaAutoCalculado(false);
            } else {
                // El SLA es lo que normalmente tardan (la mediana que ya calculamos arriba)
                metrica.setSlaObjetivoHoras(metrica.getTiempoMedianaHoras()); 
                metrica.setSlaAutoCalculado(true);
            }

            metrica.setDesviacionHoras(redondear(metrica.getTiempoPromedioHoras() - metrica.getSlaObjetivoHoras()));

            // 4. Lógica del Heatmap
            metrica.setColorSemaforo(calcularColorSemaforo(metrica.getTiempoPromedioHoras(), metrica.getSlaObjetivoHoras()));
            metricas.add(metrica);
        }

        analisis.setMetricasPorPaso(metricas);
        return analisis;
    }

    // Regla de Negocio para el Mapa de Calor
    private String calcularColorSemaforo(double promedio, double sla) {
        if (promedio <= sla) {
            return "VERDE"; // Eficiente
        } else if (promedio <= sla * 1.30) {
            return "AMARILLO"; // Límite (hasta 30% de demora)
        } else {
            return "ROJO"; // Estancamiento (Cuello de botella)
        }
    }

    private double redondear(double valor) {
        return Math.round(valor * 100.0) / 100.0;
    }
}