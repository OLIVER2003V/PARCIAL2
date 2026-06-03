package com.bpms.core.models;

public enum EstadoTramite {
    EN_TIEMPO,   // Verde (Atendido o a tiempo)
    EN_PROCESO,  // Amarillo (Alguien lo está revisando)
    ATRASADO,     // Rojo (Lleva demasiado tiempo estancado)
    EN_REVISION,
    APROBADO,
    RECHAZADO
}