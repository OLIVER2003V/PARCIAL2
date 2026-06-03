package com.bpms.core.controllers;

import com.bpms.core.models.RegistroArchivo;
import com.bpms.core.repositories.TramiteRepository;
import com.bpms.core.services.ArchivoService;
import com.bpms.core.services.AuditService;
import com.bpms.core.services.DocumentoColaborativoService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/archivos")
public class ArchivoController {

    private final ArchivoService archivoService;
    private final DocumentoColaborativoService docColabService;
    private final AuditService auditService;
    private final TramiteRepository tramiteRepository;

    @Value("${archivo.local.path:uploads}")
    private String localUploadPath;

    public ArchivoController(ArchivoService archivoService,
                             DocumentoColaborativoService docColabService,
                             AuditService auditService,
                             TramiteRepository tramiteRepository) {
        this.archivoService = archivoService;
        this.docColabService = docColabService;
        this.auditService = auditService;
        this.tramiteRepository = tramiteRepository;
    }

    @PostMapping("/subir")
    public ResponseEntity<?> subirArchivo(
            @RequestParam("archivo") MultipartFile archivo,
            @RequestParam(required = false) String tramiteId,
            @RequestParam(required = false) String procesoId,
            @RequestParam(required = false) String comentario,
            @RequestParam(required = false) String paso,
            Authentication auth) {

        String rol = determinarRol(auth);
        String username = auth != null ? auth.getName() : "sistema";

        String codigoSeguimiento = null;
        if (esValorPresente(tramiteId)) {
            codigoSeguimiento = tramiteRepository.findById(tramiteId)
                    .map(t -> t.getCodigoSeguimiento())
                    .orElse(null);
        }

        try {
            Map<String, Object> resp = archivoService.subirArchivo(
                    archivo, tramiteId, procesoId, codigoSeguimiento, username, comentario, paso, rol);

            String entidadId = esValorPresente(tramiteId) ? tramiteId : procesoId;
            String entidadTipo = esValorPresente(tramiteId) ? "TRAMITE" : "PROCESO";
            auditService.registrar(
                    username,
                    AuditService.CAT_TRAMITE,
                    "ARCHIVO_SUBIDO",
                    "Archivo '" + archivo.getOriginalFilename() + "' subido"
                            + (esValorPresente(tramiteId) ? " al tramite " + tramiteId : "")
                            + " (" + resp.get("almacenamiento") + ", v" + resp.get("version") + ")"
                            + (esValorPresente(paso) ? " - paso: " + paso : ""),
                    entidadId,
                    entidadTipo
            );

            return ResponseEntity.ok(resp);

        } catch (IOException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", "Error inesperado: " + e.getMessage()));
        }
    }

    @GetMapping("/tramite/{tramiteId}")
    public ResponseEntity<List<RegistroArchivo>> listarArchivosTramite(@PathVariable String tramiteId) {
        tramiteRepository.findById(tramiteId).ifPresent(tramite ->
                docColabService.vincularArchivosFormularioInicial(
                        tramite.getId(),
                        tramite.getDatosFormularioInicial(),
                        tramite.getClienteId(),
                        "Presentacion",
                        "CLIENTE"));

        List<RegistroArchivo> docs = docColabService.listarArchivosPorTramite(tramiteId);
        docs.sort(Comparator.comparing(RegistroArchivo::getCreadoEn).reversed());
        return ResponseEntity.ok(docs);
    }

    @GetMapping("/ver/{nombre}")
    public ResponseEntity<byte[]> verArchivo(@PathVariable String nombre) {
        try {
            if (nombre.contains("..") || nombre.contains("/") || nombre.contains("\\")) {
                return ResponseEntity.badRequest().build();
            }
            Path archivo = Paths.get(localUploadPath).toAbsolutePath().normalize().resolve(nombre);
            if (!Files.exists(archivo)) {
                return ResponseEntity.notFound().build();
            }
            byte[] contenido = Files.readAllBytes(archivo);
            String contentType = Files.probeContentType(archivo);
            if (contentType == null) contentType = "application/octet-stream";

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + nombre + "\"")
                    .contentType(MediaType.parseMediaType(contentType))
                    .body(contenido);
        } catch (IOException e) {
            return ResponseEntity.internalServerError().build();
        }
    }

    @DeleteMapping("/eliminar")
    public ResponseEntity<?> eliminarArchivo(@RequestParam("url") String url, Authentication auth) {
        try {
            RegistroArchivo registro = archivoService.eliminarArchivo(url);
            String username = auth != null ? auth.getName() : "sistema";
            String tramiteId = registro != null ? registro.getTramiteId() : null;
            String procesoId = registro != null ? registro.getProcesoId() : null;
            String nombre = registro != null ? registro.getNombreOriginal() : url;

            String entidadId = esValorPresente(tramiteId) ? tramiteId : procesoId;
            String entidadTipo = esValorPresente(tramiteId) ? "TRAMITE" : "PROCESO";
            auditService.registrar(
                    username,
                    AuditService.CAT_TRAMITE,
                    "ARCHIVO_ELIMINADO",
                    "Archivo eliminado: " + nombre,
                    entidadId,
                    entidadTipo
            );

            return ResponseEntity.ok(Map.of("mensaje", "Archivo eliminado"));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    private String determinarRol(Authentication auth) {
        if (auth == null || auth.getAuthorities() == null) return "CLIENTE";
        return auth.getAuthorities().stream()
                .map(a -> a.getAuthority())
                .filter(a -> a.equals("ROLE_ADMIN") || a.equals("ROLE_FUNCIONARIO"))
                .map(a -> a.replace("ROLE_", ""))
                .findFirst()
                .orElse("CLIENTE");
    }

    private boolean esValorPresente(String valor) {
        return valor != null && !valor.isBlank();
    }
}
