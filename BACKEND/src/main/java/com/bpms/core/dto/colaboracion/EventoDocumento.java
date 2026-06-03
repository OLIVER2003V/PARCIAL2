package com.bpms.core.dto.colaboracion;

/**
 * Evento WebSocket para sincronización de documentos colaborativos.
 *
 * tipo = 'yjs-update'     → payload es un Yjs binary update en Base64
 * tipo = 'presencia-celda'→ fila/columna activa del editor en la hoja
 * tipo = 'guardado'       → notificación de que el servidor persistió
 * tipo = 'archivo-subido' → nuevo archivo subido a S3 (con metadatos)
 */
public class EventoDocumento {

    private String documentoId;
    private String emisor;
    private String tipo;

    /** Base64-encoded Yjs binary update (solo para tipo 'yjs-update'). */
    private String payload;

    /** Para presencia en hoja de cálculo. */
    private Integer fila;
    private Integer columna;

    /** Para notificaciones de archivo subido. */
    private String archivoId;
    private String archivoNombre;
    private String archivoUrl;

    private Long timestamp;

    public EventoDocumento() {}

    public String getDocumentoId()              { return documentoId; }
    public void setDocumentoId(String d)        { this.documentoId = d; }
    public String getEmisor()                   { return emisor; }
    public void setEmisor(String e)             { this.emisor = e; }
    public String getTipo()                     { return tipo; }
    public void setTipo(String t)               { this.tipo = t; }
    public String getPayload()                  { return payload; }
    public void setPayload(String p)            { this.payload = p; }
    public Integer getFila()                    { return fila; }
    public void setFila(Integer f)              { this.fila = f; }
    public Integer getColumna()                 { return columna; }
    public void setColumna(Integer c)           { this.columna = c; }
    public String getArchivoId()                { return archivoId; }
    public void setArchivoId(String a)          { this.archivoId = a; }
    public String getArchivoNombre()            { return archivoNombre; }
    public void setArchivoNombre(String a)      { this.archivoNombre = a; }
    public String getArchivoUrl()               { return archivoUrl; }
    public void setArchivoUrl(String a)         { this.archivoUrl = a; }
    public Long getTimestamp()                  { return timestamp; }
    public void setTimestamp(Long t)            { this.timestamp = t; }
}
