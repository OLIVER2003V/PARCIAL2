package com.bpms.core.dto.reportes;

import lombok.Data;
import java.util.ArrayList;
import java.util.List;

/**
 * 👇 NUEVO CU13: Serie de tiempo diaria + comparativa con periodo anterior.
 */
@Data
public class TendenciaTemporalDTO {

    private List<PuntoSerieTiempoDTO> seriePorDia = new ArrayList<>();

    // Comparativa con el periodo inmediatamente anterior de la misma duración
    // Ej: si filtro es 01-31 enero, compara con 01-31 diciembre
    private long totalPeriodoActual;
    private long totalPeriodoAnterior;
    private double variacionPorcentual; // ((actual - anterior) / anterior) * 100

    // Día pico de iniciados
    private String diaPicoFecha;
    private long diaPicoCantidad;
}