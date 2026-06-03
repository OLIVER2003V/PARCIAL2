package com.bpms.core.dto.colaboracion;

import java.util.Map;

public class EventoMetadatos {
    private String emisor;
    private long timestamp;
    private Map<String, Object> payload;

    // Getters y Setters
    public String getEmisor() { return emisor; }
    public void setEmisor(String emisor) { this.emisor = emisor; }
    public long getTimestamp() { return timestamp; }
    public void setTimestamp(long timestamp) { this.timestamp = timestamp; }
    public Map<String, Object> getPayload() { return payload; }
    public void setPayload(Map<String, Object> payload) { this.payload = payload; }
}