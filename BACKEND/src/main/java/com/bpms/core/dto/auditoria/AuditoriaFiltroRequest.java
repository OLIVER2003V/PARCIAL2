package com.bpms.core.dto.auditoria;

/**
 * 👇 NUEVO CU16: DTO para los filtros de consulta del log de auditoría.
 *
 * Todos los campos son opcionales — un filtro nulo o vacío se ignora.
 * Las fechas se reciben como String ISO-8601 (ej: "2026-04-25T00:00:00")
 * para evitar problemas de parseo en query params.
 */
public class AuditoriaFiltroRequest {

    private String usuarioId;
    private String categoria;
    private String accion;
    private String ipOrigen;
    private String desde;       // ISO-8601, ej: "2026-04-25T00:00:00"
    private String hasta;       // ISO-8601
    private String textoLibre;  // busca en detalle/accion/usuarioId
    private String entidadId;   // ID de la entidad afectada (procesoId, tramiteId, userId…)
    private Integer pagina;     // 0-indexed, default 0
    private Integer tamano;     // default 50, max 200

    public AuditoriaFiltroRequest() {}

    public String getUsuarioId() { return usuarioId; }
    public void setUsuarioId(String usuarioId) { this.usuarioId = usuarioId; }

    public String getCategoria() { return categoria; }
    public void setCategoria(String categoria) { this.categoria = categoria; }

    public String getAccion() { return accion; }
    public void setAccion(String accion) { this.accion = accion; }

    public String getIpOrigen() { return ipOrigen; }
    public void setIpOrigen(String ipOrigen) { this.ipOrigen = ipOrigen; }

    public String getDesde() { return desde; }
    public void setDesde(String desde) { this.desde = desde; }

    public String getHasta() { return hasta; }
    public void setHasta(String hasta) { this.hasta = hasta; }

    public String getTextoLibre() { return textoLibre; }
    public void setTextoLibre(String textoLibre) { this.textoLibre = textoLibre; }

    public Integer getPagina() { return pagina; }
    public void setPagina(Integer pagina) { this.pagina = pagina; }

    public String getEntidadId() { return entidadId; }
    public void setEntidadId(String entidadId) { this.entidadId = entidadId; }

    public Integer getTamano() { return tamano; }
    public void setTamano(Integer tamano) { this.tamano = tamano; }
}