package com.bpms.core.dto.ia;

public class RequisitoCampo {
    private String etiqueta;
    private String tipo;
    private boolean requerido;

    public RequisitoCampo() {}

    public RequisitoCampo(String etiqueta, String tipo, boolean requerido) {
        this.etiqueta  = etiqueta;
        this.tipo      = tipo;
        this.requerido = requerido;
    }

    public String getEtiqueta()  { return etiqueta; }
    public void setEtiqueta(String e) { this.etiqueta = e; }

    public String getTipo()  { return tipo; }
    public void setTipo(String t) { this.tipo = t; }

    public boolean isRequerido()  { return requerido; }
    public void setRequerido(boolean r) { this.requerido = r; }
}
