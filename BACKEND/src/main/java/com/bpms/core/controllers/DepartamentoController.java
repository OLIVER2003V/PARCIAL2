package com.bpms.core.controllers;

import com.bpms.core.models.Departamento;
import com.bpms.core.repositories.DepartamentoRepository;
import com.bpms.core.repositories.UsuarioRepository;
import com.bpms.core.repositories.TramiteRepository;
import com.bpms.core.services.AuditService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/departamentos")
public class DepartamentoController {

    @Autowired
    private DepartamentoRepository departamentoRepository;

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Autowired
    private TramiteRepository tramiteRepository;

    // 👇 NUEVO CU16
    @Autowired
    private AuditService auditService;

    @GetMapping
    public List<Departamento> obtenerTodos() {
        return departamentoRepository.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> obtenerPorId(@PathVariable String id) {
        return departamentoRepository.findById(id)
                .map(d -> ResponseEntity.ok((Object) d))
                .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/stats")
    public ResponseEntity<?> obtenerEstadisticas() {
        List<Departamento> todos = departamentoRepository.findAll();
        Map<String, Map<String, Object>> stats = new HashMap<>();

        for (Departamento d : todos) {
            Map<String, Object> deptoStats = new HashMap<>();

            long funcionarios = usuarioRepository.findAll().stream()
                    .filter(u -> d.getId().equals(u.getDepartamentoId()))
                    .count();

            long tramitesActivos = tramiteRepository.findAll().stream()
                    .filter(t -> d.getId().equals(t.getDepartamentoActualId()))
                    .count();

            deptoStats.put("funcionarios", funcionarios);
            deptoStats.put("tramitesActivos", tramitesActivos);
            stats.put(d.getId(), deptoStats);
        }

        return ResponseEntity.ok(stats);
    }

    @PostMapping
    public ResponseEntity<?> crear(@RequestBody Departamento departamento) {
        if (departamentoRepository.findByNombre(departamento.getNombre()).isPresent()) {
            return ResponseEntity.badRequest().body("Ya existe un departamento con ese nombre");
        }

        departamento.setFechaCreacion(LocalDateTime.now());
        departamento.setActivo(true);
        Departamento guardado = departamentoRepository.save(departamento);

        // 👇 NUEVO CU16
        auditService.registrar(
                actorActual(),
                AuditService.CAT_DEPARTAMENTO,
                "DEPARTAMENTO_CREADO",
                "Departamento creado: '" + guardado.getNombre() + "'"
        );

        return ResponseEntity.ok(guardado);
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> actualizar(@PathVariable String id, @RequestBody Departamento datos) {
        return departamentoRepository.findById(id)
                .map(existente -> {
                    StringBuilder cambios = new StringBuilder();

                    if (datos.getNombre() != null && !datos.getNombre().equals(existente.getNombre())) {
                        if (departamentoRepository.findByNombre(datos.getNombre()).isPresent()) {
                            return ResponseEntity.badRequest().body((Object) "Ya existe un departamento con ese nombre");
                        }
                        cambios.append("nombre: '").append(existente.getNombre())
                                .append("' → '").append(datos.getNombre()).append("'; ");
                        existente.setNombre(datos.getNombre());
                    }

                    if (datos.getDescripcion() != null) existente.setDescripcion(datos.getDescripcion());

                    if (datos.isActivo() != existente.isActivo()) {
                        cambios.append("activo: ").append(existente.isActivo())
                                .append(" → ").append(datos.isActivo()).append("; ");
                    }
                    existente.setActivo(datos.isActivo());

                    Departamento guardado = departamentoRepository.save(existente);

                    // 👇 NUEVO CU16
                    String detalle = "Departamento '" + guardado.getNombre() + "' modificado";
                    if (cambios.length() > 0) detalle += " — cambios: " + cambios.toString().trim();

                    auditService.registrar(
                            actorActual(),
                            AuditService.CAT_DEPARTAMENTO,
                            "DEPARTAMENTO_ACTUALIZADO",
                            detalle
                    );

                    return ResponseEntity.ok((Object) guardado);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @PutMapping("/{id}/toggle-activo")
    public ResponseEntity<?> toggleActivo(@PathVariable String id) {
        return departamentoRepository.findById(id)
                .map(d -> {
                    boolean estadoAnterior = d.isActivo();
                    d.setActivo(!d.isActivo());
                    Departamento guardado = departamentoRepository.save(d);

                    // 👇 NUEVO CU16
                    auditService.registrar(
                            actorActual(),
                            AuditService.CAT_DEPARTAMENTO,
                            "DEPARTAMENTO_TOGGLE",
                            "Departamento '" + guardado.getNombre() + "' "
                                    + (estadoAnterior ? "DESACTIVADO" : "ACTIVADO")
                    );

                    return ResponseEntity.ok((Object) guardado);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> eliminar(@PathVariable String id) {
        if (!departamentoRepository.existsById(id)) {
            return ResponseEntity.notFound().build();
        }

        Departamento deptoARemover = departamentoRepository.findById(id).orElse(null);

        long funcionarios = usuarioRepository.findAll().stream()
                .filter(u -> id.equals(u.getDepartamentoId()))
                .count();

        if (funcionarios > 0) {
            return ResponseEntity.badRequest().body(
                "No se puede eliminar: el departamento tiene " + funcionarios +
                " funcionario(s) asignado(s). Reasigna o elimina los funcionarios primero."
            );
        }

        long tramitesActivos = tramiteRepository.findAll().stream()
                .filter(t -> id.equals(t.getDepartamentoActualId()))
                .count();

        if (tramitesActivos > 0) {
            return ResponseEntity.badRequest().body(
                "No se puede eliminar: el departamento tiene " + tramitesActivos +
                " trámite(s) activo(s). Considera desactivarlo en lugar de eliminarlo."
            );
        }

        departamentoRepository.deleteById(id);

        // 👇 NUEVO CU16
        auditService.registrar(
                actorActual(),
                AuditService.CAT_DEPARTAMENTO,
                "DEPARTAMENTO_ELIMINADO",
                "Departamento eliminado: '" + (deptoARemover != null ? deptoARemover.getNombre() : id) + "'"
        );

        return ResponseEntity.ok(Map.of("mensaje", "Departamento eliminado correctamente"));
    }

    /**
     * 👇 NUEVO CU16: extrae el username del contexto de seguridad JWT.
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