package com.bpms.core.services;

import com.bpms.core.models.ProcesoDefinicion;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PreDestroy;

/**
 * 👇 NUEVO Colaboración: auto-guardado del borrador colaborativo en MongoDB.
 *
 * Estrategia anti-saturación:
 *  - El frontend manda cambios cada ~500ms (debounce ya hecho del lado cliente)
 *  - Pero NO queremos hacer write en Mongo cada 500ms
 *  - Solución: server-side debounce de 3s. Cada vez que llega un cambio,
 *    cancelo el guardado pendiente (si lo había) y agendo uno nuevo a 3s.
 *  - Resultado: si A está editando como loco, Mongo solo recibe writes
 *    cada 3s aproximadamente.
 *
 * Concurrencia:
 *  - Un Map<procesoId, ScheduledFuture> guarda los timers pendientes
 *  - Un Map<procesoId, EstadoPendiente> guarda el último XML a persistir
 *  - Todo en ConcurrentHashMap → thread-safe
 */
@Service
public class BorradorService {

    @Autowired
    private ProcesoDefinicionRepository procesoRepository;

    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(2);
    private static final long DEBOUNCE_SECONDS = 3;

    private final Map<String, ScheduledFuture<?>> tareasAgendadas = new ConcurrentHashMap<>();
    private final Map<String, EstadoPendiente> estadosPendientes = new ConcurrentHashMap<>();

    /**
     * Agenda un guardado del borrador con debounce de 3s.
     * Si llega otro cambio antes de los 3s, se cancela el anterior y se reinicia.
     */
    public void agendarGuardado(String procesoId, String xml, String username) {
        // Actualizamos el estado pendiente (siempre se guarda el más reciente)
        estadosPendientes.put(procesoId, new EstadoPendiente(xml, username));

        // Cancelar guardado previo si lo había
        ScheduledFuture<?> previo = tareasAgendadas.get(procesoId);
        if (previo != null && !previo.isDone()) {
            previo.cancel(false);
        }

        // Agendar nuevo guardado a 3s
        ScheduledFuture<?> nueva = scheduler.schedule(
                () -> ejecutarGuardado(procesoId),
                DEBOUNCE_SECONDS,
                TimeUnit.SECONDS
        );
        tareasAgendadas.put(procesoId, nueva);
    }

    /**
     * Ejecuta el guardado real en MongoDB.
     */
    private void ejecutarGuardado(String procesoId) {
        EstadoPendiente estado = estadosPendientes.remove(procesoId);
        tareasAgendadas.remove(procesoId);
        if (estado == null) return;

        try {
            Optional<ProcesoDefinicion> opt = procesoRepository.findById(procesoId);
            if (opt.isEmpty()) {
                System.err.println("⚠️ [Borrador] proceso " + procesoId + " no existe, abortando guardado");
                return;
            }

            ProcesoDefinicion proceso = opt.get();
            proceso.setBorradorXml(estado.xml);
            proceso.setFechaUltimoBorrador(LocalDateTime.now());
            proceso.setBorradorPor(estado.username);
            procesoRepository.save(proceso);

            System.out.println("💾 [Borrador] guardado proceso=" + procesoId
                    + " por=" + estado.username
                    + " (" + estado.xml.length() + " chars)");
        } catch (Exception e) {
            System.err.println("❌ [Borrador] error guardando " + procesoId + ": " + e.getMessage());
        }
    }

    /**
     * Limpia el borrador de un proceso (se llama cuando el admin guarda
     * la política definitivamente y promueve el borrador a XML oficial).
     */
    public void limpiarBorrador(String procesoId) {
        // Cancelar cualquier guardado pendiente
        ScheduledFuture<?> pendiente = tareasAgendadas.remove(procesoId);
        if (pendiente != null) pendiente.cancel(false);
        estadosPendientes.remove(procesoId);

        // Limpiar en BD
        try {
            Optional<ProcesoDefinicion> opt = procesoRepository.findById(procesoId);
            if (opt.isPresent()) {
                ProcesoDefinicion proceso = opt.get();
                proceso.setBorradorXml(null);
                proceso.setFechaUltimoBorrador(null);
                proceso.setBorradorPor(null);
                procesoRepository.save(proceso);
                System.out.println("🧹 [Borrador] limpiado proceso=" + procesoId);
            }
        } catch (Exception e) {
            System.err.println("❌ [Borrador] error limpiando " + procesoId + ": " + e.getMessage());
        }
    }

    /**
     * Obtiene el borrador actual si existe y es más reciente que el XML oficial.
     * Devuelve null si no hay borrador relevante.
     */
    public ProcesoDefinicion obtenerProcesoConBorrador(String procesoId) {
        return procesoRepository.findById(procesoId).orElse(null);
    }

    /**
     * Forzar guardado inmediato (por ejemplo cuando el último usuario sale de la sala).
     */
    public void forzarGuardadoInmediato(String procesoId) {
        ScheduledFuture<?> pendiente = tareasAgendadas.get(procesoId);
        if (pendiente != null && !pendiente.isDone()) {
            pendiente.cancel(false);
            tareasAgendadas.remove(procesoId);
            ejecutarGuardado(procesoId);
        }
    }

    @PreDestroy
    public void shutdown() {
        // Al apagar la app, intentamos persistir lo pendiente
        for (String procesoId : new java.util.ArrayList<>(estadosPendientes.keySet())) {
            try { ejecutarGuardado(procesoId); } catch (Exception ignored) {}
        }
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(2, TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
        }
    }

    /**
     * Estado interno de un guardado pendiente.
     */
    private static class EstadoPendiente {
        final String xml;
        final String username;

        EstadoPendiente(String xml, String username) {
            this.xml = xml;
            this.username = username;
        }
    }
}