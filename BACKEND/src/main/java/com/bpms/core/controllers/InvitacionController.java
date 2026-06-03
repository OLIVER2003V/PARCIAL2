package com.bpms.core.controllers;

import com.bpms.core.dto.colaboracion.InvitacionRequest;
import com.bpms.core.models.Rol;
import com.bpms.core.models.Usuario;
import com.bpms.core.repositories.UsuarioRepository;
import com.bpms.core.services.AuditService;
import com.bpms.core.services.InvitacionService;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 👇 NUEVO Colaboración: REST API para invitar a una sala.
 *
 * Endpoints:
 *  POST /api/colaboracion/generar-link     → genera token JWT corto y devuelve la URL
 *  POST /api/colaboracion/invitar          → invita a admins de la lista interna
 *  GET  /api/colaboracion/admins-disponibles → lista admins (excluyendo al actual)
 *  GET  /api/colaboracion/validar/{token}  → valida un token de invitación recibido
 */
@RestController
@RequestMapping("/api/colaboracion")
public class InvitacionController {

    @Autowired
    private InvitacionService invitacionService;

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Autowired
    private AuditService auditService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    /**
     * Genera un link de invitación firmado.
     */
    @PostMapping("/generar-link")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> generarLink(@RequestBody Map<String, String> payload) {
        String procesoId = payload.get("procesoId");
        if (procesoId == null || procesoId.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "procesoId requerido"));
        }

        String invitador = actorActual();
        String token = invitacionService.generarToken(invitador, procesoId);

        // Auditar (CU16)
        try {
            auditService.registrar(
                    invitador,
                    AuditService.CAT_POLITICA,
                    "COLABORACION_LINK_GENERADO",
                    "Generó link de invitación para proceso " + procesoId
            );
        } catch (Exception ignored) { }

        // Devolvemos solo el token; el frontend arma la URL completa
        return ResponseEntity.ok(Map.of(
                "token", token,
                "expiraEn", "24 horas"
        ));
    }

    /**
     * Lista los admins disponibles para invitar (excluyendo al actual).
     */
    @GetMapping("/admins-disponibles")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> listarAdminsDisponibles() {
        String yo = actorActual();

        List<Map<String, Object>> admins = usuarioRepository.findAll().stream()
                .filter(u -> u.getRol() == Rol.ADMIN)
                .filter(u -> !u.getUsername().equalsIgnoreCase(yo))
                .filter(u -> u.getEstadoDisponibilidad() == null
                        || !"INACTIVO".equalsIgnoreCase(String.valueOf(u.getEstadoDisponibilidad())))
                .map(u -> {
                    Map<String, Object> m = new HashMap<>();
                    m.put("username", u.getUsername());
                    m.put("nombreCompleto", u.getNombreCompleto());
                    m.put("email", u.getEmail());
                    return m;
                })
                .toList();

        return ResponseEntity.ok(admins);
    }

    /**
     * Invita a una lista de admins. Por cada uno:
     *  1. Genera un token específico (cada admin recibe su propio link/notif)
     *  2. Manda notificación in-app vía WS personal /user/queue/notificaciones
     *  3. Audita la acción
     */
    @PostMapping("/invitar")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> invitar(@RequestBody InvitacionRequest req) {
        if (req.getProcesoId() == null || req.getProcesoId().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "procesoId requerido"));
        }
        if (req.getUsernamesInvitados() == null || req.getUsernamesInvitados().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Selecciona al menos un admin"));
        }

        String invitador = actorActual();
        int enviadas = 0;

        for (String invitado : req.getUsernamesInvitados()) {
            // Verificar que el invitado existe y es ADMIN
            var optU = usuarioRepository.findByUsername(invitado);
            if (optU.isEmpty() || optU.get().getRol() != Rol.ADMIN) {
                System.err.println("⚠️ [Invitación] " + invitado + " no es ADMIN o no existe");
                continue;
            }

            // Generar token específico para este invitado
            String token = invitacionService.generarToken(invitador, req.getProcesoId());

            // Notificación in-app via WS personal
            Map<String, Object> notif = new HashMap<>();
            notif.put("tipo", "INVITACION_COLABORACION");
            notif.put("invitador", invitador);
            notif.put("procesoId", req.getProcesoId());
            notif.put("token", token);
            notif.put("mensaje", req.getMensajeOpcional() != null ? req.getMensajeOpcional() : "");
            notif.put("timestamp", System.currentTimeMillis());

            messagingTemplate.convertAndSendToUser(
                    invitado,
                    "/queue/notificaciones",
                    notif
            );

            // Auditar
            try {
                auditService.registrar(
                        invitador,
                        AuditService.CAT_POLITICA,
                        "COLABORACION_INVITACION_ENVIADA",
                        "Invitó a " + invitado + " a colaborar en proceso " + req.getProcesoId()
                );
            } catch (Exception ignored) { }

            enviadas++;
        }

        return ResponseEntity.ok(Map.of(
                "mensaje", "Invitaciones enviadas",
                "enviadas", enviadas,
                "totalSolicitadas", req.getUsernamesInvitados().size()
        ));
    }

    /**
     * Valida un token de invitación y devuelve los datos.
     * Lo usa el guard del frontend al abrir /colaborar/{token}.
     */
    @GetMapping("/validar/{token}")
    public ResponseEntity<?> validarToken(@PathVariable String token) {
        try {
            InvitacionService.DatosInvitacion datos = invitacionService.validarToken(token);
            return ResponseEntity.ok(Map.of(
                    "valido", true,
                    "invitador", datos.invitador,
                    "procesoId", datos.procesoId,
                    "expiraEn", datos.expiracion.getTime()
            ));
        } catch (Exception e) {
            return ResponseEntity.status(401).body(Map.of(
                    "valido", false,
                    "error", e.getMessage()
            ));
        }
    }

    private String actorActual() {
        try {
            var auth = SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.isAuthenticated()) {
                String name = auth.getName();
                return (name != null && !name.equals("anonymousUser")) ? name : "SISTEMA";
            }
        } catch (Exception ignored) {}
        return "SISTEMA";
    }
}