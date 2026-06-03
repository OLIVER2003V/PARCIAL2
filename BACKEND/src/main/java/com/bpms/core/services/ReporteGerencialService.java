package com.bpms.core.services;

import com.bpms.core.dto.reportes.*;
import com.bpms.core.models.*;
import com.bpms.core.repositories.*;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.aggregation.*;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 👇 NUEVO CU13: Service que construye el Reporte Gerencial completo.
 * Usa Mongo Aggregation Framework para todas las sumarizaciones
 * (evita traer miles de documentos a memoria).
 */
@Service
public class ReporteGerencialService {

    @Autowired private MongoTemplate mongoTemplate;
    @Autowired private TramiteRepository tramiteRepository;
    @Autowired private AuditLogRepository auditLogRepository;
    @Autowired private DepartamentoRepository departamentoRepository;
    @Autowired private ProcesoDefinicionRepository procesoRepository;
    @Autowired private UsuarioRepository usuarioRepository;

    // ==========================================================================
    // MÉTODO PRINCIPAL - Arma el reporte completo
    // ==========================================================================

    public ReporteGerencialDTO generarReporte(FiltrosReporteRequest req, String generadoPor) {
        // Validar rango de fechas
        if (req.getFechaInicio() == null || req.getFechaFin() == null) {
            throw new IllegalArgumentException("El rango de fechas es obligatorio");
        }
        if (req.getFechaInicio().isAfter(req.getFechaFin())) {
            throw new IllegalArgumentException("La fecha de inicio no puede ser posterior a la fecha de fin");
        }

        ReporteGerencialDTO dto = new ReporteGerencialDTO();
        dto.setFechaGeneracion(LocalDateTime.now());
        dto.setGeneradoPor(generadoPor);
        dto.setFiltros(construirFiltrosAplicados(req));

        // Traer los trámites del periodo UNA VEZ (los reutilizamos en todas las secciones)
        List<Tramite> tramites = buscarTramitesFiltrados(req);

        // 👇 FLUJO A1: si no hay datos, cortamos aquí
        if (tramites.isEmpty()) {
            dto.setSinDatos(true);
            dto.setMensajeSinDatos("No hay registros para el período seleccionado");
            return dto;
        }

        // Calcular cada sección
        dto.setResumenEjecutivo(calcularResumenEjecutivo(tramites, req));
        dto.setDesempenioDepartamentos(calcularDesempenioDepartamentos(tramites, req));
        dto.setDesempenioPoliticas(calcularDesempenioPoliticas(tramites));
        dto.setTendenciaTemporal(calcularTendenciaTemporal(tramites, req));

        return dto;
    }

    // ==========================================================================
    // BÚSQUEDA BASE - Los trámites del periodo filtrado
    // ==========================================================================

    private List<Tramite> buscarTramitesFiltrados(FiltrosReporteRequest req) {
        LocalDateTime inicio = req.getFechaInicio().atStartOfDay();
        LocalDateTime fin = req.getFechaFin().atTime(23, 59, 59);

        Criteria criteria = Criteria.where("fechaCreacion").gte(inicio).lte(fin);

        if (req.getDepartamentoId() != null && !req.getDepartamentoId().isBlank()) {
            criteria = criteria.and("departamentoActualId").is(req.getDepartamentoId());
        }
        if (req.getProcesoDefinicionId() != null && !req.getProcesoDefinicionId().isBlank()) {
            criteria = criteria.and("procesoDefinicionId").is(req.getProcesoDefinicionId());
        }

        org.springframework.data.mongodb.core.query.Query query =
            new org.springframework.data.mongodb.core.query.Query(criteria);
        return mongoTemplate.find(query, Tramite.class);
    }

    private FiltrosAplicadosDTO construirFiltrosAplicados(FiltrosReporteRequest req) {
        FiltrosAplicadosDTO f = new FiltrosAplicadosDTO();
        f.setFechaInicio(req.getFechaInicio());
        f.setFechaFin(req.getFechaFin());
        f.setDepartamentoId(req.getDepartamentoId());
        f.setProcesoDefinicionId(req.getProcesoDefinicionId());

        // Resolver nombres legibles para la cabecera del PDF
        if (req.getDepartamentoId() != null && !req.getDepartamentoId().isBlank()) {
            departamentoRepository.findById(req.getDepartamentoId())
                .ifPresent(d -> f.setDepartamentoNombre(d.getNombre()));
        }
        if (req.getProcesoDefinicionId() != null && !req.getProcesoDefinicionId().isBlank()) {
            procesoRepository.findById(req.getProcesoDefinicionId())
                .ifPresent(p -> f.setProcesoNombre(p.getNombre() + " v" + p.getNumeroVersion()));
        }
        return f;
    }

    // ==========================================================================
    // SECCIÓN 1 - RESUMEN EJECUTIVO
    // ==========================================================================

    private ResumenEjecutivoDTO calcularResumenEjecutivo(List<Tramite> tramites, FiltrosReporteRequest req) {
        ResumenEjecutivoDTO r = new ResumenEjecutivoDTO();

        long total = tramites.size();
        long aprobados = tramites.stream().filter(t -> t.getEstadoSemaforo() == EstadoTramite.APROBADO).count();
        long rechazados = tramites.stream().filter(t -> t.getEstadoSemaforo() == EstadoTramite.RECHAZADO).count();
        long completados = aprobados + rechazados;
        long enCurso = total - completados;

        r.setTotalTramites(total);
        r.setTramitesAprobados(aprobados);
        r.setTramitesRechazados(rechazados);
        r.setTramitesCompletados(completados);
        r.setTramitesEnCurso(enCurso);

        // Tasas (evitar división por cero)
        r.setTasaFinalizacion(total > 0 ? porcentaje(completados, total) : 0);
        r.setTasaAprobacion(completados > 0 ? porcentaje(aprobados, completados) : 0);
        r.setTasaRechazo(completados > 0 ? porcentaje(rechazados, completados) : 0);

        // Retrabajo: trámites con alguna iteración > 1
        long conRetrabajo = tramites.stream()
            .filter(t -> t.getContadorIteraciones() != null &&
                         t.getContadorIteraciones().values().stream().anyMatch(v -> v != null && v > 1))
            .count();
        r.setTasaRetrabajo(total > 0 ? porcentaje(conRetrabajo, total) : 0);

        // Lead Time (solo sobre trámites completados para no sesgar con los que siguen abiertos)
        List<Double> leadTimes = tramites.stream()
            .filter(t -> t.getEstadoSemaforo() == EstadoTramite.APROBADO ||
                         t.getEstadoSemaforo() == EstadoTramite.RECHAZADO)
            .filter(t -> t.getFechaCreacion() != null && t.getFechaUltimaActualizacion() != null)
            .map(t -> (double) ChronoUnit.MINUTES.between(t.getFechaCreacion(), t.getFechaUltimaActualizacion()) / 60.0)
            .filter(h -> h >= 0) // defensivo
            .sorted()
            .collect(Collectors.toList());

        if (!leadTimes.isEmpty()) {
            double promedio = leadTimes.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            double mediana = leadTimes.get(leadTimes.size() / 2);
            double maximo = leadTimes.get(leadTimes.size() - 1);
            r.setLeadTimePromedioHoras(redondear(promedio));
            r.setLeadTimeMedianaHoras(redondear(mediana));
            r.setLeadTimeMaximoHoras(redondear(maximo));
        }

        // Throughput
        long diasRango = ChronoUnit.DAYS.between(req.getFechaInicio(), req.getFechaFin()) + 1;
        r.setDiasDelRango((int) diasRango);
        r.setThroughputDiarioPromedio(diasRango > 0 ? redondear((double) completados / diasRango) : 0);

        return r;
    }

    // ==========================================================================
    // SECCIÓN 2 - PRODUCTIVIDAD POR DEPARTAMENTO
    // ==========================================================================

    private List<DepartamentoDesempenioDTO> calcularDesempenioDepartamentos(
            List<Tramite> tramites, FiltrosReporteRequest req) {

        // IDs de trámites del periodo (para filtrar AuditLogs)
        List<String> tramiteIds = tramites.stream().map(Tramite::getId).collect(Collectors.toList());
        if (tramiteIds.isEmpty()) return new ArrayList<>();

        // Traer los AuditLogs de estos trámites
        List<AuditLog> logs = mongoTemplate.find(
            new org.springframework.data.mongodb.core.query.Query(
                Criteria.where("tramiteId").in(tramiteIds)
            ), AuditLog.class);

        // Agrupar logs por departamento
        Map<String, List<AuditLog>> logsPorDepto = logs.stream()
            .filter(l -> l.getDepartamentoId() != null && !l.getDepartamentoId().isBlank())
            .filter(l -> !esDepartamentoVirtual(l.getDepartamentoId()))
            .collect(Collectors.groupingBy(AuditLog::getDepartamentoId));

        // Cargar nombres de departamentos en un mapa
        Map<String, String> nombresDepto = departamentoRepository.findAll().stream()
            .collect(Collectors.toMap(Departamento::getId, Departamento::getNombre));

        // Calcular tiempos de permanencia por departamento
        // Agrupamos logs POR TRÁMITE para reconstruir cronología
        Map<String, List<AuditLog>> logsPorTramite = logs.stream()
            .collect(Collectors.groupingBy(AuditLog::getTramiteId));

        // Estructura: deptoId → lista de minutos de permanencia (cada entrada es un handoff)
        Map<String, List<Long>> tiemposPorDepto = new HashMap<>();

        for (List<AuditLog> logsTramite : logsPorTramite.values()) {
            // Ordenar cronológicamente
            logsTramite.sort(Comparator.comparing(AuditLog::getFechaTimestamp));

            // El tiempo que un trámite PERMANECIÓ en un depto =
            // tiempo entre que llegó (log anterior) y salió (log actual con ese depto)
            for (int i = 0; i < logsTramite.size() - 1; i++) {
                AuditLog actual = logsTramite.get(i);
                AuditLog siguiente = logsTramite.get(i + 1);
                if (actual.getDepartamentoId() == null || esDepartamentoVirtual(actual.getDepartamentoId())) continue;

                long minutos = ChronoUnit.MINUTES.between(actual.getFechaTimestamp(), siguiente.getFechaTimestamp());
                if (minutos < 0) continue;
                tiemposPorDepto.computeIfAbsent(actual.getDepartamentoId(), k -> new ArrayList<>()).add(minutos);
            }
        }

        // Carga activa (WIP): cuántos trámites están AHORA en cada depto
        Map<String, Long> wipPorDepto = tramiteRepository.findAll().stream()
            .filter(t -> t.getDepartamentoActualId() != null && !esDepartamentoVirtual(t.getDepartamentoActualId()))
            .filter(t -> t.getEstadoSemaforo() != EstadoTramite.APROBADO &&
                         t.getEstadoSemaforo() != EstadoTramite.RECHAZADO)
            .collect(Collectors.groupingBy(Tramite::getDepartamentoActualId, Collectors.counting()));

        // Top funcionario por departamento
        Map<String, Map<String, Long>> accionesPorDeptoUsuario = logs.stream()
            .filter(l -> l.getDepartamentoId() != null && !esDepartamentoVirtual(l.getDepartamentoId()))
            .filter(l -> l.getUsuarioId() != null && !l.getUsuarioId().isBlank())
            .collect(Collectors.groupingBy(
                AuditLog::getDepartamentoId,
                Collectors.groupingBy(AuditLog::getUsuarioId, Collectors.counting())
            ));

        // Construir el resultado
        List<DepartamentoDesempenioDTO> resultado = new ArrayList<>();
        for (Map.Entry<String, List<AuditLog>> e : logsPorDepto.entrySet()) {
            String deptoId = e.getKey();
            List<AuditLog> logsDepto = e.getValue();

            DepartamentoDesempenioDTO d = new DepartamentoDesempenioDTO();
            d.setDepartamentoId(deptoId);
            d.setDepartamentoNombre(nombresDepto.getOrDefault(deptoId, "Desconocido"));
            d.setAccionesRegistradas(logsDepto.size());

            // Trámites únicos que pasaron por este depto
            long tramitesProcesados = logsDepto.stream().map(AuditLog::getTramiteId).distinct().count();
            d.setTramitesProcesados(tramitesProcesados);

            d.setCargaActivaActual(wipPorDepto.getOrDefault(deptoId, 0L));

            // Tiempos de permanencia
            List<Long> tiempos = tiemposPorDepto.getOrDefault(deptoId, new ArrayList<>());
            if (!tiempos.isEmpty()) {
                double prom = tiempos.stream().mapToLong(Long::longValue).average().orElse(0) / 60.0;
                double max = tiempos.stream().mapToLong(Long::longValue).max().orElse(0) / 60.0;
                d.setTiempoPromedioPermanenciaHoras(redondear(prom));
                d.setTiempoMaximoPermanenciaHoras(redondear(max));
            }

            // Top funcionario
            Map<String, Long> usuariosDepto = accionesPorDeptoUsuario.getOrDefault(deptoId, new HashMap<>());
            usuariosDepto.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .ifPresent(top -> {
                    d.setTopFuncionarioUsername(top.getKey());
                    d.setTopFuncionarioAcciones(top.getValue());
                });

            resultado.add(d);
        }

        // Ordenar por volumen descendente
        resultado.sort((a, b) -> Long.compare(b.getTramitesProcesados(), a.getTramitesProcesados()));
        return resultado;
    }

    private boolean esDepartamentoVirtual(String id) {
        return "PORTAL_WEB".equals(id) || "SISTEMA".equals(id) || "ARCHIVADO".equals(id);
    }

    // ==========================================================================
    // SECCIÓN 3 - DESEMPEÑO POR POLÍTICA DE NEGOCIO
    // ==========================================================================

    private List<PoliticaDesempenioDTO> calcularDesempenioPoliticas(List<Tramite> tramites) {
        // Agrupar trámites por política
        Map<String, List<Tramite>> porPolitica = tramites.stream()
            .filter(t -> t.getProcesoDefinicionId() != null)
            .collect(Collectors.groupingBy(Tramite::getProcesoDefinicionId));

        if (porPolitica.isEmpty()) return new ArrayList<>();

        // Cargar definiciones de políticas en un mapa
        List<String> politicaIds = new ArrayList<>(porPolitica.keySet());
        Map<String, ProcesoDefinicion> politicas = procesoRepository.findAllById(politicaIds).stream()
            .collect(Collectors.toMap(ProcesoDefinicion::getId, p -> p));

        // Traer AuditLogs para calcular distribución de decisiones
        List<String> tramiteIds = tramites.stream().map(Tramite::getId).collect(Collectors.toList());
        List<AuditLog> logs = mongoTemplate.find(
            new org.springframework.data.mongodb.core.query.Query(
                Criteria.where("tramiteId").in(tramiteIds)
            ), AuditLog.class);

        // Mapa tramiteId → política para agrupar decisiones
        Map<String, String> tramiteAPolitica = tramites.stream()
            .filter(t -> t.getProcesoDefinicionId() != null)
            .collect(Collectors.toMap(Tramite::getId, Tramite::getProcesoDefinicionId));

        List<PoliticaDesempenioDTO> resultado = new ArrayList<>();

        for (Map.Entry<String, List<Tramite>> e : porPolitica.entrySet()) {
            String politicaId = e.getKey();
            List<Tramite> grupo = e.getValue();
            ProcesoDefinicion pol = politicas.get(politicaId);

            PoliticaDesempenioDTO p = new PoliticaDesempenioDTO();
            p.setProcesoDefinicionId(politicaId);
            if (pol != null) {
                p.setCodigoPolitica(pol.getCodigo());
                p.setNombrePolitica(pol.getNombre());
                p.setVersion(pol.getNumeroVersion());
            } else {
                p.setNombrePolitica("Política eliminada o no encontrada");
            }

            long total = grupo.size();
            long completados = grupo.stream()
                .filter(t -> t.getEstadoSemaforo() == EstadoTramite.APROBADO ||
                             t.getEstadoSemaforo() == EstadoTramite.RECHAZADO)
                .count();

            p.setTotalTramites(total);
            p.setCompletados(completados);
            p.setEnCurso(total - completados);
            p.setTasaFinalizacion(total > 0 ? porcentaje(completados, total) : 0);

            // Lead time promedio de esta política
            OptionalDouble avgHoras = grupo.stream()
                .filter(t -> t.getEstadoSemaforo() == EstadoTramite.APROBADO ||
                             t.getEstadoSemaforo() == EstadoTramite.RECHAZADO)
                .filter(t -> t.getFechaCreacion() != null && t.getFechaUltimaActualizacion() != null)
                .mapToLong(t -> ChronoUnit.MINUTES.between(t.getFechaCreacion(), t.getFechaUltimaActualizacion()))
                .filter(m -> m >= 0)
                .average();
            p.setLeadTimePromedioHoras(avgHoras.isPresent() ? redondear(avgHoras.getAsDouble() / 60.0) : 0);

            // Distribución de decisiones: contamos los `accion` de los AuditLogs de esta política
            Map<String, Long> distribucion = logs.stream()
                .filter(l -> politicaId.equals(tramiteAPolitica.get(l.getTramiteId())))
                .filter(l -> l.getAccion() != null && !l.getAccion().isBlank())
                .filter(l -> !l.getAccion().equalsIgnoreCase("CREADO") &&
                             !l.getAccion().equalsIgnoreCase("DERIVADO"))
                .collect(Collectors.groupingBy(AuditLog::getAccion, Collectors.counting()));
            p.setDistribucionDecisiones(distribucion);

            resultado.add(p);
        }

        resultado.sort((a, b) -> Long.compare(b.getTotalTramites(), a.getTotalTramites()));
        return resultado;
    }

    // ==========================================================================
    // SECCIÓN 4 - TENDENCIA TEMPORAL
    // ==========================================================================

    private TendenciaTemporalDTO calcularTendenciaTemporal(List<Tramite> tramites, FiltrosReporteRequest req) {
        TendenciaTemporalDTO t = new TendenciaTemporalDTO();
        ZoneId zona = ZoneId.systemDefault();

        // Agrupar por día de creación
        Map<LocalDate, Long> iniciadosPorDia = tramites.stream()
            .filter(tr -> tr.getFechaCreacion() != null)
            .collect(Collectors.groupingBy(
                tr -> tr.getFechaCreacion().atZone(zona).toLocalDate(),
                Collectors.counting()
            ));

        // Agrupar por día de finalización (solo completados)
        Map<LocalDate, Long> completadosPorDia = tramites.stream()
            .filter(tr -> tr.getEstadoSemaforo() == EstadoTramite.APROBADO ||
                          tr.getEstadoSemaforo() == EstadoTramite.RECHAZADO)
            .filter(tr -> tr.getFechaUltimaActualizacion() != null)
            .collect(Collectors.groupingBy(
                tr -> tr.getFechaUltimaActualizacion().atZone(zona).toLocalDate(),
                Collectors.counting()
            ));

        // Construir la serie día a día (rellenando ceros)
        List<PuntoSerieTiempoDTO> serie = new ArrayList<>();
        LocalDate cursor = req.getFechaInicio();
        while (!cursor.isAfter(req.getFechaFin())) {
            PuntoSerieTiempoDTO punto = new PuntoSerieTiempoDTO();
            punto.setFecha(cursor);
            punto.setIniciados(iniciadosPorDia.getOrDefault(cursor, 0L));
            punto.setCompletados(completadosPorDia.getOrDefault(cursor, 0L));
            serie.add(punto);
            cursor = cursor.plusDays(1);
        }
        t.setSeriePorDia(serie);

        // Día pico de iniciados
        serie.stream()
            .max(Comparator.comparingLong(PuntoSerieTiempoDTO::getIniciados))
            .filter(p -> p.getIniciados() > 0)
            .ifPresent(p -> {
                t.setDiaPicoFecha(p.getFecha().toString());
                t.setDiaPicoCantidad(p.getIniciados());
            });

        // Comparativa con periodo anterior
        long diasRango = ChronoUnit.DAYS.between(req.getFechaInicio(), req.getFechaFin()) + 1;
        LocalDate inicioAnterior = req.getFechaInicio().minusDays(diasRango);
        LocalDate finAnterior = req.getFechaInicio().minusDays(1);

        long actual = tramites.size();
        long anterior = tramiteRepository.count() == 0 ? 0 : contarTramitesEnRango(inicioAnterior, finAnterior, req);

        t.setTotalPeriodoActual(actual);
        t.setTotalPeriodoAnterior(anterior);
        if (anterior > 0) {
            t.setVariacionPorcentual(redondear(((double) (actual - anterior) / anterior) * 100));
        } else if (actual > 0) {
            t.setVariacionPorcentual(100.0); // crecimiento desde cero
        }

        return t;
    }

    private long contarTramitesEnRango(LocalDate inicio, LocalDate fin, FiltrosReporteRequest req) {
        Criteria criteria = Criteria.where("fechaCreacion")
            .gte(inicio.atStartOfDay())
            .lte(fin.atTime(23, 59, 59));
        if (req.getDepartamentoId() != null && !req.getDepartamentoId().isBlank()) {
            criteria = criteria.and("departamentoActualId").is(req.getDepartamentoId());
        }
        if (req.getProcesoDefinicionId() != null && !req.getProcesoDefinicionId().isBlank()) {
            criteria = criteria.and("procesoDefinicionId").is(req.getProcesoDefinicionId());
        }
        return mongoTemplate.count(
            new org.springframework.data.mongodb.core.query.Query(criteria), Tramite.class);
    }

    // ==========================================================================
    // UTILIDADES
    // ==========================================================================

    private double porcentaje(long parte, long total) {
        return redondear((double) parte / total * 100);
    }

    private double redondear(double valor) {
        return Math.round(valor * 100.0) / 100.0;
    }
}