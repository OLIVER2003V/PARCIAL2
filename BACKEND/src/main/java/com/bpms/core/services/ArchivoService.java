package com.bpms.core.services;

import com.bpms.core.models.RegistroArchivo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.CopyObjectRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class ArchivoService {

    private static final Logger log = LoggerFactory.getLogger(ArchivoService.class);

    private static final long MAX_TAMANO_BYTES = 10L * 1024 * 1024;
    private static final int  MAX_DOCS_POR_TRAMITE = 20;

    private static final Set<String> TIPOS_PERMITIDOS = Set.of(
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "image/jpeg", "image/jpg", "image/png", "image/webp",
            "image/gif", "image/heic", "image/heif"
    );

    // Prefijo temporal para archivos subidos antes de que exista el trámite
    static final String PREFIJO_SIN_ASIGNAR = "sin-asignar";

    private final S3Client s3Client;
    private final DocumentoColaborativoService docService;

    @Value("${aws.s3.bucket:bpms-core-archivos-oliver}")
    private String bucketName;

    @Value("${aws.s3.region:us-east-2}")
    private String region;

    @Value("${archivo.local.path:uploads}")
    private String localUploadPath;

    @Value("${server.url:http://localhost:8080}")
    private String serverUrl;

    @Value("${archivo.s3.required:false}")
    private boolean s3Required;

    public ArchivoService(Optional<S3Client> s3Client, DocumentoColaborativoService docService) {
        this.s3Client = s3Client.orElse(null);
        this.docService = docService;
    }

    // ─── Subida principal ─────────────────────────────────────────────────────

    public Map<String, Object> subirArchivo(MultipartFile archivo,
                                            String tramiteId,
                                            String procesoId,
                                            String codigoSeguimiento,
                                            String subidoPor,
                                            String comentario,
                                            String paso,
                                            String rol) throws IOException {
        if (archivo.isEmpty()) throw new IOException("Archivo vacio");

        if (archivo.getSize() > MAX_TAMANO_BYTES) {
            throw new IOException("El archivo excede el tamaño máximo de 10 MB ("
                    + String.format("%.1f", archivo.getSize() / (1024.0 * 1024)) + " MB).");
        }

        String mime = archivo.getContentType() != null ? archivo.getContentType().toLowerCase() : "";
        if (!TIPOS_PERMITIDOS.contains(mime)) {
            throw new IOException("Formato no permitido. Usa PDF, Word, Excel, JPG, PNG o WebP.");
        }

        String nombreOriginal = archivo.getOriginalFilename();
        if (nombreOriginal == null || nombreOriginal.isBlank()) nombreOriginal = "archivo";
        final String nombreOriginalFinal = nombreOriginal;

        if (tramiteId != null && !tramiteId.isBlank()) {
            List<RegistroArchivo> existentes = docService.listarArchivosPorTramite(tramiteId);
            boolean esNuevaEntrada = existentes.stream()
                    .noneMatch(r -> nombreOriginalFinal.equals(r.getNombreOriginal()));
            if (esNuevaEntrada && existentes.size() >= MAX_DOCS_POR_TRAMITE) {
                throw new IOException("El trámite ya alcanzó el límite de " + MAX_DOCS_POR_TRAMITE + " documentos.");
            }
        }

        String extension = nombreOriginal.contains(".")
                ? nombreOriginal.substring(nombreOriginal.lastIndexOf("."))
                : "";
        String nombreUnico = UUID.randomUUID() + extension;

        String rolLimpio   = sanitizar(rol);
        String usuarioLimpio = sanitizar(subidoPor != null ? subidoPor : "sistema");

        ResultadoAlmacenamiento almacenamiento =
                almacenar(archivo, codigoSeguimiento, rolLimpio, usuarioLimpio, nombreUnico, nombreOriginal);

        RegistroArchivo registro = docService.registrarNuevaVersion(
                tramiteId, procesoId,
                nombreOriginal,
                archivo.getContentType(),
                almacenamiento.url(),
                nombreUnico,
                archivo.getSize(),
                subidoPor != null ? subidoPor : "sistema",
                comentario,
                paso,
                rol
        );

        Map<String, Object> resp = new HashMap<>();
        resp.put("nombreOriginal",    nombreOriginal);
        resp.put("nombreAlmacenado",  nombreUnico);
        resp.put("url",               almacenamiento.url());
        resp.put("tamano",            archivo.getSize());
        resp.put("fechaSubida",       LocalDateTime.now().toString());
        resp.put("registroId",        registro.getId());
        resp.put("version",           registro.getVersiones().size());
        resp.put("almacenamiento",    almacenamiento.tipo());
        return resp;
    }

    public Map<String, Object> subirArchivo(MultipartFile archivo, String tramiteId) throws IOException {
        return subirArchivo(archivo, tramiteId, null, null, "sistema", null, null, null);
    }

    // ─── Movimiento de archivos pre-tramite ───────────────────────────────────

    /**
     * Mueve todos los archivos que están en "sin-asignar/{usuario}/" a la carpeta
     * correcta "{codigoSeguimiento}/CLIENTE-{clienteId}/" dentro de S3.
     * Solo opera en S3; en almacenamiento local los archivos quedan en su lugar.
     *
     * @return Mapa de URL vieja → URL nueva, para actualizar MongoDB.
     */
    public Map<String, String> moverArchivosATramite(Map<String, Object> datosFormulario,
                                                      String clienteId,
                                                      String codigoSeguimiento) {
        Map<String, String> remapeo = new HashMap<>();
        if (datosFormulario == null || datosFormulario.isEmpty()) return remapeo;
        if (s3Client == null) return remapeo;

        Set<String> urls = new LinkedHashSet<>();
        recolectarUrls(datosFormulario, urls);

        String prefixS3 = String.format("https://%s.s3.%s.amazonaws.com/", bucketName, region);
        String usuarioLimpio = sanitizar(clienteId);
        String subcarnetaDestino = codigoSeguimiento + "/CLIENTE-" + usuarioLimpio + "/";

        for (String url : urls) {
            if (!url.startsWith(prefixS3)) continue;

            String keyViejo = url.substring(prefixS3.length());
            if (!keyViejo.startsWith(PREFIJO_SIN_ASIGNAR + "/")) continue;

            // Extraer solo el nombre de archivo (puede tener subcarpeta usuario)
            // Estructura: sin-asignar/CLIENTE-xxx/uuid.ext  → tomar uuid.ext
            String[] partes = keyViejo.split("/");
            String nombreArchivo = partes[partes.length - 1];

            String keyNuevo = subcarnetaDestino + nombreArchivo;
            String urlNueva = prefixS3 + keyNuevo;

            if (copiarEnS3(keyViejo, keyNuevo)) {
                eliminarDeS3(keyViejo);
                remapeo.put(url, urlNueva);
                log.info("[ArchivoService] Movido: {} → {}", keyViejo, keyNuevo);
            }
        }

        return remapeo;
    }

    // ─── Eliminación ──────────────────────────────────────────────────────────

    public RegistroArchivo eliminarArchivo(String urlOKey) {
        if (urlOKey == null || urlOKey.isBlank()) return null;

        RegistroArchivo registro = docService.eliminarRegistroArchivoPorUrl(urlOKey);
        if (registro != null && registro.getVersiones() != null) {
            for (RegistroArchivo.VersionArchivo version : registro.getVersiones()) {
                eliminarObjetoFisico(version.getUrl());
            }
            return registro;
        }

        eliminarObjetoFisico(urlOKey);
        return null;
    }

    // ─── Helpers de almacenamiento ────────────────────────────────────────────

    private ResultadoAlmacenamiento almacenar(MultipartFile archivo,
                                              String codigoSeguimiento,
                                              String rolLimpio,
                                              String usuarioLimpio,
                                              String nombreUnico,
                                              String nombreOriginal) throws IOException {
        if (s3Client == null) {
            if (s3Required) throw new IOException("AWS S3 no está configurado.");
            log.info("[ArchivoService] S3 no configurado. Usando almacenamiento local.");
            return new ResultadoAlmacenamiento(guardarLocal(archivo, nombreUnico), "local");
        }

        try {
            String key = construirKey(codigoSeguimiento, rolLimpio, usuarioLimpio, nombreUnico);
            PutObjectRequest putRequest = PutObjectRequest.builder()
                    .bucket(bucketName)
                    .key(key)
                    .contentType(archivo.getContentType())
                    .contentDisposition("inline; filename=\"" + nombreOriginal + "\"")
                    .build();

            s3Client.putObject(putRequest,
                    RequestBody.fromInputStream(archivo.getInputStream(), archivo.getSize()));

            String url = String.format("https://%s.s3.%s.amazonaws.com/%s", bucketName, region, key);
            log.info("[ArchivoService] Archivo subido a S3: {}", key);
            return new ResultadoAlmacenamiento(url, "s3");

        } catch (Exception s3Ex) {
            if (s3Required) {
                throw new IOException("Error de autenticación con AWS S3: " + s3Ex.getMessage(), s3Ex);
            }
            log.warn("[ArchivoService] S3 no disponible ({}). Usando almacenamiento local.", s3Ex.getMessage());
            return new ResultadoAlmacenamiento(guardarLocal(archivo, nombreUnico), "local");
        }
    }

    /**
     * Estructura: {codigoSeguimiento}/{ROL}-{usuario}/{uuid}.ext
     * Si no hay trámite aún: sin-asignar/{ROL}-{usuario}/{uuid}.ext
     */
    private String construirKey(String codigoSeguimiento, String rol, String usuario, String nombreUnico) {
        String carpetaActor = (rol != null && !rol.isBlank() ? rol : "SISTEMA") + "-" + usuario;
        String raiz = (codigoSeguimiento != null && !codigoSeguimiento.isBlank())
                ? codigoSeguimiento
                : PREFIJO_SIN_ASIGNAR;
        return raiz + "/" + carpetaActor + "/" + nombreUnico;
    }

    private boolean copiarEnS3(String keyViejo, String keyNuevo) {
        try {
            s3Client.copyObject(CopyObjectRequest.builder()
                    .sourceBucket(bucketName)
                    .sourceKey(keyViejo)
                    .destinationBucket(bucketName)
                    .destinationKey(keyNuevo)
                    .build());
            return true;
        } catch (Exception e) {
            log.warn("[ArchivoService] No se pudo copiar en S3: {} → {} — {}", keyViejo, keyNuevo, e.getMessage());
            return false;
        }
    }

    private void eliminarDeS3(String key) {
        try {
            s3Client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(bucketName)
                    .key(key)
                    .build());
        } catch (Exception e) {
            log.warn("[ArchivoService] No se pudo eliminar de S3 key={} — {}", key, e.getMessage());
        }
    }

    private void eliminarObjetoFisico(String urlOKey) {
        if (urlOKey == null || urlOKey.isBlank()) return;

        String localPrefix = serverUrl + "/api/archivos/ver/";
        if (urlOKey.startsWith(localPrefix)) {
            String nombre = urlOKey.substring(localPrefix.length());
            try {
                Path path = Paths.get(localUploadPath).resolve(nombre).normalize();
                Files.deleteIfExists(path);
                log.info("[ArchivoService] Archivo local eliminado: {}", path);
            } catch (Exception e) {
                log.warn("[ArchivoService] No se pudo eliminar archivo local: {} — {}", nombre, e.getMessage());
            }
            return;
        }

        if (s3Client == null) return;
        String prefix = String.format("https://%s.s3.%s.amazonaws.com/", bucketName, region);
        String key = urlOKey.startsWith(prefix) ? urlOKey.substring(prefix.length()) : urlOKey;
        eliminarDeS3(key);
    }

    private String guardarLocal(MultipartFile archivo, String nombreUnico) throws IOException {
        Path dir = Paths.get(localUploadPath).toAbsolutePath().normalize();
        Files.createDirectories(dir);
        archivo.transferTo(dir.resolve(nombreUnico).toFile());
        log.info("[ArchivoService] Archivo guardado localmente: {}", nombreUnico);
        return serverUrl + "/api/archivos/ver/" + nombreUnico;
    }

    /** Elimina caracteres no seguros para claves S3 (deja letras, números, guión y punto). */
    private static String sanitizar(String valor) {
        if (valor == null || valor.isBlank()) return "sistema";
        return valor.replaceAll("[^a-zA-Z0-9\\-_.]", "_");
    }

    @SuppressWarnings("unchecked")
    private void recolectarUrls(Object valor, Set<String> urls) {
        if (valor == null) return;
        if (valor instanceof Map<?, ?> mapa) {
            Object url = mapa.get("url");
            Object nombre = mapa.get("nombreOriginal");
            if (url instanceof String s && !s.isBlank() && nombre instanceof String) urls.add(s);
            for (Object child : mapa.values()) recolectarUrls(child, urls);
        } else if (valor instanceof Collection<?> col) {
            for (Object child : col) recolectarUrls(child, urls);
        }
    }

    private record ResultadoAlmacenamiento(String url, String tipo) {}
}
