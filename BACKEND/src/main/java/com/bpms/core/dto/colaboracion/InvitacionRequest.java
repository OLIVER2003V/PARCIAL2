package com.bpms.core.dto.colaboracion;

import java.util.List;

/**
 * 👇 NUEVO Colaboración: payload para invitar admins desde la lista interna.
 * Se manda vía REST POST /api/colaboracion/invitar.
 *
 * El backend genera un token JWT corto (24h) por cada invitado y le envía
 * una notificación in-app vía WS personal /user/queue/notificaciones.
 */
public class InvitacionRequest {
    private String procesoId;
    private List<String> usernamesInvitados;
    private String mensajeOpcional; // texto libre del que invita

    public InvitacionRequest() {}

    public String getProcesoId() { return procesoId; }
    public void setProcesoId(String procesoId) { this.procesoId = procesoId; }
    public List<String> getUsernamesInvitados() { return usernamesInvitados; }
    public void setUsernamesInvitados(List<String> usernamesInvitados) { this.usernamesInvitados = usernamesInvitados; }
    public String getMensajeOpcional() { return mensajeOpcional; }
    public void setMensajeOpcional(String mensajeOpcional) { this.mensajeOpcional = mensajeOpcional; }
}