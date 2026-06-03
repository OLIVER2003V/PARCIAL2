package com.bpms.core.dto.ia;

import java.util.ArrayList;
import java.util.List;

/**
 * 👇 NUEVO CU17: Estructura intermedia que devuelve Gemini.
 * Antes de mandarla al frontend, el service la valida y enriquece.
 */
public class FlujoGeneradoIA {

    private List<String> departamentos = new ArrayList<>();
    private List<NodoIA> nodos = new ArrayList<>();
    private List<ConexionIA> conexiones = new ArrayList<>();

    public List<String> getDepartamentos() { return departamentos; }
    public void setDepartamentos(List<String> departamentos) { this.departamentos = departamentos; }

    public List<NodoIA> getNodos() { return nodos; }
    public void setNodos(List<NodoIA> nodos) { this.nodos = nodos; }

    public List<ConexionIA> getConexiones() { return conexiones; }
    public void setConexiones(List<ConexionIA> conexiones) { this.conexiones = conexiones; }

    public static class NodoIA {
        private String id;
        private String tipo;        // StartEvent, UserTask, ExclusiveGateway, ParallelGateway, EndEvent
        private String nombre;
        private String departamento;

        public String getId() { return id; }
        public void setId(String id) { this.id = id; }

        public String getTipo() { return tipo; }
        public void setTipo(String tipo) { this.tipo = tipo; }

        public String getNombre() { return nombre; }
        public void setNombre(String nombre) { this.nombre = nombre; }

        public String getDepartamento() { return departamento; }
        public void setDepartamento(String departamento) { this.departamento = departamento; }
    }

    public static class ConexionIA {
        private String origen;
        private String destino;
        private String nombre;

        public String getOrigen() { return origen; }
        public void setOrigen(String origen) { this.origen = origen; }

        public String getDestino() { return destino; }
        public void setDestino(String destino) { this.destino = destino; }

        public String getNombre() { return nombre; }
        public void setNombre(String nombre) { this.nombre = nombre; }
    }
}