package com.bpms.core.repositories;

import com.bpms.core.models.Tramite;
import com.bpms.core.models.TipoResponsable;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface TramiteRepository extends MongoRepository<Tramite, String> {

    // === Búsquedas por departamento (funcionarios) ===
    List<Tramite> findByDepartamentoActualId(String departamentoId);

    // === Búsquedas por cliente ===
    List<Tramite> findByClienteIdOrderByFechaCreacionDesc(String clienteId);


    List<Tramite> findByClienteIdAndTipoResponsableActual(String clienteId, TipoResponsable tipo);

    // === Búsquedas para Minería de Procesos ===
    List<Tramite> findByProcesoDefinicionId(String procesoDefinicionId);

    // === Código de seguimiento (rastreo público) ===
    Optional<Tramite> findByCodigoSeguimiento(String codigo);

    // === Conteo por estado (para dashboard) ===
    @Query(value = "{ 'estadoSemaforo': ?0 }", count = true)
    long contarPorEstado(String estado);

    // === CU24: anomalías detectadas por IA ===
    List<Tramite> findByEsAnomaliaTrue();

    // === CU24: conteos por nivel de prioridad (evita findAll en el monitor) ===
    @Query(value = "{ 'nivelPrioridad': ?0 }", count = true)
    long contarPorNivel(String nivel);

    @Query(value = "{ 'esAnomalia': true }", count = true)
    long contarAnomalias();

    // === CU24: conteo de trámites activos por departamento (excluye terminados) ===
    @Query(value = "{ 'departamentoActualId': ?0, 'estadoSemaforo': { $nin: ['APROBADO', 'RECHAZADO'] } }", count = true)
    long contarActivosPorDepartamento(String departamentoId);

    // === CU24: top N críticos para Monitor IA ===
    List<Tramite> findTop10ByNivelPrioridadOrderByFechaUltimaActualizacionDesc(String nivel);

    // === CU24: conteos por departamento para gráfico Monitor IA ===
    @Query(value = "{ 'departamentoActualId': ?0 }", count = true)
    long contarPorDepartamento(String departamentoId);

    @Query(value = "{ 'departamentoActualId': ?0, 'nivelPrioridad': ?1 }", count = true)
    long contarPorDepartamentoYNivel(String departamentoId, String nivel);
}