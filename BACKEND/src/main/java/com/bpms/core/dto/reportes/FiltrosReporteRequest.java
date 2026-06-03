package com.bpms.core.dto.reportes;

import lombok.Data;
import java.time.LocalDate;

/**
 * 👇 NUEVO CU13: Payload que envía el frontend al generar un reporte.
 * fechaInicio/fechaFin son obligatorios; los demás son opcionales.
 */
@Data
public class FiltrosReporteRequest {
    private LocalDate fechaInicio;
    private LocalDate fechaFin;
    private String departamentoId;      // null = todos
    private String procesoDefinicionId; // null = todos
}