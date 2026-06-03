package com.bpms.core.services;

import com.bpms.core.dto.reportes.ResultadoReporteNlpDTO;
import com.lowagie.text.*;
import com.lowagie.text.Font;
import com.lowagie.text.pdf.*;
import org.apache.poi.ss.usermodel.BorderStyle;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.usermodel.IndexedColors;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.VerticalAlignment;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFCellStyle;
import org.apache.poi.xssf.usermodel.XSSFColor;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Genera PDF y Excel a partir de un ResultadoReporteNlpDTO (CU23).
 */
@Service
public class NlpExportService {

    private static final DateTimeFormatter DTF = DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm");

    // ── Colores PDF (paleta brand) ─────────────────────────────────────────────
    private static final Color VIOLETA      = new Color(109, 40, 217);
    private static final Color VIOLETA_OSC  = new Color(76, 29, 149);
    private static final Color GRIS_OSCURO  = new Color(31, 41, 55);
    private static final Color GRIS_MEDIO   = new Color(107, 114, 128);
    private static final Color GRIS_CLARO   = new Color(248, 250, 252);
    private static final Color BORDE        = new Color(226, 232, 240);
    private static final Color VERDE        = new Color(34, 197, 94);
    private static final Color ROJO         = new Color(239, 68, 68);
    private static final Color NARANJA      = new Color(245, 158, 11);

    // ── Fuentes PDF ────────────────────────────────────────────────────────────
    private static final Font F_TITULO     = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 18, Color.WHITE);
    private static final Font F_SUBTITULO  = FontFactory.getFont(FontFactory.HELVETICA, 9,  new Color(221, 214, 254));
    private static final Font F_SECCION    = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 12, VIOLETA);
    private static final Font F_CABECERA_T = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9,  Color.WHITE);
    private static final Font F_CELDA      = FontFactory.getFont(FontFactory.HELVETICA, 9,       GRIS_OSCURO);
    private static final Font F_CELDA_BOLD = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9,  GRIS_OSCURO);
    private static final Font F_META       = FontFactory.getFont(FontFactory.HELVETICA, 8,       GRIS_MEDIO);
    private static final Font F_META_BOLD  = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9,  GRIS_OSCURO);
    private static final Font F_INTERP     = FontFactory.getFont(FontFactory.HELVETICA, 10,      GRIS_MEDIO);
    private static final Font F_KPI_VAL    = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 20, VIOLETA);
    private static final Font F_KPI_LBL    = FontFactory.getFont(FontFactory.HELVETICA, 8,       GRIS_MEDIO);
    private static final Font F_PIE        = FontFactory.getFont(FontFactory.HELVETICA, 7,       GRIS_MEDIO);

    // ==========================================================================
    // PDF
    // ==========================================================================

    public byte[] generarPdf(ResultadoReporteNlpDTO res, String consulta) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Document pdf = new Document(PageSize.A4, 36, 36, 40, 40);
        PdfWriter writer = PdfWriter.getInstance(pdf, out);
        pdf.open();

        cabeceraPdf(pdf, res, consulta);
        metadatosPdf(pdf, res);

        if (res.getInterpretacion() != null && !res.getInterpretacion().isBlank()) {
            Paragraph p = new Paragraph(res.getInterpretacion(), F_INTERP);
            p.setSpacingBefore(4);
            p.setSpacingAfter(14);
            pdf.add(p);
        }

        if (res.getColumnas() != null && !res.getColumnas().isEmpty()
                && res.getFilas() != null && !res.getFilas().isEmpty()) {
            tablaDatosPdf(pdf, res);
        }

        piePaginaPdf(pdf);
        pdf.close();
        return out.toByteArray();
    }

    private void cabeceraPdf(Document pdf, ResultadoReporteNlpDTO res, String consulta)
            throws DocumentException {
        PdfPTable banda = new PdfPTable(1);
        banda.setWidthPercentage(100);
        banda.setSpacingAfter(12);

        PdfPCell cell = new PdfPCell();
        cell.setBackgroundColor(VIOLETA_OSC);
        cell.setBorder(Rectangle.NO_BORDER);
        cell.setPadding(18);

        Paragraph titulo = new Paragraph(
            res.getTitulo() != null ? res.getTitulo().toUpperCase() : "REPORTE DINÁMICO",
            F_TITULO);
        titulo.setAlignment(Element.ALIGN_LEFT);
        cell.addElement(titulo);

        Paragraph sub = new Paragraph(
            "BPMS Core  ·  Reportes Inteligentes (IA)  ·  Generado: " + LocalDateTime.now().format(DTF),
            F_SUBTITULO);
        sub.setSpacingBefore(4);
        cell.addElement(sub);

        if (consulta != null && !consulta.isBlank()) {
            Paragraph q = new Paragraph("Consulta: \"" + consulta + "\"",
                FontFactory.getFont(FontFactory.HELVETICA, 8, new Color(196, 181, 253)));
            q.setSpacingBefore(6);
            cell.addElement(q);
        }

        banda.addCell(cell);
        pdf.add(banda);
    }

    private void metadatosPdf(Document pdf, ResultadoReporteNlpDTO res) throws DocumentException {
        PdfPTable t = new PdfPTable(4);
        t.setWidthPercentage(100);
        t.setSpacingAfter(14);

        agregarKpiPdf(t, "TOTAL REGISTROS", String.valueOf(res.getTotalRegistros()), VIOLETA);
        agregarKpiPdf(t, "VISUALIZACIÓN",
            res.getTipoVisualizacion() != null ? res.getTipoVisualizacion().toUpperCase() : "-", GRIS_MEDIO);
        agregarKpiPdf(t, "FILAS EN TABLA",
            res.getFilas() != null ? String.valueOf(res.getFilas().size()) : "0", GRIS_MEDIO);
        agregarKpiPdf(t, "EXPORTABLE",
            res.isExportable() ? "SÍ" : "NO",
            res.isExportable() ? VERDE : ROJO);

        pdf.add(t);
    }

    private void agregarKpiPdf(PdfPTable t, String label, String valor, Color color) {
        PdfPCell c = new PdfPCell();
        c.setBorder(Rectangle.BOX);
        c.setBorderColor(BORDE);
        c.setPadding(10);
        c.setHorizontalAlignment(Element.ALIGN_CENTER);

        Paragraph pVal = new Paragraph(valor,
            FontFactory.getFont(FontFactory.HELVETICA_BOLD, 16, color));
        pVal.setAlignment(Element.ALIGN_CENTER);
        c.addElement(pVal);

        Paragraph pLbl = new Paragraph(label, F_KPI_LBL);
        pLbl.setAlignment(Element.ALIGN_CENTER);
        c.addElement(pLbl);

        t.addCell(c);
    }

    private void tablaDatosPdf(Document pdf, ResultadoReporteNlpDTO res) throws DocumentException {
        dibujarTituloSeccionPdf(pdf, "DATOS DEL REPORTE");

        List<String> columnas = res.getColumnas();
        int numCols = columnas.size();
        PdfPTable t = new PdfPTable(numCols);
        t.setWidthPercentage(100);
        t.setSpacingAfter(10);

        // Cabeceras
        for (String col : columnas) {
            PdfPCell h = new PdfPCell(new Phrase(col.toUpperCase(), F_CABECERA_T));
            h.setBackgroundColor(VIOLETA);
            h.setBorder(Rectangle.NO_BORDER);
            h.setPadding(8);
            h.setHorizontalAlignment(Element.ALIGN_CENTER);
            t.addCell(h);
        }

        // Filas de datos con alternancia
        boolean par = false;
        for (List<Object> fila : res.getFilas()) {
            Color fondo = par ? GRIS_CLARO : Color.WHITE;
            for (int i = 0; i < fila.size(); i++) {
                Object val = fila.get(i);
                String texto = val != null ? val.toString() : "-";
                Font f = (i == 0) ? F_CELDA_BOLD : F_CELDA;
                PdfPCell c = new PdfPCell(new Phrase(texto, f));
                c.setBackgroundColor(fondo);
                c.setBorder(Rectangle.BOTTOM);
                c.setBorderColor(BORDE);
                c.setPadding(7);
                c.setHorizontalAlignment(i == 0 ? Element.ALIGN_LEFT : Element.ALIGN_RIGHT);
                t.addCell(c);
            }
            par = !par;
        }

        pdf.add(t);
    }

    private void dibujarTituloSeccionPdf(Document pdf, String titulo) throws DocumentException {
        Paragraph p = new Paragraph(titulo, F_SECCION);
        p.setSpacingBefore(8);
        p.setSpacingAfter(6);
        pdf.add(p);

        PdfPTable linea = new PdfPTable(1);
        linea.setWidthPercentage(100);
        linea.setSpacingAfter(6);
        PdfPCell c = new PdfPCell();
        c.setFixedHeight(2);
        c.setBackgroundColor(VIOLETA);
        c.setBorder(Rectangle.NO_BORDER);
        linea.addCell(c);
        pdf.add(linea);
    }

    private void piePaginaPdf(Document pdf) throws DocumentException {
        Paragraph pie = new Paragraph(
            "Generado automáticamente por BPMS Core · Módulo de Reportes Inteligentes con IA · "
            + LocalDateTime.now().format(DTF),
            F_PIE);
        pie.setAlignment(Element.ALIGN_CENTER);
        pie.setSpacingBefore(20);
        pdf.add(pie);
    }

    // ==========================================================================
    // EXCEL
    // ==========================================================================

    public byte[] generarExcel(ResultadoReporteNlpDTO res, String consulta) throws Exception {
        try (XSSFWorkbook wb = new XSSFWorkbook();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {

            ExcelEstilos est = new ExcelEstilos(wb);

            hojaDatos(wb, res, est);
            hojaMetadatos(wb, res, consulta, est);

            wb.write(out);
            return out.toByteArray();
        }
    }

    private void hojaDatos(XSSFWorkbook wb, ResultadoReporteNlpDTO res, ExcelEstilos est) {
        Sheet s = wb.createSheet("Datos");

        // Título fusionado
        Row rTitulo = s.createRow(0);
        Cell cTitulo = rTitulo.createCell(0);
        cTitulo.setCellValue(res.getTitulo() != null ? res.getTitulo() : "Reporte Dinámico");
        cTitulo.setCellStyle(est.titulo);

        List<String> columnas = res.getColumnas();
        int numCols = columnas != null ? columnas.size() : 0;
        if (numCols > 1) {
            s.addMergedRegion(new CellRangeAddress(0, 0, 0, numCols - 1));
        }

        if (numCols == 0 || res.getFilas() == null) return;

        // Cabeceras
        Row rCab = s.createRow(2);
        for (int i = 0; i < columnas.size(); i++) {
            Cell c = rCab.createCell(i);
            c.setCellValue(columnas.get(i));
            c.setCellStyle(est.cabecera);
        }

        // Datos
        int rowIdx = 3;
        boolean par = false;
        for (List<Object> fila : res.getFilas()) {
            Row r = s.createRow(rowIdx++);
            for (int i = 0; i < fila.size(); i++) {
                Cell c = r.createCell(i);
                Object val = fila.get(i);
                if (val instanceof Number) {
                    c.setCellValue(((Number) val).doubleValue());
                    c.setCellStyle(par ? est.numeroAlternado : est.numero);
                } else {
                    c.setCellValue(val != null ? val.toString() : "");
                    c.setCellStyle(par ? est.celdaAlternado : est.celda);
                }
            }
            par = !par;
        }

        // Ajustar ancho de columnas
        for (int i = 0; i < numCols; i++) {
            s.autoSizeColumn(i);
            int ancho = s.getColumnWidth(i);
            if (ancho < 3000) s.setColumnWidth(i, 3000);
            if (ancho > 15000) s.setColumnWidth(i, 15000);
        }
    }

    private void hojaMetadatos(XSSFWorkbook wb, ResultadoReporteNlpDTO res,
                                String consulta, ExcelEstilos est) {
        Sheet s = wb.createSheet("Metadatos");
        int r = 0;

        filaMeta(s, r++, est, "REPORTE DINÁMICO — BPMS Core");
        r++;
        filaMeta(s, r++, est, "Campo", "Valor");
        filaMeta(s, r++, est, "Título",          res.getTitulo() != null ? res.getTitulo() : "-");
        filaMeta(s, r++, est, "Consulta",         consulta != null ? consulta : "-");
        filaMeta(s, r++, est, "Total registros",  String.valueOf(res.getTotalRegistros()));
        filaMeta(s, r++, est, "Visualización",    res.getTipoVisualizacion() != null ? res.getTipoVisualizacion() : "-");
        filaMeta(s, r++, est, "Interpretación",   res.getInterpretacion() != null ? res.getInterpretacion() : "-");
        filaMeta(s, r++, est, "Fecha generación", LocalDateTime.now().format(DTF));

        s.setColumnWidth(0, 5000);
        s.setColumnWidth(1, 15000);
    }

    private void filaMeta(Sheet s, int rowIdx, ExcelEstilos est, String... valores) {
        Row r = s.createRow(rowIdx);
        for (int i = 0; i < valores.length; i++) {
            Cell c = r.createCell(i);
            c.setCellValue(valores[i]);
            c.setCellStyle(rowIdx == 0 ? est.titulo : (i == 0 ? est.celdaBold : est.celda));
        }
    }

    // ==========================================================================
    // ESTILOS EXCEL
    // ==========================================================================

    private static class ExcelEstilos {
        final CellStyle titulo;
        final CellStyle cabecera;
        final CellStyle celda;
        final CellStyle celdaBold;
        final CellStyle celdaAlternado;
        final CellStyle numero;
        final CellStyle numeroAlternado;

        ExcelEstilos(XSSFWorkbook wb) {
            XSSFColor violeta = new XSSFColor(new byte[]{(byte)76, (byte)29, (byte)149}, null);
            XSSFColor grisClaro = new XSSFColor(new byte[]{(byte)248, (byte)250, (byte)252}, null);

            org.apache.poi.ss.usermodel.Font fTitulo = wb.createFont();
            fTitulo.setBold(true);
            fTitulo.setFontHeightInPoints((short) 14);
            fTitulo.setColor(IndexedColors.WHITE.getIndex());

            org.apache.poi.ss.usermodel.Font fCab = wb.createFont();
            fCab.setBold(true);
            fCab.setFontHeightInPoints((short) 10);
            fCab.setColor(IndexedColors.WHITE.getIndex());

            org.apache.poi.ss.usermodel.Font fBold = wb.createFont();
            fBold.setBold(true);
            fBold.setFontHeightInPoints((short) 10);

            org.apache.poi.ss.usermodel.Font fNormal = wb.createFont();
            fNormal.setFontHeightInPoints((short) 10);

            titulo = wb.createCellStyle();
            ((XSSFCellStyle) titulo).setFillForegroundColor(violeta);
            titulo.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            titulo.setFont(fTitulo);
            titulo.setAlignment(HorizontalAlignment.LEFT);
            titulo.setVerticalAlignment(VerticalAlignment.CENTER);

            cabecera = wb.createCellStyle();
            ((XSSFCellStyle) cabecera).setFillForegroundColor(violeta);
            cabecera.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            cabecera.setFont(fCab);
            cabecera.setAlignment(HorizontalAlignment.CENTER);
            setBordes(cabecera);

            celda = wb.createCellStyle();
            celda.setFont(fNormal);
            setBordes(celda);

            celdaBold = wb.createCellStyle();
            celdaBold.setFont(fBold);
            setBordes(celdaBold);

            celdaAlternado = wb.createCellStyle();
            ((XSSFCellStyle) celdaAlternado).setFillForegroundColor(grisClaro);
            celdaAlternado.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            celdaAlternado.setFont(fNormal);
            setBordes(celdaAlternado);

            numero = wb.createCellStyle();
            numero.setFont(fBold);
            numero.setAlignment(HorizontalAlignment.RIGHT);
            setBordes(numero);

            numeroAlternado = wb.createCellStyle();
            ((XSSFCellStyle) numeroAlternado).setFillForegroundColor(grisClaro);
            numeroAlternado.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            numeroAlternado.setFont(fBold);
            numeroAlternado.setAlignment(HorizontalAlignment.RIGHT);
            setBordes(numeroAlternado);
        }

        private void setBordes(CellStyle s) {
            s.setBorderBottom(BorderStyle.THIN);
            s.setBorderTop(BorderStyle.THIN);
            s.setBorderLeft(BorderStyle.THIN);
            s.setBorderRight(BorderStyle.THIN);
            s.setBottomBorderColor(IndexedColors.GREY_25_PERCENT.getIndex());
            s.setTopBorderColor(IndexedColors.GREY_25_PERCENT.getIndex());
            s.setLeftBorderColor(IndexedColors.GREY_25_PERCENT.getIndex());
            s.setRightBorderColor(IndexedColors.GREY_25_PERCENT.getIndex());
        }
    }
}
