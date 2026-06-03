package com.bpms.core.services;

import com.bpms.core.models.DocumentoColaborativo;
import com.bpms.core.models.DocumentoColaborativo.VersionContenido;
import com.bpms.core.models.RegistroArchivo;
import com.bpms.core.models.RegistroArchivo.VersionArchivo;
import com.bpms.core.repositories.DocumentoColaborativoRepository;
import com.bpms.core.repositories.RegistroArchivoRepository;
import com.bpms.core.services.GoogleDriveService.GoogleDocInfo;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class DocumentoColaborativoService {

    private static final int MAX_VERSIONES = 20;

    private final DocumentoColaborativoRepository docRepo;
    private final RegistroArchivoRepository archivoRepo;
    private final GoogleDriveService driveService;

    public DocumentoColaborativoService(
            DocumentoColaborativoRepository docRepo,
            RegistroArchivoRepository archivoRepo,
            GoogleDriveService driveService) {
        this.docRepo      = docRepo;
        this.archivoRepo  = archivoRepo;
        this.driveService = driveService;
    }

    /**
     * Devuelve el documento asociado a la claveCampo si ya existe en MongoDB.
     * Si no existe, crea un nuevo Google Doc/Sheet, lo persiste y lo devuelve.
     */
    public DocumentoColaborativo obtenerOCrearGoogleDoc(
            String claveCampo, String tipo, String nombre, String usuario) throws IOException {

        var existing = docRepo.findByClaveCampo(claveCampo);
        if (existing.isPresent()) {
            DocumentoColaborativo doc = existing.get();
            // Always recompute embedUrl so stale stored URLs (e.g. with rm=minimal) are not served
            if (doc.getGoogleDocId() != null) {
                doc.setGoogleEmbedUrl(buildFreshEmbedUrl(doc.getGoogleDocId(), doc.getTipo()));
            }
            return doc;
        }

        try {
            String nombreDoc = (nombre != null && !nombre.isBlank()) ? nombre
                    : ("documento-texto".equals(tipo) ? "Documento" : "Hoja de cálculo");

            GoogleDocInfo info = driveService.crearDocumento(nombreDoc, tipo);

            DocumentoColaborativo doc = new DocumentoColaborativo();
            doc.setClaveCampo(claveCampo);
            doc.setTipo(tipo);
            doc.setNombre(nombreDoc);
            doc.setGoogleDocId(info.docId());
            doc.setGoogleEditUrl(info.editUrl());
            doc.setGoogleEmbedUrl(info.embedUrl());
            doc.setCreadoPor(usuario != null ? usuario : "sistema");
            doc.setCreadoEn(LocalDateTime.now());
            return docRepo.save(doc);
        } catch (IOException e) {
            throw new RuntimeException("Error al crear documento en Google Drive: " + e.getMessage(), e);
        }
    }

    /**
     * Devuelve el documento TipTap asociado a la claveCampo si ya existe.
     * Si no existe, crea uno nuevo vacío (sin Google Drive).
     */
    public DocumentoColaborativo obtenerOCrearTiptap(
            String claveCampo, String nombre, String usuario) {

        var existing = docRepo.findByClaveCampo(claveCampo);
        if (existing.isPresent()) {
            return existing.get();
        }

        String nombreDoc = (nombre != null && !nombre.isBlank()) ? nombre : "Documento";

        DocumentoColaborativo doc = new DocumentoColaborativo();
        doc.setClaveCampo(claveCampo);
        doc.setTipo("tiptap-texto");
        doc.setNombre(nombreDoc);
        doc.setContenido("");
        doc.setEstadoYjs("");
        doc.setCreadoPor(usuario != null ? usuario : "sistema");
        doc.setCreadoEn(LocalDateTime.now());
        return docRepo.save(doc);
    }

    private String buildFreshEmbedUrl(String docId, String tipo) {
        if ("documento-texto".equals(tipo)) {
            return "https://docs.google.com/document/d/" + docId + "/edit?usp=sharing";
        }
        return "https://docs.google.com/spreadsheets/d/" + docId + "/edit?usp=sharing";
    }

    // ── Documentos colaborativos (texto / hoja) ────────────────────────────────

    public DocumentoColaborativo crear(String nombre, String tipo,
                                       String tramiteId, String procesoId,
                                       String usuario) {
        DocumentoColaborativo doc = new DocumentoColaborativo();
        doc.setNombre(nombre);
        doc.setTipo(tipo);
        doc.setTramiteId(tramiteId);
        doc.setProcesoId(procesoId);
        doc.setCreadoPor(usuario);
        doc.setUltimoEditor(usuario);
        doc.setCreadoEn(LocalDateTime.now());
        doc.setContenido(tipo.equals("hoja") ? "[[]]" : "");
        return docRepo.save(doc);
    }

    public List<DocumentoColaborativo> listarPorTramite(String tramiteId) {
        return docRepo.findByTramiteId(tramiteId);
    }

    public List<DocumentoColaborativo> listarPorProceso(String procesoId) {
        return docRepo.findByProcesoId(procesoId);
    }

    public DocumentoColaborativo obtener(String id) {
        return docRepo.findById(id).orElse(null);
    }

    /**
     * Persiste el estado actual del documento y guarda la versión anterior en historial.
     * Se llama desde el WebSocket handler cada vez que llega un guardado explícito
     * o por debounce desde el frontend (cada ~3 s).
     */
    public DocumentoColaborativo guardar(String id, String contenido,
                                          String estadoYjs, String editor) {
        DocumentoColaborativo doc = docRepo.findById(id).orElse(null);
        if (doc == null) return null;

        // Rotar versiones (máximo MAX_VERSIONES)
        if (doc.getContenido() != null && !doc.getContenido().isBlank()) {
            List<VersionContenido> hist = doc.getVersiones();
            hist.add(0, new VersionContenido(
                    doc.getUltimoEditor(),
                    doc.getActualizadoEn() != null ? doc.getActualizadoEn() : doc.getCreadoEn(),
                    doc.getContenido(),
                    doc.getEstadoYjs()
            ));
            if (hist.size() > MAX_VERSIONES) hist = hist.subList(0, MAX_VERSIONES);
            doc.setVersiones(hist);
        }

        doc.setContenido(contenido);
        doc.setEstadoYjs(estadoYjs);
        doc.setUltimoEditor(editor);
        doc.setActualizadoEn(LocalDateTime.now());
        return docRepo.save(doc);
    }

    public void eliminar(String id) {
        docRepo.deleteById(id);
    }

    // ── Registros de archivos S3 con versionado ────────────────────────────────

    /**
     * Registra una nueva versión de un archivo S3.
     * Si ya existe un registro para el mismo nombre en el mismo trámite, agrega versión.
     * Si no, crea un nuevo registro.
     */
    public RegistroArchivo registrarNuevaVersion(
            String tramiteId, String procesoId,
            String nombreOriginal, String tipoMime,
            String url, String nombreAlmacenado,
            long tamano, String subidoPor, String comentario,
            String paso, String rol) {

        // Buscar registro existente por nombre original en el mismo contexto
        List<RegistroArchivo> existentes = tramiteId != null
                ? archivoRepo.findByTramiteId(tramiteId)
                : procesoId != null
                        ? archivoRepo.findByProcesoId(procesoId)
                        : List.of();

        RegistroArchivo registro = existentes.stream()
                .filter(r -> nombreOriginal.equals(r.getNombreOriginal()))
                .findFirst()
                .orElse(null);

        if (registro == null) {
            registro = new RegistroArchivo();
            registro.setTramiteId(tramiteId);
            registro.setProcesoId(procesoId);
            registro.setNombreOriginal(nombreOriginal);
            registro.setTipoMime(tipoMime);
            registro.setCreadoEn(LocalDateTime.now());
        }

        int siguienteVersion = registro.getVersiones().size() + 1;

        VersionArchivo version = new VersionArchivo();
        version.setNumero(siguienteVersion);
        version.setUrl(url);
        version.setNombreAlmacenado(nombreAlmacenado);
        version.setTamano(tamano);
        version.setSubidoPor(subidoPor);
        version.setFechaSubida(LocalDateTime.now());
        version.setComentario(comentario);
        version.setPaso(paso);
        version.setRol(rol);

        registro.getVersiones().add(version);
        registro.setUrlActual(url);

        return archivoRepo.save(registro);
    }

    public List<RegistroArchivo> listarArchivosPorTramite(String tramiteId) {
        return archivoRepo.findByTramiteId(tramiteId);
    }

    public List<RegistroArchivo> listarArchivosPorProceso(String procesoId) {
        return archivoRepo.findByProcesoId(procesoId);
    }

    public int vincularArchivosFormularioInicial(String tramiteId,
                                                 Map<String, Object> datosFormulario,
                                                 String subidoPor,
                                                 String paso,
                                                 String rol) {
        if (tramiteId == null || tramiteId.isBlank() || datosFormulario == null || datosFormulario.isEmpty()) {
            return 0;
        }

        Set<String> urls = new LinkedHashSet<>();
        recolectarUrlsArchivo(datosFormulario, urls);
        int vinculados = 0;

        for (String url : urls) {
            RegistroArchivo registro = buscarRegistroPorUrl(url);
            if (registro == null) continue;

            boolean cambio = false;
            if (registro.getTramiteId() == null || registro.getTramiteId().isBlank()) {
                registro.setTramiteId(tramiteId);
                cambio = true;
            }

            if (registro.getVersiones() != null) {
                for (VersionArchivo version : registro.getVersiones()) {
                    if (!url.equals(version.getUrl())) continue;
                    if (version.getPaso() == null || version.getPaso().isBlank()) {
                        version.setPaso(paso);
                        cambio = true;
                    }
                    if (version.getRol() == null || version.getRol().isBlank()) {
                        version.setRol(rol);
                        cambio = true;
                    }
                    if (version.getSubidoPor() == null || version.getSubidoPor().isBlank()
                            || "sistema".equalsIgnoreCase(version.getSubidoPor())) {
                        version.setSubidoPor(subidoPor);
                        cambio = true;
                    }
                }
            }

            if (cambio) {
                archivoRepo.save(registro);
                vinculados++;
            }
        }

        return vinculados;
    }

    /**
     * Actualiza las URLs de versiones y urlActual en RegistroArchivo tras mover objetos en S3.
     * @param remapeo mapa de URL_vieja → URL_nueva devuelto por ArchivoService.moverArchivosATramite()
     */
    public void actualizarUrls(Map<String, String> remapeo) {
        if (remapeo == null || remapeo.isEmpty()) return;
        for (Map.Entry<String, String> entry : remapeo.entrySet()) {
            String urlVieja = entry.getKey();
            String urlNueva = entry.getValue();
            RegistroArchivo registro = buscarRegistroPorUrl(urlVieja);
            if (registro == null) continue;
            if (urlVieja.equals(registro.getUrlActual())) {
                registro.setUrlActual(urlNueva);
            }
            if (registro.getVersiones() != null) {
                for (VersionArchivo v : registro.getVersiones()) {
                    if (urlVieja.equals(v.getUrl())) v.setUrl(urlNueva);
                }
            }
            archivoRepo.save(registro);
        }
    }

    public RegistroArchivo eliminarRegistroArchivoPorUrl(String url) {
        if (url == null || url.isBlank()) return null;

        RegistroArchivo registro = buscarRegistroPorUrl(url);

        if (registro == null) return null;
        archivoRepo.deleteById(registro.getId());
        return registro;
    }

    private RegistroArchivo buscarRegistroPorUrl(String url) {
        if (url == null || url.isBlank()) return null;
        return archivoRepo.findByUrlActual(url)
                .orElseGet(() -> archivoRepo.findByVersionesUrl(url).stream()
                        .findFirst()
                        .orElse(null));
    }

    @SuppressWarnings("unchecked")
    private void recolectarUrlsArchivo(Object valor, Set<String> urls) {
        if (valor == null) return;

        if (valor instanceof Map<?, ?> mapa) {
            Object url = mapa.get("url");
            Object nombreOriginal = mapa.get("nombreOriginal");
            if (url instanceof String urlStr && !urlStr.isBlank() && nombreOriginal instanceof String) {
                urls.add(urlStr);
            }
            for (Object child : mapa.values()) {
                recolectarUrlsArchivo(child, urls);
            }
            return;
        }

        if (valor instanceof Collection<?> coleccion) {
            for (Object child : coleccion) {
                recolectarUrlsArchivo(child, urls);
            }
        }
    }
}
