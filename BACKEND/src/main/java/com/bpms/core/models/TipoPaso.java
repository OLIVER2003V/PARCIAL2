package com.bpms.core.models;

/**
 * Tipo de nodo en el diagrama BPMN.
 * Cada tipo tiene comportamiento diferente en el motor de workflow.
 */
public enum TipoPaso {
    TAREA,                  // Task — requiere acción humana
    GATEWAY_EXCLUSIVO,      // Decisión: toma UN camino según condición
    GATEWAY_PARALELO_SPLIT, // Bifurcación: activa TODOS los caminos simultáneamente
    GATEWAY_PARALELO_JOIN,  // Unión: espera que TODOS los caminos entrantes terminen
    GATEWAY_INCLUSIVO,      // Inclusivo: activa los caminos que cumplan condición
    NODO_FINAL,             // EndEvent
    NODO_TERMINACION,       // EndEvent de tipo Terminate (corta todo)
    EVENTO_INTERMEDIO,      // Signal/Timer intermedio
    SUBPROCESO              // Subproceso anidado
}