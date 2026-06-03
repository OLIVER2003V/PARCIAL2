package com.bpms.core.controllers;

import com.bpms.core.models.Rol;
import com.bpms.core.models.Usuario;
import com.bpms.core.services.AuthService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    @Autowired
    private AuthService authService;
    @Autowired
    private com.bpms.core.repositories.UsuarioRepository usuarioRepository;

    // 👇 NUEVO: Endpoint para que el celular mande su token
    // 👇 CAMBIO: Recibir username y token explícitamente
    @PostMapping("/guardar-token-push")
    public ResponseEntity<?> guardarTokenPush(@RequestBody java.util.Map<String, String> body) {
        String username = body.get("username");
        String fcmToken = body.get("fcmToken");

        if (username == null || fcmToken == null) {
            return ResponseEntity.badRequest().body("Faltan datos");
        }

        usuarioRepository.findByUsername(username).ifPresent(usuario -> {
            usuario.setFcmToken(fcmToken);
            usuarioRepository.save(usuario);
            System.out.println("✅ Token guardado para el usuario: " + username);
        });

        return ResponseEntity.ok("Token actualizado");
    }

    @PostMapping("/register")
    public ResponseEntity<?> registrar(@RequestBody Usuario usuario) {
        
        // 1. Validaciones básicas de campos obligatorios para BPMS
        if (usuario.getUsername() == null || usuario.getUsername().trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "El nombre de usuario es obligatorio"));
        }
        if (usuario.getPassword() == null || usuario.getPassword().length() < 6) {
            return ResponseEntity.badRequest().body(Map.of("message", "La contraseña debe tener al menos 6 caracteres"));
        }
        if (usuario.getNombreCompleto() == null || usuario.getNombreCompleto().trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "El nombre completo es obligatorio"));
        }
        if (usuario.getEmail() == null || !usuario.getEmail().contains("@")) {
            return ResponseEntity.badRequest().body(Map.of("message", "El correo electrónico es inválido o está vacío"));
        }

        // 2. Comprobar si el usuario ya existe (para no sobreescribir ni romper la base de datos)
        if (usuarioRepository.findByUsername(usuario.getUsername()).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("message", "El nombre de usuario ya está en uso"));
        }

        // 3. Configuración por defecto para nuevos ciudadanos/clientes
        usuario.setRol(Rol.CLIENTE);
        usuario.setDepartamentoId(null); // Los clientes no pertenecen a un departamento
        
        try {
            Usuario nuevoUsuario = authService.registrar(usuario);
            // Quitamos la contraseña de la respuesta por seguridad
            nuevoUsuario.setPassword(null);
            return ResponseEntity.ok(nuevoUsuario);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Error al procesar el registro: " + e.getMessage()));
        }
    }

    @PostMapping("/login")
    public Map<String, String> login(@RequestBody Map<String, String> credentials) {
        return authService.login(credentials.get("username"), credentials.get("password"));
    }
}