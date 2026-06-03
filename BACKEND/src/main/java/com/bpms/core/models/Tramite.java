package com.bpms.core.models;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;
import lombok.Data;
import java.time.LocalDateTime;
import java.util.*;

@Data
@Document(collection = "tramites")
public class Tramite {

    @Id
    private String id;

    private String codigoSeguimiento;
    private String nombreProceso;
    private String descripcion;

    private String clienteId;
    private String procesoDefinicionId; // 👈 NUEVO — qué política sigue
    private String pasoActualId; // 👈 NUEVO — id del paso actual dentro de la política
    private String departamentoActualId;
    private String responsableActualId;

    private EstadoTramite estadoSemaforo;

    // ── CU24: metadatos predictivos ──────────────────────────────────────────
    /** Puntuación de riesgo de demora (0.0 – 1.0) calculada por TensorFlow. */
    private double  riesgoDemora        = 0.0;
    /** true si el modelo detectó un patrón atípico en este trámite. */
    private boolean esAnomalia          = false;
    /** NORMAL | ALTO | CRITICO — derivado del riesgo. */
    private String  nivelPrioridad      = "NORMAL";
    /** ID del funcionario recomendado por el modelo (puede ser null). */
    private String  funcionarioRecomendadoId;
    /** Explicación legible del nivel de riesgo. */
    private String  motivoPrediccion;

    private LocalDateTime fechaCreacion;
    private LocalDateTime fechaUltimaActualizacion;
    /** Marca el momento exacto en que el trámite entró en el paso actual (CU24). */
    private LocalDateTime fechaInicioStepActual;
    private TipoResponsable tipoResponsableActual;
    private String accionActor;
    private Map<String, Object> datosFormularioInicial = new HashMap<>();
    // 👇 NUEVOS CAMPOS para soportar paralelismo

    /**
     * Pasos que están activos simultáneamente (para flujos paralelos).
     * Si es secuencial, solo tiene 1 elemento (igual que pasoActualId).
     */
    private List<String> pasosActivosIds = new ArrayList<>();

    /**
     * Pasos ya completados en la ejecución actual.
     * Útil para gateways de join (cuando esperan que TODOS lleguen).
     */
    private List<String> pasosCompletadosIds = new ArrayList<>();

    /**
     * Contador de vueltas en bucles iterativos.
     * Previene bucles infinitos.
     */
    private Map<String, Integer> contadorIteraciones = new HashMap<>();

    public Tramite() {
        this.fechaCreacion = LocalDateTime.now();
        this.fechaUltimaActualizacion = LocalDateTime.now();
        this.fechaInicioStepActual = LocalDateTime.now();
        this.estadoSemaforo = EstadoTramite.EN_TIEMPO;
    }

    @org.springframework.data.annotation.Transient
    private java.util.Map<String, Object> datosFormulario;

    public java.util.Map<String, Object> getDatosFormulario() {
        return datosFormulario;
    }

    public void setDatosFormulario(java.util.Map<String, Object> datos) {
        this.datosFormulario = datos;
    }

    public List<String> getPasosActivosIds() {
        return pasosActivosIds;
    }

    public void setPasosActivosIds(List<String> pasos) {
        this.pasosActivosIds = pasos;
    }

    public List<String> getPasosCompletadosIds() {
        return pasosCompletadosIds;
    }

    public void setPasosCompletadosIds(List<String> pasos) {
        this.pasosCompletadosIds = pasos;
    }

    public Map<String, Integer> getContadorIteraciones() {
        return contadorIteraciones;
    }

    public void setContadorIteraciones(Map<String, Integer> c) {
        this.contadorIteraciones = c;
    }

    public TipoResponsable getTipoResponsableActual() {
        return tipoResponsableActual;
    }

    public void setTipoResponsableActual(TipoResponsable t) {
        this.tipoResponsableActual = t;
    }

    public Map<String, Object> getDatosFormularioInicial() {
        return datosFormularioInicial;
    }

    public void setDatosFormularioInicial(Map<String, Object> d) {
        this.datosFormularioInicial = d;
    }

    public String getAccionActor() {
        return accionActor;
    }

    public void setAccionActor(String accionActor) {
        this.accionActor = accionActor;
    }
}