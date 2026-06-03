package com.bpms.core.models;

public enum EstadoProceso {
    BORRADOR,   // Admin está diseñando, no visible para clientes
    ACTIVA,     // Publicada, los clientes pueden usar
    OBSOLETA,   // Superada por una versión nueva, trámites viejos la siguen usando
    ARCHIVADA   // Descontinuada completamente (no hay trámites activos usándola)
}