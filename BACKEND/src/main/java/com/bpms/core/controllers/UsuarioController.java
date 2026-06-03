package com.bpms.core.controllers;

import com.bpms.core.models.Usuario;
import com.bpms.core.repositories.UsuarioRepository;
import com.bpms.core.services.AuditService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/usuarios")
public class UsuarioController {

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    // 👇 NUEVO CU16
    @Autowired
    private AuditService auditService;

    @GetMapping
    public List<Usuario> obtenerTodos() {
        return usuarioRepository.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> obtenerPorId(@PathVariable String id) {
        return usuarioRepository.findById(id)
                .map(u -> ResponseEntity.ok((Object) u))
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping
    public ResponseEntity<?> crearUsuario(@RequestBody Usuario usuario) {
        if (usuarioRepository.findByUsername(usuario.getUsername()).isPresent()) {
            return ResponseEntity.badRequest().body("El nombre de usuario ya está en uso");
        }

        usuario.setPassword(passwordEncoder.encode(usuario.getPassword()));
        usuario.setFechaCreacion(LocalDateTime.now());
        if (usuario.getEstadoDisponibilidad() == null) {
            usuario.setEstadoDisponibilidad("DISPONIBLE");
        }

        Usuario guardado = usuarioRepository.save(usuario);

        // 👇 NUEVO CU16
        auditService.registrar(
                actorActual(),
                AuditService.CAT_USUARIO,
                "USUARIO_CREADO",
                "Usuario creado: @" + guardado.getUsername() + " (rol: " + guardado.getRol() + ")"
        );

        return ResponseEntity.ok(guardado);
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> actualizarUsuario(@PathVariable String id, @RequestBody Usuario datos) {
        return usuarioRepository.findById(id)
                .map(existente -> {
                    StringBuilder cambios = new StringBuilder();

                    if (datos.getUsername() != null && !datos.getUsername().equals(existente.getUsername())) {
                        cambios.append("username: ").append(existente.getUsername())
                                .append(" → ").append(datos.getUsername()).append("; ");
                        existente.setUsername(datos.getUsername());
                    }
                    if (datos.getNombreCompleto() != null) {
                        existente.setNombreCompleto(datos.getNombreCompleto());
                    }
                    if (datos.getEmail() != null) {
                        existente.setEmail(datos.getEmail());
                    }

                    if (datos.getRol() != null && !datos.getRol().equals(existente.getRol())) {
                        cambios.append("rol: ").append(existente.getRol())
                                .append(" → ").append(datos.getRol()).append("; ");
                        existente.setRol(datos.getRol());
                    }
                    if (datos.getDepartamentoId() != null) {
                        existente.setDepartamentoId(datos.getDepartamentoId());
                    }
                    if (datos.getEstadoDisponibilidad() != null) {
                        existente.setEstadoDisponibilidad(datos.getEstadoDisponibilidad());
                    }

                    boolean cambioPassword = false;
                    if (datos.getPassword() != null && !datos.getPassword().isBlank()) {
                        existente.setPassword(passwordEncoder.encode(datos.getPassword()));
                        cambioPassword = true;
                    }

                    Usuario guardado = usuarioRepository.save(existente);

                    // 👇 NUEVO CU16
                    String detalle = "Usuario @" + guardado.getUsername() + " modificado";
                    if (cambios.length() > 0) detalle += " — cambios: " + cambios.toString().trim();
                    if (cambioPassword) detalle += " [contraseña actualizada]";

                    auditService.registrar(
                            actorActual(),
                            AuditService.CAT_USUARIO,
                            "USUARIO_ACTUALIZADO",
                            detalle
                    );

                    return ResponseEntity.ok((Object) guardado);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/estado")
    public ResponseEntity<?> actualizarEstado(@PathVariable String id, @RequestBody Map<String, String> body) {
        String nuevoEstado = body.get("estado");
        if (nuevoEstado == null || !List.of("DISPONIBLE", "AUSENTE", "VACACIONES").contains(nuevoEstado)) {
            return ResponseEntity.badRequest().body("Estado no válido. Debe ser: DISPONIBLE, AUSENTE o VACACIONES");
        }

        return usuarioRepository.findById(id)
                .map(usuario -> {
                    String estadoAnterior = usuario.getEstadoDisponibilidad();
                    usuario.setEstadoDisponibilidad(nuevoEstado);
                    Usuario guardado = usuarioRepository.save(usuario);

                    // 👇 NUEVO CU16
                    auditService.registrar(
                            actorActual(),
                            AuditService.CAT_USUARIO,
                            "USUARIO_CAMBIO_ESTADO",
                            "Disponibilidad de @" + guardado.getUsername()
                                    + ": " + estadoAnterior + " → " + nuevoEstado
                    );

                    return ResponseEntity.ok((Object) guardado);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> eliminarUsuario(@PathVariable String id) {
        return usuarioRepository.findById(id)
                .map(usuario -> {
                    usuarioRepository.deleteById(id);

                    // 👇 NUEVO CU16
                    auditService.registrar(
                            actorActual(),
                            AuditService.CAT_USUARIO,
                            "USUARIO_ELIMINADO",
                            "Usuario eliminado: @" + usuario.getUsername()
                                    + " (rol: " + usuario.getRol() + ", id: " + id + ")"
                    );

                    return ResponseEntity.ok((Object) Map.of("mensaje", "Usuario eliminado correctamente"));
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * 👇 NUEVO CU16: extrae el username del contexto de seguridad JWT.
     * Devuelve "SISTEMA" si no hay autenticación (caso raro en endpoints protegidos).
     */
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