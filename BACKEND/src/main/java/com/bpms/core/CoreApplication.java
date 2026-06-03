package com.bpms.core;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class CoreApplication {

    public static void main(String[] args) {
        // 1. INYECTAMOS LA URL A LA FUERZA (Ignorando cualquier archivo configuration)
        System.setProperty("spring.data.mongodb.uri", "mongodb+srv://admin_bpms:Admin2026@cluster0.porjqan.mongodb.net/bpms_db");
        
        // 2. ARRANCAMOS LA APLICACIÓN
        SpringApplication.run(CoreApplication.class, args);
    }
}