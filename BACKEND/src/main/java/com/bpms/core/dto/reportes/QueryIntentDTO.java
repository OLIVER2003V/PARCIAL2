package com.bpms.core.dto.reportes;

import lombok.Data;

/**
 * Intención de consulta generada por Gemini a partir de lenguaje natural.
 * NUNCA contiene código MongoDB directo — solo metadatos declarativos.
 * ReporteNlpService construye el aggregation pipeline real a partir de esto.
 */
@Data
public class QueryIntentDTO {

    /** Título legible generado por la IA para el reporte */
    private String titulo;

    /** Tipo de gráfico sugerido: bar | line | pie | doughnut | tabla | mixed */
    private String tipoVisualizacion;

    /** Colección principal: tramites | usuarios | auditoria | procesos */
    private String coleccion;

    /** Filtros a aplicar */
    private FiltrosNlpDTO filtros;

    /** Dimensión de agrupación: estado | departamento | proceso | mes | semana | dia | usuario */
    private String agrupacion;

    /** Métrica: count | promedioDias */
    private String metrica;

    /** Orden de resultados: asc | desc */
    private String ordenar;

    /** Límite de grupos/filas a devolver (por defecto 10) */
    private Integer limite;

    /** Mensaje de error si Gemini no pudo interpretar la consulta */
    private String error;

    /** Sugerencia al usuario en caso de error */
    private String sugerencia;

    @Data
    public static class FiltrosNlpDTO {
        /** ISO date string yyyy-MM-dd, null = sin límite */
        private String fechaDesde;
        private String fechaHasta;
        /** EN_REVISION | APROBADO | RECHAZADO | null = todos */
        private String estado;
        /** Nombre parcial del departamento (case-insensitive) */
        private String departamentoNombre;
        /** Nombre parcial del proceso/política */
        private String procesoNombre;
        /** Username del usuario/cliente */
        private String usuarioUsername;
    }
}
