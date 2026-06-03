package com.bpms.core.services;

import com.bpms.core.dto.PrediccionDTO;
import com.bpms.core.models.Tramite;
import com.bpms.core.repositories.TramiteRepository;
import com.bpms.core.repositories.UsuarioRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * CU24 — Ejecuta la predicción ML y la notificación FCM en un hilo separado,
 * para no bloquear la respuesta HTTP al funcionario que procesa el trámite.
 */
@Service
public class PrediccionAsyncService {

    @Autowired private TramiteRepository  tramiteRepository;
    @Autowired private UsuarioRepository  usuarioRepository;
    @Autowired private PredictorService   predictorService;
    @Autowired private FirebasePushService pushService;

    /**
     * Carga el trámite por ID, llama al microservicio Python, guarda los
     * metadatos de riesgo y, si se detecta una anomalía, notifica a los admins.
     * Se ejecuta en el thread-pool de Spring (@Async) y nunca lanza excepción.
     */
    @Async
    public void predecirYNotificar(String tramiteId) {
        try {
            Tramite tramite = tramiteRepository.findById(tramiteId).orElse(null);
            if (tramite == null) return;

            PrediccionDTO pred = predictorService.predecir(tramite);
            tramite.setRiesgoDemora(pred.getRiesgoDemora());
            tramite.setEsAnomalia(pred.isEsAnomalia());
            tramite.setNivelPrioridad(pred.getNivelPrioridad() != null ? pred.getNivelPrioridad() : "NORMAL");
            tramite.setFuncionarioRecomendadoId(pred.getFuncionarioRecomendadoId());
            tramite.setMotivoPrediccion(pred.getMotivo());

            Tramite actualizado = tramiteRepository.save(tramite);

            if (actualizado.isEsAnomalia()) {
                notificarAdmins(actualizado);
            }
            if ("ALTO".equals(actualizado.getNivelPrioridad()) || "CRITICO".equals(actualizado.getNivelPrioridad())) {
                notificarFuncionario(actualizado);
            }
        } catch (Exception e) {
            System.err.println("[CU24-Async] Error en predicción: " + e.getMessage());
        }
    }

    private void notificarAdmins(Tramite tramite) {
        try {
            usuarioRepository.findAll().stream()
                .filter(u -> u.getRol() != null && u.getRol().name().equals("ADMIN"))
                .filter(u -> u.getFcmToken() != null && !u.getFcmToken().isBlank())
                .forEach(admin -> {
                    String titulo = "⚠️ Anomalía detectada — " + tramite.getCodigoSeguimiento();
                    String cuerpo = "El expediente \"" + tramite.getNombreProceso()
                        + "\" presenta un patrón atípico. " + tramite.getMotivoPrediccion();
                    pushService.enviarNotificacionPush(admin.getFcmToken(), titulo, cuerpo);
                });
        } catch (Exception e) {
            System.err.println("[CU24-Async] No se pudo notificar anomalía: " + e.getMessage());
        }
    }

    private void notificarFuncionario(Tramite tramite) {
        try {
            String responsableId = tramite.getResponsableActualId();
            if (responsableId == null || responsableId.isBlank()) return;

            usuarioRepository.findByUsername(responsableId).ifPresent(funcionario -> {
                if (funcionario.getFcmToken() == null || funcionario.getFcmToken().isBlank()) return;
                String nivel = tramite.getNivelPrioridad();
                String titulo = ("CRITICO".equals(nivel) ? "🔴 Expediente crítico" : "🟡 Expediente prioritario")
                        + " — " + tramite.getCodigoSeguimiento();
                String cuerpo = "\"" + tramite.getNombreProceso() + "\" requiere atención urgente. "
                        + tramite.getMotivoPrediccion();
                pushService.enviarNotificacionPush(funcionario.getFcmToken(), titulo, cuerpo);
            });
        } catch (Exception e) {
            System.err.println("[CU24-Async] No se pudo notificar al funcionario: " + e.getMessage());
        }
    }
}
