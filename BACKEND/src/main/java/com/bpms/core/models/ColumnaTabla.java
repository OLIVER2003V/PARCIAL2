package com.bpms.core.models;

import java.util.ArrayList;
import java.util.List;

/**
 * Define una columna dentro de un campo de tipo "tabla".
 * Tipos soportados: "texto", "numero", "fecha", "select", "checkbox", "booleano"
 */
public class ColumnaTabla {
    private String id;
    private String etiqueta;
    private String tipo;
    private boolean requerido;
    private String placeholder;
    private String ancho; // "auto", "pequeno", "medio", "grande" — relativo al ancho total de la tabla

    // Solo aplica cuando tipo = "select"
    private List<OpcionCampo> opciones = new ArrayList<>();

    public ColumnaTabla() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getEtiqueta() { return etiqueta; }
    public void setEtiqueta(String etiqueta) { this.etiqueta = etiqueta; }

    public String getTipo() { return tipo; }
    public void setTipo(String tipo) { this.tipo = tipo; }

    public boolean isRequerido() { return requerido; }
    public void setRequerido(boolean requerido) { this.requerido = requerido; }

    public String getPlaceholder() { return placeholder; }
    public void setPlaceholder(String placeholder) { this.placeholder = placeholder; }

    public String getAncho() { return ancho; }
    public void setAncho(String ancho) { this.ancho = ancho; }

    public List<OpcionCampo> getOpciones() { return opciones; }
    public void setOpciones(List<OpcionCampo> opciones) { this.opciones = opciones; }
}