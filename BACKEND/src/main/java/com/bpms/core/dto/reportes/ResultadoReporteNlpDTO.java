package com.bpms.core.dto.reportes;

import lombok.Data;
import java.util.List;

/**
 * Resultado estructurado que el frontend consume para renderizar
 * gráficos (Chart.js) y tablas dinámicamente.
 */
@Data
public class ResultadoReporteNlpDTO {

    private String titulo;
    private String subtitulo;
    /** Frase en lenguaje natural que describe lo encontrado */
    private String interpretacion;
    /** bar | line | pie | doughnut | tabla | mixed */
    private String tipoVisualizacion;

    // ── Datos para gráfico ──────────────────────────────────────────────────
    /** Etiquetas del eje X (o sectores del pie) */
    private List<String> etiquetas;
    /** Una o más series de datos */
    private List<SerieDTO> series;

    // ── Datos para tabla ────────────────────────────────────────────────────
    private List<String> columnas;
    private List<List<Object>> filas;

    // ── Meta ────────────────────────────────────────────────────────────────
    private long totalRegistros;
    private boolean exportable;
    private String error;

    @Data
    public static class SerieDTO {
        private String nombre;
        private List<Number> valores;
        /**
         * Un color para series de una sola dimensión (bar, line).
         * Para pie/doughnut usar colores/coloresFondo (un elemento por sector).
         */
        private String color;
        private String colorFondo;
        /** Lista de colores por sector para pie/doughnut */
        private List<String> colores;
        private List<String> coloresFondo;
    }
}
