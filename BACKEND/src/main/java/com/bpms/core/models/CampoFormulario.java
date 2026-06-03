package com.bpms.core.models;

import java.util.ArrayList;
import java.util.List;

/**
 * Define un campo de formulario dentro de un Paso.
 * El admin lo configura al crear la política; el funcionario lo llena al atender el trámite.
 */
public class CampoFormulario {
    // === Propiedades básicas ===
    private String id;
    private String etiqueta;
    private String tipo;
    private boolean requerido;
    private String opciones;   // legacy, retrocompat

    // === Propiedades extendidas ===
    private String descripcion;        // texto de ayuda
    private String placeholder;
    private String ancho;              // "completo", "medio", "tercio"
    private String valorPorDefecto;

    // === Validación ===
    private Integer minLongitud;
    private Integer maxLongitud;
    private Double minValor;
    private Double maxValor;
    private String patronRegex;
    private String mensajeError;

    // === Opciones estructuradas ===
    private List<OpcionCampo> opcionesList = new ArrayList<>();

    // === Archivos ===
    private List<String> tiposArchivoPermitidos = new ArrayList<>();
    private Integer tamanoMaxMB;
    private boolean permiteMultiples;

    // === Calificación ===
    private Integer escalaMax;
    private String iconoCalificacion; // "estrella", "corazon", "numero"

    // === Tabla ===
    private List<ColumnaTabla> columnasTabla = new ArrayList<>();
    private Integer filasMinimas;
    private Integer filasMaximas;

    // === Grid de layout (sistema de 12 columnas) ===
    private Integer columnaSpan;    // 1–12: cuántas columnas CSS ocupa este campo
    private boolean columnaSalto;   // true = fuerza inicio en nueva fila del grid

    // === Decorativos ===
    private String contenidoTexto;

    public CampoFormulario() {}

    // Getters y setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getEtiqueta() { return etiqueta; }
    public void setEtiqueta(String etiqueta) { this.etiqueta = etiqueta; }

    public String getTipo() { return tipo; }
    public void setTipo(String tipo) { this.tipo = tipo; }

    public boolean isRequerido() { return requerido; }
    public void setRequerido(boolean requerido) { this.requerido = requerido; }

    public String getOpciones() { return opciones; }
    public void setOpciones(String opciones) { this.opciones = opciones; }

    public String getDescripcion() { return descripcion; }
    public void setDescripcion(String descripcion) { this.descripcion = descripcion; }

    public String getPlaceholder() { return placeholder; }
    public void setPlaceholder(String placeholder) { this.placeholder = placeholder; }

    public String getAncho() { return ancho; }
    public void setAncho(String ancho) { this.ancho = ancho; }

    public String getValorPorDefecto() { return valorPorDefecto; }
    public void setValorPorDefecto(String valorPorDefecto) { this.valorPorDefecto = valorPorDefecto; }

    public Integer getMinLongitud() { return minLongitud; }
    public void setMinLongitud(Integer minLongitud) { this.minLongitud = minLongitud; }

    public Integer getMaxLongitud() { return maxLongitud; }
    public void setMaxLongitud(Integer maxLongitud) { this.maxLongitud = maxLongitud; }

    public Double getMinValor() { return minValor; }
    public void setMinValor(Double minValor) { this.minValor = minValor; }

    public Double getMaxValor() { return maxValor; }
    public void setMaxValor(Double maxValor) { this.maxValor = maxValor; }

    public String getPatronRegex() { return patronRegex; }
    public void setPatronRegex(String patronRegex) { this.patronRegex = patronRegex; }

    public String getMensajeError() { return mensajeError; }
    public void setMensajeError(String mensajeError) { this.mensajeError = mensajeError; }

    public List<OpcionCampo> getOpcionesList() { return opcionesList; }
    public void setOpcionesList(List<OpcionCampo> opcionesList) { this.opcionesList = opcionesList; }

    public List<String> getTiposArchivoPermitidos() { return tiposArchivoPermitidos; }
    public void setTiposArchivoPermitidos(List<String> tiposArchivoPermitidos) { this.tiposArchivoPermitidos = tiposArchivoPermitidos; }

    public Integer getTamanoMaxMB() { return tamanoMaxMB; }
    public void setTamanoMaxMB(Integer tamanoMaxMB) { this.tamanoMaxMB = tamanoMaxMB; }

    public boolean isPermiteMultiples() { return permiteMultiples; }
    public void setPermiteMultiples(boolean permiteMultiples) { this.permiteMultiples = permiteMultiples; }

    public Integer getEscalaMax() { return escalaMax; }
    public void setEscalaMax(Integer escalaMax) { this.escalaMax = escalaMax; }

    public String getIconoCalificacion() { return iconoCalificacion; }
    public void setIconoCalificacion(String iconoCalificacion) { this.iconoCalificacion = iconoCalificacion; }

    public List<ColumnaTabla> getColumnasTabla() { return columnasTabla; }
    public void setColumnasTabla(List<ColumnaTabla> columnasTabla) { this.columnasTabla = columnasTabla; }

    public Integer getFilasMinimas() { return filasMinimas; }
    public void setFilasMinimas(Integer filasMinimas) { this.filasMinimas = filasMinimas; }

    public Integer getFilasMaximas() { return filasMaximas; }
    public void setFilasMaximas(Integer filasMaximas) { this.filasMaximas = filasMaximas; }

    public String getContenidoTexto() { return contenidoTexto; }
    public void setContenidoTexto(String contenidoTexto) { this.contenidoTexto = contenidoTexto; }

    public Integer getColumnaSpan() { return columnaSpan; }
    public void setColumnaSpan(Integer columnaSpan) { this.columnaSpan = columnaSpan; }

    public boolean isColumnaSalto() { return columnaSalto; }
    public void setColumnaSalto(boolean columnaSalto) { this.columnaSalto = columnaSalto; }
}