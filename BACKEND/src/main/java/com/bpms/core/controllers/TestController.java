package com.bpms.core.controllers;

import com.bpms.core.models.Rol;
import com.bpms.core.models.Usuario;
import com.bpms.core.repositories.UsuarioRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder; // <-- 1. Importamos la herramienta
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/test")
public class TestController {

    @Autowired
    private UsuarioRepository usuarioRepository;

    @Autowired
    private PasswordEncoder passwordEncoder; // <-- 2. Inyectamos la máquina encriptadora aquí

    @GetMapping("/crear-admin")
    public String crearAdmin() {
        // Creamos un usuario de prueba
        Usuario nuevoAdmin = new Usuario("admin_real", passwordEncoder.encode("SuperPassword123"), Rol.ADMIN, null);
        usuarioRepository.save(nuevoAdmin);
        
        return "Administrador creado con éxito";
    }

    @GetMapping("/secreto")
    public String rutaSecreta() {
        return "¡Felicidades! Entraste a la Bóveda Secreta con un Token válido.";
 
    }
    // ... tu código anterior ...

    @GetMapping("/limpiar-usuarios")
    public String limpiarUsuarios() {
        usuarioRepository.deleteAll();
        return "💥 Base de datos de usuarios formateada. Todos los clones fueron eliminados. Ahora ve a /crear-admin (¡SOLO UNA VEZ!)";
    }
}