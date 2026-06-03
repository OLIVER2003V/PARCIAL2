package com.bpms.core.controllers;

import com.bpms.core.dto.colaboracion.EventoDocumento;
import com.bpms.core.models.DocumentoColaborativo;
import com.bpms.core.models.RegistroArchivo;
import com.bpms.core.services.AuditService;
import com.bpms.core.services.DocumentoColaborativoService;
import com.bpms.core.services.GoogleDriveService;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;
import java.util.Map;

/**
 * Gestión de documentos colaborativos:
 *
 * REST (CRUD):
 *   POST   /api/documentos/crear
 *   GET    /api/documentos/tramite/{tramiteId}
 *   GET    /api/documentos/proceso/{procesoId}
 *   GET    /api/documentos/{id}
 *   DELETE /api/documentos/{id}
 *   GET    /api/documentos/{id}/estado-yjs   ← devuelve el estado Yjs para reconexión
 *
 * REST (archivos versionados):
 *   GET    /api/documentos/archivos/tramite/{tramiteId}
 *   GET    /api/documentos/archivos/proceso/{procesoId}
 *
 * WebSocket (STOMP):
 *   /app/doc/{documentoId}/update   ← Yjs binary update (base64)
 *   /app/doc/{documentoId}/presencia-celda ← cursor en hoja
 *   /app/doc/{documentoId}/guardar  ← guardar snapshot explícito
 *
 * Broadcasts:
 *   /topic/doc/{documentoId}/update
 *   /topic/doc/{documentoId}/presencia
 *   /topic/doc/{documentoId}/guardado
 */
@RestController
@RequestMapping("/api/documentos")
public class DocumentoColaborativoController {

    private final DocumentoColaborativoService docService;
    private final AuditService auditService;
    private final SimpMessagingTemplate messaging;
    private final GoogleDriveService driveService;

    public DocumentoColaborativoController(
            DocumentoColaborativoService docService,
            AuditService auditService,
            SimpMessagingTemplate messaging,
            GoogleDriveService driveService) {
        this.docService   = docService;
        this.auditService = auditService;
        this.messaging    = messaging;
        this.driveService = driveService;
    }

    // ── REST ──────────────────────────────────────────────────────────────────

    @PostMapping("/crear")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO')")
    public ResponseEntity<?> crear(@RequestBody Map<String, String> body, Principal principal) {
        String nombre    = body.getOrDefault("nombre", "Nuevo documento");
        String tipo      = body.getOrDefault("tipo", "texto");
        String tramiteId = body.get("tramiteId");
        String procesoId = body.get("procesoId");

        DocumentoColaborativo doc = docService.crear(nombre, tipo, tramiteId, procesoId,
                principal.getName());

        auditService.registrar(principal.getName(),
                AuditService.CAT_POLITICA, "DOCUMENTO_CREADO",
                "Documento '" + nombre + "' creado (" + tipo + ")");

        return ResponseEntity.ok(doc);
    }

    @GetMapping("/tramite/{tramiteId}")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO','CLIENTE')")
    public ResponseEntity<List<DocumentoColaborativo>> listarPorTramite(
            @PathVariable String tramiteId) {
        return ResponseEntity.ok(docService.listarPorTramite(tramiteId));
    }

    @GetMapping("/proceso/{procesoId}")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO')")
    public ResponseEntity<List<DocumentoColaborativo>> listarPorProceso(
            @PathVariable String procesoId) {
        return ResponseEntity.ok(docService.listarPorProceso(procesoId));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO','CLIENTE')")
    public ResponseEntity<?> obtener(@PathVariable String id) {
        DocumentoColaborativo doc = docService.obtener(id);
        if (doc == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(doc);
    }

    /** Devuelve solo el estado Yjs (puede ser grande) para que el cliente reconecte. */
    @GetMapping("/{id}/estado-yjs")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO','CLIENTE')")
    public ResponseEntity<?> estadoYjs(@PathVariable String id) {
        DocumentoColaborativo doc = docService.obtener(id);
        if (doc == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok(Map.of(
                "documentoId", id,
                "estadoYjs", doc.getEstadoYjs() != null ? doc.getEstadoYjs() : ""
        ));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO')")
    public ResponseEntity<?> eliminar(@PathVariable String id, Principal principal) {
        docService.eliminar(id);
        auditService.registrar(principal.getName(),
                AuditService.CAT_POLITICA, "DOCUMENTO_ELIMINADO",
                "Documento " + id + " eliminado");
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ── Google Drive — obtener o crear Doc/Sheet ─────────────────────────────

    /**
     * POST /api/documentos/google-doc
     * Body: { "claveCampo": "...", "tipo": "documento-texto"|"documento-hoja", "nombre": "..." }
     *
     * Si ya existe un DocumentoColaborativo con esa claveCampo y ya tiene googleDocId,
     * devuelve el existente. Si no, crea el Doc/Sheet en Google Drive y lo persiste.
     */
    @PostMapping("/google-doc")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO','CLIENTE')")
    public ResponseEntity<?> obtenerOCrearGoogleDoc(
            @RequestBody Map<String, String> body, Principal principal) {
        String claveCampo = body.get("claveCampo");
        String tipo       = body.getOrDefault("tipo", "documento-texto");
        String nombre     = body.getOrDefault("nombre", "");
        String usuario    = principal != null ? principal.getName() : "sistema";

        if (claveCampo == null || claveCampo.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "claveCampo es requerido"));
        }

        try {
            DocumentoColaborativo doc = docService.obtenerOCrearGoogleDoc(
                    claveCampo, tipo, nombre, usuario);
            return ResponseEntity.ok(doc);
        } catch (Exception e) {
            // Imprime en consola del backend para facilitar diagnóstico
            System.err.println("[GoogleDrive] Error al crear/obtener documento: " + e.getMessage());
            if (e.getCause() != null) System.err.println("[GoogleDrive] Causa: " + e.getCause().getMessage());
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage() != null ? e.getMessage() : "Error desconocido"));
        }
    }

    // ── TipTap — obtener o crear documento nativo ─────────────────────────────

    /**
     * POST /api/documentos/tiptap
     * Body: { "claveCampo": "...", "nombre": "..." }
     *
     * Devuelve o crea un documento TipTap (tipo "tiptap-texto") sin Google Drive.
     * Responde: { id, nombre, contenido, estadoYjs }
     */
    @PostMapping("/tiptap")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO','CLIENTE')")
    public ResponseEntity<?> obtenerOCrearTiptap(
            @RequestBody Map<String, String> body, Principal principal) {
        String claveCampo = body.get("claveCampo");
        String nombre     = body.getOrDefault("nombre", "Documento");
        String usuario    = principal != null ? principal.getName() : "sistema";

        if (claveCampo == null || claveCampo.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "claveCampo es requerido"));
        }

        DocumentoColaborativo doc = docService.obtenerOCrearTiptap(claveCampo, nombre, usuario);
        return ResponseEntity.ok(Map.of(
                "id",        doc.getId(),
                "nombre",    doc.getNombre(),
                "contenido", doc.getContenido() != null ? doc.getContenido() : "",
                "estadoYjs", doc.getEstadoYjs() != null ? doc.getEstadoYjs() : ""
        ));
    }

    // ── Admin: limpieza de cuota Google Drive ─────────────────────────────────

    /**
     * DELETE /api/documentos/admin/limpiar-drive
     * Borra TODOS los archivos de la cuenta de servicio para liberar cuota.
     * Usar una sola vez cuando storageQuotaExceeded.
     */
    @DeleteMapping("/admin/limpiar-drive")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> limpiarDrive(Principal principal) {
        try {
            int eliminados = driveService.limpiarTodosLosArchivos();
            auditService.registrar(principal.getName(),
                    AuditService.CAT_POLITICA, "DRIVE_LIMPIEZA",
                    "Se eliminaron " + eliminados + " archivos de la cuenta de servicio Google Drive");
            return ResponseEntity.ok(Map.of("eliminados", eliminados));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("error", e.getMessage()));
        }
    }

    // ── REST — archivos versionados ───────────────────────────────────────────

    @GetMapping("/archivos/tramite/{tramiteId}")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO','CLIENTE')")
    public ResponseEntity<List<RegistroArchivo>> archivosPorTramite(
            @PathVariable String tramiteId) {
        return ResponseEntity.ok(docService.listarArchivosPorTramite(tramiteId));
    }

    @GetMapping("/archivos/proceso/{procesoId}")
    @PreAuthorize("hasAnyRole('ADMIN','FUNCIONARIO')")
    public ResponseEntity<List<RegistroArchivo>> archivosPorProceso(
            @PathVariable String procesoId) {
        return ResponseEntity.ok(docService.listarArchivosPorProceso(procesoId));
    }

    // ── WebSocket ─────────────────────────────────────────────────────────────

    /**
     * Recibe un Yjs binary update (base64) y lo reenvía a todos en la sala.
     * El backend actúa como relay — no necesita entender el contenido Yjs.
     */
    @MessageMapping("/doc/{documentoId}/update")
    public void yjsUpdate(
            @DestinationVariable String documentoId,
            @Payload EventoDocumento evento,
            Principal principal) {

        if (principal == null) return;
        evento.setDocumentoId(documentoId);
        evento.setEmisor(principal.getName());
        evento.setTimestamp(System.currentTimeMillis());

        messaging.convertAndSend("/topic/doc/" + documentoId + "/update", evento);
    }

    /**
     * Cursor activo en hoja de cálculo (fila, columna).
     * Alta frecuencia — no se persiste ni audita.
     */
    @MessageMapping("/doc/{documentoId}/presencia-celda")
    public void presenciaCelda(
            @DestinationVariable String documentoId,
            @Payload EventoDocumento evento,
            Principal principal) {

        if (principal == null) return;
        evento.setDocumentoId(documentoId);
        evento.setEmisor(principal.getName());
        evento.setTimestamp(System.currentTimeMillis());

        messaging.convertAndSend("/topic/doc/" + documentoId + "/presencia", evento);
    }

    /**
     * Guardado explícito: el cliente manda el snapshot HTML/JSON + estado Yjs.
     * Se persiste en MongoDB y se notifica a los demás.
     */
    @MessageMapping("/doc/{documentoId}/guardar")
    public void guardar(
            @DestinationVariable String documentoId,
            @Payload EventoDocumento evento,
            Principal principal) {

        if (principal == null) return;
        String editor = principal.getName();

        DocumentoColaborativo guardado = docService.guardar(
                documentoId,
                evento.getPayload(),          // contenido (HTML o JSON)
                evento.getArchivoUrl(),       // reutilizamos archivoUrl para estadoYjs base64
                editor
        );

        if (guardado != null) {
            EventoDocumento notif = new EventoDocumento();
            notif.setDocumentoId(documentoId);
            notif.setEmisor(editor);
            notif.setTipo("guardado");
            notif.setTimestamp(System.currentTimeMillis());
            messaging.convertAndSend("/topic/doc/" + documentoId + "/guardado", notif);
        }
    }
}
