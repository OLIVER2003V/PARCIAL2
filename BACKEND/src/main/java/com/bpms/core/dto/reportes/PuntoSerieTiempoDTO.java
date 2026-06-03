package com.bpms.core.dto.reportes;

import lombok.Data;
import java.time.LocalDate;

/**
 * 👇 NUEVO CU13: Un punto de la serie de tiempo diaria.
 * Frontend lo pinta con Chart.js (línea doble: iniciados vs completados).
 */
@Data
public class PuntoSerieTiempoDTO {
    private LocalDate fecha;
    private long iniciados;    // trámites cuya fechaCreacion cae en este día
    private long completados;  // trámites cuya fechaUltimaActualizacion cae aquí Y están APROBADO/RECHAZADO
}