package com.bpms.core.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.messaging.simp.config.ChannelRegistration;

/**
 * 👇 NUEVO Colaboración: configuración STOMP sobre WebSocket.
 *
 * Endpoint de conexión:  /ws-colaboracion (handshake HTTP → WS upgrade)
 * Prefijo de envíos:     /app/...      (cliente → servidor)
 * Prefijo de broadcasts: /topic/...    (servidor → cliente, broadcast)
 * Prefijo personal:      /user/queue/...(servidor → un solo cliente)
 *
 * El cliente debe mandar el JWT como header "Authorization: Bearer <token>"
 * en el frame CONNECT. Esto lo procesa JwtChannelInterceptor.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Autowired
    private JwtChannelInterceptor jwtChannelInterceptor;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // 👇 NUEVO: Permitimos orígenes dinámicos para Dev y Prod
        registry.addEndpoint("/ws-colaboracion")
                .setAllowedOriginPatterns(
                    "http://localhost:4200", 
                    "http://13.59.124.116", 
                    "http://13.59.124.116:8080",
                    "https://*.cloudfront.net"
                );
        // Sin SockJS: usamos WebSocket nativo.
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // Broker simple en memoria para /topic (broadcast) y /queue (personal).
        registry.enableSimpleBroker("/topic", "/queue");
        // Los clientes envían a /app/...
        registry.setApplicationDestinationPrefixes("/app");
        // Los mensajes a un user específico llevan prefijo /user/...
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // 👇 Inyecta el interceptor JWT en TODOS los mensajes entrantes.
        registration.interceptors(jwtChannelInterceptor);
    }
}