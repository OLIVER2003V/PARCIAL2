package com.bpms.core.models;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.LocalDateTime;

@Document(collection = "audit_logs")
public class AuditLog {

    @Id
    private String id;

    // Sobre QUÉ documento se hizo la acción
    private String tramiteId;

    // QUIÉN hizo la acción
    private String usuarioId;

    // DESDE DÓNDE se hizo (departamento del actor)
    private String departamentoId;

    // QUÉ ACCIÓN tomó (Ej: "APROBADO", "RECHAZADO", "POLITICA_PUBLICADA", "AUTH_LOGIN_OK")
    private String accion;

    // CU14: qué nodo se resolvió
    private String pasoId;
    private String pasoNombre;

    // QUÉ DIJO (Comentario o dictamen técnico)
    private String detalle;

    // CUÁNDO ocurrió (servidor, no falsificable por cliente)
    private LocalDateTime fechaTimestamp = LocalDateTime.now();

    // Payload del formulario (puede contener PII, solo visible para ADMIN)
    private java.util.Map<String, Object> datosFormulario;

    // 👇 NUEVO CU16: IP de origen del request (X-Forwarded-For o RemoteAddr)
    private String ipOrigen;

    // 👇 NUEVO CU16: categoría para filtrar rápido en la UI
    // Valores: AUTH, POLITICA, USUARIO, DEPARTAMENTO, TRAMITE, SISTEMA
    private String categoria;

    // 👇 NUEVO CU20: entidad afectada (permite trazar auditoría por proceso/trámite/usuario)
    private String entidadId;   // ID del documento afectado (procesoId, tramiteId, userId…)
    private String entidadTipo; // PROCESO | TRAMITE | USUARIO | DEPARTAMENTO

    public AuditLog() {}

    // === Getters y Setters ===
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getTramiteId() { return tramiteId; }
    public void setTramiteId(String tramiteId) { this.tramiteId = tramiteId; }

    public String getUsuarioId() { return usuarioId; }
    public void setUsuarioId(String usuarioId) { this.usuarioId = usuarioId; }

    public String getDepartamentoId() { return departamentoId; }
    public void setDepartamentoId(String departamentoId) { this.departamentoId = departamentoId; }

    public String getAccion() { return accion; }
    public void setAccion(String accion) { this.accion = accion; }

    public String getDetalle() { return detalle; }
    public void setDetalle(String detalle) { this.detalle = detalle; }

    public LocalDateTime getFechaTimestamp() { return fechaTimestamp; }
    public void setFechaTimestamp(LocalDateTime fechaTimestamp) { this.fechaTimestamp = fechaTimestamp; }

    public java.util.Map<String, Object> getDatosFormulario() { return datosFormulario; }
    public void setDatosFormulario(java.util.Map<String, Object> datosFormulario) { this.datosFormulario = datosFormulario; }

    public String getPasoId() { return pasoId; }
    public void setPasoId(String pasoId) { this.pasoId = pasoId; }

    public String getPasoNombre() { return pasoNombre; }
    public void setPasoNombre(String pasoNombre) { this.pasoNombre = pasoNombre; }

    // 👇 NUEVO CU16
    public String getIpOrigen() { return ipOrigen; }
    public void setIpOrigen(String ipOrigen) { this.ipOrigen = ipOrigen; }

    public String getCategoria() { return categoria; }
    public void setCategoria(String categoria) { this.categoria = categoria; }

    public String getEntidadId() { return entidadId; }
    public void setEntidadId(String entidadId) { this.entidadId = entidadId; }

    public String getEntidadTipo() { return entidadTipo; }
    public void setEntidadTipo(String entidadTipo) { this.entidadTipo = entidadTipo; }
}