package com.bpms.core.services;

import com.bpms.core.models.Usuario;
import com.bpms.core.repositories.UsuarioRepository;
import com.bpms.core.security.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

@Service
public class AuthService {

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtUtil jwtUtil;

    @Autowired
    private AuditService auditService;

    // Registro de nuevos usuarios
    public Usuario registrar(Usuario usuario) {
        // Encriptar la contraseña (asumimos que el Controller ya validó que no sea null)
        usuario.setPassword(passwordEncoder.encode(usuario.getPassword()));

        usuario.setFechaCreacion(LocalDateTime.now());
        if (usuario.getEstadoDisponibilidad() == null) {
            usuario.setEstadoDisponibilidad("DISPONIBLE");
        }

        Usuario guardado = usuarioRepository.save(usuario);

        // Registro en auditoría del auto-registro de cliente
        auditService.registrar(
                guardado.getUsername(),
                AuditService.CAT_AUTH,
                "AUTH_REGISTRO",
                "Auto-registro de cliente nuevo: " + guardado.getNombreCompleto() + " (" + guardado.getEmail() + ")"
        );

        return guardado;
    }

    // Proceso de Login
    public Map<String, String> login(String username, String password) {
        Usuario usuario = usuarioRepository.findByUsername(username)
                .orElse(null);

        if (usuario == null) {
            auditService.registrar(
                    username != null ? username : "ANONIMO",
                    AuditService.CAT_AUTH,
                    "AUTH_LOGIN_FALLIDO",
                    "Intento de login con usuario inexistente: " + username
            );
            throw new RuntimeException("Usuario no encontrado");
        }

        if (passwordEncoder.matches(password, usuario.getPassword())) {

            usuario.setUltimaConexion(LocalDateTime.now());
            usuarioRepository.save(usuario);

            String token = jwtUtil.generateToken(username);
            Map<String, String> response = new HashMap<>();
            response.put("token", token);
            response.put("username", usuario.getUsername());
            response.put("rol", usuario.getRol().name());

            if (usuario.getDepartamentoId() != null) {
                response.put("departamentoId", usuario.getDepartamentoId());
            }

            auditService.registrar(
                    usuario.getUsername(),
                    AuditService.CAT_AUTH,
                    "AUTH_LOGIN_OK",
                    "Inicio de sesión exitoso (rol: " + usuario.getRol().name() + ")"
            );

            return response;
        } else {
            auditService.registrar(
                    usuario.getUsername(),
                    AuditService.CAT_AUTH,
                    "AUTH_LOGIN_FALLIDO",
                    "Contraseña incorrecta para usuario: " + usuario.getUsername()
            );
            throw new RuntimeException("Contraseña incorrecta");
        }
    }
}