package com.bpms.core.services; // 👈 CRÍTICO: Debe estar en este paquete

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.Notification;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.io.InputStream;

@Service // 👈 CRÍTICO: Sin esto, Spring Boot ignora la clase
public class FirebasePushService {


    @PostConstruct
    public void init() {
        System.out.println("\n======================================================");
        System.out.println("🚀 INICIANDO SERVICIO DE FIREBASE PUSH...");
        try {
            ClassPathResource resource = new ClassPathResource("firebase-service-account.json");

            if (!resource.exists()) {
                System.err.println("❌ ERROR FATAL: No se encuentra el archivo JSON");
                System.out.println("======================================================\n");
                return;
            }

            InputStream inputStream = resource.getInputStream();
            if (FirebaseApp.getApps().isEmpty()) {
                FirebaseOptions options = FirebaseOptions.builder()
                        .setCredentials(GoogleCredentials.fromStream(inputStream))
                        .build();
                FirebaseApp.initializeApp(options);
                System.out.println("✅ Firebase Admin SDK inicializado CON ÉXITO.");
            }
        } catch (Exception e) {
            System.err.println("❌ Error CRÍTICO inicializando Firebase:");
            e.printStackTrace();
        }
        System.out.println("======================================================\n");
    }

    public void enviarNotificacionPush(String fcmToken, String titulo, String cuerpo) {
        try {
            Notification notification = Notification.builder()
                    .setTitle(titulo)
                    .setBody(cuerpo)
                    .build();

            Message message = Message.builder()
                    .setToken(fcmToken)
                    .setNotification(notification)
                    .build();

            String response = FirebaseMessaging.getInstance().send(message);
            System.out.println("✅ Notificación enviada con éxito: " + response);

        } catch (Exception e) {
            System.err.println("❌ Error enviando Notificación: " + e.getMessage());
        }
    }
}