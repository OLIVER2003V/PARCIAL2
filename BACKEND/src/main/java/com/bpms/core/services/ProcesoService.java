package com.bpms.core.services;

import com.bpms.core.models.AuditLog;
import com.bpms.core.models.EstadoProceso;
import com.bpms.core.models.Paso;
import com.bpms.core.models.ProcesoDefinicion;
import com.bpms.core.models.TipoPaso;
import com.bpms.core.models.Transicion;
import com.bpms.core.repositories.AuditLogRepository;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class ProcesoService {

    @Autowired
    private ProcesoDefinicionRepository procesoRepository;

    @Autowired
    private BpmnParserService bpmnParser;

    @Autowired
    private AuditLogRepository auditLogRepository;

    // 👇 NUEVO CU16: servicio centralizado de auditoría
    @Autowired
    private AuditService auditService;

    /**
     * Guarda un nuevo proceso. Si trae bpmnXml, lo parsea automáticamente
     * para generar pasos y transiciones.
     */
    public ProcesoDefinicion guardarProceso(ProcesoDefinicion proceso) {
        if (proceso.getBpmnXml() != null && !proceso.getBpmnXml().isBlank()) {
            bpmnParser.parsearYRellenar(proceso, proceso.getBpmnXml());
        }
        proceso.setFechaCreacion(LocalDateTime.now());
        proceso.setFechaUltimaActualizacion(LocalDateTime.now());
        proceso.setActivo(true);

        ProcesoDefinicion guardado = procesoRepository.save(proceso);

        auditService.registrar(
                "SISTEMA",
                AuditService.CAT_POLITICA,
                "POLITICA_CREADA",
                "Política creada: '" + guardado.getNombre() + "' (código: " + guardado.getCodigo() + ")",
                guardado.getId(), "PROCESO"
        );

        return guardado;
    }

    public ProcesoDefinicion actualizarProceso(String id, ProcesoDefinicion datos) {
        ProcesoDefinicion existente = procesoRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Proceso no encontrado: " + id));

        // Copiamos metadatos simples
        existente.setNombre(datos.getNombre());
        existente.setDescripcion(datos.getDescripcion());
        existente.setActivo(datos.isActivo());
        existente.setBpmnXml(datos.getBpmnXml());
        existente.setSvgPreview(datos.getSvgPreview());
        existente.setFechaUltimaActualizacion(LocalDateTime.now());

        // 👇 CLAVE: copiamos los pasos del frontend (con sus campos) ANTES del parseo
        if (datos.getPasos() != null) {
            existente.setPasos(datos.getPasos());
        }

        if (datos.getBpmnXml() != null && !datos.getBpmnXml().isBlank()) {
            bpmnParser.parsearYRellenar(existente, datos.getBpmnXml());
        }

        ProcesoDefinicion actualizado = procesoRepository.save(existente);

        auditService.registrar(
                "SISTEMA",
                AuditService.CAT_POLITICA,
                "POLITICA_ACTUALIZADA",
                "Política modificada: '" + actualizado.getNombre() + "' (estado: " + actualizado.getEstado() + ")",
                actualizado.getId(), "PROCESO"
        );

        return actualizado;
    }

    public Optional<ProcesoDefinicion> obtenerPorId(String id) {
        return procesoRepository.findById(id);
    }

    public List<ProcesoDefinicion> obtenerTodos() {
        return procesoRepository.findAll();
    }

    public List<ProcesoDefinicion> obtenerActivos() {
        return procesoRepository.findAll().stream()
                .filter(ProcesoDefinicion::isActivo)
                .collect(Collectors.toList());
    }

    /**
     * Publica una política en borrador.
     * - Valida integridad del flujo
     * - Asigna versión
     * - Marca versión anterior como OBSOLETA
     * - Registra en auditoría
     */
    public ProcesoDefinicion publicar(String procesoId, String usernameAdmin) {
        ProcesoDefinicion borrador = procesoRepository.findById(procesoId)
                .orElseThrow(() -> new RuntimeException("Política no encontrada"));

        if (borrador.getEstado() != EstadoProceso.BORRADOR) {
            throw new RuntimeException(
                    "Solo se pueden publicar políticas en estado BORRADOR. Estado actual: " + borrador.getEstado());
        }

        // 1. Validar integridad
        List<String> erroresValidacion = validarIntegridad(borrador);
        if (!erroresValidacion.isEmpty()) {
            throw new RuntimeException("Errores de integridad: " + String.join(" | ", erroresValidacion));
        }

        // 2. Determinar código base
        String codigoBase = borrador.getCodigoBase() != null
                ? borrador.getCodigoBase()
                : borrador.getCodigo();
        borrador.setCodigoBase(codigoBase);

        // 3. Buscar versión activa previa del mismo codigoBase
        Optional<ProcesoDefinicion> activaAnterior = procesoRepository
                .findByCodigoBaseAndEstado(codigoBase, EstadoProceso.ACTIVA);

        int nuevoNumeroVersion = 1;
        if (activaAnterior.isPresent()) {
            ProcesoDefinicion anterior = activaAnterior.get();
            anterior.setEstado(EstadoProceso.OBSOLETA);
            anterior.setMotivoObsolescencia("Reemplazada por versión nueva publicada el "
                    + LocalDateTime.now() + " por " + usernameAdmin);
            procesoRepository.save(anterior);

            nuevoNumeroVersion = (anterior.getNumeroVersion() != null ? anterior.getNumeroVersion() : 1) + 1;
        }

        // 4. Asignar versión y estado al borrador
        borrador.setEstado(EstadoProceso.ACTIVA);
        borrador.setNumeroVersion(nuevoNumeroVersion);
        borrador.setVersion("v" + nuevoNumeroVersion + ".0");
        borrador.setPublicadoPor(usernameAdmin);
        borrador.setFechaPublicacion(LocalDateTime.now());
        borrador.setActivo(true);

        ProcesoDefinicion publicado = procesoRepository.save(borrador);

        String detallePublicacion = "Publicada política '" + publicado.getNombre() + "' " + publicado.getVersion()
                + (activaAnterior.isPresent()
                        ? " (reemplaza a " + activaAnterior.get().getVersion() + " que pasó a OBSOLETA)"
                        : " (primera versión)");

        auditService.registrar(
                usernameAdmin,
                AuditService.CAT_POLITICA,
                "POLITICA_PUBLICADA",
                detallePublicacion,
                publicado.getId(), "PROCESO"
        );

        if (activaAnterior.isPresent()) {
            auditService.registrar(
                    usernameAdmin,
                    AuditService.CAT_POLITICA,
                    "POLITICA_OBSOLETA",
                    "Política '" + activaAnterior.get().getNombre() + "' " + activaAnterior.get().getVersion()
                            + " marcada OBSOLETA al publicarse v" + nuevoNumeroVersion,
                    activaAnterior.get().getId(), "PROCESO"
            );
        }

        return publicado;
    }

    /**
     * Crea una nueva versión en borrador basada en una política ya publicada.
     * Lanza "BORRADOR_EXISTENTE:{id}" si ya hay un BORRADOR en curso para el mismo codigoBase.
     */
    public ProcesoDefinicion crearNuevaVersion(String procesoOriginalId, String usernameAdmin) {
        ProcesoDefinicion original = procesoRepository.findById(procesoOriginalId)
                .orElseThrow(() -> new RuntimeException("Política original no encontrada"));

        // Solo se puede crear nueva versión a partir de una política ACTIVA u OBSOLETA
        if (original.getEstado() == EstadoProceso.BORRADOR) {
            throw new RuntimeException("La política ya es un BORRADOR. Edítala directamente.");
        }

        // Evitar BORRADOR duplicado para el mismo codigoBase
        String codigoBaseABuscar = original.getCodigoBase() != null ? original.getCodigoBase() : original.getCodigo();
        Optional<ProcesoDefinicion> borradorExistente = procesoRepository
                .findByCodigoBaseAndEstado(codigoBaseABuscar, EstadoProceso.BORRADOR);
        if (borradorExistente.isPresent()) {
            throw new RuntimeException("BORRADOR_EXISTENTE:" + borradorExistente.get().getId());
        }

        ProcesoDefinicion nueva = new ProcesoDefinicion();
        nueva.setCodigo(original.getCodigo());
        nueva.setCodigoBase(original.getCodigoBase() != null ? original.getCodigoBase() : original.getCodigo());
        nueva.setNombre(original.getNombre());
        nueva.setDescripcion(original.getDescripcion());
        nueva.setBpmnXml(original.getBpmnXml());
        nueva.setSvgPreview(original.getSvgPreview());
        nueva.setPasos(original.getPasos());
        nueva.setPasoInicialId(original.getPasoInicialId());
        nueva.setEstado(EstadoProceso.BORRADOR);
        nueva.setNumeroVersion(null);
        nueva.setActivo(false);
        nueva.setFechaCreacion(LocalDateTime.now());

        ProcesoDefinicion nuevaGuardada = procesoRepository.save(nueva);

        auditService.registrar(
                usernameAdmin,
                AuditService.CAT_POLITICA,
                "POLITICA_NUEVA_VERSION",
                "Nueva versión BORRADOR creada a partir de '" + original.getNombre()
                        + "' " + original.getVersion(),
                nuevaGuardada.getId(), "PROCESO"
        );

        return nuevaGuardada;
    }

    /**
     * Valida la integridad del flujo antes de publicar.
     */
    public List<String> validarIntegridad(ProcesoDefinicion proceso) {
        List<String> errores = new ArrayList<>();

        if (proceso.getPasos() == null || proceso.getPasos().isEmpty()) {
            errores.add("La política no tiene ningún paso definido");
            return errores;
        }

        if (proceso.getPasoInicialId() == null || proceso.getPasoInicialId().isBlank()) {
            errores.add("La política no tiene un paso inicial definido");
        }

        for (Paso p : proceso.getPasos()) {
            if (p.getTipo() == TipoPaso.TAREA) {
                String depto = p.getDepartamentoAsignadoId();
                if (depto == null || depto.isBlank()
                        || depto.equals("SIN_ASIGNAR")
                        || depto.startsWith("NO_EXISTE:")) {
                    errores.add("El paso '" + p.getNombre() + "' no tiene un departamento válido asignado");
                }
            }

            if (p.getTipo() == TipoPaso.TAREA
                    || p.getTipo() == TipoPaso.GATEWAY_EXCLUSIVO
                    || p.getTipo() == TipoPaso.GATEWAY_PARALELO_SPLIT) {
                if (p.getTransiciones() == null || p.getTransiciones().isEmpty()) {
                    errores.add("El paso '" + p.getNombre() + "' no tiene transiciones de salida (nodo huérfano)");
                }
            }

            if (p.getTipo() == TipoPaso.GATEWAY_EXCLUSIVO) {
                if (p.getTransiciones() == null || p.getTransiciones().size() < 2) {
                    errores.add("El gateway '" + p.getNombre() + "' debe tener al menos 2 salidas (actualmente tiene "
                            + (p.getTransiciones() == null ? 0 : p.getTransiciones().size()) + ")");
                }
                if (p.getTransiciones() != null) {
                    for (Transicion t : p.getTransiciones()) {
                        if ((t.getNombreAccion() == null || t.getNombreAccion().isBlank())
                                && (t.getEstadoCondicion() == null || t.getEstadoCondicion().isBlank()
                                        || "DEFAULT".equalsIgnoreCase(t.getEstadoCondicion()))) {
                            errores.add("El gateway '" + p.getNombre()
                                    + "' tiene una flecha sin nombre. Todas las salidas de un gateway de decisión deben tener un nombre (ej: APROBADO, RECHAZADO)");
                        }
                    }
                }
            }
        }

        Set<String> idsPasos = proceso.getPasos().stream()
                .map(Paso::getId)
                .collect(java.util.stream.Collectors.toSet());

        for (Paso p : proceso.getPasos()) {
            if (p.getTransiciones() != null) {
                for (Transicion t : p.getTransiciones()) {
                    String destino = t.getPasoDestinoId();
                    if (destino != null && !destino.equals("FIN") && !destino.equals("FIN_TERMINA_TODO")
                            && !idsPasos.contains(destino)) {
                        errores.add("El paso '" + p.getNombre()
                                + "' tiene una transición que apunta a un paso inexistente: " + destino);
                    }
                }
            }
        }

        return errores;
    }

    /**
     * Restaura una versión OBSOLETA creando un nuevo BORRADOR con su contenido.
     * Lanza "BORRADOR_EXISTENTE:{id}" si ya hay un BORRADOR en curso para el codigoBase.
     * El admin revisará y publicará el BORRADOR normalmente como vN+1.
     */
    public ProcesoDefinicion restaurarVersion(String procesoObsoletaId, String usernameAdmin) {
        ProcesoDefinicion obsoleta = procesoRepository.findById(procesoObsoletaId)
                .orElseThrow(() -> new RuntimeException("Versión no encontrada"));

        if (obsoleta.getEstado() != EstadoProceso.OBSOLETA) {
            throw new RuntimeException(
                    "Solo se pueden restaurar versiones en estado OBSOLETA. Estado actual: " + obsoleta.getEstado());
        }

        // Evitar BORRADOR duplicado para el mismo codigoBase
        String codigoBaseABuscar = obsoleta.getCodigoBase() != null ? obsoleta.getCodigoBase() : obsoleta.getCodigo();
        Optional<ProcesoDefinicion> borradorExistente = procesoRepository
                .findByCodigoBaseAndEstado(codigoBaseABuscar, EstadoProceso.BORRADOR);
        if (borradorExistente.isPresent()) {
            throw new RuntimeException("BORRADOR_EXISTENTE:" + borradorExistente.get().getId());
        }

        ProcesoDefinicion nueva = new ProcesoDefinicion();
        nueva.setCodigo(obsoleta.getCodigo());
        nueva.setCodigoBase(codigoBaseABuscar);
        nueva.setNombre(obsoleta.getNombre());
        nueva.setDescripcion(obsoleta.getDescripcion());
        nueva.setBpmnXml(obsoleta.getBpmnXml());
        nueva.setSvgPreview(obsoleta.getSvgPreview());
        nueva.setPasos(obsoleta.getPasos());
        nueva.setPasoInicialId(obsoleta.getPasoInicialId());
        nueva.setEstado(EstadoProceso.BORRADOR);
        nueva.setNumeroVersion(null);
        nueva.setActivo(false);
        nueva.setFechaCreacion(LocalDateTime.now());

        ProcesoDefinicion nuevaGuardada = procesoRepository.save(nueva);

        auditService.registrar(
                usernameAdmin,
                AuditService.CAT_POLITICA,
                "POLITICA_RESTAURADA",
                "Borrador de restauración creado desde '" + obsoleta.getNombre()
                        + "' " + obsoleta.getVersion() + " por " + usernameAdmin,
                nuevaGuardada.getId(), "PROCESO"
        );

        return nuevaGuardada;
    }

    public List<ProcesoDefinicion> obtenerHistorialVersiones(String codigoBase) {
        return procesoRepository.findByCodigoBaseOrderByNumeroVersionDesc(codigoBase);
    }

    public List<ProcesoDefinicion> obtenerPorEstado(EstadoProceso estado) {
        return procesoRepository.findByEstado(estado);
    }
}