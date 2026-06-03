package com.bpms.core.dto.ia;

import java.util.List;

// 👇 NUEVO (Asistente IA Cliente): payload entrante del chatbot
public class ChatbotRequest {
    private String mensaje;
    private List<MensajeChat> historial;

    public static class MensajeChat {
        private String rol;        // "user" o "assistant"
        private String contenido;

        public String getRol() { return rol; }
        public void setRol(String rol) { this.rol = rol; }
        public String getContenido() { return contenido; }
        public void setContenido(String contenido) { this.contenido = contenido; }
    }

    public String getMensaje() { return mensaje; }
    public void setMensaje(String mensaje) { this.mensaje = mensaje; }
    public List<MensajeChat> getHistorial() { return historial; }
    public void setHistorial(List<MensajeChat> historial) { this.historial = historial; }
}