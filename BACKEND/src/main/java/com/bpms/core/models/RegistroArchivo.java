package com.bpms.core.models;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Registro persistido en MongoDB cada vez que se sube un archivo a S3.
 * Mantiene el historial completo de versiones: cada nueva subida agrega
 * una VersionArchivo en lugar de reemplazar la anterior.
 */
@Document(collection = "registros_archivos")
public class RegistroArchivo {

    @Id
    private String id;

    /** Trámite al que pertenece este documento (puede ser null si es de proceso). */
    private String tramiteId;
    private String procesoId;

    private String nombreOriginal;
    private String tipoMime;

    /** URL S3 de la versión activa (la más reciente). */
    private String urlActual;

    /** Historial de versiones — se preservan todas. */
    private List<VersionArchivo> versiones = new ArrayList<>();

    private LocalDateTime creadoEn  = LocalDateTime.now();

    // ── Inner DTO ──────────────────────────────────────────────────────────────

    public static class VersionArchivo {
        private int numero;
        private String url;
        private String nombreAlmacenado;
        private long tamano;
        private String subidoPor;
        private LocalDateTime fechaSubida;
        private String comentario;

        public VersionArchivo() {}

        public int getNumero()                    { return numero; }
        public void setNumero(int n)              { this.numero = n; }
        public String getUrl()                    { return url; }
        public void setUrl(String u)              { this.url = u; }
        public String getNombreAlmacenado()       { return nombreAlmacenado; }
        public void setNombreAlmacenado(String n) { this.nombreAlmacenado = n; }
        public long getTamano()                   { return tamano; }
        public void setTamano(long t)             { this.tamano = t; }
        public String getSubidoPor()              { return subidoPor; }
        public void setSubidoPor(String s)        { this.subidoPor = s; }
        public LocalDateTime getFechaSubida()     { return fechaSubida; }
        public void setFechaSubida(LocalDateTime d){ this.fechaSubida = d; }
        public String getComentario()             { return comentario; }
        public void setComentario(String c)       { this.comentario = c; }

        // CU22: paso del proceso y rol del actor que subió el archivo
        private String paso;
        private String rol;
        public String getPaso()                   { return paso; }
        public void setPaso(String p)             { this.paso = p; }
        public String getRol()                    { return rol; }
        public void setRol(String r)              { this.rol = r; }
    }

    // ── Getters & Setters ──────────────────────────────────────────────────────

    public String getId()                           { return id; }
    public void setId(String id)                    { this.id = id; }
    public String getTramiteId()                    { return tramiteId; }
    public void setTramiteId(String t)              { this.tramiteId = t; }
    public String getProcesoId()                    { return procesoId; }
    public void setProcesoId(String p)              { this.procesoId = p; }
    public String getNombreOriginal()               { return nombreOriginal; }
    public void setNombreOriginal(String n)         { this.nombreOriginal = n; }
    public String getTipoMime()                     { return tipoMime; }
    public void setTipoMime(String t)               { this.tipoMime = t; }
    public String getUrlActual()                    { return urlActual; }
    public void setUrlActual(String u)              { this.urlActual = u; }
    public List<VersionArchivo> getVersiones()      { return versiones; }
    public void setVersiones(List<VersionArchivo> v){ this.versiones = v; }
    public LocalDateTime getCreadoEn()              { return creadoEn; }
    public void setCreadoEn(LocalDateTime d)        { this.creadoEn = d; }
}
