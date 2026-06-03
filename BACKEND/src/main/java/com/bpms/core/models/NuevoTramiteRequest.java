package com.bpms.core.models;

import java.util.HashMap;
import java.util.Map;

public class NuevoTramiteRequest {
    private String codigoProceso;
    private String clienteId;
    private String descripcion;

    // 👇 NUEVO: datos del formulario inicial que llenó el cliente
    private Map<String, Object> datosFormularioInicial = new HashMap<>();

    public NuevoTramiteRequest() {}

    public String getCodigoProceso() { return codigoProceso; }
    public void setCodigoProceso(String s) { this.codigoProceso = s; }

    public String getClienteId() { return clienteId; }
    public void setClienteId(String s) { this.clienteId = s; }

    public String getDescripcion() { return descripcion; }
    public void setDescripcion(String s) { this.descripcion = s; }

    public Map<String, Object> getDatosFormularioInicial() { return datosFormularioInicial; }
    public void setDatosFormularioInicial(Map<String, Object> d) { this.datosFormularioInicial = d; }
}