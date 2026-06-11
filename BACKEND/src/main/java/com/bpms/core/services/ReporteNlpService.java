package com.bpms.core.services;

import com.bpms.core.dto.reportes.QueryIntentDTO;
import com.bpms.core.dto.reportes.QueryIntentDTO.FiltrosNlpDTO;
import com.bpms.core.dto.reportes.ResultadoReporteNlpDTO;
import com.bpms.core.dto.reportes.ResultadoReporteNlpDTO.SerieDTO;
import com.bpms.core.models.EstadoTramite;
import com.bpms.core.models.Tramite;
import com.bpms.core.repositories.DepartamentoRepository;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import com.bpms.core.repositories.TramiteRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.TextStyle;
import java.time.temporal.ChronoUnit;
import java.time.temporal.WeekFields;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ReporteNlpService {

    @Autowired private GeminiAiService geminiService;
    @Autowired private MongoTemplate mongoTemplate;
    @Autowired private TramiteRepository tramiteRepository;
    @Autowired private DepartamentoRepository departamentoRepository;
    @Autowired private ProcesoDefinicionRepository procesoRepository;
    @Autowired private com.bpms.core.repositories.UsuarioRepository usuarioRepository;
    @Autowired private com.bpms.core.repositories.AuditLogRepository auditLogRepository;

    private final ObjectMapper mapper = new ObjectMapper();

    private static final String[] COLORES = {
        "#6366f1","#22c55e","#f59e0b","#ef4444","#8b5cf6",
        "#06b6d4","#ec4899","#14b8a6","#f97316","#84cc16"
    };
    private static final String[] COLORES_FONDO = {
        "#6366f120","#22c55e20","#f59e0b20","#ef444420","#8b5cf620",
        "#06b6d420","#ec489920","#14b8a620","#f9731620","#84cc1620"
    };

    private static final Set<String> AGRUPACIONES_TEMPORALES =
        Set.of("mes", "semana", "dia", "anio", "trimestre");

    // =========================================================================
    //  ENTRY POINT
    // =========================================================================

    public ResultadoReporteNlpDTO consultar(String textoLibre) {
        QueryIntentDTO intent;
        try {
            String jsonIntent = geminiService.interpretarConsultaNlp(textoLibre);
            intent = mapper.readValue(jsonIntent, QueryIntentDTO.class);
        } catch (Exception e) {
            return errorResult("No pude interpretar tu consulta. Intenta ser más específico.",
                               "Ejemplo: 'Trámites aprobados en abril 2026 por departamento'");
        }

        if (intent.getError() != null) {
            return errorResult(intent.getSugerencia() != null
                ? intent.getSugerencia() : "No pude interpretar esa consulta.", null);
        }

        String coleccion = intent.getColeccion() != null ? intent.getColeccion() : "tramites";
        return switch (coleccion) {
            case "tramites"  -> ejecutarConsultaTramites(intent);
            case "procesos"  -> ejecutarConsultaProcesos(intent);
            case "usuarios"  -> ejecutarConsultaUsuarios(intent);
            case "auditoria" -> ejecutarConsultaAuditoria(intent);
            default          -> ejecutarConsultaTramites(intent);
        };
    }

    // =========================================================================
    //  CONSULTA SOBRE TRÁMITES
    // =========================================================================

    private ResultadoReporteNlpDTO ejecutarConsultaTramites(QueryIntentDTO intent) {
        Criteria criteria = construirCriteriaTramites(intent.getFiltros());
        List<Tramite> tramites = mongoTemplate.find(new Query(criteria), Tramite.class);

        if (tramites.isEmpty()) {
            ResultadoReporteNlpDTO res = new ResultadoReporteNlpDTO();
            res.setTitulo(intent.getTitulo() != null ? intent.getTitulo() : "Sin resultados");
            res.setInterpretacion("No se encontraron trámites con los criterios especificados.");
            res.setTotalRegistros(0);
            res.setEtiquetas(new ArrayList<>());
            res.setSeries(new ArrayList<>());
            res.setColumnas(new ArrayList<>());
            res.setFilas(new ArrayList<>());
            res.setTipoVisualizacion("tabla");
            res.setExportable(false);
            return res;
        }

        String agrupacion = intent.getAgrupacion() != null ? intent.getAgrupacion() : "estado";
        String metrica    = intent.getMetrica()    != null ? intent.getMetrica()    : "count";

        Map<String, Double> grupos;
        if ("promedioDias".equals(metrica)) {
            grupos = calcularPromedioLTPorGrupo(tramites, agrupacion);
        } else {
            grupos = toDouble(agruparTramites(tramites, agrupacion));
        }

        grupos = ordenarYLimitar(grupos, agrupacion, intent.getOrdenar(), intent.getLimite());
        return construirResultado(intent, tramites.size(), grupos, metrica);
    }

    private Criteria construirCriteriaTramites(FiltrosNlpDTO f) {
        List<Criteria> conds = new ArrayList<>();

        LocalDateTime desdeDefault = LocalDateTime.now().minusYears(1);
        LocalDateTime hastaDefault = LocalDateTime.now();

        if (f != null) {
            try {
                LocalDateTime desde = (f.getFechaDesde() != null && !f.getFechaDesde().isBlank())
                    ? LocalDate.parse(f.getFechaDesde()).atStartOfDay() : desdeDefault;
                LocalDateTime hasta = (f.getFechaHasta() != null && !f.getFechaHasta().isBlank())
                    ? LocalDate.parse(f.getFechaHasta()).atTime(23, 59, 59) : hastaDefault;
                conds.add(Criteria.where("fechaCreacion").gte(desde).lte(hasta));
            } catch (Exception ignored) {
                conds.add(Criteria.where("fechaCreacion").gte(desdeDefault).lte(hastaDefault));
            }

            if (f.getEstado() != null && !f.getEstado().isBlank()) {
                try {
                    EstadoTramite estado = EstadoTramite.valueOf(f.getEstado().toUpperCase());
                    conds.add(Criteria.where("estadoSemaforo").is(estado));
                } catch (Exception ignored) {}
            }

            if (f.getDepartamentoNombre() != null && !f.getDepartamentoNombre().isBlank()) {
                List<String> ids = departamentoRepository.findAll().stream()
                    .filter(d -> d.getNombre() != null &&
                                 d.getNombre().toLowerCase()
                                   .contains(f.getDepartamentoNombre().toLowerCase()))
                    .map(d -> d.getId())
                    .collect(Collectors.toList());
                if (!ids.isEmpty()) conds.add(Criteria.where("departamentoActualId").in(ids));
            }

            if (f.getProcesoNombre() != null && !f.getProcesoNombre().isBlank()) {
                conds.add(Criteria.where("nombreProceso").regex(f.getProcesoNombre(), "i"));
            }

            if (f.getUsuarioUsername() != null && !f.getUsuarioUsername().isBlank()) {
                conds.add(Criteria.where("clienteId").is(f.getUsuarioUsername()));
            }
        } else {
            conds.add(Criteria.where("fechaCreacion").gte(desdeDefault).lte(hastaDefault));
        }

        return conds.isEmpty()
            ? new Criteria()
            : new Criteria().andOperator(conds.toArray(new Criteria[0]));
    }

    // =========================================================================
    //  AGRUPACIONES (count)
    // =========================================================================

    private Map<String, Long> agruparTramites(List<Tramite> tramites, String agrupacion) {
        return switch (agrupacion) {
            case "departamento" -> agruparPorDepartamento(tramites);
            case "proceso"      -> agruparPorProceso(tramites);
            case "mes"          -> agruparPorMes(tramites);
            case "semana"       -> agruparPorSemana(tramites);
            case "dia"          -> agruparPorDia(tramites);
            case "anio"         -> agruparPorAnio(tramites);
            case "trimestre"    -> agruparPorTrimestre(tramites);
            case "usuario"      -> tramites.stream().collect(Collectors.groupingBy(
                t -> t.getClienteId() != null ? t.getClienteId() : "desconocido",
                Collectors.counting()));
            default             -> agruparPorEstado(tramites);
        };
    }

    private Map<String, Long> agruparPorEstado(List<Tramite> tramites) {
        Map<String, Long> mapa = new LinkedHashMap<>();
        mapa.put("En revisión", tramites.stream()
            .filter(t -> t.getEstadoSemaforo() != null &&
                         "EN_REVISION".equals(t.getEstadoSemaforo().name())).count());
        mapa.put("Aprobado", tramites.stream()
            .filter(t -> t.getEstadoSemaforo() != null &&
                         "APROBADO".equals(t.getEstadoSemaforo().name())).count());
        mapa.put("Rechazado", tramites.stream()
            .filter(t -> t.getEstadoSemaforo() != null &&
                         "RECHAZADO".equals(t.getEstadoSemaforo().name())).count());
        mapa.entrySet().removeIf(e -> e.getValue() == 0);
        return mapa;
    }

    private Map<String, Long> agruparPorDepartamento(List<Tramite> tramites) {
        Map<String, String> nombres = cargarNombresDepartamento();
        return tramites.stream().collect(Collectors.groupingBy(
            t -> {
                String id = t.getDepartamentoActualId() != null ? t.getDepartamentoActualId() : "";
                return nombres.getOrDefault(id, id.isBlank() ? "Sin departamento" : id);
            },
            LinkedHashMap::new, Collectors.counting()));
    }

    private Map<String, Long> agruparPorProceso(List<Tramite> tramites) {
        return tramites.stream().collect(Collectors.groupingBy(
            t -> t.getNombreProceso() != null && !t.getNombreProceso().isBlank()
                 ? t.getNombreProceso() : "Sin proceso",
            LinkedHashMap::new, Collectors.counting()));
    }

    private Map<String, Long> agruparPorMes(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream().filter(t -> t.getFechaCreacion() != null).forEach(t -> {
            String clave = t.getFechaCreacion().getYear() + "-"
                + String.format("%02d", t.getFechaCreacion().getMonthValue()) + " "
                + t.getFechaCreacion().getMonth().getDisplayName(TextStyle.SHORT, new Locale("es"));
            mapa.merge(clave, 1L, Long::sum);
        });
        return mapa;
    }

    private Map<String, Long> agruparPorSemana(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream().filter(t -> t.getFechaCreacion() != null).forEach(t -> {
            LocalDate f = t.getFechaCreacion().toLocalDate();
            int sem  = f.get(WeekFields.ISO.weekOfWeekBasedYear());
            int anio = f.get(WeekFields.ISO.weekBasedYear());
            mapa.merge(anio + " Sem " + String.format("%02d", sem), 1L, Long::sum);
        });
        return mapa;
    }

    private Map<String, Long> agruparPorDia(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream().filter(t -> t.getFechaCreacion() != null).forEach(t -> {
            String clave = String.format("%04d-%02d-%02d",
                t.getFechaCreacion().getYear(),
                t.getFechaCreacion().getMonthValue(),
                t.getFechaCreacion().getDayOfMonth());
            mapa.merge(clave, 1L, Long::sum);
        });
        return mapa;
    }

    private Map<String, Long> agruparPorAnio(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream().filter(t -> t.getFechaCreacion() != null).forEach(t ->
            mapa.merge(String.valueOf(t.getFechaCreacion().getYear()), 1L, Long::sum));
        return mapa;
    }

    private Map<String, Long> agruparPorTrimestre(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream().filter(t -> t.getFechaCreacion() != null).forEach(t -> {
            int trim = (t.getFechaCreacion().getMonthValue() - 1) / 3 + 1;
            mapa.merge(t.getFechaCreacion().getYear() + "-T" + trim, 1L, Long::sum);
        });
        return mapa;
    }

    // =========================================================================
    //  MÉTRICA: promedioDias (tiempo medio de resolución por grupo)
    // =========================================================================

    private Map<String, Double> calcularPromedioLTPorGrupo(List<Tramite> tramites, String agrupacion) {
        Map<String, String> nombresDep = cargarNombresDepartamento();
        Map<String, List<Double>> tiemposPorGrupo = new TreeMap<>();

        for (Tramite t : tramites) {
            if (t.getFechaCreacion() == null || t.getFechaUltimaActualizacion() == null) continue;
            double horas = ChronoUnit.MINUTES.between(
                t.getFechaCreacion(), t.getFechaUltimaActualizacion()) / 60.0;
            if (horas < 0) continue;
            String clave = obtenerClaveGrupo(t, agrupacion, nombresDep);
            tiemposPorGrupo.computeIfAbsent(clave, k -> new ArrayList<>()).add(horas / 24.0);
        }

        Map<String, Double> resultado = new LinkedHashMap<>();
        tiemposPorGrupo.forEach((k, lista) -> {
            double avg = lista.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            resultado.put(k, Math.round(avg * 10) / 10.0);
        });
        return resultado;
    }

    private String obtenerClaveGrupo(Tramite t, String agrupacion, Map<String, String> nombresDep) {
        return switch (agrupacion) {
            case "departamento" -> {
                String id = t.getDepartamentoActualId() != null ? t.getDepartamentoActualId() : "";
                yield nombresDep.getOrDefault(id, id.isBlank() ? "Sin departamento" : id);
            }
            case "proceso" ->
                t.getNombreProceso() != null && !t.getNombreProceso().isBlank()
                    ? t.getNombreProceso() : "Sin proceso";
            case "mes" -> {
                if (t.getFechaCreacion() == null) yield "Desconocido";
                yield t.getFechaCreacion().getYear() + "-"
                    + String.format("%02d", t.getFechaCreacion().getMonthValue()) + " "
                    + t.getFechaCreacion().getMonth().getDisplayName(TextStyle.SHORT, new Locale("es"));
            }
            case "semana" -> {
                if (t.getFechaCreacion() == null) yield "Desconocido";
                LocalDate f = t.getFechaCreacion().toLocalDate();
                yield f.get(WeekFields.ISO.weekBasedYear()) + " Sem "
                    + String.format("%02d", f.get(WeekFields.ISO.weekOfWeekBasedYear()));
            }
            case "dia" -> {
                if (t.getFechaCreacion() == null) yield "Desconocido";
                yield String.format("%04d-%02d-%02d",
                    t.getFechaCreacion().getYear(),
                    t.getFechaCreacion().getMonthValue(),
                    t.getFechaCreacion().getDayOfMonth());
            }
            case "anio" ->
                t.getFechaCreacion() != null
                    ? String.valueOf(t.getFechaCreacion().getYear()) : "Desconocido";
            case "trimestre" -> {
                if (t.getFechaCreacion() == null) yield "Desconocido";
                int trim = (t.getFechaCreacion().getMonthValue() - 1) / 3 + 1;
                yield t.getFechaCreacion().getYear() + "-T" + trim;
            }
            case "usuario" -> t.getClienteId() != null ? t.getClienteId() : "desconocido";
            default -> {
                if (t.getEstadoSemaforo() == null) yield "Desconocido";
                yield switch (t.getEstadoSemaforo().name()) {
                    case "EN_REVISION" -> "En revisión";
                    case "APROBADO"    -> "Aprobado";
                    case "RECHAZADO"   -> "Rechazado";
                    default            -> t.getEstadoSemaforo().name();
                };
            }
        };
    }

    private Map<String, String> cargarNombresDepartamento() {
        Map<String, String> m = new HashMap<>();
        departamentoRepository.findAll().forEach(d -> m.put(d.getId(), d.getNombre()));
        return m;
    }

    // =========================================================================
    //  CONSULTA SOBRE PROCESOS
    // =========================================================================

    private ResultadoReporteNlpDTO ejecutarConsultaProcesos(QueryIntentDTO intent) {
        List<com.bpms.core.models.ProcesoDefinicion> procesos = procesoRepository.findAll();

        Map<String, Long> conteo = new LinkedHashMap<>();
        conteo.put("Activos",   procesos.stream().filter(p -> p.isActivo()).count());
        conteo.put("Inactivos", procesos.stream().filter(p -> !p.isActivo()).count());
        conteo.entrySet().removeIf(e -> e.getValue() == 0);

        if (intent.getTitulo() == null)          intent.setTitulo("Procesos por estado");
        if (intent.getTipoVisualizacion() == null) intent.setTipoVisualizacion("pie");

        Map<String, Double> grupos = ordenarYLimitar(
            toDouble(conteo), "estado", intent.getOrdenar(), intent.getLimite());
        return construirResultado(intent, procesos.size(), grupos, "count");
    }

    // =========================================================================
    //  CONSULTA SOBRE USUARIOS
    // =========================================================================

    private ResultadoReporteNlpDTO ejecutarConsultaUsuarios(QueryIntentDTO intent) {
        List<com.bpms.core.models.Usuario> usuarios = usuarioRepository.findAll();
        String agrupacion = intent.getAgrupacion() != null ? intent.getAgrupacion() : "rol";

        Map<String, Long> conteo;
        if ("departamento".equals(agrupacion)) {
            Map<String, String> nombresDep = cargarNombresDepartamento();
            conteo = usuarios.stream().collect(Collectors.groupingBy(
                u -> {
                    String id = u.getDepartamentoId() != null ? u.getDepartamentoId() : "";
                    return nombresDep.getOrDefault(id, id.isBlank() ? "Sin departamento" : id);
                },
                LinkedHashMap::new, Collectors.counting()));
        } else {
            conteo = usuarios.stream().collect(Collectors.groupingBy(
                u -> u.getRol() != null ? u.getRol().name() : "Sin rol",
                LinkedHashMap::new, Collectors.counting()));
        }

        Map<String, Double> grupos = ordenarYLimitar(
            toDouble(conteo), agrupacion, intent.getOrdenar(), intent.getLimite());
        if (intent.getTitulo() == null)            intent.setTitulo("Usuarios por " + agrupacion);
        if (intent.getTipoVisualizacion() == null) intent.setTipoVisualizacion("doughnut");
        return construirResultado(intent, usuarios.size(), grupos, "count");
    }

    // =========================================================================
    //  CONSULTA SOBRE AUDITORÍA
    // =========================================================================

    private ResultadoReporteNlpDTO ejecutarConsultaAuditoria(QueryIntentDTO intent) {
        Criteria criteria = new Criteria();
        FiltrosNlpDTO f = intent.getFiltros();
        if (f != null && f.getFechaDesde() != null && !f.getFechaDesde().isBlank()) {
            try {
                LocalDateTime desde = LocalDate.parse(f.getFechaDesde()).atStartOfDay();
                LocalDateTime hasta = (f.getFechaHasta() != null && !f.getFechaHasta().isBlank())
                    ? LocalDate.parse(f.getFechaHasta()).atTime(23, 59, 59)
                    : LocalDateTime.now();
                criteria = Criteria.where("fechaTimestamp").gte(desde).lte(hasta);
            } catch (Exception ignored) {}
        }

        List<com.bpms.core.models.AuditLog> logs =
            mongoTemplate.find(new Query(criteria), com.bpms.core.models.AuditLog.class);

        String agrupacion = intent.getAgrupacion() != null ? intent.getAgrupacion() : "accion";
        Map<String, Long> conteo;

        if ("mes".equals(agrupacion)) {
            conteo = logs.stream().filter(l -> l.getFechaTimestamp() != null)
                .collect(Collectors.groupingBy(
                    l -> l.getFechaTimestamp().getYear() + "-"
                         + String.format("%02d", l.getFechaTimestamp().getMonthValue()) + " "
                         + l.getFechaTimestamp().getMonth()
                             .getDisplayName(TextStyle.SHORT, new Locale("es")),
                    TreeMap::new, Collectors.counting()));
        } else if ("anio".equals(agrupacion)) {
            conteo = logs.stream().filter(l -> l.getFechaTimestamp() != null)
                .collect(Collectors.groupingBy(
                    l -> String.valueOf(l.getFechaTimestamp().getYear()),
                    TreeMap::new, Collectors.counting()));
        } else if ("trimestre".equals(agrupacion)) {
            conteo = logs.stream().filter(l -> l.getFechaTimestamp() != null)
                .collect(Collectors.groupingBy(
                    l -> {
                        int trim = (l.getFechaTimestamp().getMonthValue() - 1) / 3 + 1;
                        return l.getFechaTimestamp().getYear() + "-T" + trim;
                    },
                    TreeMap::new, Collectors.counting()));
        } else if ("usuario".equals(agrupacion)) {
            conteo = logs.stream().collect(Collectors.groupingBy(
                l -> l.getUsuarioId() != null ? l.getUsuarioId() : "sistema",
                LinkedHashMap::new, Collectors.counting()));
        } else {
            conteo = logs.stream().collect(Collectors.groupingBy(
                l -> l.getAccion() != null ? l.getAccion() : "DESCONOCIDO",
                LinkedHashMap::new, Collectors.counting()));
        }

        Map<String, Double> grupos = ordenarYLimitar(
            toDouble(conteo), agrupacion, intent.getOrdenar(), intent.getLimite());
        if (intent.getTitulo() == null)            intent.setTitulo("Actividad de auditoría");
        if (intent.getTipoVisualizacion() == null) intent.setTipoVisualizacion("bar");
        return construirResultado(intent, logs.size(), grupos, "count");
    }

    // =========================================================================
    //  CONSTRUCCIÓN DEL RESULTADO
    // =========================================================================

    private ResultadoReporteNlpDTO construirResultado(QueryIntentDTO intent, long total,
                                                       Map<String, Double> grupos, String metrica) {
        ResultadoReporteNlpDTO res = new ResultadoReporteNlpDTO();
        res.setTitulo(intent.getTitulo() != null ? intent.getTitulo() : "Reporte");
        res.setTotalRegistros(total);
        res.setTipoVisualizacion(
            intent.getTipoVisualizacion() != null ? intent.getTipoVisualizacion() : "bar");
        res.setExportable(true);

        List<String> etiquetas = new ArrayList<>(grupos.keySet());
        List<Number>  valores  = new ArrayList<>(grupos.values());
        res.setEtiquetas(etiquetas);

        List<String> colores     = new ArrayList<>();
        List<String> colorsFondo = new ArrayList<>();
        for (int i = 0; i < etiquetas.size(); i++) {
            String[] par = colorParaEtiqueta(etiquetas.get(i), i);
            colores.add(par[0]);
            colorsFondo.add(par[1]);
        }

        boolean esCircular = "pie".equals(res.getTipoVisualizacion())
            || "doughnut".equals(res.getTipoVisualizacion());

        SerieDTO serie = new SerieDTO();
        serie.setNombre("promedioDias".equals(metrica) ? "Días promedio"
            : intent.getAgrupacion() != null ? intent.getAgrupacion() : "Total");
        serie.setValores(valores);
        if (esCircular) {
            serie.setColores(colores);
            serie.setColoresFondo(colorsFondo);
        } else {
            serie.setColor(!colores.isEmpty() ? colores.get(0) : COLORES[0]);
            serie.setColorFondo(!colorsFondo.isEmpty() ? colorsFondo.get(0) : COLORES_FONDO[0]);
        }
        res.setSeries(List.of(serie));

        String colNombre = nombreColumnaAgrupacion(intent.getAgrupacion());
        String colValor  = "promedioDias".equals(metrica) ? "Días promedio" : "Cantidad";
        res.setColumnas(List.of(colNombre, colValor));

        List<List<Object>> filas = new ArrayList<>();
        for (int i = 0; i < etiquetas.size(); i++) {
            Number val = valores.get(i);
            Object display = "promedioDias".equals(metrica)
                ? String.format("%.1f", val.doubleValue())
                : val.longValue();
            filas.add(List.of(etiquetas.get(i), display));
        }
        res.setFilas(filas);

        res.setInterpretacion(generarInterpretacion(intent, total, grupos, metrica));
        return res;
    }

    // =========================================================================
    //  HELPERS
    // =========================================================================

    /**
     * Ordena y limita el mapa de resultados.
     * Para agrupaciones temporales sin límite explícito preserva el orden cronológico natural.
     * Para agrupaciones categóricas (o cuando hay límite+orden), ordena por valor.
     */
    private Map<String, Double> ordenarYLimitar(Map<String, Double> grupos, String agrupacion,
                                                  String orden, Integer limite) {
        int max = (limite != null && limite > 0) ? Math.min(limite, 50) : 50;
        boolean esTemporal  = AGRUPACIONES_TEMPORALES.contains(agrupacion);
        boolean sortByValue = !esTemporal || (limite != null && orden != null);

        if (!sortByValue) {
            return grupos.entrySet().stream()
                .limit(max)
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue,
                    (a, b) -> a, LinkedHashMap::new));
        }

        boolean desc = !"asc".equalsIgnoreCase(orden);
        return grupos.entrySet().stream()
            .sorted(desc
                ? Map.Entry.<String, Double>comparingByValue().reversed()
                : Map.Entry.comparingByValue())
            .limit(max)
            .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue,
                (a, b) -> a, LinkedHashMap::new));
    }

    private Map<String, Double> toDouble(Map<String, Long> m) {
        Map<String, Double> r = new LinkedHashMap<>();
        m.forEach((k, v) -> r.put(k, v.doubleValue()));
        return r;
    }

    private String[] colorParaEtiqueta(String etiqueta, int idx) {
        String lower = etiqueta.toLowerCase();
        if (lower.contains("aprobado") || lower.contains("activo"))
            return new String[]{"#22c55e", "#22c55e20"};
        if (lower.contains("rechazado") || lower.contains("inactivo"))
            return new String[]{"#ef4444", "#ef444420"};
        if (lower.contains("revision") || lower.contains("revisión") || lower.contains("proceso"))
            return new String[]{"#f59e0b", "#f59e0b20"};
        int i = idx % COLORES.length;
        return new String[]{COLORES[i], COLORES_FONDO[i]};
    }

    private String nombreColumnaAgrupacion(String agrupacion) {
        if (agrupacion == null) return "Estado";
        return switch (agrupacion) {
            case "departamento" -> "Departamento";
            case "proceso"      -> "Proceso";
            case "mes"          -> "Mes";
            case "semana"       -> "Semana";
            case "dia"          -> "Fecha";
            case "anio"         -> "Año";
            case "trimestre"    -> "Trimestre";
            case "usuario"      -> "Usuario";
            default             -> "Estado";
        };
    }

    private String generarInterpretacion(QueryIntentDTO intent, long total,
                                          Map<String, Double> grupos, String metrica) {
        String dim = nombreColumnaAgrupacion(intent.getAgrupacion()).toLowerCase();
        String plural = dim.equals("estado") ? "estados" : dim + "s";
        boolean esDias = "promedioDias".equals(metrica);

        Optional<Map.Entry<String, Double>> mayor = grupos.entrySet().stream()
            .max(Map.Entry.comparingByValue());
        Optional<Map.Entry<String, Double>> menor = grupos.entrySet().stream()
            .min(Map.Entry.comparingByValue());

        StringBuilder sb = new StringBuilder();
        if (esDias) {
            sb.append(String.format("Se analizaron %d registros distribuidos en %d %s. ",
                total, grupos.size(), plural));
            mayor.ifPresent(e -> sb.append(String.format(
                "El mayor tiempo promedio es \"%s\" con %.1f días. ", e.getKey(), e.getValue())));
            menor.ifPresent(e -> sb.append(String.format(
                "El menor es \"%s\" con %.1f días.", e.getKey(), e.getValue())));
        } else {
            sb.append(String.format("Se encontraron %d registros distribuidos en %d %s. ",
                total, grupos.size(), plural));
            mayor.ifPresent(e -> sb.append(String.format(
                "El más alto es \"%s\" con %d registros.", e.getKey(), e.getValue().longValue())));
        }
        return sb.toString().trim();
    }

    private ResultadoReporteNlpDTO errorResult(String mensaje, String detalle) {
        ResultadoReporteNlpDTO res = new ResultadoReporteNlpDTO();
        res.setError(mensaje + (detalle != null ? " " + detalle : ""));
        res.setTitulo("Sin resultado");
        res.setEtiquetas(new ArrayList<>());
        res.setSeries(new ArrayList<>());
        res.setColumnas(new ArrayList<>());
        res.setFilas(new ArrayList<>());
        res.setTotalRegistros(0);
        res.setExportable(false);
        return res;
    }
}
