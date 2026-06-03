package com.bpms.core.models;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import lombok.Data;
import java.time.LocalDateTime;

@Data 
@Document(collection = "usuarios")
public class Usuario {

    @Id
    private String id;
    
    private String username;
    private String password;
    private String nombreCompleto;  // 👈 NUEVO
    private String email;           // 👈 NUEVO
    private String fcmToken; // 👈 NUEVO: Aquí guardaremos el token del teléfono

    private Rol rol; 
    private String departamentoId; 

    private String estadoDisponibilidad;
    private LocalDateTime ultimaConexion;
    private LocalDateTime fechaCreacion;

    public Usuario() {
    }

    public Usuario(String username, String password, Rol rol, String departamentoId) {
        this.username = username;
        this.password = password;
        this.rol = rol;
        this.departamentoId = departamentoId;
    }
}