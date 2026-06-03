package com.bpms.core.services;

import com.bpms.core.dto.reportes.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/**
 * 👇 NUEVO CU13: Genera el Excel del Reporte Gerencial usando Apache POI.
 * 5 hojas: Resumen, Departamentos, Políticas, Tendencia, Metadatos.
 * El admin puede hacer pivot tables directamente sobre cada hoja.
 */
@Service
public class ExcelReporteService {

    private static final DateTimeFormatter DTF_DIA = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    private static final DateTimeFormatter DTF = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");

    public byte[] generar(ReporteGerencialDTO dto) throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {

            // Estilos compartidos
            Estilos estilos = new Estilos(wb);

            hojaMetadatos(wb, dto, estilos);

            if (!dto.isSinDatos()) {
                hojaResumen(wb, dto.getResumenEjecutivo(), estilos);
                hojaDepartamentos(wb, dto.getDesempenioDepartamentos(), estilos);
                hojaPoliticas(wb, dto.getDesempenioPoliticas(), estilos);
                hojaTendencia(wb, dto.getTendenciaTemporal(), estilos);
            }

            wb.write(out);
            return out.toByteArray();
        }
    }

    // ==========================================================================
    // HOJA 0: METADATOS
    // ==========================================================================

    private void hojaMetadatos(Workbook wb, ReporteGerencialDTO dto, Estilos est) {
        Sheet s = wb.createSheet("Metadatos");
        int r = 0;

        fila(s, r++, est.titulo, "REPORTE GERENCIAL EJECUTIVO - BPMS Core");
        r++;
        fila(s, r++, est.cabecera, "Metadato", "Valor");
        fila(s, r++, est.celdaBold, "Fecha de generación", dto.getFechaGeneracion().format(DTF));
        fila(s, r++, est.celdaBold, "Generado por", dto.getGeneradoPor());

        FiltrosAplicadosDTO f = dto.getFiltros();
        fila(s, r++, est.celdaBold, "Fecha inicio", f.getFechaInicio().format(DTF_DIA));
        fila(s, r++, est.celdaBold, "Fecha fin",    f.getFechaFin().format(DTF_DIA));
        fila(s, r++, est.celdaBold, "Departamento",
            f.getDepartamentoNombre() != null ? f.getDepartamentoNombre() : "Todos");
        fila(s, r++, est.celdaBold, "Política",
            f.getProcesoNombre() != null ? f.getProcesoNombre() : "Todas");

        if (dto.isSinDatos()) {
            r++;
            fila(s, r++, est.advertencia, "⚠ " + dto.getMensajeSinDatos());
        }

        s.setColumnWidth(0, 6000);
        s.setColumnWidth(1, 10000);
    }

    // ==========================================================================
    // HOJA 1: RESUMEN EJECUTIVO
    // ==========================================================================

    private void hojaResumen(Workbook wb, ResumenEjecutivoDTO r, Estilos est) {
        if (r == null) return;
        Sheet s = wb.createSheet("Resumen Ejecutivo");
        int row = 0;

        fila(s, row++, est.titulo, "RESUMEN EJECUTIVO");
        row++;

        // Grupo: Volumen
        fila(s, row++, est.subseccion, "VOLUMEN");
        fila(s, row++, est.cabecera, "Indicador", "Valor");
        filaKpi(s, row++, "Total trámites", r.getTotalTramites(), est);
        filaKpi(s, row++, "Completados (aprobados + rechazados)", r.getTramitesCompletados(), est);
        filaKpi(s, row++, "En curso", r.getTramitesEnCurso(), est);
        filaKpi(s, row++, "Aprobados", r.getTramitesAprobados(), est);
        filaKpi(s, row++, "Rechazados", r.getTramitesRechazados(), est);
        row++;

        // Grupo: Eficiencia
        fila(s, row++, est.subseccion, "TASAS DE EFICIENCIA (%)");
        fila(s, row++, est.cabecera, "Indicador", "Porcentaje");
        filaKpiPct(s, row++, "Tasa de finalización", r.getTasaFinalizacion(), est);
        filaKpiPct(s, row++, "Tasa de aprobación",   r.getTasaAprobacion(), est);
        filaKpiPct(s, row++, "Tasa de rechazo",      r.getTasaRechazo(), est);
        filaKpiPct(s, row++, "Tasa de retrabajo",    r.getTasaRetrabajo(), est);
        row++;

        // Grupo: Tiempos
        fila(s, row++, est.subseccion, "TIEMPOS (HORAS)");
        fila(s, row++, est.cabecera, "Indicador", "Valor");
        filaKpi(s, row++, "Lead Time promedio (h)", r.getLeadTimePromedioHoras(), est);
        filaKpi(s, row++, "Lead Time mediana (h)",  r.getLeadTimeMedianaHoras(), est);
        filaKpi(s, row++, "Lead Time máximo (h)",   r.getLeadTimeMaximoHoras(), est);
        filaKpi(s, row++, "Throughput diario promedio", r.getThroughputDiarioPromedio(), est);
        filaKpi(s, row++, "Días del rango analizado", r.getDiasDelRango(), est);

        s.setColumnWidth(0, 11000);
        s.setColumnWidth(1, 4000);
    }

    // ==========================================================================
    // HOJA 2: DEPARTAMENTOS
    // ==========================================================================

    private void hojaDepartamentos(Workbook wb, java.util.List<DepartamentoDesempenioDTO> lista, Estilos est) {
        if (lista == null || lista.isEmpty()) return;
        Sheet s = wb.createSheet("Departamentos");
        int row = 0;

        fila(s, row++, est.titulo, "PRODUCTIVIDAD POR DEPARTAMENTO");
        row++;
        fila(s, row++, est.cabecera,
            "Departamento", "Trámites procesados", "WIP actual",
            "Acciones registradas", "T. promedio (h)", "T. máximo (h)",
            "Top funcionario", "Acciones del top");

        for (DepartamentoDesempenioDTO d : lista) {
            Row r = s.createRow(row++);
            celda(r, 0, d.getDepartamentoNombre(), est.celdaBold);
            celda(r, 1, d.getTramitesProcesados(), est.celda);
            celda(r, 2, d.getCargaActivaActual(), est.celda);
            celda(r, 3, d.getAccionesRegistradas(), est.celda);
            celda(r, 4, d.getTiempoPromedioPermanenciaHoras(), est.celda);
            celda(r, 5, d.getTiempoMaximoPermanenciaHoras(), est.celda);
            celda(r, 6, d.getTopFuncionarioUsername() != null ? d.getTopFuncionarioUsername() : "—", est.celda);
            celda(r, 7, d.getTopFuncionarioAcciones(), est.celda);
        }

        for (int i = 0; i < 8; i++) s.autoSizeColumn(i);
    }

    // ==========================================================================
    // HOJA 3: POLÍTICAS
    // ==========================================================================

    private void hojaPoliticas(Workbook wb, java.util.List<PoliticaDesempenioDTO> lista, Estilos est) {
        if (lista == null || lista.isEmpty()) return;
        Sheet s = wb.createSheet("Políticas");
        int row = 0;

        fila(s, row++, est.titulo, "DESEMPEÑO POR POLÍTICA DE NEGOCIO");
        row++;
        fila(s, row++, est.cabecera,
            "Código", "Política", "Versión", "Total trámites",
            "Completados", "En curso", "Tasa finalización (%)",
            "Lead Time promedio (h)", "Distribución decisiones");

        for (PoliticaDesempenioDTO p : lista) {
            Row r = s.createRow(row++);
            celda(r, 0, p.getCodigoPolitica() != null ? p.getCodigoPolitica() : "—", est.celda);
            celda(r, 1, p.getNombrePolitica(), est.celdaBold);
            celda(r, 2, p.getVersion() != null ? p.getVersion() : "", est.celda);
            celda(r, 3, p.getTotalTramites(), est.celda);
            celda(r, 4, p.getCompletados(), est.celda);
            celda(r, 5, p.getEnCurso(), est.celda);
            celda(r, 6, p.getTasaFinalizacion(), est.celda);
            celda(r, 7, p.getLeadTimePromedioHoras(), est.celda);

            String dist = p.getDistribucionDecisiones() == null || p.getDistribucionDecisiones().isEmpty()
                ? "—"
                : p.getDistribucionDecisiones().entrySet().stream()
                    .map(e -> e.getKey() + ": " + e.getValue())
                    .reduce((a, b) -> a + " | " + b)
                    .orElse("—");
            celda(r, 8, dist, est.celda);
        }

        for (int i = 0; i < 9; i++) s.autoSizeColumn(i);
    }

    // ==========================================================================
    // HOJA 4: TENDENCIA
    // ==========================================================================

    private void hojaTendencia(Workbook wb, TendenciaTemporalDTO tt, Estilos est) {
        if (tt == null) return;
        Sheet s = wb.createSheet("Tendencia Diaria");
        int row = 0;

        fila(s, row++, est.titulo, "TENDENCIA TEMPORAL");
        row++;

        // Resumen comparativo
        fila(s, row++, est.subseccion, "COMPARATIVA CON PERÍODO ANTERIOR");
        fila(s, row++, est.cabecera, "Métrica", "Valor");
        filaKpi(s, row++, "Total período actual", tt.getTotalPeriodoActual(), est);
        filaKpi(s, row++, "Total período anterior", tt.getTotalPeriodoAnterior(), est);
        filaKpiPct(s, row++, "Variación porcentual", tt.getVariacionPorcentual(), est);
        if (tt.getDiaPicoFecha() != null) {
            fila(s, row++, est.celdaBold, "Día pico", tt.getDiaPicoFecha() + "  (" + tt.getDiaPicoCantidad() + ")");
        }
        row++;

        // Serie completa día por día (perfecto para gráficos del admin en Excel)
        fila(s, row++, est.subseccion, "SERIE DIARIA");
        fila(s, row++, est.cabecera, "Fecha", "Iniciados", "Completados");

        if (tt.getSeriePorDia() != null) {
            for (PuntoSerieTiempoDTO p : tt.getSeriePorDia()) {
                Row r = s.createRow(row++);
                celda(r, 0, p.getFecha().format(DTF_DIA), est.celda);
                celda(r, 1, p.getIniciados(), est.celda);
                celda(r, 2, p.getCompletados(), est.celda);
            }
        }

        s.setColumnWidth(0, 4000);
        s.setColumnWidth(1, 4000);
        s.setColumnWidth(2, 4000);
    }

    // ==========================================================================
    // HELPERS
    // ==========================================================================

    private void fila(Sheet s, int rowIdx, CellStyle style, String... valores) {
        Row r = s.createRow(rowIdx);
        for (int i = 0; i < valores.length; i++) {
            celda(r, i, valores[i], style);
        }
        // Merge del título cuando solo tiene 1 columna en una hoja ancha
        if (valores.length == 1 && rowIdx == 0) {
            s.addMergedRegion(new CellRangeAddress(0, 0, 0, 5));
        }
    }

    private void filaKpi(Sheet s, int rowIdx, String etiqueta, double valor, Estilos est) {
        Row r = s.createRow(rowIdx);
        celda(r, 0, etiqueta, est.celda);
        Cell c = r.createCell(1);
        c.setCellValue(valor);
        c.setCellStyle(est.numero);
    }

    private void filaKpiPct(Sheet s, int rowIdx, String etiqueta, double valor, Estilos est) {
        Row r = s.createRow(rowIdx);
        celda(r, 0, etiqueta, est.celda);
        Cell c = r.createCell(1);
        c.setCellValue(valor);
        c.setCellStyle(est.porcentaje);
    }

    private void celda(Row r, int col, Object valor, CellStyle style) {
        Cell c = r.createCell(col);
        if (valor == null) c.setCellValue("—");
        else if (valor instanceof Number) c.setCellValue(((Number) valor).doubleValue());
        else c.setCellValue(valor.toString());
        c.setCellStyle(style);
    }

    // ==========================================================================
    // ESTILOS REUTILIZABLES
    // ==========================================================================

    private static class Estilos {
        final CellStyle titulo;
        final CellStyle subseccion;
        final CellStyle cabecera;
        final CellStyle celda;
        final CellStyle celdaBold;
        final CellStyle numero;
        final CellStyle porcentaje;
        final CellStyle advertencia;

        Estilos(Workbook wb) {
            DataFormat df = wb.createDataFormat();

            Font fTitulo = wb.createFont();
            fTitulo.setBold(true);
            fTitulo.setFontHeightInPoints((short) 14);
            fTitulo.setColor(IndexedColors.WHITE.getIndex());

            titulo = wb.createCellStyle();
            titulo.setFont(fTitulo);
            titulo.setFillForegroundColor(IndexedColors.ROYAL_BLUE.getIndex());
            titulo.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            titulo.setAlignment(HorizontalAlignment.LEFT);
            titulo.setVerticalAlignment(VerticalAlignment.CENTER);

            Font fSub = wb.createFont();
            fSub.setBold(true);
            fSub.setFontHeightInPoints((short) 11);
            fSub.setColor(IndexedColors.DARK_BLUE.getIndex());

            subseccion = wb.createCellStyle();
            subseccion.setFont(fSub);
            subseccion.setFillForegroundColor(IndexedColors.PALE_BLUE.getIndex());
            subseccion.setFillPattern(FillPatternType.SOLID_FOREGROUND);

            Font fCab = wb.createFont();
            fCab.setBold(true);
            fCab.setColor(IndexedColors.WHITE.getIndex());
            fCab.setFontHeightInPoints((short) 10);

            cabecera = wb.createCellStyle();
            cabecera.setFont(fCab);
            cabecera.setFillForegroundColor(IndexedColors.ROYAL_BLUE.getIndex());
            cabecera.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            cabecera.setAlignment(HorizontalAlignment.CENTER);
            cabecera.setBorderBottom(BorderStyle.THIN);

            celda = wb.createCellStyle();
            celda.setBorderBottom(BorderStyle.HAIR);
            celda.setBottomBorderColor(IndexedColors.GREY_25_PERCENT.getIndex());

            Font fBold = wb.createFont();
            fBold.setBold(true);

            celdaBold = wb.createCellStyle();
            celdaBold.cloneStyleFrom(celda);
            celdaBold.setFont(fBold);

            numero = wb.createCellStyle();
            numero.cloneStyleFrom(celda);
            numero.setDataFormat(df.getFormat("#,##0.00"));
            numero.setAlignment(HorizontalAlignment.RIGHT);

            porcentaje = wb.createCellStyle();
            porcentaje.cloneStyleFrom(celda);
            porcentaje.setDataFormat(df.getFormat("0.00\"%\""));
            porcentaje.setAlignment(HorizontalAlignment.RIGHT);

            Font fAdv = wb.createFont();
            fAdv.setBold(true);
            fAdv.setColor(IndexedColors.DARK_RED.getIndex());

            advertencia = wb.createCellStyle();
            advertencia.setFont(fAdv);
            advertencia.setFillForegroundColor(IndexedColors.LIGHT_YELLOW.getIndex());
            advertencia.setFillPattern(FillPatternType.SOLID_FOREGROUND);
        }
    }
}