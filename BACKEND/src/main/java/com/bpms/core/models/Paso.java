package com.bpms.core.models;

import java.util.ArrayList;
import java.util.List;

public class Paso {
    private String id;
    private String nombre;
    private String departamentoAsignadoId;
    private List<Transicion> transiciones = new ArrayList<>();
    private List<CampoFormulario> campos = new ArrayList<>();
    private List<String> camposVisibles = new ArrayList<>();
    // 👇 NUEVO: tipo de nodo
    private TipoPaso tipo = TipoPaso.TAREA;

    // 👇 NUEVO: para loops — indica si este paso puede ejecutarse múltiples veces
    private boolean permiteReejecucion = false;
    private TipoResponsable tipoResponsable = TipoResponsable.FUNCIONARIO;

    private Double slaHoras;
    public Paso() {
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getNombre() {
        return nombre;
    }

    public void setNombre(String nombre) {
        this.nombre = nombre;
    }

    public String getDepartamentoAsignadoId() {
        return departamentoAsignadoId;
    }

    public void setDepartamentoAsignadoId(String id) {
        this.departamentoAsignadoId = id;
    }

    public List<Transicion> getTransiciones() {
        return transiciones;
    }

    public void setTransiciones(List<Transicion> t) {
        this.transiciones = t;
    }

    public List<CampoFormulario> getCampos() {
        return campos;
    }

    public void setCampos(List<CampoFormulario> c) {
        this.campos = c;
    }

    public TipoPaso getTipo() {
        return tipo;
    }

    public void setTipo(TipoPaso tipo) {
        this.tipo = tipo;
    }

    public boolean isPermiteReejecucion() {
        return permiteReejecucion;
    }

    public void setPermiteReejecucion(boolean p) {
        this.permiteReejecucion = p;
    }

    public TipoResponsable getTipoResponsable() {
        return tipoResponsable;
    }

    public void setTipoResponsable(TipoResponsable t) {
        this.tipoResponsable = t;
    }

    public List<String> getCamposVisibles() {
        return camposVisibles;
    }

    public void setCamposVisibles(List<String> c) {
        this.camposVisibles = c;
    }
    public Double getSlaHoras() {
        return slaHoras;
    }

    public void setSlaHoras(Double slaHoras) {
        this.slaHoras = slaHoras;
    }
}