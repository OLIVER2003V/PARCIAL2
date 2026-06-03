package com.bpms.core.dto.reportes;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 👇 NUEVO CU13: Contenedor raíz del reporte gerencial.
 * Viaja del backend al frontend con TODAS las secciones pre-calculadas.
 * Los generadores de PDF/Excel lo consumen directamente.
 */
@Data
public class ReporteGerencialDTO {

    // === METADATOS DEL REPORTE ===
    private LocalDateTime fechaGeneracion;
    private String generadoPor; // username del admin
    private FiltrosAplicadosDTO filtros;

    // === SECCIÓN 1: RESUMEN EJECUTIVO ===
    private ResumenEjecutivoDTO resumenEjecutivo;

    // === SECCIÓN 2: PRODUCTIVIDAD POR DEPARTAMENTO ===
    private List<DepartamentoDesempenioDTO> desempenioDepartamentos = new ArrayList<>();

    // === SECCIÓN 3: DESEMPEÑO POR POLÍTICA DE NEGOCIO ===
    private List<PoliticaDesempenioDTO> desempenioPoliticas = new ArrayList<>();

    // === SECCIÓN 4: TENDENCIA TEMPORAL ===
    private TendenciaTemporalDTO tendenciaTemporal;

    // === SEÑAL A1: FLAG DE "SIN DATOS" ===
    private boolean sinDatos;
    private String mensajeSinDatos;
}