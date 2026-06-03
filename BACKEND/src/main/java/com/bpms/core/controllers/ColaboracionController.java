package com.bpms.core.controllers;

import com.bpms.core.dto.colaboracion.EstadoSesion;
import com.bpms.core.dto.colaboracion.EventoCursor;
import com.bpms.core.dto.colaboracion.EventoMetadatos;
import com.bpms.core.dto.colaboracion.EventoXml;
import com.bpms.core.dto.colaboracion.PresenciaUsuario;
import com.bpms.core.services.AuditService;
import com.bpms.core.services.BorradorService;
import com.bpms.core.services.SesionColaborativaService;
import com.bpms.core.models.ProcesoDefinicion;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.annotation.SendToUser;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;

import java.security.Principal;
import java.time.ZoneId;
import java.util.List;

/**
 * 👇 NUEVO Colaboración: handler central de mensajes WebSocket.
 *
 * Rutas:
 *   /app/sesion/{procesoId}/unirse        → cliente entra a sala
 *   /app/sesion/{procesoId}/salir         → cliente sale de sala
 *   /app/sesion/{procesoId}/cambio-xml    → broadcast del XML editado
 *   /app/sesion/{procesoId}/cursor        → broadcast del cursor
 *
 * Broadcasts:
 *   /topic/sesion/{procesoId}/presencia   → lista de conectados
 *   /topic/sesion/{procesoId}/cambio-xml  → cambio del diagrama
 *   /topic/sesion/{procesoId}/cursor      → cursor remoto
 *
 * Personal (solo al usuario que se conectó):
 *   /user/queue/sesion/{procesoId}/estado → snapshot inicial al entrar
 */
@Controller
public class ColaboracionController {

    @Autowired
    private SesionColaborativaService sesionService;

    @Autowired
    private BorradorService borradorService;

    @Autowired
    private AuditService auditService;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    /**
     * Cliente entra a una sala.
     * El frontend manda esto justo después del CONNECT, una vez ya está suscrito
     * al topic, así no se pierde el broadcast de presencia.
     */
    @MessageMapping("/sesion/{procesoId}/unirse")
    public void unirse(@DestinationVariable String procesoId, Principal principal) {
        if (principal == null) {
            System.err.println("⚠️ [Colaboración] unirse() sin Principal — token inválido");
            return;
        }
        String username = principal.getName();

        // 1. Agregar a la sala en memoria
        List<PresenciaUsuario> conectados = sesionService.unirAUsuario(procesoId, username);

        // 2. Broadcast: todos en la sala reciben la lista actualizada
        messagingTemplate.convertAndSend(
                "/topic/sesion/" + procesoId + "/presencia",
                conectados
        );

        // 3. Personal: al recién entrado le mandamos el estado inicial completo
        //    (lista de conectados + último borrador conocido si existe)
        EstadoSesion estado = construirEstadoInicial(procesoId, conectados);
        messagingTemplate.convertAndSendToUser(
                username,
                "/queue/sesion/" + procesoId + "/estado",
                estado
        );

        // 4. Auditar (CU16)
        try {
            auditService.registrar(
                    username,
                    AuditService.CAT_POLITICA,
                    "COLABORACION_INICIADA",
                    "Usuario se unió a sala colaborativa del proceso " + procesoId
            );
        } catch (Exception ignored) { /* no romper el flujo */ }
    }

    /**
     * Cliente sale de la sala (cierra pestaña, se desconecta, etc.).
     * También se llama en SessionDisconnectEvent si se detecta caída de conexión.
     */
    @MessageMapping("/sesion/{procesoId}/salir")
    public void salir(@DestinationVariable String procesoId, Principal principal) {
        if (principal == null) return;
        String username = principal.getName();

        boolean salaVacia = sesionService.removerUsuario(procesoId, username);

        // Broadcast actualizado
        List<PresenciaUsuario> conectados = sesionService.obtenerConectados(procesoId);
        messagingTemplate.convertAndSend(
                "/topic/sesion/" + procesoId + "/presencia",
                conectados
        );

        // Si el último usuario salió, forzamos el guardado inmediato del borrador
        if (salaVacia) {
            borradorService.forzarGuardadoInmediato(procesoId);
            System.out.println("🚪 [Colaboración] sala " + procesoId + " quedó vacía");
        }
    }

    /**
     * Cambio en el diagrama: el emisor manda el XML completo, lo broadcasteamos
     * a todos los demás conectados (no al emisor — bpmn-js ya tiene su propio estado).
     *
     * También agendamos auto-guardado en BD vía BorradorService.
     */
    @MessageMapping("/sesion/{procesoId}/cambio-xml")
    public void cambioXml(
            @DestinationVariable String procesoId,
            @Payload EventoXml evento,
            Principal principal) {

        if (principal == null) return;
        String username = principal.getName();

        // Asegurar que el emisor que llega coincide con el principal autenticado
        // (evita que alguien suplante a otro en el campo emisor)
        evento.setEmisor(username);
        evento.setTimestamp(System.currentTimeMillis());

        // Broadcast a la sala
        messagingTemplate.convertAndSend(
                "/topic/sesion/" + procesoId + "/cambio-xml",
                evento
        );

        // Auto-guardado debounced
        if (evento.getXml() != null && !evento.getXml().isBlank()) {
            borradorService.agendarGuardado(procesoId, evento.getXml(), username);
        }
    }

    /**
     * Cursor remoto: throttle alto (~50ms del lado cliente).
     * No auditamos esto, sería ruido absurdo en los logs.
     */
    @MessageMapping("/sesion/{procesoId}/cursor")
    public void cursor(
            @DestinationVariable String procesoId,
            @Payload EventoCursor evento,
            Principal principal) {

        if (principal == null) return;
        evento.setEmisor(principal.getName());
        evento.setTimestamp(System.currentTimeMillis());

        messagingTemplate.convertAndSend(
                "/topic/sesion/" + procesoId + "/cursor",
                evento
        );
    }

    /**
     * Sincronización en tiempo real de los formularios dinámicos y metadata.
     */
    @MessageMapping("/sesion/{procesoId}/cambio-metadatos")
    public void cambioMetadatos(
            @DestinationVariable String procesoId,
            @Payload EventoMetadatos evento,
            Principal principal) {

        if (principal == null) return;
        evento.setEmisor(principal.getName());
        evento.setTimestamp(System.currentTimeMillis());

        messagingTemplate.convertAndSend(
                "/topic/sesion/" + procesoId + "/cambio-metadatos",
                evento
        );
    }

    /**
     * Construye el snapshot inicial que se manda al usuario que recién entra.
     */
    private EstadoSesion construirEstadoInicial(String procesoId, List<PresenciaUsuario> conectados) {
        EstadoSesion estado = new EstadoSesion();
        estado.setProcesoId(procesoId);
        estado.setConectados(conectados);

        // Cargar borrador desde BD si existe
        ProcesoDefinicion proceso = borradorService.obtenerProcesoConBorrador(procesoId);
        if (proceso != null) {
            if (proceso.getBorradorXml() != null && !proceso.getBorradorXml().isBlank()) {
                estado.setBorradorXml(proceso.getBorradorXml());
            } else if (proceso.getBpmnXml() != null) {
                // Si no hay borrador, usamos el XML oficial como punto de partida
                estado.setBorradorXml(proceso.getBpmnXml());
            }

            if (proceso.getFechaUltimoBorrador() != null) {
                long epoch = proceso.getFechaUltimoBorrador()
                        .atZone(ZoneId.systemDefault())
                        .toInstant()
                        .toEpochMilli();
                estado.setFechaUltimoBorrador(epoch);
            }
        }

        return estado;
    }
}