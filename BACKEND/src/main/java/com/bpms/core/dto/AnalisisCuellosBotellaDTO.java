package com.bpms.core.dto;

import lombok.Data;
import java.util.List;

@Data
public class AnalisisCuellosBotellaDTO {
    private String procesoId;
    private String nombreProceso;
    private long totalTramitesAnalizados;
    private boolean datosInsuficientes; // 👇 Para activar el Flujo A1 en frontend
    private String mensajeAdvertencia;
    
    private List<PasoMetricaDTO> metricasPorPaso;
}