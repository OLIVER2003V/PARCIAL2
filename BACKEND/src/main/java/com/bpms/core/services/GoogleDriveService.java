package com.bpms.core.services;

import com.google.api.client.googleapis.auth.oauth2.GoogleCredential;
import com.google.api.client.googleapis.javanet.GoogleNetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import com.google.api.services.drive.Drive;
import com.google.api.services.drive.DriveScopes;
import com.google.api.services.drive.model.File;
import com.google.api.services.drive.model.Permission;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Service
public class GoogleDriveService {

    private static final String APP_NAME = "BPMS-Workflow";
    private static final String MIME_DOC   = "application/vnd.google-apps.document";
    private static final String MIME_SHEET = "application/vnd.google-apps.spreadsheet";

    @Value("${google.drive.parent-folder-id:}")
    private String parentFolderId;

    @Value("${google.drive.oauth.client-id:}")
    private String oauthClientId;

    @Value("${google.drive.oauth.client-secret:}")
    private String oauthClientSecret;

    @Value("${google.drive.oauth.refresh-token:}")
    private String oauthRefreshToken;

    public record GoogleDocInfo(String docId, String editUrl, String embedUrl) {}

    public GoogleDocInfo crearDocumento(String nombre, String tipo) throws IOException {
        Drive drive = buildDriveService();

        String mimeType = "documento-texto".equals(tipo) ? MIME_DOC : MIME_SHEET;

        File metadata = new File();
        metadata.setName(nombre);
        metadata.setMimeType(mimeType);
        if (parentFolderId != null && !parentFolderId.isBlank()) {
            metadata.setParents(List.of(parentFolderId));
            System.out.println("[GoogleDrive] Usando carpeta padre: " + parentFolderId);
        } else {
            System.out.println("[GoogleDrive] ADVERTENCIA: parentFolderId vacío, creando en raíz de cuenta de servicio");
        }

        File created = drive.files().create(metadata)
                .setFields("id,webViewLink")
                .execute();

        String docId = created.getId();

        // Compartir: cualquiera con el enlace puede editar (sin login de Google)
        Permission perm = new Permission();
        perm.setType("anyone");
        perm.setRole("writer");
        drive.permissions().create(docId, perm).execute();

        return new GoogleDocInfo(docId, created.getWebViewLink(), buildEmbedUrl(docId, tipo));
    }

    /** Elimina TODOS los archivos de la cuenta de servicio. Usar solo para limpiar cuota. */
    public int limpiarTodosLosArchivos() throws IOException {
        Drive drive = buildDriveService();
        List<String> ids = new ArrayList<>();
        String pageToken = null;
        do {
            var result = drive.files().list()
                    .setQ("trashed = false")
                    .setFields("nextPageToken, files(id)")
                    .setPageSize(100)
                    .setPageToken(pageToken)
                    .execute();
            if (result.getFiles() != null) {
                result.getFiles().forEach(f -> ids.add(f.getId()));
            }
            pageToken = result.getNextPageToken();
        } while (pageToken != null);

        for (String id : ids) {
            drive.files().delete(id).execute();
        }
        return ids.size();
    }

    private String buildEmbedUrl(String docId, String tipo) {
        if ("documento-texto".equals(tipo)) {
            return "https://docs.google.com/document/d/" + docId + "/edit?usp=sharing";
        }
        return "https://docs.google.com/spreadsheets/d/" + docId + "/edit?usp=sharing";
    }

    /**
     * Usa OAuth2 de usuario real (refresh token) para que los archivos queden
     * en la cuenta personal y no en la cuenta de servicio (que tiene cuota 0).
     * Si no hay credenciales OAuth configuradas, cae back a la cuenta de servicio.
     */
    @SuppressWarnings("deprecation")
    private Drive buildDriveService() throws IOException {
        try {
            GoogleCredential credential;

            if (oauthRefreshToken != null && !oauthRefreshToken.isBlank()) {
                // Credenciales OAuth2 de usuario personal
                credential = new GoogleCredential.Builder()
                        .setTransport(GoogleNetHttpTransport.newTrustedTransport())
                        .setJsonFactory(GsonFactory.getDefaultInstance())
                        .setClientSecrets(oauthClientId, oauthClientSecret)
                        .build()
                        .setRefreshToken(oauthRefreshToken);
                credential.refreshToken();
            } else {
                // Fallback: cuenta de servicio (puede fallar por cuota)
                credential = GoogleCredential
                        .fromStream(new ClassPathResource("firebase-service-account.json").getInputStream())
                        .createScoped(Collections.singletonList(DriveScopes.DRIVE));
            }

            return new Drive.Builder(
                    GoogleNetHttpTransport.newTrustedTransport(),
                    GsonFactory.getDefaultInstance(),
                    credential)
                    .setApplicationName(APP_NAME)
                    .build();
        } catch (Exception e) {
            throw new IOException("No se pudo inicializar Google Drive: " + e.getMessage(), e);
        }
    }
}
