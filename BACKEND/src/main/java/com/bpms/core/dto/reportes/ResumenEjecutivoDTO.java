package com.bpms.core.dto.reportes;

import lombok.Data;

/**
 * 👇 NUEVO CU13: KPIs principales que aparecen en las cards del preview
 * y en la primera página del PDF.
 */
@Data
public class ResumenEjecutivoDTO {

    // Volumen
    private long totalTramites;
    private long tramitesCompletados;     // APROBADO + RECHAZADO
    private long tramitesEnCurso;         // EN_PROCESO + EN_REVISION + EN_TIEMPO + ATRASADO + INICIADO
    private long tramitesAprobados;
    private long tramitesRechazados;

    // Eficiencia (porcentajes 0-100)
    private double tasaFinalizacion;      // completados / total * 100
    private double tasaAprobacion;        // aprobados / completados * 100
    private double tasaRechazo;           // rechazados / completados * 100
    private double tasaRetrabajo;         // trámites con al menos 1 iteración > 1

    // Tiempos (en horas, número decimal con 2 dígitos)
    private double leadTimePromedioHoras;    // media
    private double leadTimeMedianaHoras;     // mediana (más robusto a outliers)
    private double leadTimeMaximoHoras;

    // Throughput
    private double throughputDiarioPromedio; // completados / días del rango
    private int diasDelRango;
}