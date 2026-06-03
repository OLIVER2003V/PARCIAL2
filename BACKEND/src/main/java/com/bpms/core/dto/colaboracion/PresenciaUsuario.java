package com.bpms.core.dto.colaboracion;

/**
 * 👇 NUEVO Colaboración: representa a un usuario presente en la sala.
 * Se broadcasts cada vez que alguien entra/sale para que todos vean
 * la lista actualizada de avatares en la toolbar.
 */
public class PresenciaUsuario {
    private String username;
    private String nombreCompleto;
    private String color;       // color asignado deterministamente para cursor + avatar
    private String iniciales;   // ej: "OV" para Oliver Ventura
    private long conectadoEn;   // timestamp de cuando entró a la sala

    public PresenciaUsuario() {}

    public PresenciaUsuario(String username, String nombreCompleto, String color, String iniciales) {
        this.username = username;
        this.nombreCompleto = nombreCompleto;
        this.color = color;
        this.iniciales = iniciales;
        this.conectadoEn = System.currentTimeMillis();
    }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }
    public String getNombreCompleto() { return nombreCompleto; }
    public void setNombreCompleto(String nombreCompleto) { this.nombreCompleto = nombreCompleto; }
    public String getColor() { return color; }
    public void setColor(String color) { this.color = color; }
    public String getIniciales() { return iniciales; }
    public void setIniciales(String iniciales) { this.iniciales = iniciales; }
    public long getConectadoEn() { return conectadoEn; }
    public void setConectadoEn(long conectadoEn) { this.conectadoEn = conectadoEn; }
}