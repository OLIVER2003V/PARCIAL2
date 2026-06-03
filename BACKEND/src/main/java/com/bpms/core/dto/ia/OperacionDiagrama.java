package com.bpms.core.dto.ia;

/**
 * Representa una operación atómica de edición sobre el diagrama actual.
 * El frontend aplica la lista de operaciones en orden sobre el grafo maxGraph.
 *
 * Tipos soportados:
 *   AGREGAR_NODO       — inserta un nodo nuevo en el carril indicado
 *   AGREGAR_CONEXION   — inserta una arista entre dos nodos existentes
 *   ELIMINAR_NODO      — elimina nodo e incidentes automáticamente
 *   ELIMINAR_CONEXION  — elimina solo la arista indicada
 *   ACTUALIZAR_NODO    — cambia nombre y/o departamento de un nodo existente
 *   AGREGAR_DEPARTAMENTO — añade un nuevo carril al diagrama
 */
public class OperacionDiagrama {

    private String tipo;

    // Para AGREGAR_NODO / ACTUALIZAR_NODO
    private String id;
    private String nombre;
    private String tipoNodo;       // UserTask, ExclusiveGateway, StartEvent, EndEvent…
    private String departamento;

    // Para AGREGAR_CONEXION / ELIMINAR_CONEXION
    private String origen;
    private String destino;
    private String condicion;      // Texto de la etiqueta (vacío si no aplica)

    public String getTipo()        { return tipo; }
    public void   setTipo(String v){ this.tipo = v; }

    public String getId()          { return id; }
    public void   setId(String v)  { this.id = v; }

    public String getNombre()         { return nombre; }
    public void   setNombre(String v) { this.nombre = v; }

    public String getTipoNodo()         { return tipoNodo; }
    public void   setTipoNodo(String v) { this.tipoNodo = v; }

    public String getDepartamento()         { return departamento; }
    public void   setDepartamento(String v) { this.departamento = v; }

    public String getOrigen()         { return origen; }
    public void   setOrigen(String v) { this.origen = v; }

    public String getDestino()         { return destino; }
    public void   setDestino(String v) { this.destino = v; }

    public String getCondicion()         { return condicion; }
    public void   setCondicion(String v) { this.condicion = v; }
}
