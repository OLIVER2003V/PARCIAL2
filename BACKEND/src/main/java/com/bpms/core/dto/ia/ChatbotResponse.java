package com.bpms.core.dto.ia;

import java.util.List;

public class ChatbotResponse {
    private String respuesta;
    private List<String> sugerenciasRapidas;
    private String advertencia;
    // Rellenos por el backend cuando Gemini detecta intención clara de iniciar un trámite
    private String accion;
    private String procesoId;
    private String procesoNombre;
    // Campos del formulario inicial (solo cuando accion == MOSTRAR_REQUISITOS)
    private List<RequisitoCampo> requisitos;

    public String getRespuesta() { return respuesta; }
    public void setRespuesta(String r) { this.respuesta = r; }
    public List<String> getSugerenciasRapidas() { return sugerenciasRapidas; }
    public void setSugerenciasRapidas(List<String> s) { this.sugerenciasRapidas = s; }
    public String getAdvertencia() { return advertencia; }
    public void setAdvertencia(String a) { this.advertencia = a; }
    public String getAccion() { return accion; }
    public void setAccion(String a) { this.accion = a; }
    public String getProcesoId() { return procesoId; }
    public void setProcesoId(String p) { this.procesoId = p; }
    public String getProcesoNombre() { return procesoNombre; }
    public void setProcesoNombre(String p) { this.procesoNombre = p; }
    public List<RequisitoCampo> getRequisitos() { return requisitos; }
    public void setRequisitos(List<RequisitoCampo> r) { this.requisitos = r; }
}
