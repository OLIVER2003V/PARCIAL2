package com.bpms.core.models;

public class OpcionCampo {
    private String id;
    private String etiqueta;
    private String valor;

    public OpcionCampo() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getEtiqueta() { return etiqueta; }
    public void setEtiqueta(String etiqueta) { this.etiqueta = etiqueta; }

    public String getValor() { return valor; }
    public void setValor(String valor) { this.valor = valor; }
}