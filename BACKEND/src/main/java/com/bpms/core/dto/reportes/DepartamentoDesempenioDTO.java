package com.bpms.core.dto.reportes;

import lombok.Data;

/**
 * 👇 NUEVO CU13: Una fila por departamento en la tabla de productividad.
 * Usa AuditLog para calcular tiempo real de permanencia (handoff).
 */
@Data
public class DepartamentoDesempenioDTO {
    private String departamentoId;
    private String departamentoNombre;

    private long tramitesProcesados;            // cuántos pasaron por aquí
    private long cargaActivaActual;             // WIP: trámites que están AHÍ hoy
    private double tiempoPromedioPermanenciaHoras; // handoff time medio
    private double tiempoMaximoPermanenciaHoras;

    // Productividad del equipo
    private long accionesRegistradas;           // cantidad de AuditLogs del depto
    private String topFuncionarioUsername;      // el que más resolvió
    private long topFuncionarioAcciones;
}