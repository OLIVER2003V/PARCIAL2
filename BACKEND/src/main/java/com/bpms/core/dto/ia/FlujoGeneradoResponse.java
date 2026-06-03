package com.bpms.core.dto.ia;

import java.util.ArrayList;
import java.util.List;

/**
 * 👇 NUEVO CU17: Lo que el backend manda al frontend.
 *
 * - flujo: el JSON ya validado y normalizado (departamentos matcheados, etc.)
 * - advertencias: lista de avisos no críticos (ej: "Asigné X paso al depto Y por similitud")
 * - departamentosNoMatcheados: nombres que la IA inventó y no existen en BD
 */
public class FlujoGeneradoResponse {

    private FlujoGeneradoIA flujo;
    private List<String> advertencias = new ArrayList<>();
    private List<String> departamentosNoMatcheados = new ArrayList<>();
    private int totalNodos;
    private int totalConexiones;

    public FlujoGeneradoIA getFlujo() { return flujo; }
    public void setFlujo(FlujoGeneradoIA flujo) { this.flujo = flujo; }

    public List<String> getAdvertencias() { return advertencias; }
    public void setAdvertencias(List<String> advertencias) { this.advertencias = advertencias; }

    public List<String> getDepartamentosNoMatcheados() { return departamentosNoMatcheados; }
    public void setDepartamentosNoMatcheados(List<String> departamentosNoMatcheados) {
        this.departamentosNoMatcheados = departamentosNoMatcheados;
    }

    public int getTotalNodos() { return totalNodos; }
    public void setTotalNodos(int totalNodos) { this.totalNodos = totalNodos; }

    public int getTotalConexiones() { return totalConexiones; }
    public void setTotalConexiones(int totalConexiones) { this.totalConexiones = totalConexiones; }
}