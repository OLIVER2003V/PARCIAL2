package com.bpms.core.dto.colaboracion;

/**
 * 👇 NUEVO Colaboración: posición del cursor de un usuario en el canvas.
 * Coordenadas en el espacio del MODELO bpmn-js (no de la pantalla),
 * para que se vean correctamente aunque cada uno tenga zoom distinto.
 *
 * Frontend hace throttle de 50ms antes de emitir.
 */
public class EventoCursor {
    private String emisor;
    private double x;
    private double y;
    private long timestamp;

    public EventoCursor() {}

    public String getEmisor() { return emisor; }
    public void setEmisor(String emisor) { this.emisor = emisor; }
    public double getX() { return x; }
    public void setX(double x) { this.x = x; }
    public double getY() { return y; }
    public void setY(double y) { this.y = y; }
    public long getTimestamp() { return timestamp; }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }
}