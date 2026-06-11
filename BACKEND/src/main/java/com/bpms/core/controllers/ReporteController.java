package com.bpms.core.controllers;

import com.bpms.core.dto.reportes.FiltrosReporteRequest;
import com.bpms.core.dto.reportes.ReporteGerencialDTO;
import com.bpms.core.models.AuditLog;
import com.bpms.core.models.Rol;
import com.bpms.core.models.Usuario;
import com.bpms.core.repositories.AuditLogRepository;
import com.bpms.core.repositories.UsuarioRepository;
import com.bpms.core.services.ExcelReporteService;
import com.bpms.core.services.PdfReporteService;
import com.bpms.core.services.ReporteGerencialService;
// 👇 Inyectamos el servicio del CU14
import com.bpms.core.services.MineriaProcesosService;
import com.bpms.core.services.ReporteNlpService;
import com.bpms.core.services.NlpExportService;
import com.bpms.core.dto.reportes.ResultadoReporteNlpDTO;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

@RestController
@RequestMapping("/api/reportes")
public class ReporteController {

    @Autowired private ReporteGerencialService reporteService;
    @Autowired private PdfReporteService pdfService;
    @Autowired private ExcelReporteService excelService;
    @Autowired private UsuarioRepository usuarioRepository;
    @Autowired private AuditLogRepository auditLogRepository;
    
    // 👇 Instanciamos el motor del CU14
    @Autowired private MineriaProcesosService mineriaService;
    @Autowired private ReporteNlpService reporteNlpService;
    @Autowired private NlpExportService nlpExportService;

    // MIME type oficial para .xlsx
    private static final String MIME_XLSX =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    // ==========================================================================
    // ENDPOINT 1: PREVIEW (JSON para renderizar en la UI - CU13)
    // ==========================================================================
    @PostMapping("/preview")
    public ResponseEntity<?> preview(
            @RequestBody FiltrosReporteRequest req,
            Authentication auth) {
        Usuario admin = validarAdmin(auth);
        try {
            ReporteGerencialDTO dto = reporteService.generarReporte(req, admin.getUsername());
            return ResponseEntity.ok(dto);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Error al generar el reporte: " + e.getMessage()));
        }
    }

    // ==========================================================================
    // ENDPOINT 2: DESCARGAR PDF (CU13)
    // ==========================================================================
    @PostMapping("/pdf")
    public ResponseEntity<?> generarPdf(
            @RequestBody FiltrosReporteRequest req,
            Authentication auth) {
        Usuario admin = validarAdmin(auth);
        try {
            ReporteGerencialDTO dto = reporteService.generarReporte(req, admin.getUsername());
            if (dto.isSinDatos()) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", dto.getMensajeSinDatos()));
            }
            byte[] pdf = pdfService.generar(dto);
            registrarAuditoria(admin, "REPORTE_PDF_GENERADO", req, pdf.length);
            String filename = buildFilename("reporte-gerencial", req, "pdf");

            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .body(pdf);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Error al generar el PDF: " + e.getMessage()));
        }
    }

    // ==========================================================================
    // ENDPOINT 3: DESCARGAR EXCEL (CU13)
    // ==========================================================================
    @PostMapping("/excel")
    public ResponseEntity<?> generarExcel(
            @RequestBody FiltrosReporteRequest req,
            Authentication auth) {
        Usuario admin = validarAdmin(auth);
        try {
            ReporteGerencialDTO dto = reporteService.generarReporte(req, admin.getUsername());
            if (dto.isSinDatos()) {
                return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("error", dto.getMensajeSinDatos()));
            }
            byte[] excel = excelService.generar(dto);
            registrarAuditoria(admin, "REPORTE_EXCEL_GENERADO", req, excel.length);
            String filename = buildFilename("reporte-gerencial", req, "xlsx");

            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType(MIME_XLSX))
                .contentLength(excel.length)
                .body(excel);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Error al generar el Excel: " + e.getMessage()));
        }
    }

    // ==========================================================================
    // 👇 NUEVO ENDPOINT 4: MINERÍA DE PROCESOS (HEATMAP - CU14)
    // ==========================================================================
    @GetMapping("/mineria/{procesoId}")
    public ResponseEntity<?> obtenerAnalisisMineria(
            @PathVariable String procesoId,
            Authentication auth) {
        
        // Reutilizamos tu seguridad: Solo administradores pueden ver el mapa de calor
        validarAdmin(auth); 

        try {
            return ResponseEntity.ok(mineriaService.analizarCuellosBotella(procesoId));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(Map.of("error", "Error al generar minería: " + e.getMessage()));
        }
    }

    // ==========================================================================
    // VALIDACIÓN DE ROL
    // ==========================================================================
    private Usuario validarAdmin(Authentication auth) {
        if (auth == null || auth.getName() == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "No autenticado");
        }
        Usuario user = usuarioRepository.findByUsername(auth.getName())
            .orElseThrow(() -> new ResponseStatusException(
                HttpStatus.UNAUTHORIZED, "Usuario no encontrado"));

        if (user.getRol() != Rol.ADMIN) {
            throw new ResponseStatusException(
                HttpStatus.FORBIDDEN, "Solo los administradores pueden generar reportes gerenciales");
        }
        return user;
    }

    // ==========================================================================
    // AUDITORÍA
    // ==========================================================================
    private void registrarAuditoria(Usuario admin, String accion,
                                    FiltrosReporteRequest req, int bytesGenerados) {
        try {
            AuditLog log = new AuditLog();
            log.setUsuarioId(admin.getUsername());
            log.setDepartamentoId(admin.getDepartamentoId()); 
            log.setAccion(accion);

            StringBuilder detalle = new StringBuilder();
            detalle.append("Rango: ")
                   .append(req.getFechaInicio())
                   .append(" a ")
                   .append(req.getFechaFin());
            if (req.getDepartamentoId() != null && !req.getDepartamentoId().isBlank()) {
                detalle.append(" | Depto filtrado: ").append(req.getDepartamentoId());
            }
            if (req.getProcesoDefinicionId() != null && !req.getProcesoDefinicionId().isBlank()) {
                detalle.append(" | Política filtrada: ").append(req.getProcesoDefinicionId());
            }
            detalle.append(" | Tamaño: ")
                   .append(bytesGenerados / 1024)
                   .append(" KB");

            log.setDetalle(detalle.toString());
            auditLogRepository.save(log);
        } catch (Exception e) {
            System.err.println("⚠️ No se pudo registrar auditoría: " + e.getMessage());
        }
    }

    // ==========================================================================
    // UTILIDADES
    // ==========================================================================
    private String buildFilename(String base, FiltrosReporteRequest req, String ext) {
        String raw = base + "_" + req.getFechaInicio() + "_" + req.getFechaFin() + "." + ext;
        return URLEncoder.encode(raw, StandardCharsets.UTF_8).replace("+", "%20");
    }

    // =========================================================================
    //  CU23 — Reportes Dinámicos NLP
    // =========================================================================

    @PostMapping("/nlp")
    public ResponseEntity<?> consultarNlp(@RequestBody Map<String, String> body, Authentication auth) {
        validarAdmin(auth);
        String consulta = body.get("consulta");
        if (consulta == null || consulta.isBlank()) {
            return ResponseEntity.badRequest().body("El campo 'consulta' es obligatorio.");
        }
        try {
            ResultadoReporteNlpDTO resultado = reporteNlpService.consultar(consulta.trim());
            return ResponseEntity.ok(resultado);
        } catch (Exception e) {
            ResultadoReporteNlpDTO err = new ResultadoReporteNlpDTO();
            err.setError("Error interno al procesar la consulta: " + e.getMessage());
            return ResponseEntity.status(500).body(err);
        }
    }

    // =========================================================================
    //  CU23 — Exportar PDF del reporte NLP
    // =========================================================================

    @PostMapping("/nlp/pdf")
    public ResponseEntity<?> exportarNlpPdf(
            @RequestBody Map<String, String> body,
            Authentication auth) {
        validarAdmin(auth);
        String consulta = body.get("consulta");
        if (consulta == null || consulta.isBlank()) {
            return ResponseEntity.badRequest().body("El campo 'consulta' es obligatorio.");
        }
        try {
            ResultadoReporteNlpDTO resultado = reporteNlpService.consultar(consulta.trim());
            if (resultado.getError() != null) {
                return ResponseEntity.badRequest().body(Map.of("error", resultado.getError()));
            }
            byte[] pdf = nlpExportService.generarPdf(resultado, consulta.trim());
            String filename = URLEncoder.encode(
                "reporte-nlp_" + java.time.LocalDate.now() + ".pdf",
                StandardCharsets.UTF_8).replace("+", "%20");
            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.APPLICATION_PDF)
                .contentLength(pdf.length)
                .body(pdf);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Error al generar PDF: " + e.getMessage()));
        }
    }

    // =========================================================================
    //  CU23 — Exportar Excel del reporte NLP
    // =========================================================================

    @PostMapping("/nlp/excel")
    public ResponseEntity<?> exportarNlpExcel(
            @RequestBody Map<String, String> body,
            Authentication auth) {
        validarAdmin(auth);
        String consulta = body.get("consulta");
        if (consulta == null || consulta.isBlank()) {
            return ResponseEntity.badRequest().body("El campo 'consulta' es obligatorio.");
        }
        try {
            ResultadoReporteNlpDTO resultado = reporteNlpService.consultar(consulta.trim());
            if (resultado.getError() != null) {
                return ResponseEntity.badRequest().body(Map.of("error", resultado.getError()));
            }
            byte[] excel = nlpExportService.generarExcel(resultado, consulta.trim());
            String filename = URLEncoder.encode(
                "reporte-nlp_" + java.time.LocalDate.now() + ".xlsx",
                StandardCharsets.UTF_8).replace("+", "%20");
            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.parseMediaType(MIME_XLSX))
                .contentLength(excel.length)
                .body(excel);
        } catch (Exception e) {
            return ResponseEntity.status(500).body(Map.of("error", "Error al generar Excel: " + e.getMessage()));
        }
    }
}