package com.bpms.core.dto.colaboracion;

/**
 * 👇 NUEVO Colaboración: cambio en el diagrama. El emisor manda el XML
 * BPMN completo (es la estrategia pragmática para evitar problemas de
 * sincronización de comandos granulares en bpmn-js).
 *
 * El frontend aplica debounce de 500ms antes de enviar este evento
 * para no saturar el WebSocket durante drag.
 */
public class EventoXml {
    private String emisor;       // username de quien generó el cambio
    private String xml;          // XML BPMN completo serializado
    private long timestamp;      // para resolver conflictos last-write-wins

    public EventoXml() {}

    public String getEmisor() { return emisor; }
    public void setEmisor(String emisor) { this.emisor = emisor; }
    public String getXml() { return xml; }
    public void setXml(String xml) { this.xml = xml; }
    public long getTimestamp() { return timestamp; }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }
}