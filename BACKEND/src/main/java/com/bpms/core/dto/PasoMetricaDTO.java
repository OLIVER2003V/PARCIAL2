package com.bpms.core.dto;

import lombok.Data;

@Data
public class PasoMetricaDTO {
    private String pasoId;
    private String nombrePaso;
    private long cantidadTramites;
    
    // Tiempos en HORAS
    private double tiempoPromedioHoras;
    private double tiempoMedianaHoras;
    private double tiempoP75Horas; // El percentil 75 (nos dice si hay valores atípicos graves)
    
    private double slaObjetivoHoras;
    private double desviacionHoras;
    
    private String colorSemaforo; // "VERDE", "AMARILLO", "ROJO"
    private boolean slaAutoCalculado;
}