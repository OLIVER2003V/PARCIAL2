package com.bpms.core.dto.colaboracion;

import java.util.List;

/**
 * 👇 NUEVO Colaboración: snapshot del estado actual de una sala.
 * Se manda al usuario que recién se conecta, para que reciba la lista
 * de quienes ya estaban dentro y el último XML del borrador (si existe).
 */
public class EstadoSesion {
    private String procesoId;
    private List<PresenciaUsuario> conectados;
    private String borradorXml;          // último XML conocido (puede ser null)
    private Long fechaUltimoBorrador;    // ms epoch, null si no hay borrador

    public EstadoSesion() {}

    public String getProcesoId() { return procesoId; }
    public void setProcesoId(String procesoId) { this.procesoId = procesoId; }
    public List<PresenciaUsuario> getConectados() { return conectados; }
    public void setConectados(List<PresenciaUsuario> conectados) { this.conectados = conectados; }
    public String getBorradorXml() { return borradorXml; }
    public void setBorradorXml(String borradorXml) { this.borradorXml = borradorXml; }
    public Long getFechaUltimoBorrador() { return fechaUltimoBorrador; }
    public void setFechaUltimoBorrador(Long fechaUltimoBorrador) { this.fechaUltimoBorrador = fechaUltimoBorrador; }
}