package com.bpms.core.models;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Documento colaborativo en tiempo real.
 * Tipo 'texto'  → contenido HTML (Quill delta serializado)
 * Tipo 'hoja'   → contenido JSON (filas x columnas como List<List<String>>)
 *
 * El campo estadoYjs guarda el vector Yjs (base64) para reconectar
 * sin perder el historial de operaciones CRDT.
 */
@Document(collection = "documentos_colaborativos")
public class DocumentoColaborativo {

    @Id
    private String id;

    private String tramiteId;
    private String procesoId;

    private String nombre;

    /** 'texto' | 'hoja' */
    private String tipo;

    /** Snapshot del contenido legible (HTML o JSON string). */
    private String contenido;

    /** Estado Yjs codificado en Base64 — se actualiza en cada guardado. */
    private String estadoYjs;

    private String creadoPor;
    private LocalDateTime creadoEn   = LocalDateTime.now();
    private LocalDateTime actualizadoEn;
    private String ultimoEditor;

    /** Últimas 20 versiones para historial. */
    private List<VersionContenido> versiones = new ArrayList<>();

    // ── Google Drive ───────────────────────────────────────────────────────────
    /** Clave única del campo: "{tramiteId}_{campoId}" o "borrador_{procesoId}_{campoId}" */
    private String claveCampo;
    /** ID del documento en Google Drive. */
    private String googleDocId;
    /** URL de edición directa en Google Docs/Sheets. */
    private String googleEditUrl;
    /** URL de embed para iframe. */
    private String googleEmbedUrl;

    // ── Inner DTO ──────────────────────────────────────────────────────────────

    public static class VersionContenido {
        private String editor;
        private LocalDateTime fecha;
        private String contenido;
        private String estadoYjs;

        public VersionContenido() {}
        public VersionContenido(String editor, LocalDateTime fecha, String contenido, String estadoYjs) {
            this.editor     = editor;
            this.fecha      = fecha;
            this.contenido  = contenido;
            this.estadoYjs  = estadoYjs;
        }

        public String getEditor()      { return editor; }
        public LocalDateTime getFecha(){ return fecha; }
        public String getContenido()   { return contenido; }
        public String getEstadoYjs()   { return estadoYjs; }
        public void setEditor(String e){ this.editor = e; }
        public void setFecha(LocalDateTime f){ this.fecha = f; }
        public void setContenido(String c){ this.contenido = c; }
        public void setEstadoYjs(String y){ this.estadoYjs = y; }
    }

    // ── Getters & Setters ──────────────────────────────────────────────────────

    public String getId()                          { return id; }
    public void setId(String id)                   { this.id = id; }
    public String getTramiteId()                   { return tramiteId; }
    public void setTramiteId(String t)             { this.tramiteId = t; }
    public String getProcesoId()                   { return procesoId; }
    public void setProcesoId(String p)             { this.procesoId = p; }
    public String getNombre()                      { return nombre; }
    public void setNombre(String n)                { this.nombre = n; }
    public String getTipo()                        { return tipo; }
    public void setTipo(String t)                  { this.tipo = t; }
    public String getContenido()                   { return contenido; }
    public void setContenido(String c)             { this.contenido = c; }
    public String getEstadoYjs()                   { return estadoYjs; }
    public void setEstadoYjs(String y)             { this.estadoYjs = y; }
    public String getCreadoPor()                   { return creadoPor; }
    public void setCreadoPor(String c)             { this.creadoPor = c; }
    public LocalDateTime getCreadoEn()             { return creadoEn; }
    public void setCreadoEn(LocalDateTime d)       { this.creadoEn = d; }
    public LocalDateTime getActualizadoEn()        { return actualizadoEn; }
    public void setActualizadoEn(LocalDateTime d)  { this.actualizadoEn = d; }
    public String getUltimoEditor()                { return ultimoEditor; }
    public void setUltimoEditor(String u)          { this.ultimoEditor = u; }
    public List<VersionContenido> getVersiones()   { return versiones; }
    public void setVersiones(List<VersionContenido> v){ this.versiones = v; }

    public String getClaveCampo()                  { return claveCampo; }
    public void setClaveCampo(String c)            { this.claveCampo = c; }
    public String getGoogleDocId()                 { return googleDocId; }
    public void setGoogleDocId(String g)           { this.googleDocId = g; }
    public String getGoogleEditUrl()               { return googleEditUrl; }
    public void setGoogleEditUrl(String u)         { this.googleEditUrl = u; }
    public String getGoogleEmbedUrl()              { return googleEmbedUrl; }
    public void setGoogleEmbedUrl(String u)        { this.googleEmbedUrl = u; }
}
