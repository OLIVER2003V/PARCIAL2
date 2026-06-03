package com.bpms.core.dto.reportes;

import lombok.Data;
import java.time.LocalDate;

/**
 * 👇 NUEVO CU13: Filtros que el admin eligió, los re-enviamos en la respuesta
 * para que el PDF/Excel los muestre en la cabecera del documento.
 */
@Data
public class FiltrosAplicadosDTO {
    private LocalDate fechaInicio;
    private LocalDate fechaFin;

    // Opcionales — si vienen null significa "todos"
    private String departamentoId;
    private String departamentoNombre; // resuelto para mostrar en el PDF
    private String procesoDefinicionId;
    private String procesoNombre; // resuelto para mostrar en el PDF
}