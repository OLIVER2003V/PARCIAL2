package com.bpms.core.controllers;

import com.bpms.core.models.*;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import com.bpms.core.repositories.TramiteRepository;
import com.bpms.core.repositories.UsuarioRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * TramiteSeedController — crea trámites de prueba para el CU21 (Asistente de formulario).
 *
 * POST   /api/admin/seed-tramites  → inserta los trámites de prueba en MongoDB
 * DELETE /api/admin/seed-tramites  → elimina todos los trámites de prueba
 * GET    /api/admin/seed-tramites  → lista los trámites de prueba creados
 *
 * Los trámites se asignan automáticamente al primer FUNCIONARIO encontrado en BD.
 * El campo clienteId queda como "SEED_TEST_CU21" para identificarlos y limpiarlos.
 */
@RestController
@RequestMapping("/api/admin/seed-tramites")
@CrossOrigin(origins = "*")
public class TramiteSeedController {

    // Marker para identificar y limpiar los trámites de prueba
    private static final String SEED_MARKER = "SEED_TEST_CU21";

    @Autowired private TramiteRepository    tramiteRepo;
    @Autowired private ProcesoDefinicionRepository procesoRepo;
    @Autowired private UsuarioRepository    usuarioRepo;

    // ── POST /api/admin/seed-tramites ─────────────────────────────────────────
    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> sembrar() {

        // 1. Limpiar trámites anteriores de esta semilla
        List<Tramite> anteriores = tramiteRepo.findByClienteIdOrderByFechaCreacionDesc(SEED_MARKER);
        if (!anteriores.isEmpty()) tramiteRepo.deleteAll(anteriores);

        // 2. Obtener mapa código → proceso de los procesos demo
        Map<String, ProcesoDefinicion> procs = procesoRepo.findAll().stream()
            .filter(p -> "seed-demo".equals(p.getPublicadoPor()))
            .collect(Collectors.toMap(ProcesoDefinicion::getCodigo, p -> p, (a, b) -> a));

        // 3. Buscar primer FUNCIONARIO y su departamento
        Usuario funcionario = usuarioRepo.findAll().stream()
            .filter(u -> Rol.FUNCIONARIO == u.getRol())
            .findFirst().orElse(null);

        String funcionarioId = funcionario != null ? funcionario.getId() : "funcionario_seed";
        String deptId        = funcionario != null ? funcionario.getDepartamentoId() : null;
        String funcionarioNombre = funcionario != null
            ? (funcionario.getNombreCompleto() != null ? funcionario.getNombreCompleto() : funcionario.getUsername())
            : "funcionario_seed";

        // 4. Construir los trámites de prueba
        List<Tramite> tramites = new ArrayList<>();
        int n = 1;

        // ══ PRUEBA 1: LIC001 — Licencia de Funcionamiento (TODOS los campos vacíos) ══════
        if (procs.containsKey("LIC001")) {
            tramites.add(build(procs.get("LIC001"), n++, funcionarioId, deptId,
                "🧪 CU21-P1 • Licencia de Funcionamiento — Ferretería El Constructor",
                Map.of() // sin datos → el asistente debe llenar todo
            ));
        }

        // ══ PRUEBA 2: SOC002 — Beca Escolar (PARCIALMENTE lleno) ═════════════════════════
        // Nombre y fecha ya llenos → probar que CU21 respeta "Solo campos vacíos"
        if (procs.containsKey("SOC002")) {
            tramites.add(build(procs.get("SOC002"), n++, funcionarioId, deptId,
                "🧪 CU21-P2 • Beca Escolar — Lucía Acabal Xiloj (parcial)",
                new LinkedHashMap<>(Map.of(
                    "nombre_estudiante", "Lucía Fernanda Acabal Xiloj",
                    "fecha_nacimiento",  "2009-11-03"
                ))
            ));
        }

        // ══ PRUEBA 3: CON001 — Permiso de Construcción (TODOS vacíos) ════════════════════
        if (procs.containsKey("CON001")) {
            tramites.add(build(procs.get("CON001"), n++, funcionarioId, deptId,
                "🧪 CU21-P3 • Permiso de Construcción — Residencial Los Pinos",
                Map.of()
            ));
        }

        // ══ PRUEBA 4: SAL001 — Permiso Sanitario (TODOS vacíos) ══════════════════════════
        if (procs.containsKey("SAL001")) {
            tramites.add(build(procs.get("SAL001"), n++, funcionarioId, deptId,
                "🧪 CU21-P4 • Permiso Sanitario — Restaurante El Sabor de Casa",
                Map.of()
            ));
        }

        // ══ PRUEBA 5: EMP001 — Registro de Empresa (TODOS vacíos) ════════════════════════
        if (procs.containsKey("EMP001")) {
            tramites.add(build(procs.get("EMP001"), n++, funcionarioId, deptId,
                "🧪 CU21-P5 • Registro de Empresa — Tech Solutions S.A.",
                Map.of()
            ));
        }

        // ══ PRUEBA 6: LIC001 — Prueba VOZ (campos vacíos para dictar) ════════════════════
        if (procs.containsKey("LIC001")) {
            tramites.add(build(procs.get("LIC001"), n++, funcionarioId, deptId,
                "🎙️ CU21-V1 • Licencia Funcionamiento — Para prueba de VOZ",
                Map.of()
            ));
        }

        if (tramites.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                "error",  "No se encontraron procesos demo. Ejecuta primero POST /api/admin/seed-demo.",
                "tip",    "Asegúrate de haber corrido el seed de procesos antes de crear los trámites."
            ));
        }

        tramiteRepo.saveAll(tramites);

        // 5. Construir respuesta
        List<Map<String, Object>> resumen = tramites.stream().map(t -> {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("codigo",      t.getCodigoSeguimiento());
            r.put("descripcion", t.getDescripcion());
            r.put("pasoActual",  t.getPasoActualId());
            r.put("camposPreLlenados", t.getDatosFormularioInicial().size());
            return r;
        }).collect(Collectors.toList());

        return ResponseEntity.ok(Map.of(
            "mensaje",             "✅ " + tramites.size() + " trámites de prueba CU21 creados.",
            "funcionarioAsignado", funcionarioNombre,
            "tramites",            resumen,
            "instrucciones", List.of(
                "1. Login como funcionario en la aplicación.",
                "2. Ve a 'Bandeja de Entrada'.",
                "3. Busca los trámites cuyo código empieza con SEED-TEST-.",
                "4. Abre cualquiera y prueba el botón '🎙️ Dictar datos'.",
                "5. Usa el tab Texto/Prompt con los prompts del script test-cu21.ps1."
            )
        ));
    }

    // ── DELETE /api/admin/seed-tramites ───────────────────────────────────────
    @DeleteMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> limpiar() {
        List<Tramite> aEliminar = tramiteRepo.findByClienteIdOrderByFechaCreacionDesc(SEED_MARKER);
        tramiteRepo.deleteAll(aEliminar);
        return ResponseEntity.ok(Map.of(
            "mensaje", "🗑️ " + aEliminar.size() + " trámites de prueba CU21 eliminados."
        ));
    }

    // ── GET /api/admin/seed-tramites ──────────────────────────────────────────
    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> listar() {
        List<Tramite> existentes = tramiteRepo.findByClienteIdOrderByFechaCreacionDesc(SEED_MARKER);
        List<Map<String, Object>> datos = existentes.stream().map(t -> {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id",          t.getId());
            r.put("codigo",      t.getCodigoSeguimiento());
            r.put("descripcion", t.getDescripcion());
            r.put("proceso",     t.getProcesoDefinicionId());
            r.put("paso",        t.getPasoActualId());
            r.put("campos",      t.getDatosFormularioInicial());
            return r;
        }).collect(Collectors.toList());

        return ResponseEntity.ok(Map.of(
            "total",    existentes.size(),
            "tramites", datos
        ));
    }

    // ── Builder ───────────────────────────────────────────────────────────────

    private Tramite build(ProcesoDefinicion proc, int num,
                          String funcionarioId, String deptId,
                          String descripcion, Map<String, Object> datosIniciales) {

        // El paso inicial es "INICIO_CLIENTE" (p1), el segundo es "FUNCIONARIO" (p2)
        // Ponemos el trámite en p2 para que aparezca en la bandeja del funcionario
        String pasoFuncionario = proc.getCodigo() + "-p2";

        Tramite t = new Tramite();
        t.setCodigoSeguimiento("SEED-TEST-" + String.format("%03d", num));
        t.setDescripcion(descripcion);
        t.setClienteId(SEED_MARKER);                            // marker de prueba

        t.setProcesoDefinicionId(proc.getId());
        t.setPasoActualId(pasoFuncionario);
        t.setPasosActivosIds(new ArrayList<>(List.of(pasoFuncionario)));
        t.setPasosCompletadosIds(new ArrayList<>(List.of(proc.getCodigo() + "-p1")));

        t.setTipoResponsableActual(TipoResponsable.FUNCIONARIO);
        t.setResponsableActualId(funcionarioId);
        t.setDepartamentoActualId(deptId);
        t.setEstadoSemaforo(EstadoTramite.EN_TIEMPO);

        // Fecha creada "ayer" para simular tramite realista
        t.setFechaCreacion(LocalDateTime.now().minusDays(1));
        t.setFechaUltimaActualizacion(LocalDateTime.now().minusHours(2));

        // Datos del formulario (vacío o parcial según la prueba)
        t.setDatosFormularioInicial(new HashMap<>(datosIniciales));

        return t;
    }
}
