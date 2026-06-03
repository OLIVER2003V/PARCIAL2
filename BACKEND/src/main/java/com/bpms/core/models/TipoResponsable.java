package com.bpms.core.models;

/**
 * Quién es responsable de llenar el formulario de un paso.
 */
public enum TipoResponsable {
    INICIO_CLIENTE,      // Cliente al crear el trámite (primer paso)
    FUNCIONARIO,         // Funcionario del departamento (default)
    SOLICITUD_CLIENTE,   // Cliente notificado durante el flujo (aporta más datos)
    AUTOMATICO           // Sistema (gateways, transiciones condicionales)
}