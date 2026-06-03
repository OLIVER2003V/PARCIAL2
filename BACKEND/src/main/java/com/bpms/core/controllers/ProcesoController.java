package com.bpms.core.controllers;

import com.bpms.core.dto.colaboracion.PresenciaUsuario;
import com.bpms.core.models.EstadoProceso;
import com.bpms.core.models.ProcesoDefinicion;
import com.bpms.core.services.ProcesoService;
import com.bpms.core.services.SesionColaborativaService;

import java.util.List;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import org.springframework.security.core.Authentication;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/procesos")
public class ProcesoController {

    @Autowired
    private ProcesoService procesoService;

    @Autowired
    private SesionColaborativaService sesionService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @PostMapping
    public ResponseEntity<?> crear(@RequestBody ProcesoDefinicion proceso) {
        // 👇 DEBUG: imprimir lo que llegó
        System.out.println("📦 POST recibido:");
        if (proceso.getPasos() != null) {
            proceso.getPasos().forEach(p -> {
                int numCampos = p.getCampos() != null ? p.getCampos().size() : 0;
                System.out.println("  - " + p.getId() + " | nombre: " + p.getNombre() + " | campos: " + numCampos);
                if (p.getCampos() != null) {
                    p.getCampos()
                            .forEach(c -> System.out.println("      • " + c.getEtiqueta() + " (" + c.getTipo() + ")"));
                }
            });
        }

        try {
            return ResponseEntity.ok(procesoService.guardarProceso(proceso));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body("Error al guardar: " + e.getMessage());
        }
    }

    @GetMapping
    public ResponseEntity<?> listar() {
        return ResponseEntity.ok(procesoService.obtenerTodos());
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> obtenerPorId(@PathVariable String id) {
        return procesoService.obtenerPorId(id)
                .map(p -> ResponseEntity.ok((Object) p))
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> actualizar(@PathVariable String id, @RequestBody ProcesoDefinicion proceso) {
        // Solo se permite edición directa de BORRADORes
        Optional<ProcesoDefinicion> existenteOpt = procesoService.obtenerPorId(id);
        if (existenteOpt.isPresent()) {
            EstadoProceso estadoActual = existenteOpt.get().getEstado();
            if (estadoActual != null && estadoActual != EstadoProceso.BORRADOR) {
                return ResponseEntity.badRequest().body(Map.of(
                        "error", "ESTADO_NO_BORRADOR",
                        "mensaje", "No se puede editar directamente una política en estado " + estadoActual
                                + ". Usa 'Nueva Versión' para crear un borrador editable."));
            }
        }

        try {
            return ResponseEntity.ok(procesoService.actualizarProceso(id, proceso));
        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * PATCH /api/admin/procesos/{id}/toggle-activo
     * Activa o desactiva una política sin pasar por la validación de estado.
     */
    @PatchMapping("/{id}/toggle-activo")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> toggleActivo(@PathVariable String id) {
        return procesoService.obtenerPorId(id)
                .map(proceso -> {
                    proceso.setActivo(!proceso.isActivo());
                    ProcesoDefinicion actualizado = procesoService.actualizarProceso(id, proceso);
                    return ResponseEntity.ok((Object) actualizado);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/publicos")
    public ResponseEntity<List<ProcesoDefinicion>> obtenerProcesosPublicos() {
        // 👇 NUEVO: solo devolver procesos publicados (ACTIVOS)
        List<ProcesoDefinicion> activos = procesoService.obtenerPorEstado(EstadoProceso.ACTIVA);
        return ResponseEntity.ok(activos);
    }

    /**
     * POST /api/admin/procesos/{id}/publicar
     * Publica una política en borrador (admin only)
     */

    /**
     * POST /api/admin/procesos/{id}/publicar
     * Publica una política en borrador. Si hay colaboradores activos y forzar=false,
     * devuelve 409 con la lista de conectados para que el frontend pida confirmación.
     */
    @PostMapping("/{id}/publicar")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> publicarPolitica(
            @PathVariable String id,
            @RequestParam(defaultValue = "false") boolean forzar,
            Authentication auth) {
        try {
            String username = auth.getName();

            // Verificar colaboradores activos si no se fuerza
            if (!forzar) {
                List<PresenciaUsuario> conectados = sesionService.obtenerConectados(id);
                List<PresenciaUsuario> otros = conectados.stream()
                        .filter(p -> !p.getUsername().equals(username))
                        .toList();
                if (!otros.isEmpty()) {
                    return ResponseEntity.status(409).body(Map.of(
                            "error", "COLABORADORES_ACTIVOS",
                            "mensaje", "Hay " + otros.size() + " colaborador(es) editando este borrador.",
                            "colaboradores", otros));
                }
            }

            ProcesoDefinicion publicado = procesoService.publicar(id, username);

            // Notificar a colaboradores en la sala vía WebSocket
            java.util.HashMap<String, Object> notif = new java.util.HashMap<>();
            notif.put("tipo", "PROCESO_PUBLICADO");
            notif.put("por", username);
            notif.put("nombre", publicado.getNombre());
            notif.put("version", publicado.getVersion() != null ? publicado.getVersion() : "v1.0");
            messagingTemplate.convertAndSend("/topic/sesion/" + id + "/notificacion", (Object) notif);

            return ResponseEntity.ok(publicado);
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * POST /api/admin/procesos/{id}/nueva-version
     * Crea un nuevo borrador a partir de una política publicada.
     * Retorna 409 si ya existe un BORRADOR para el mismo codigoBase.
     */
    @PostMapping("/{id}/nueva-version")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> crearNuevaVersion(@PathVariable String id, Authentication auth) {
        try {
            String username = auth.getName();
            ProcesoDefinicion nueva = procesoService.crearNuevaVersion(id, username);
            return ResponseEntity.ok(nueva);
        } catch (RuntimeException e) {
            String msg = e.getMessage();
            if (msg != null && msg.startsWith("BORRADOR_EXISTENTE:")) {
                String borradorId = msg.substring("BORRADOR_EXISTENTE:".length());
                return ResponseEntity.status(409).body(Map.of(
                        "error", "BORRADOR_EXISTENTE",
                        "borradorId", borradorId,
                        "mensaje", "Ya existe un borrador en edición para esta política."));
            }
            return ResponseEntity.badRequest().body(Map.of("error", msg));
        }
    }

    /**
     * POST /api/admin/procesos/{id}/restaurar
     * Crea un BORRADOR con el contenido de una versión OBSOLETA para revisión y republicación.
     * Retorna 409 si ya existe un BORRADOR activo para el mismo codigoBase.
     */
    @PostMapping("/{id}/restaurar")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> restaurarVersion(@PathVariable String id, Authentication auth) {
        try {
            String username = auth.getName();
            ProcesoDefinicion borrador = procesoService.restaurarVersion(id, username);
            return ResponseEntity.ok(borrador);
        } catch (RuntimeException e) {
            String msg = e.getMessage();
            if (msg != null && msg.startsWith("BORRADOR_EXISTENTE:")) {
                String borradorId = msg.substring("BORRADOR_EXISTENTE:".length());
                return ResponseEntity.status(409).body(Map.of(
                        "error", "BORRADOR_EXISTENTE",
                        "borradorId", borradorId,
                        "mensaje", "Ya existe un borrador en edición para esta política."));
            }
            return ResponseEntity.badRequest().body(Map.of("error", msg));
        }
    }

    /**
     * POST /api/admin/procesos/{id}/validar
     * Valida la integridad sin publicar. Útil para mostrar errores al admin.
     */
    @PostMapping("/{id}/validar")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> validarPolitica(@PathVariable String id) {
        return procesoService.obtenerPorId(id)
                .map(proceso -> {
                    List<String> errores = procesoService.validarIntegridad(proceso);
                    return ResponseEntity.ok((Object) Map.of(
                            "valido", errores.isEmpty(),
                            "errores", errores));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * GET /api/admin/procesos/{codigoBase}/versiones
     * Obtiene el historial de versiones de una política
     */
    @GetMapping("/versiones/{codigoBase}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<List<ProcesoDefinicion>> obtenerVersiones(@PathVariable String codigoBase) {
        return ResponseEntity.ok(procesoService.obtenerHistorialVersiones(codigoBase));
    }

    /**
     * 👇 NUEVO Colaboración: devuelve el último borrador colaborativo de un proceso.
     * Si no hay borrador, devuelve el XML oficial.
     * Lo usa el frontend al abrir el editor para preguntar "¿recuperar borrador?".
     */
    @GetMapping("/{id}/borrador")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> obtenerBorrador(@PathVariable String id) {
        return procesoService.obtenerPorId(id)
                .map(p -> {
                    Map<String, Object> resp = new java.util.HashMap<>();
                    resp.put("procesoId", p.getId());
                    resp.put("bpmnXml", p.getBpmnXml());
                    resp.put("borradorXml", p.getBorradorXml());
                    resp.put("borradorPor", p.getBorradorPor());
                    resp.put("fechaUltimoBorrador", p.getFechaUltimoBorrador());
                    boolean hayBorradorReciente = p.getBorradorXml() != null
                            && !p.getBorradorXml().isBlank();
                    resp.put("hayBorradorReciente", hayBorradorReciente);
                    return ResponseEntity.ok((Object) resp);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 👇 NUEVO Colaboración: limpia el borrador colaborativo (lo invoca el frontend
     * tras guardar la política definitivamente).
     */
    @DeleteMapping("/{id}/borrador")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> limpiarBorrador(@PathVariable String id) {
        try {
            // Inyectaremos BorradorService a través del service o aquí mismo
            // Como ProcesoService no lo tiene, lo hacemos aquí:
            var opt = procesoService.obtenerPorId(id);
            if (opt.isEmpty()) return ResponseEntity.notFound().build();

            var proceso = opt.get();
            proceso.setBorradorXml(null);
            proceso.setFechaUltimoBorrador(null);
            proceso.setBorradorPor(null);
            procesoService.actualizarProceso(id, proceso);

            return ResponseEntity.ok(Map.of("mensaje", "Borrador limpiado"));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}