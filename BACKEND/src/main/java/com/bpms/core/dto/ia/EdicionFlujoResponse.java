package com.bpms.core.dto.ia;

import java.util.ArrayList;
import java.util.List;

/** Respuesta del endpoint POST /api/ia/editar-flujo. */
public class EdicionFlujoResponse {

    private List<OperacionDiagrama> operaciones = new ArrayList<>();
    private List<String> advertencias = new ArrayList<>();
    private String resumen;

    public List<OperacionDiagrama> getOperaciones()               { return operaciones; }
    public void setOperaciones(List<OperacionDiagrama> v)         { this.operaciones = v; }

    public List<String> getAdvertencias()                         { return advertencias; }
    public void setAdvertencias(List<String> v)                   { this.advertencias = v; }

    public String getResumen()                                    { return resumen; }
    public void   setResumen(String v)                            { this.resumen = v; }
}
