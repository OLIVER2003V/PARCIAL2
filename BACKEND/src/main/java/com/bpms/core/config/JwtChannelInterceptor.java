package com.bpms.core.config;

import com.bpms.core.security.JwtUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 👇 NUEVO Colaboración: interceptor que valida el JWT en el frame CONNECT
 * de STOMP. Si el token es válido, "etiqueta" el principal del usuario en
 * la sesión WS para que los @MessageMapping puedan saber quién mandó qué.
 */
@Component
public class JwtChannelInterceptor implements ChannelInterceptor {

    @Autowired
    private JwtUtil jwtUtil;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null) return message;

        // Solo validamos en CONNECT. En frames posteriores el principal ya está pegado
        // a la sesión WS y se propaga automáticamente.
        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            String authHeader = obtenerAuthHeader(accessor);
            if (authHeader == null || !authHeader.startsWith("Bearer ")) {
                throw new IllegalArgumentException("⚠️ WS rechazado: token JWT ausente en el CONNECT");
            }

            String token = authHeader.substring(7);
            try {
                String username = jwtUtil.extractUsername(token);
                if (username == null || !jwtUtil.validateToken(token, username)) {
                    throw new IllegalArgumentException("⚠️ WS rechazado: token inválido o expirado");
                }

                // Construimos el Authentication sin roles específicos.
                // Para colaboración no necesitamos chequear ROL en cada mensaje;
                // ya filtramos eso en el controlador de invitación.
                UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
                        username,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_USER"))
                );
                accessor.setUser(auth);
                System.out.println("✅ WS conectado: " + username);
            } catch (Exception e) {
                throw new IllegalArgumentException("⚠️ WS rechazado: " + e.getMessage());
            }
        }
        return message;
    }

    private String obtenerAuthHeader(StompHeaderAccessor accessor) {
        // Buscamos el header "Authorization" tanto en nativeHeaders como en attributes.
        List<String> headers = accessor.getNativeHeader("Authorization");
        if (headers != null && !headers.isEmpty()) return headers.get(0);
        return null;
    }
}