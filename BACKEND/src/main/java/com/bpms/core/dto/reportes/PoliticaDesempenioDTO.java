package com.bpms.core.dto.reportes;

import lombok.Data;
import java.util.HashMap;
import java.util.Map;

/**
 * 👇 NUEVO CU13: Una fila por política de negocio.
 * Incluye distribución de decisiones de gateway (ej: "APROBADO: 70%, RECHAZADO: 30%").
 */
@Data
public class PoliticaDesempenioDTO {
    private String procesoDefinicionId;
    private String codigoPolitica;
    private String nombrePolitica;
    private Integer version;

    private long totalTramites;
    private long completados;
    private long enCurso;
    private double tasaFinalizacion;
    private double leadTimePromedioHoras;

    // Distribución de resoluciones: clave = nombreAccion del gateway (ej "APROBADO", "SI", "BUENO")
    // valor = cantidad de veces que se eligió esa ruta
    private Map<String, Long> distribucionDecisiones = new HashMap<>();
}