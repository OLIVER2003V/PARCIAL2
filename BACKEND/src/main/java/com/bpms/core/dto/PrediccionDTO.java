package com.bpms.core.dto;

import lombok.Data;

/**
 * DTO que mapea la respuesta JSON del microservicio Python (CU24).
 * Campos en snake_case porque Jackson los convierte automáticamente
 * cuando spring.jackson.property-naming-strategy=SNAKE_CASE, pero
 * aquí usamos @JsonProperty explícito para máxima compatibilidad.
 */
@Data
public class PrediccionDTO {

    @com.fasterxml.jackson.annotation.JsonProperty("riesgo_demora")
    private double riesgoDemora;

    @com.fasterxml.jackson.annotation.JsonProperty("es_anomalia")
    private boolean esAnomalia;

    @com.fasterxml.jackson.annotation.JsonProperty("nivel_prioridad")
    private String nivelPrioridad;

    @com.fasterxml.jackson.annotation.JsonProperty("funcionario_recomendado_id")
    private String funcionarioRecomendadoId;

    @com.fasterxml.jackson.annotation.JsonProperty("confianza")
    private double confianza;

    @com.fasterxml.jackson.annotation.JsonProperty("motivo")
    private String motivo;
}
