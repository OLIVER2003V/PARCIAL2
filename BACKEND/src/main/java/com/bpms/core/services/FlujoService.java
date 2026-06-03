package com.bpms.core.services;

import com.bpms.core.models.*;
import com.bpms.core.repositories.AuditLogRepository;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import com.bpms.core.repositories.TramiteRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class FlujoService {

    private static final int MAX_ITERACIONES = 10;

    @Autowired
    private TramiteRepository tramiteRepository;
    @Autowired
    private AuditLogRepository auditLogRepository;
    @Autowired
    private ProcesoDefinicionRepository procesoRepository;
    @Autowired
    private com.bpms.core.repositories.UsuarioRepository usuarioRepository;
    @Autowired
    private FirebasePushService pushService;

    @Autowired
    private com.bpms.core.services.AuditService auditService;
    @Autowired
    private DocumentoColaborativoService documentoColaborativoService;
    @Autowired
    private PrediccionAsyncService prediccionAsyncService;
    /**
     * Cuando un FUNCIONARIO o CLIENTE resuelve un paso, el motor deriva al
     * siguiente.
     */
    public Tramite procesarResolucion(String tramiteId, Tramite datosActualizados, String usernameActor) {
        Tramite tramite = tramiteRepository.findById(tramiteId)
                .orElseThrow(() -> new RuntimeException("El expediente no existe"));

        ProcesoDefinicion mapa = procesoRepository.findById(tramite.getProcesoDefinicionId())
                .orElseThrow(() -> new RuntimeException("La política asociada ya no existe."));

        // 👇 NUEVO: priorizar accionActor (string libre) sobre estadoSemaforo (enum)
        String accionActor = datosActualizados.getAccionActor();
        if (accionActor == null || accionActor.isBlank()) {
            // Fallback: si no viene accionActor, usar estadoSemaforo (retrocompat)
            accionActor = datosActualizados.getEstadoSemaforo() != null
                    ? datosActualizados.getEstadoSemaforo().name()
                    : "APROBADO";
        }

        // 👇 Guardar la acción libre en el tramite para que el gateway pueda leerla
        tramite.setAccionActor(accionActor);

        // Mapear accionActor a estadoSemaforo para compatibilidad (emerald/red/amber en
        // UI)
        EstadoTramite estadoDerivado = mapearAccionAEstado(accionActor);
        String pasoActualId = tramite.getPasoActualId();

        Paso pasoActual = buscarPaso(mapa, pasoActualId);
        if (pasoActual == null) {
            throw new RuntimeException("El paso actual no existe en el mapa");
        }

        // Marcar completado
        if (!tramite.getPasosCompletadosIds().contains(pasoActualId)) {
            tramite.getPasosCompletadosIds().add(pasoActualId);
        }
        tramite.getPasosActivosIds().remove(pasoActualId);

        // Calcular siguientes pasos según tipo de nodo
        List<String> siguientesIds = calcularSiguientesPasos(pasoActual, accionActor);

        List<String> mensajes = new ArrayList<>();
        for (String destinoId : siguientesIds) {
            procesarSiguientePaso(tramite, mapa, destinoId, mensajes);
        }

        // Actualizar datos básicos
        tramite.setEstadoSemaforo(estadoDerivado);
        tramite.setDescripcion(datosActualizados.getDescripcion());
        tramite.setFechaUltimaActualizacion(LocalDateTime.now());

        // Actualizar pasoActual, departamento y TIPO RESPONSABLE
        if (!tramite.getPasosActivosIds().isEmpty()) {
            String primerActivo = tramite.getPasosActivosIds().get(0);
            Paso pasoDestino = buscarPaso(mapa, primerActivo);

            tramite.setPasoActualId(primerActivo);
            tramite.setFechaInicioStepActual(LocalDateTime.now());
            if (pasoDestino != null) {
                tramite.setDepartamentoActualId(pasoDestino.getDepartamentoAsignadoId());

                // 👇 NUEVO: definir quién debe atender ahora
                tramite.setTipoResponsableActual(
                        pasoDestino.getTipoResponsable() != null
                                ? pasoDestino.getTipoResponsable()
                                : TipoResponsable.FUNCIONARIO);
            }
        } else {
            tramite.setPasoActualId("FIN");
            tramite.setDepartamentoActualId("ARCHIVADO");
            tramite.setTipoResponsableActual(null);
        }

        Tramite guardado = tramiteRepository.save(tramite);

        // CU24: predicción + notificación en hilo separado (no bloquea la respuesta)
        prediccionAsyncService.predecirYNotificar(guardado.getId());

        // Auditoría
        // Auditoría
        AuditLog log = new AuditLog();
        log.setTramiteId(guardado.getId());
        log.setUsuarioId(usernameActor);
        log.setDepartamentoId(pasoActual.getDepartamentoAsignadoId());
        log.setPasoId(pasoActual.getId());
        log.setPasoNombre(pasoActual.getNombre());
        log.setAccion(accionActor);
        log.setDetalle("Resolución emitida. " + String.join(" | ", mensajes));
        log.setFechaTimestamp(LocalDateTime.now());
        log.setDatosFormulario(datosActualizados.getDatosFormulario());
        // 👇 NUEVO CU16: categorizar + capturar IP
        log.setCategoria("TRAMITE");
        log.setIpOrigen(auditService.extraerIpDelRequestActual());
        auditLogRepository.save(log);

        // 👇 NUEVO: copias effectively-final para el lambda (accionActor fue reasignado
        // arriba)
        final String accionActorFinal = accionActor;
        final EstadoTramite estadoDerivadoFinal = estadoDerivado;
        final Paso pasoActualFinal = pasoActual;

        // 👇 SOLUCIÓN: Buscar por Username en lugar de ID
        try {
            // Cambiamos findById por findByUsername porque guardado.getClienteId() es el
            // username
            usuarioRepository.findByUsername(guardado.getClienteId()).ifPresent(cliente -> {
                if (cliente.getFcmToken() != null && !cliente.getFcmToken().isBlank()) {
                    String titulo = "Trámite " + guardado.getCodigoSeguimiento() + " Actualizado";
                    String cuerpo = "El paso '" + pasoActualFinal.getNombre() + "' fue resuelto como: "
                            + accionActorFinal;

                    if ("FIN".equals(guardado.getPasoActualId())) {
                        titulo = "Trámite " + guardado.getCodigoSeguimiento() + " Finalizado";
                        cuerpo = "Tu trámite ha concluido su ciclo con estado: " + estadoDerivadoFinal.name();
                    }

                    // Disparo a Firebase
                    pushService.enviarNotificacionPush(cliente.getFcmToken(), titulo, cuerpo);
                }
            });
        } catch (Exception e) {
            System.err.println("Error al intentar enviar push automático: " + e.getMessage());
        }
        return guardado;
    }

    private List<String> calcularSiguientesPasos(Paso pasoActual, String accion) {
        List<String> siguientes = new ArrayList<>();

        switch (pasoActual.getTipo()) {
            case TAREA:
            case EVENTO_INTERMEDIO:
                // 👇 Si la tarea tiene UNA sola transición → avanzar directamente
                // (La condición la evalúa el siguiente nodo si es un Gateway)
                if (pasoActual.getTransiciones().size() == 1) {
                    siguientes.add(pasoActual.getTransiciones().get(0).getPasoDestinoId());
                    break;
                }

                // Si tiene varias transiciones → buscar por estadoCondicion
                Transicion trans = pasoActual.getTransiciones().stream()
                        .filter(t -> t.getEstadoCondicion() != null
                                && t.getEstadoCondicion().equalsIgnoreCase(accion))
                        .findFirst()
                        .orElseGet(() -> pasoActual.getTransiciones().stream()
                                .filter(t -> "DEFAULT".equalsIgnoreCase(t.getEstadoCondicion()))
                                .findFirst()
                                .orElse(null));

                if (trans == null) {
                    throw new RuntimeException(
                            "No hay regla para la acción: " + accion + " en el paso " + pasoActual.getNombre());
                }
                siguientes.add(trans.getPasoDestinoId());
                break;

            case GATEWAY_EXCLUSIVO:
                // El gateway se resuelve en procesarSiguientePaso, no aquí
                // (pero por si acaso lo llaman directo, dejamos la primera transición)
                if (!pasoActual.getTransiciones().isEmpty()) {
                    siguientes.add(pasoActual.getTransiciones().get(0).getPasoDestinoId());
                }
                break;

            case GATEWAY_PARALELO_SPLIT:
                for (Transicion t : pasoActual.getTransiciones()) {
                    siguientes.add(t.getPasoDestinoId());
                }
                break;

            default:
                if (!pasoActual.getTransiciones().isEmpty()) {
                    siguientes.add(pasoActual.getTransiciones().get(0).getPasoDestinoId());
                }
        }
        return siguientes;
    }

    private void procesarSiguientePaso(Tramite tramite, ProcesoDefinicion mapa,
            String destinoId, List<String> mensajes) {
        if ("FIN".equals(destinoId)) {
            mensajes.add("Rama finalizada.");
            return;
        }
        if ("FIN_TERMINA_TODO".equals(destinoId)) {
            tramite.getPasosActivosIds().clear();
            mensajes.add("Proceso terminado forzadamente.");
            return;
        }

        Paso destino = buscarPaso(mapa, destinoId);
        if (destino == null) {
            mensajes.add("Paso destino no encontrado: " + destinoId);
            return;
        }

        switch (destino.getTipo()) {
            case GATEWAY_EXCLUSIVO:
                // 👇 NUEVO: Resolver el gateway XOR con la acción libre del trámite
                if (!destino.getTransiciones().isEmpty()) {
                    String accion = tramite.getAccionActor();
                    if (accion == null || accion.isBlank()) {
                        accion = tramite.getEstadoSemaforo() != null
                                ? tramite.getEstadoSemaforo().name()
                                : "APROBADO";
                    }
                    final String accionFinal = accion;

                    Transicion elegida = destino.getTransiciones().stream()
                            .filter(t -> (t.getNombreAccion() != null
                                    && t.getNombreAccion().equalsIgnoreCase(accionFinal))
                                    || (t.getEstadoCondicion() != null
                                            && t.getEstadoCondicion().equalsIgnoreCase(accionFinal)))
                            .findFirst()
                            .orElseGet(() -> destino.getTransiciones().stream()
                                    .filter(t -> "DEFAULT".equalsIgnoreCase(t.getEstadoCondicion())
                                            || "DEFAULT".equalsIgnoreCase(t.getNombreAccion()))
                                    .findFirst()
                                    .orElse(destino.getTransiciones().get(0)));

                    mensajes.add("Decisión del gateway: " + (elegida.getNombreAccion() != null
                            ? elegida.getNombreAccion()
                            : elegida.getEstadoCondicion()));
                    procesarSiguientePaso(tramite, mapa, elegida.getPasoDestinoId(), mensajes);
                }
                break;

            case GATEWAY_PARALELO_SPLIT:
                mensajes.add("Bifurcación paralela activada.");
                for (Transicion t : destino.getTransiciones()) {
                    procesarSiguientePaso(tramite, mapa, t.getPasoDestinoId(), mensajes);
                }
                break;

            case GATEWAY_PARALELO_JOIN:
                if (todasRamasCompletadas(destino, mapa, tramite)) {
                    mensajes.add("Sincronización de ramas completada.");
                    if (!destino.getTransiciones().isEmpty()) {
                        procesarSiguientePaso(tramite, mapa,
                                destino.getTransiciones().get(0).getPasoDestinoId(), mensajes);
                    }
                } else {
                    mensajes.add("Esperando que terminen otras ramas paralelas.");
                }
                break;

            case TAREA:
            case EVENTO_INTERMEDIO:
                // Verificar iteración (bucles)
                if (destino.isPermiteReejecucion()) {
                    int iteraciones = tramite.getContadorIteraciones().getOrDefault(destinoId, 0);
                    if (iteraciones >= MAX_ITERACIONES) {
                        mensajes.add("⚠️ Límite de iteraciones alcanzado en: " + destino.getNombre());
                        return;
                    }
                    tramite.getContadorIteraciones().put(destinoId, iteraciones + 1);
                    tramite.getPasosCompletadosIds().remove(destinoId);
                }

                // Activar el paso
                if (!tramite.getPasosActivosIds().contains(destinoId)) {
                    tramite.getPasosActivosIds().add(destinoId);
                }

                TipoResponsable resp = destino.getTipoResponsable() != null
                        ? destino.getTipoResponsable()
                        : TipoResponsable.FUNCIONARIO;

                switch (resp) {
                    case SOLICITUD_CLIENTE:
                        mensajes.add("🔔 Se solicitó información adicional al cliente: " + destino.getNombre());
                        break;
                    case FUNCIONARIO:
                        mensajes.add("Derivado al funcionario: " + destino.getNombre());
                        break;
                    default:
                        mensajes.add("Derivado a: " + destino.getNombre());
                }
                break;

            default:
                if (!destino.getTransiciones().isEmpty()) {
                    procesarSiguientePaso(tramite, mapa,
                            destino.getTransiciones().get(0).getPasoDestinoId(), mensajes);
                }
        }
    }

    private boolean todasRamasCompletadas(Paso gatewayJoin, ProcesoDefinicion mapa, Tramite tramite) {
        List<String> predecesores = new ArrayList<>();
        for (Paso p : mapa.getPasos()) {
            for (Transicion t : p.getTransiciones()) {
                if (t.getPasoDestinoId().equals(gatewayJoin.getId())) {
                    predecesores.add(p.getId());
                }
            }
        }
        return predecesores.stream().allMatch(id -> tramite.getPasosCompletadosIds().contains(id));
    }

    private Paso buscarPaso(ProcesoDefinicion mapa, String id) {
        return mapa.getPasos().stream()
                .filter(p -> p.getId().equals(id))
                .findFirst()
                .orElse(null);
    }

    public List<AuditLog> obtenerHistorialTramite(String tramiteId) {
        return auditLogRepository.findByTramiteIdOrderByFechaTimestampAsc(tramiteId);
    }

    /**
     * Cuando el CLIENTE inicia un trámite.
     * Si la política tiene un paso INICIO_CLIENTE, el cliente YA lo llenó (viene en
     * request).
     * El motor salta ese paso y activa el SIGUIENTE.
     */
    public Tramite iniciarTramiteCliente(NuevoTramiteRequest request) {
        ProcesoDefinicion mapa = procesoRepository.findFirstByCodigo(request.getCodigoProceso())
                .orElseThrow(() -> new RuntimeException("El servicio solicitado no está disponible."));

        if (!mapa.isActivo()) {
            throw new RuntimeException("Este servicio está temporalmente inactivo.");
        }

        String pasoInicialId = mapa.getPasoInicialId();
        if (pasoInicialId == null || pasoInicialId.isBlank()) {
            throw new RuntimeException("La política '" + mapa.getNombre() + "' no tiene paso inicial definido.");
        }

        Paso pasoInicial = buscarPaso(mapa, pasoInicialId);
        if (pasoInicial == null) {
            throw new RuntimeException("El paso inicial no existe.");
        }

        Tramite tramite = new Tramite();
        int numero = (int) (Math.random() * 9000) + 1000;
        tramite.setCodigoSeguimiento("TRM-" + LocalDateTime.now().getYear() + "-" + numero);
        tramite.setClienteId(request.getClienteId());
        tramite.setDescripcion(request.getDescripcion());
        tramite.setNombreProceso(mapa.getNombre());
        tramite.setProcesoDefinicionId(mapa.getId());
        tramite.setEstadoSemaforo(EstadoTramite.EN_REVISION);
        tramite.setFechaCreacion(LocalDateTime.now());
        tramite.setFechaUltimaActualizacion(LocalDateTime.now());

        tramite.setPasosActivosIds(new ArrayList<>());
        tramite.setPasosCompletadosIds(new ArrayList<>());
        tramite.setContadorIteraciones(new HashMap<>());

        TipoResponsable respInicial = pasoInicial.getTipoResponsable() != null
                ? pasoInicial.getTipoResponsable()
                : TipoResponsable.FUNCIONARIO;

        List<String> mensajes = new ArrayList<>();

        // 👇 CASO 1: El primer paso es "INICIO_CLIENTE"
        // → El cliente ya llenó el formulario al crear el trámite (viene en
        // request.datosFormularioInicial)
        // → Marcamos el paso como completado y avanzamos al siguiente
        if (respInicial == TipoResponsable.INICIO_CLIENTE) {
            tramite.getPasosCompletadosIds().add(pasoInicial.getId());

            // Guardar los datos que llenó el cliente
            if (request.getDatosFormularioInicial() != null) {
                tramite.setDatosFormularioInicial(request.getDatosFormularioInicial());
            }

            // Buscar el siguiente paso
            if (!pasoInicial.getTransiciones().isEmpty()) {
                String siguienteId = pasoInicial.getTransiciones().get(0).getPasoDestinoId();
                procesarSiguientePaso(tramite, mapa, siguienteId, mensajes);
            } else {
                mensajes.add("Proceso finalizado tras inicio del cliente.");
            }
        }
        // 👇 CASO 2: El primer paso es FUNCIONARIO (flujo tradicional)
        else {
            tramite.getPasosActivosIds().add(pasoInicial.getId());
            mensajes.add("Asignado a: " + pasoInicial.getNombre());
        }

        // Definir estado final del trámite
        if (!tramite.getPasosActivosIds().isEmpty()) {
            String primerActivo = tramite.getPasosActivosIds().get(0);
            Paso pasoDestino = buscarPaso(mapa, primerActivo);
            tramite.setPasoActualId(primerActivo);
            tramite.setFechaInicioStepActual(LocalDateTime.now());
            if (pasoDestino != null) {
                tramite.setDepartamentoActualId(pasoDestino.getDepartamentoAsignadoId());
                tramite.setTipoResponsableActual(
                        pasoDestino.getTipoResponsable() != null
                                ? pasoDestino.getTipoResponsable()
                                : TipoResponsable.FUNCIONARIO);
            }
        } else {
            tramite.setPasoActualId("FIN");
            tramite.setDepartamentoActualId("ARCHIVADO");
        }

        Tramite guardado = tramiteRepository.save(tramite);

        // Auditoría
        // Auditoría
        int archivosVinculados = documentoColaborativoService.vincularArchivosFormularioInicial(
                guardado.getId(),
                guardado.getDatosFormularioInicial(),
                request.getClienteId(),
                pasoInicial.getNombre(),
                "CLIENTE");

        AuditLog log = new AuditLog();
        log.setTramiteId(guardado.getId());
        log.setUsuarioId(request.getClienteId());
        log.setDepartamentoId("PORTAL_WEB");
        log.setPasoId(pasoInicial.getId());
        log.setPasoNombre(pasoInicial.getNombre());
        log.setAccion("INICIADO");
        log.setDetalle("El cliente inició la solicitud '" + mapa.getNombre() + "'. " + String.join(" | ", mensajes));
        log.setFechaTimestamp(LocalDateTime.now());
        if (request.getDatosFormularioInicial() != null) {
            log.setDatosFormulario(request.getDatosFormularioInicial());
        }
        // 👇 NUEVO CU16: categorizar + capturar IP
        log.setCategoria("TRAMITE");
        log.setIpOrigen(auditService.extraerIpDelRequestActual());
        auditLogRepository.save(log);

        if (archivosVinculados > 0) {
            auditService.registrar(
                    request.getClienteId(),
                    AuditService.CAT_TRAMITE,
                    "ARCHIVOS_FORMULARIO_VINCULADOS",
                    archivosVinculados + " archivo(s) del formulario inicial vinculados al expediente",
                    guardado.getId(),
                    "TRAMITE");
        }

        return guardado;
    }

    // =========================================================================
    //  CU24 — Predicción ML
    // =========================================================================


    /**
     * Convierte una acción libre (APROBADO, RECHAZADO, SI, NO, BUENO, etc.)
     * a un EstadoTramite para el semáforo visual.
     */
    private EstadoTramite mapearAccionAEstado(String accion) {
        if (accion == null)
            return EstadoTramite.EN_REVISION;
        String upper = accion.toUpperCase();
        // Acciones positivas
        if (upper.equals("APROBADO") || upper.equals("APROBAR") || upper.equals("SI") ||
                upper.equals("BUENO") || upper.equals("ACEPTADO") || upper.equals("CORRECTO") ||
                upper.equals("VALIDO") || upper.equals("APTO")) {
            return EstadoTramite.APROBADO;
        }
        // Acciones negativas
        if (upper.equals("RECHAZADO") || upper.equals("RECHAZAR") || upper.equals("NO") ||
                upper.equals("MALO") || upper.equals("DENEGADO") || upper.equals("INCORRECTO") ||
                upper.equals("INVALIDO") || upper.equals("NO_APTO")) {
            return EstadoTramite.RECHAZADO;
        }
        // Todo lo demás → "en revisión" (devolver/corregir/subsanar/etc.)
        return EstadoTramite.EN_REVISION;
    }
}
