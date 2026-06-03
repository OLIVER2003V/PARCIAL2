package com.bpms.core.models;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Document(collection = "procesos_definicion")
public class ProcesoDefinicion {

    @Id
    private String id;

    private String codigo;
    private String nombre;
    private String descripcion;

    private boolean activo = true;
    private LocalDateTime fechaCreacion = LocalDateTime.now();
    private LocalDateTime fechaUltimaActualizacion = LocalDateTime.now();

    private String pasoInicialId;
    private List<Paso> pasos = new ArrayList<>();

    // 👇 NUEVOS — para guardar el diagrama visual
    private String bpmnXml;
    private String svgPreview;

    // 👇 NUEVOS: sistema de versionamiento
    private EstadoProceso estado = EstadoProceso.BORRADOR;
    private String version; // "v1.0", "v2.0", etc.
    private String codigoBase; // agrupa versiones del mismo proceso (ej: "TEST1")
    private String publicadoPor; // username del admin que publicó
    private LocalDateTime fechaPublicacion;
    private String motivoObsolescencia; // por qué se marcó como obsoleta
    private Integer numeroVersion = 0; // para ordenar (1, 2, 3, ...)

    // 👇 NUEVO Colaboración: borrador compartido en tiempo real.
    // Se actualiza por auto-guardado mientras hay sesión colaborativa activa.
    // Al guardar la política definitivamente, este campo se limpia.
    private String borradorXml;
    private LocalDateTime fechaUltimoBorrador;
    private String borradorPor; // username del último que tocó el borrador

    public ProcesoDefinicion() {
    }

    // Getters y Setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getCodigo() {
        return codigo;
    }

    public void setCodigo(String codigo) {
        this.codigo = codigo;
    }

    public String getNombre() {
        return nombre;
    }

    public void setNombre(String nombre) {
        this.nombre = nombre;
    }

    public String getDescripcion() {
        return descripcion;
    }

    public void setDescripcion(String descripcion) {
        this.descripcion = descripcion;
    }

    public boolean isActivo() {
        return activo;
    }

    public void setActivo(boolean activo) {
        this.activo = activo;
    }

    public LocalDateTime getFechaCreacion() {
        return fechaCreacion;
    }

    public void setFechaCreacion(LocalDateTime fechaCreacion) {
        this.fechaCreacion = fechaCreacion;
    }

    public LocalDateTime getFechaUltimaActualizacion() {
        return fechaUltimaActualizacion;
    }

    public void setFechaUltimaActualizacion(LocalDateTime f) {
        this.fechaUltimaActualizacion = f;
    }

    public String getPasoInicialId() {
        return pasoInicialId;
    }

    public void setPasoInicialId(String pasoInicialId) {
        this.pasoInicialId = pasoInicialId;
    }

    public List<Paso> getPasos() {
        return pasos;
    }

    public void setPasos(List<Paso> pasos) {
        this.pasos = pasos;
    }

    public String getBpmnXml() {
        return bpmnXml;
    }

    public void setBpmnXml(String bpmnXml) {
        this.bpmnXml = bpmnXml;
    }

    public String getSvgPreview() {
        return svgPreview;
    }

    public void setSvgPreview(String svgPreview) {
        this.svgPreview = svgPreview;
    }

    // Getters/setters
    public EstadoProceso getEstado() {
        return estado;
    }

    public void setEstado(EstadoProceso e) {
        this.estado = e;
    }

    public String getVersion() {
        return version;
    }

    public void setVersion(String v) {
        this.version = v;
    }

    public String getCodigoBase() {
        return codigoBase;
    }

    public void setCodigoBase(String c) {
        this.codigoBase = c;
    }

    public String getPublicadoPor() {
        return publicadoPor;
    }

    public void setPublicadoPor(String p) {
        this.publicadoPor = p;
    }

    public LocalDateTime getFechaPublicacion() {
        return fechaPublicacion;
    }

    public void setFechaPublicacion(LocalDateTime f) {
        this.fechaPublicacion = f;
    }

    public String getMotivoObsolescencia() {
        return motivoObsolescencia;
    }

    public void setMotivoObsolescencia(String m) {
        this.motivoObsolescencia = m;
    }

    public Integer getNumeroVersion() {
        return numeroVersion;
    }

    public void setNumeroVersion(Integer n) {
        this.numeroVersion = n;
    }
    // 👇 NUEVO Colaboración: getters/setters del borrador compartido
    public String getBorradorXml() {
        return borradorXml;
    }

    public void setBorradorXml(String borradorXml) {
        this.borradorXml = borradorXml;
    }

    public LocalDateTime getFechaUltimoBorrador() {
        return fechaUltimoBorrador;
    }

    public void setFechaUltimoBorrador(LocalDateTime f) {
        this.fechaUltimoBorrador = f;
    }

    public String getBorradorPor() {
        return borradorPor;
    }

    public void setBorradorPor(String borradorPor) {
        this.borradorPor = borradorPor;
    }
}