package com.bpms.core.services;

import com.bpms.core.dto.colaboracion.PresenciaUsuario;
import com.bpms.core.models.Usuario;
import com.bpms.core.repositories.UsuarioRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 👇 NUEVO Colaboración: maneja en memoria el estado de las salas activas.
 *
 * Estructura: Map<procesoId, Map<username, PresenciaUsuario>>
 * - Concurrent para soportar conexiones simultáneas sin race conditions
 * - Volátil: si el servidor reinicia, las salas se pierden (los clientes
 *   se reconectan y reconstruyen el estado). Esto es aceptable porque el
 *   borrador real está en BD vía BorradorService.
 *
 * Asignación de colores: hash determinista del username, así el mismo
 * usuario siempre tiene el mismo color en cualquier sala.
 */
@Service
public class SesionColaborativaService {

    @Autowired
    private UsuarioRepository usuarioRepository;

    // Paleta de colores agradables para distinguir usuarios.
    // Coinciden con la convención del proyecto (purple, blue, emerald, amber, etc.)
    private static final String[] PALETA_COLORES = {
            "#a855f7", // purple-500
            "#3b82f6", // blue-500
            "#10b981", // emerald-500
            "#f59e0b", // amber-500
            "#ef4444", // red-500
            "#06b6d4", // cyan-500
            "#ec4899", // pink-500
            "#84cc16"  // lime-500
    };

    // procesoId → (username → PresenciaUsuario)
    private final Map<String, Map<String, PresenciaUsuario>> salas = new ConcurrentHashMap<>();

    /**
     * Agrega un usuario a la sala. Si ya estaba (reconexión), actualiza su entrada.
     * Devuelve la lista actualizada de presencias en la sala.
     */
    public List<PresenciaUsuario> unirAUsuario(String procesoId, String username) {
        Map<String, PresenciaUsuario> sala = salas.computeIfAbsent(procesoId, k -> new ConcurrentHashMap<>());

        PresenciaUsuario presencia = construirPresencia(username);
        sala.put(username, presencia);

        System.out.println("👋 [Colaboración] " + username + " entró a sala " + procesoId
                + " (total: " + sala.size() + ")");
        return new ArrayList<>(sala.values());
    }

    /**
     * Quita al usuario de la sala. Devuelve true si la sala quedó vacía
     * (útil para que el caller decida si liberar recursos).
     */
    public boolean removerUsuario(String procesoId, String username) {
        Map<String, PresenciaUsuario> sala = salas.get(procesoId);
        if (sala == null) return true;

        sala.remove(username);
        System.out.println("👋 [Colaboración] " + username + " salió de sala " + procesoId
                + " (quedan: " + sala.size() + ")");

        if (sala.isEmpty()) {
            salas.remove(procesoId);
            return true;
        }
        return false;
    }

    /**
     * Devuelve la lista actual de conectados en una sala (snapshot).
     */
    public List<PresenciaUsuario> obtenerConectados(String procesoId) {
        Map<String, PresenciaUsuario> sala = salas.get(procesoId);
        if (sala == null) return Collections.emptyList();
        return new ArrayList<>(sala.values());
    }

    /**
     * Obtiene una presencia específica (útil al recibir cursores/cambios
     * para "etiquetar" el evento con info del emisor sin reconstruirla).
     */
    public PresenciaUsuario obtenerPresencia(String procesoId, String username) {
        Map<String, PresenciaUsuario> sala = salas.get(procesoId);
        if (sala == null) return null;
        return sala.get(username);
    }

    /**
     * Construye la PresenciaUsuario consultando la BD para datos completos.
     * Si no encuentra el usuario, devuelve uno mínimo con valores por defecto.
     */
    private PresenciaUsuario construirPresencia(String username) {
        Optional<Usuario> userOpt = usuarioRepository.findByUsername(username);

        String nombreCompleto = userOpt.map(Usuario::getNombreCompleto).orElse(username);
        if (nombreCompleto == null || nombreCompleto.isBlank()) nombreCompleto = username;

        String color = colorParaUsuario(username);
        String iniciales = calcularIniciales(nombreCompleto);

        return new PresenciaUsuario(username, nombreCompleto, color, iniciales);
    }

    /**
     * Color determinista por username: mismo user → mismo color siempre.
     */
    private String colorParaUsuario(String username) {
        int hash = Math.abs(username.hashCode());
        return PALETA_COLORES[hash % PALETA_COLORES.length];
    }

    /**
     * Iniciales para mostrar en avatar circular: "Oliver Ventura" → "OV"
     */
    private String calcularIniciales(String nombreCompleto) {
        String[] partes = nombreCompleto.trim().split("\\s+");
        if (partes.length == 0) return "?";
        if (partes.length == 1) return partes[0].substring(0, Math.min(2, partes[0].length())).toUpperCase();
        return ("" + partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
    }

    /**
     * Total de salas activas (útil para métricas/debug).
     */
    public int totalSalasActivas() {
        return salas.size();
    }
}