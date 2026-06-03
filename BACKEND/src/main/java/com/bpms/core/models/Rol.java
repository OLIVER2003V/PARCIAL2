package com.bpms.core.models;

public enum Rol {
    ADMIN,          // El que crea las políticas y flujos
    FUNCIONARIO,    // El que atiende los trámites en su bandeja
    CLIENTE         // El que inicia un trámite
}