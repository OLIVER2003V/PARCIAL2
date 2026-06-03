package com.bpms.core.services;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

/**
 * 👇 NUEVO Colaboración: genera y valida tokens de invitación a salas.
 *
 * Un token incluye:
 *  - sub: username del invitador (quien generó el link)
 *  - procesoId: la política a colaborar
 *  - exp: 24 horas
 *
 * El cliente recibe un link tipo /colaborar/{token}.
 * Al abrirlo, el guard valida el token, extrae el procesoId y entra a la sala.
 */
@Service
public class InvitacionService {

    // Secret distinto al de auth principal, específico para invitaciones.
    // En producción debería estar en application.properties.
    private static final String INVITE_SECRET =
            "5142794F614413F5Eb5ATM3QtP4F8Y4u4q4D5f6G7h8J9k0L1m2N3o4P5q6R7s8T9";

    private static final long DURACION_MS = 1000L * 60 * 60 * 24; // 24 horas

    /**
     * Genera un token de invitación.
     */
    public String generarToken(String invitador, String procesoId) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("procesoId", procesoId);
        claims.put("tipo", "INVITACION_COLABORACION");

        return Jwts.builder()
                .setClaims(claims)
                .setSubject(invitador)
                .setIssuedAt(new Date())
                .setExpiration(new Date(System.currentTimeMillis() + DURACION_MS))
                .signWith(getKey(), SignatureAlgorithm.HS256)
                .compact();
    }

    /**
     * Valida y devuelve los datos del token.
     * Lanza excepción si está expirado, malformado o tiene firma inválida.
     */
    public DatosInvitacion validarToken(String token) {
        Claims claims = Jwts.parserBuilder()
                .setSigningKey(getKey())
                .build()
                .parseClaimsJws(token)
                .getBody();

        String tipo = claims.get("tipo", String.class);
        if (!"INVITACION_COLABORACION".equals(tipo)) {
            throw new IllegalArgumentException("Tipo de token inválido");
        }

        DatosInvitacion datos = new DatosInvitacion();
        datos.invitador = claims.getSubject();
        datos.procesoId = claims.get("procesoId", String.class);
        datos.expiracion = claims.getExpiration();
        return datos;
    }

    private Key getKey() {
        byte[] keyBytes = Decoders.BASE64.decode(INVITE_SECRET);
        return Keys.hmacShaKeyFor(keyBytes);
    }

    /**
     * Wrapper público de los datos extraídos de un token de invitación.
     */
    public static class DatosInvitacion {
        public String invitador;
        public String procesoId;
        public Date expiracion;
    }
}