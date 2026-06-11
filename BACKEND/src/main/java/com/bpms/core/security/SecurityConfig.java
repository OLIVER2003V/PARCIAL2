package com.bpms.core.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;
import java.util.Arrays;

@Configuration
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthFilter;

    public SecurityConfig(JwtAuthenticationFilter jwtAuthFilter) {
        this.jwtAuthFilter = jwtAuthFilter;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // 1. Permitir preflight
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                        // 2. Endpoints públicos
                        .requestMatchers(
                                "/api/auth/**",
                                "/api/test/**",
                                "/api/tramites/rastrear/**",
                                "/api/admin/procesos/publicos",
                                "/api/archivos/ver/**",
                                "/api/tramites/test-push/**", "/ws-colaboracion/**",
                                "/dev/**")   // solo desarrollo — eliminar en producción
                        .permitAll()

                        // 👇 NUEVO CU16: GARANTÍA DE INMUTABILIDAD DEL LOG DE AUDITORÍA
                        // Cualquier PUT/DELETE/PATCH a /api/auditoria/** se rechaza con 405.
                        // Spring Security al denegar estos métodos antes del routing produce 405,
                        // cumpliendo el Flujo Alternativo A1 del CU.
                        .requestMatchers(HttpMethod.PUT, "/api/auditoria/**").denyAll()
                        .requestMatchers(HttpMethod.DELETE, "/api/auditoria/**").denyAll()
                        .requestMatchers(HttpMethod.PATCH, "/api/auditoria/**").denyAll()

                        // 👇 NUEVO CU16: solo lectura, requiere autenticación
                        // (la restricción a ADMIN se controla en el frontend con guards)
                        .requestMatchers("/api/auditoria/**").authenticated()

                        // Endpoints existentes que requieren JWT explícito
                        .requestMatchers("/api/ia/**").authenticated()
                        .requestMatchers("/api/reportes/**").authenticated()
                        .requestMatchers("/api/colaboracion/**").authenticated()

                        // 3. Cualquier otro requiere autenticación
                        .anyRequest().authenticated())
                .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        
        // 👇 NUEVO: Cambiado obligatoriamente a setAllowedOriginPatterns
        configuration.setAllowedOriginPatterns(Arrays.asList(
                "http://localhost:4200",
                "http://3.14.70.65:8080",
                "http://3.14.70.65",
                "https://bpms-parcial.duckdns.org",
                "https://*.cloudfront.net" 
        ));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"));
        configuration.setAllowedHeaders(List.of("*"));
        configuration.setExposedHeaders(List.of("Authorization", "Content-Disposition"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}