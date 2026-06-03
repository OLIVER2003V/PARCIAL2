package com.bpms.core.services;

import com.bpms.core.dto.reportes.*;
import com.lowagie.text.*;
import com.lowagie.text.pdf.*;
import org.springframework.stereotype.Service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/**
 * 👇 NUEVO CU13: Genera el PDF del Reporte Gerencial usando OpenPDF.
 * Diseño profesional con cabecera, secciones y tablas estilizadas.
 */
@Service
public class PdfReporteService {

    // Paleta corporativa (coincide con los colores del frontend brand-*)
    private static final Color AZUL_CORP      = new Color(37, 99, 235);   // brand-primary
    private static final Color GRIS_OSCURO    = new Color(31, 41, 55);    // text-primary
    private static final Color GRIS_MEDIO     = new Color(107, 114, 128); // text-muted
    private static final Color GRIS_CLARO     = new Color(243, 244, 246); // surface
    private static final Color BORDE          = new Color(229, 231, 235);
    private static final Color VERDE          = new Color(16, 185, 129);  // aprobado
    private static final Color ROJO           = new Color(239, 68, 68);   // rechazado
    private static final Color AMARILLO       = new Color(245, 158, 11);  // en revisión

    private static final DateTimeFormatter DTF = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");
    private static final DateTimeFormatter DTF_DIA = DateTimeFormatter.ofPattern("dd/MM/yyyy");

    // Fuentes reutilizables
    private static final Font F_TITULO     = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 20, Color.WHITE);
    private static final Font F_SUBTITULO  = FontFactory.getFont(FontFactory.HELVETICA, 10, new Color(219, 234, 254));
    private static final Font F_SECCION    = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 14, AZUL_CORP);
    private static final Font F_CABECERA_T = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, Color.WHITE);
    private static final Font F_CELDA      = FontFactory.getFont(FontFactory.HELVETICA, 9, GRIS_OSCURO);
    private static final Font F_CELDA_BOLD = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, GRIS_OSCURO);
    private static final Font F_KPI_VALOR  = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 16, AZUL_CORP);
    private static final Font F_KPI_LABEL  = FontFactory.getFont(FontFactory.HELVETICA, 8, GRIS_MEDIO);
    private static final Font F_META       = FontFactory.getFont(FontFactory.HELVETICA, 9, GRIS_MEDIO);
    private static final Font F_META_BOLD  = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, GRIS_OSCURO);

    public byte[] generar(ReporteGerencialDTO dto) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Document pdf = new Document(PageSize.A4, 36, 36, 40, 40);
        PdfWriter.getInstance(pdf, out);
        pdf.open();

        dibujarCabecera(pdf, dto);
        dibujarMetadatos(pdf, dto);

        if (dto.isSinDatos()) {
            dibujarSinDatos(pdf, dto);
        } else {
            dibujarResumenEjecutivo(pdf, dto.getResumenEjecutivo());
            dibujarDepartamentos(pdf, dto.getDesempenioDepartamentos());
            dibujarPoliticas(pdf, dto.getDesempenioPoliticas());
            dibujarTendencia(pdf, dto.getTendenciaTemporal());
        }

        dibujarPiePagina(pdf);
        pdf.close();
        return out.toByteArray();
    }

    // ==========================================================================
    // CABECERA
    // ==========================================================================

    private void dibujarCabecera(Document pdf, ReporteGerencialDTO dto) throws DocumentException {
        PdfPTable banda = new PdfPTable(1);
        banda.setWidthPercentage(100);
        banda.setSpacingAfter(8);

        PdfPCell cell = new PdfPCell();
        cell.setBackgroundColor(AZUL_CORP);
        cell.setBorder(Rectangle.NO_BORDER);
        cell.setPadding(16);

        Paragraph titulo = new Paragraph("REPORTE GERENCIAL EJECUTIVO", F_TITULO);
        titulo.setAlignment(Element.ALIGN_LEFT);
        cell.addElement(titulo);

        Paragraph sub = new Paragraph(
            "BPMS Core  |  Generado: " + dto.getFechaGeneracion().format(DTF) +
            "  |  Por: " + dto.getGeneradoPor(),
            F_SUBTITULO);
        cell.addElement(sub);

        banda.addCell(cell);
        pdf.add(banda);
    }

    // ==========================================================================
    // METADATOS (filtros aplicados)
    // ==========================================================================

    private void dibujarMetadatos(Document pdf, ReporteGerencialDTO dto) throws DocumentException {
        FiltrosAplicadosDTO f = dto.getFiltros();

        PdfPTable t = new PdfPTable(new float[]{1, 3});
        t.setWidthPercentage(100);
        t.setSpacingAfter(16);

        agregarFilaMeta(t, "Período analizado",
            f.getFechaInicio().format(DTF_DIA) + "  al  " + f.getFechaFin().format(DTF_DIA));
        agregarFilaMeta(t, "Departamento",
            f.getDepartamentoNombre() != null ? f.getDepartamentoNombre() : "Todos los departamentos");
        agregarFilaMeta(t, "Política de Negocio",
            f.getProcesoNombre() != null ? f.getProcesoNombre() : "Todas las políticas");

        pdf.add(t);
    }

    private void agregarFilaMeta(PdfPTable t, String k, String v) {
        PdfPCell cK = new PdfPCell(new Phrase(k, F_META));
        cK.setBorder(Rectangle.BOTTOM);
        cK.setBorderColor(BORDE);
        cK.setPadding(6);
        t.addCell(cK);

        PdfPCell cV = new PdfPCell(new Phrase(v, F_META_BOLD));
        cV.setBorder(Rectangle.BOTTOM);
        cV.setBorderColor(BORDE);
        cV.setPadding(6);
        t.addCell(cV);
    }

    // ==========================================================================
    // FLUJO A1: SIN DATOS
    // ==========================================================================

    private void dibujarSinDatos(Document pdf, ReporteGerencialDTO dto) throws DocumentException {
        Paragraph p = new Paragraph(
            "\n\n" + (dto.getMensajeSinDatos() != null
                ? dto.getMensajeSinDatos()
                : "No hay registros para el período seleccionado") + ".",
            FontFactory.getFont(FontFactory.HELVETICA, 12, GRIS_MEDIO));
        p.setAlignment(Element.ALIGN_CENTER);
        pdf.add(p);
    }

    // ==========================================================================
    // SECCIÓN 1: RESUMEN EJECUTIVO
    // ==========================================================================

    private void dibujarResumenEjecutivo(Document pdf, ResumenEjecutivoDTO r) throws DocumentException {
        if (r == null) return;
        dibujarTituloSeccion(pdf, "1.  RESUMEN EJECUTIVO");

        // Grid de 4 KPIs cabeza
        PdfPTable grid1 = new PdfPTable(4);
        grid1.setWidthPercentage(100);
        grid1.setSpacingAfter(8);
        agregarKpi(grid1, "TOTAL TRÁMITES",     String.valueOf(r.getTotalTramites()),    AZUL_CORP);
        agregarKpi(grid1, "COMPLETADOS",         String.valueOf(r.getTramitesCompletados()), VERDE);
        agregarKpi(grid1, "EN CURSO",            String.valueOf(r.getTramitesEnCurso()),  AMARILLO);
        agregarKpi(grid1, "RECHAZADOS",          String.valueOf(r.getTramitesRechazados()), ROJO);
        pdf.add(grid1);

        // Grid de 4 KPIs secundarios (tasas)
        PdfPTable grid2 = new PdfPTable(4);
        grid2.setWidthPercentage(100);
        grid2.setSpacingAfter(8);
        agregarKpi(grid2, "TASA FINALIZACIÓN", r.getTasaFinalizacion() + "%", AZUL_CORP);
        agregarKpi(grid2, "TASA APROBACIÓN",    r.getTasaAprobacion() + "%",   VERDE);
        agregarKpi(grid2, "TASA RECHAZO",       r.getTasaRechazo() + "%",      ROJO);
        agregarKpi(grid2, "TASA RETRABAJO",     r.getTasaRetrabajo() + "%",    AMARILLO);
        pdf.add(grid2);

        // Grid de 4 KPIs de tiempo
        PdfPTable grid3 = new PdfPTable(4);
        grid3.setWidthPercentage(100);
        grid3.setSpacingAfter(16);
        agregarKpi(grid3, "LEAD TIME PROMEDIO",  r.getLeadTimePromedioHoras() + " h",  AZUL_CORP);
        agregarKpi(grid3, "LEAD TIME MEDIANA",   r.getLeadTimeMedianaHoras() + " h",   AZUL_CORP);
        agregarKpi(grid3, "LEAD TIME MÁXIMO",    r.getLeadTimeMaximoHoras() + " h",    AZUL_CORP);
        agregarKpi(grid3, "THROUGHPUT DIARIO",   r.getThroughputDiarioPromedio() + " / día", AZUL_CORP);
        pdf.add(grid3);
    }

    private void agregarKpi(PdfPTable tabla, String etiqueta, String valor, Color color) {
        PdfPCell c = new PdfPCell();
        c.setPadding(10);
        c.setBorder(Rectangle.BOX);
        c.setBorderColor(BORDE);
        c.setBorderWidth(0.5f);
        c.setBackgroundColor(GRIS_CLARO);

        Paragraph lbl = new Paragraph(etiqueta, F_KPI_LABEL);
        lbl.setAlignment(Element.ALIGN_LEFT);
        c.addElement(lbl);

        Font fVal = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 16, color);
        Paragraph val = new Paragraph(valor, fVal);
        val.setAlignment(Element.ALIGN_LEFT);
        val.setSpacingBefore(4);
        c.addElement(val);

        tabla.addCell(c);
    }

    // ==========================================================================
    // SECCIÓN 2: DEPARTAMENTOS
    // ==========================================================================

    private void dibujarDepartamentos(Document pdf, java.util.List<DepartamentoDesempenioDTO> lista)
            throws DocumentException {
        if (lista == null || lista.isEmpty()) return;
        dibujarTituloSeccion(pdf, "2.  PRODUCTIVIDAD POR DEPARTAMENTO");

        PdfPTable t = new PdfPTable(new float[]{3, 1.3f, 1.3f, 1.5f, 1.5f, 2f});
        t.setWidthPercentage(100);
        t.setSpacingAfter(16);
        t.setHeaderRows(1);

        agregarCabecera(t, "DEPARTAMENTO", "TRÁMITES", "WIP ACTUAL",
                        "T. PROM (h)", "T. MÁX (h)", "TOP FUNCIONARIO");

        for (DepartamentoDesempenioDTO d : lista) {
            agregarCelda(t, d.getDepartamentoNombre(), Element.ALIGN_LEFT, F_CELDA_BOLD);
            agregarCelda(t, String.valueOf(d.getTramitesProcesados()), Element.ALIGN_CENTER, F_CELDA);
            agregarCelda(t, String.valueOf(d.getCargaActivaActual()),  Element.ALIGN_CENTER, F_CELDA);
            agregarCelda(t, String.valueOf(d.getTiempoPromedioPermanenciaHoras()), Element.ALIGN_CENTER, F_CELDA);
            agregarCelda(t, String.valueOf(d.getTiempoMaximoPermanenciaHoras()),   Element.ALIGN_CENTER, F_CELDA);

            String topTxt = d.getTopFuncionarioUsername() != null
                ? d.getTopFuncionarioUsername() + "  (" + d.getTopFuncionarioAcciones() + ")"
                : "—";
            agregarCelda(t, topTxt, Element.ALIGN_LEFT, F_CELDA);
        }

        pdf.add(t);
    }

    // ==========================================================================
    // SECCIÓN 3: POLÍTICAS DE NEGOCIO
    // ==========================================================================

    private void dibujarPoliticas(Document pdf, java.util.List<PoliticaDesempenioDTO> lista)
            throws DocumentException {
        if (lista == null || lista.isEmpty()) return;
        dibujarTituloSeccion(pdf, "3.  DESEMPEÑO POR POLÍTICA DE NEGOCIO");

        PdfPTable t = new PdfPTable(new float[]{2.8f, 1f, 1f, 1.2f, 1.3f, 2.7f});
        t.setWidthPercentage(100);
        t.setSpacingAfter(16);
        t.setHeaderRows(1);

        agregarCabecera(t, "POLÍTICA", "TOTAL", "COMPL.",
                        "FINALIZ. %", "LEAD TIME (h)", "DISTRIBUCIÓN DECISIONES");

        for (PoliticaDesempenioDTO p : lista) {
            String nombre = p.getNombrePolitica();
            if (p.getVersion() != null) nombre += "  v" + p.getVersion();
            agregarCelda(t, nombre, Element.ALIGN_LEFT, F_CELDA_BOLD);
            agregarCelda(t, String.valueOf(p.getTotalTramites()), Element.ALIGN_CENTER, F_CELDA);
            agregarCelda(t, String.valueOf(p.getCompletados()),   Element.ALIGN_CENTER, F_CELDA);
            agregarCelda(t, p.getTasaFinalizacion() + "%",        Element.ALIGN_CENTER, F_CELDA);
            agregarCelda(t, String.valueOf(p.getLeadTimePromedioHoras()), Element.ALIGN_CENTER, F_CELDA);

            // Distribución como "APROBADO: 45, RECHAZADO: 12"
            String dist = p.getDistribucionDecisiones() == null || p.getDistribucionDecisiones().isEmpty()
                ? "—"
                : p.getDistribucionDecisiones().entrySet().stream()
                    .map(e -> e.getKey() + ": " + e.getValue())
                    .reduce((a, b) -> a + "  |  " + b)
                    .orElse("—");
            agregarCelda(t, dist, Element.ALIGN_LEFT, F_CELDA);
        }

        pdf.add(t);
    }

    // ==========================================================================
    // SECCIÓN 4: TENDENCIA TEMPORAL
    // ==========================================================================

    private void dibujarTendencia(Document pdf, TendenciaTemporalDTO tt) throws DocumentException {
        if (tt == null) return;
        dibujarTituloSeccion(pdf, "4.  TENDENCIA TEMPORAL");

        // Resumen comparativo
        PdfPTable resumen = new PdfPTable(3);
        resumen.setWidthPercentage(100);
        resumen.setSpacingAfter(8);
        Color colorVar = tt.getVariacionPorcentual() >= 0 ? VERDE : ROJO;
        String flecha = tt.getVariacionPorcentual() >= 0 ? "▲" : "▼";
        agregarKpi(resumen, "PERÍODO ACTUAL",   String.valueOf(tt.getTotalPeriodoActual()),  AZUL_CORP);
        agregarKpi(resumen, "PERÍODO ANTERIOR", String.valueOf(tt.getTotalPeriodoAnterior()), GRIS_MEDIO);
        agregarKpi(resumen, "VARIACIÓN", flecha + " " + Math.abs(tt.getVariacionPorcentual()) + "%", colorVar);
        pdf.add(resumen);

        if (tt.getDiaPicoFecha() != null) {
            Paragraph pico = new Paragraph(
                "Día de mayor demanda:  " + tt.getDiaPicoFecha() +
                "  (" + tt.getDiaPicoCantidad() + " trámites iniciados)",
                F_META);
            pico.setSpacingAfter(8);
            pdf.add(pico);
        }

        // Tabla de serie diaria (limitada a los últimos 30 días para no inflar el PDF)
        if (tt.getSeriePorDia() != null && !tt.getSeriePorDia().isEmpty()) {
            PdfPTable t = new PdfPTable(new float[]{2, 2, 2});
            t.setWidthPercentage(60);
            t.setHorizontalAlignment(Element.ALIGN_LEFT);
            t.setSpacingAfter(16);
            t.setHeaderRows(1);
            agregarCabecera(t, "FECHA", "INICIADOS", "COMPLETADOS");

            java.util.List<PuntoSerieTiempoDTO> serie = tt.getSeriePorDia();
            int inicio = Math.max(0, serie.size() - 30);
            for (int i = inicio; i < serie.size(); i++) {
                PuntoSerieTiempoDTO p = serie.get(i);
                agregarCelda(t, p.getFecha().format(DTF_DIA), Element.ALIGN_LEFT,   F_CELDA);
                agregarCelda(t, String.valueOf(p.getIniciados()),   Element.ALIGN_CENTER, F_CELDA);
                agregarCelda(t, String.valueOf(p.getCompletados()), Element.ALIGN_CENTER, F_CELDA);
            }
            pdf.add(t);
        }
    }

    // ==========================================================================
    // HELPERS DE TABLAS
    // ==========================================================================

    private void dibujarTituloSeccion(Document pdf, String texto) throws DocumentException {
        Paragraph p = new Paragraph(texto, F_SECCION);
        p.setSpacingBefore(6);
        p.setSpacingAfter(8);
        pdf.add(p);

        // línea debajo del título
        PdfPTable linea = new PdfPTable(1);
        linea.setWidthPercentage(100);
        PdfPCell c = new PdfPCell();
        c.setBorder(Rectangle.TOP);
        c.setBorderColor(AZUL_CORP);
        c.setBorderWidthTop(1.5f);
        c.setFixedHeight(2);
        linea.addCell(c);
        pdf.add(linea);
    }

    private void agregarCabecera(PdfPTable t, String... headers) {
        for (String h : headers) {
            PdfPCell c = new PdfPCell(new Phrase(h, F_CABECERA_T));
            c.setBackgroundColor(AZUL_CORP);
            c.setPadding(7);
            c.setBorder(Rectangle.NO_BORDER);
            c.setHorizontalAlignment(Element.ALIGN_CENTER);
            t.addCell(c);
        }
    }

    private void agregarCelda(PdfPTable t, String texto, int alineacion, Font font) {
        PdfPCell c = new PdfPCell(new Phrase(texto != null ? texto : "—", font));
        c.setPadding(6);
        c.setHorizontalAlignment(alineacion);
        c.setBorder(Rectangle.BOTTOM);
        c.setBorderColor(BORDE);
        c.setBorderWidth(0.5f);
        t.addCell(c);
    }

    // ==========================================================================
    // PIE DE PÁGINA
    // ==========================================================================

    private void dibujarPiePagina(Document pdf) throws DocumentException {
        Paragraph p = new Paragraph(
            "\nBPMS Core — Sistema de Gestión de Procesos de Negocio  |  " +
            "Documento generado automáticamente  |  Uso interno",
            FontFactory.getFont(FontFactory.HELVETICA_OBLIQUE, 7, GRIS_MEDIO));
        p.setAlignment(Element.ALIGN_CENTER);
        pdf.add(p);
    }
}