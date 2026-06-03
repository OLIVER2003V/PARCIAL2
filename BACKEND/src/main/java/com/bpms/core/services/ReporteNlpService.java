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

    // Paleta de colores cíclica para grupos
    private static final String[] COLORES = {
        "#6366f1","#22c55e","#f59e0b","#ef4444","#8b5cf6",
        "#06b6d4","#ec4899","#14b8a6","#f97316","#84cc16"
    };
    private static final String[] COLORES_FONDO = {
        "#6366f120","#22c55e20","#f59e0b20","#ef444420","#8b5cf620",
        "#06b6d420","#ec489920","#14b8a620","#f9731620","#84cc1620"
    };

    // =========================================================================
    //  ENTRY POINT
    // =========================================================================

    public ResultadoReporteNlpDTO consultar(String textoLibre) {
        // 1. Llamar a Gemini para obtener el QueryIntent
        QueryIntentDTO intent;
        try {
            String jsonIntent = geminiService.interpretarConsultaNlp(textoLibre);
            intent = mapper.readValue(jsonIntent, QueryIntentDTO.class);
        } catch (Exception e) {
            return errorResult("No pude interpretar tu consulta. Intenta ser más específico.",
                               "Ejemplo: 'Muéstrame los trámites aprobados en abril 2026 por departamento'");
        }

        if (intent.getError() != null) {
            return errorResult(intent.getSugerencia() != null ? intent.getSugerencia()
                               : "No pude interpretar esa consulta.", null);
        }

        // 2. Ejecutar la consulta según la colección
        String coleccion = intent.getColeccion() != null ? intent.getColeccion() : "tramites";
        return switch (coleccion) {
            case "tramites"   -> ejecutarConsultaTramites(intent);
            case "procesos"   -> ejecutarConsultaProcesos(intent);
            case "usuarios"   -> ejecutarConsultaUsuarios(intent);
            case "auditoria"  -> ejecutarConsultaAuditoria(intent);
            default           -> ejecutarConsultaTramites(intent);
        };
    }

    // =========================================================================
    //  CONSULTA SOBRE TRAMITES (colección principal)
    // =========================================================================

    private ResultadoReporteNlpDTO ejecutarConsultaTramites(QueryIntentDTO intent) {
        // Construir filtro MongoDB
        Criteria criteria = construirCriteriaTramites(intent.getFiltros());
        Query query = new Query(criteria);
        List<Tramite> tramites = mongoTemplate.find(query, Tramite.class);

        if (tramites.isEmpty()) {
            ResultadoReporteNlpDTO res = new ResultadoReporteNlpDTO();
            res.setTitulo(intent.getTitulo() != null ? intent.getTitulo() : "Resultado");
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

        // Agrupar según la dimensión solicitada
        String agrupacion = intent.getAgrupacion() != null ? intent.getAgrupacion() : "estado";
        Map<String, Long> grupos = agruparTramites(tramites, agrupacion);

        // Aplicar orden y límite
        grupos = ordenarYLimitar(grupos, intent.getOrdenar(), intent.getLimite());

        // Construir resultado
        return construirResultado(intent, tramites.size(), grupos);
    }

    private Criteria construirCriteriaTramites(FiltrosNlpDTO f) {
        Criteria c = new Criteria();
        List<Criteria> condiciones = new ArrayList<>();

        // Default de fechas: último año completo si Gemini no especificó ninguna
        LocalDateTime desdeDefault = LocalDateTime.now().minusYears(1);
        LocalDateTime hastaDefault = LocalDateTime.now();

        if (f != null) {
            // Rango de fechas
            try {
                LocalDateTime desde = (f.getFechaDesde() != null && !f.getFechaDesde().isBlank())
                    ? LocalDate.parse(f.getFechaDesde()).atStartOfDay()
                    : desdeDefault;
                LocalDateTime hasta = (f.getFechaHasta() != null && !f.getFechaHasta().isBlank())
                    ? LocalDate.parse(f.getFechaHasta()).atTime(23, 59, 59)
                    : hastaDefault;
                condiciones.add(Criteria.where("fechaCreacion").gte(desde).lte(hasta));
            } catch (Exception ignored) {
                condiciones.add(Criteria.where("fechaCreacion").gte(desdeDefault).lte(hastaDefault));
            }

            // Estado
            if (f.getEstado() != null && !f.getEstado().isBlank()) {
                try {
                    EstadoTramite estado = EstadoTramite.valueOf(f.getEstado().toUpperCase());
                    condiciones.add(Criteria.where("estadoSemaforo").is(estado));
                } catch (Exception ignored) { }
            }

            // Departamento (resolución por nombre)
            if (f.getDepartamentoNombre() != null && !f.getDepartamentoNombre().isBlank()) {
                List<String> deptoIds = departamentoRepository.findAll().stream()
                    .filter(d -> d.getNombre() != null &&
                                 d.getNombre().toLowerCase().contains(f.getDepartamentoNombre().toLowerCase()))
                    .map(d -> d.getId())
                    .collect(Collectors.toList());
                if (!deptoIds.isEmpty()) {
                    condiciones.add(Criteria.where("departamentoActualId").in(deptoIds));
                }
            }

            // Proceso (resolución por nombre)
            if (f.getProcesoNombre() != null && !f.getProcesoNombre().isBlank()) {
                condiciones.add(Criteria.where("nombreProceso")
                    .regex(f.getProcesoNombre(), "i"));
            }

            // Usuario/cliente
            if (f.getUsuarioUsername() != null && !f.getUsuarioUsername().isBlank()) {
                condiciones.add(Criteria.where("clienteId").is(f.getUsuarioUsername()));
            }
        }

        if (!condiciones.isEmpty()) {
            c = new Criteria().andOperator(condiciones.toArray(new Criteria[0]));
        }
        return c;
    }

    private Map<String, Long> agruparTramites(List<Tramite> tramites, String agrupacion) {
        return switch (agrupacion) {
            case "departamento" -> agruparPorDepartamento(tramites);
            case "proceso"      -> agruparPorProceso(tramites);
            case "mes"          -> agruparPorMes(tramites);
            case "semana"       -> agruparPorSemana(tramites);
            case "dia"          -> agruparPorDia(tramites);
            case "usuario"      -> tramites.stream()
                .collect(Collectors.groupingBy(
                    t -> t.getClienteId() != null ? t.getClienteId() : "desconocido",
                    Collectors.counting()));
            default -> agruparPorEstado(tramites);
        };
    }

    private Map<String, Long> agruparPorEstado(List<Tramite> tramites) {
        Map<String, Long> mapa = new LinkedHashMap<>();
        mapa.put("En revisión", tramites.stream()
            .filter(t -> t.getEstadoSemaforo() != null &&
                         t.getEstadoSemaforo().name().equals("EN_REVISION"))
            .count());
        mapa.put("Aprobado", tramites.stream()
            .filter(t -> t.getEstadoSemaforo() != null &&
                         t.getEstadoSemaforo().name().equals("APROBADO"))
            .count());
        mapa.put("Rechazado", tramites.stream()
            .filter(t -> t.getEstadoSemaforo() != null &&
                         t.getEstadoSemaforo().name().equals("RECHAZADO"))
            .count());
        mapa.entrySet().removeIf(e -> e.getValue() == 0);
        return mapa;
    }

    private Map<String, Long> agruparPorDepartamento(List<Tramite> tramites) {
        // Caché de IDs → nombres
        Map<String, String> nombresPorId = new HashMap<>();
        departamentoRepository.findAll().forEach(d -> nombresPorId.put(d.getId(), d.getNombre()));

        return tramites.stream().collect(Collectors.groupingBy(
            t -> {
                String id = t.getDepartamentoActualId() != null ? t.getDepartamentoActualId().toString() : "";
                return nombresPorId.getOrDefault(id, id.isBlank() ? "Sin departamento" : id);
            },
            LinkedHashMap::new,
            Collectors.counting()
        ));
    }

    private Map<String, Long> agruparPorProceso(List<Tramite> tramites) {
        return tramites.stream().collect(Collectors.groupingBy(
            t -> t.getNombreProceso() != null && !t.getNombreProceso().isBlank()
                 ? t.getNombreProceso() : "Sin proceso",
            LinkedHashMap::new,
            Collectors.counting()
        ));
    }

    private Map<String, Long> agruparPorMes(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream()
            .filter(t -> t.getFechaCreacion() != null)
            .forEach(t -> {
                String clave = t.getFechaCreacion().getYear() + "-"
                    + String.format("%02d", t.getFechaCreacion().getMonthValue()) + " "
                    + t.getFechaCreacion().getMonth().getDisplayName(TextStyle.SHORT, new Locale("es"));
                mapa.merge(clave, 1L, Long::sum);
            });
        return mapa;
    }

    private Map<String, Long> agruparPorSemana(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream()
            .filter(t -> t.getFechaCreacion() != null)
            .forEach(t -> {
                java.time.LocalDate fecha = t.getFechaCreacion().toLocalDate();
                int semana = fecha.get(WeekFields.ISO.weekOfWeekBasedYear());
                int anio   = fecha.get(WeekFields.ISO.weekBasedYear());
                String clave = anio + " Sem " + String.format("%02d", semana);
                mapa.merge(clave, 1L, Long::sum);
            });
        return mapa;
    }

    private Map<String, Long> agruparPorDia(List<Tramite> tramites) {
        Map<String, Long> mapa = new TreeMap<>();
        tramites.stream()
            .filter(t -> t.getFechaCreacion() != null)
            .forEach(t -> {
                String clave = String.format("%04d-%02d-%02d",
                    t.getFechaCreacion().getYear(),
                    t.getFechaCreacion().getMonthValue(),
                    t.getFechaCreacion().getDayOfMonth());
                mapa.merge(clave, 1L, Long::sum);
            });
        return mapa;
    }

    // =========================================================================
    //  CONSULTA SOBRE PROCESOS
    // =========================================================================

    private ResultadoReporteNlpDTO ejecutarConsultaProcesos(QueryIntentDTO intent) {
        List<com.bpms.core.models.ProcesoDefinicion> procesos = procesoRepository.findAll();
        Map<String, Long> grupos = new LinkedHashMap<>();
        grupos.put("Activos",   procesos.stream().filter(p -> p.isActivo()).count());
        grupos.put("Inactivos", procesos.stream().filter(p -> !p.isActivo()).count());
        if (intent.getTitulo() == null) intent.setTitulo("Procesos por estado");
        if (intent.getTipoVisualizacion() == null) intent.setTipoVisualizacion("pie");
        return construirResultado(intent, procesos.size(), grupos);
    }

    // =========================================================================
    //  CONSULTA SOBRE USUARIOS
    // =========================================================================

    private ResultadoReporteNlpDTO ejecutarConsultaUsuarios(QueryIntentDTO intent) {
        List<com.bpms.core.models.Usuario> usuarios = usuarioRepository.findAll();
        String agrupacion = intent.getAgrupacion() != null ? intent.getAgrupacion() : "rol";

        Map<String, Long> grupos;
        if ("departamento".equals(agrupacion)) {
            Map<String, String> nombresPorId = new HashMap<>();
            departamentoRepository.findAll().forEach(d -> nombresPorId.put(d.getId(), d.getNombre()));
            grupos = usuarios.stream().collect(Collectors.groupingBy(
                u -> {
                    String id = u.getDepartamentoId() != null ? u.getDepartamentoId() : "";
                    return nombresPorId.getOrDefault(id, id.isBlank() ? "Sin departamento" : id);
                },
                LinkedHashMap::new, Collectors.counting()
            ));
        } else {
            grupos = usuarios.stream().collect(Collectors.groupingBy(
                u -> u.getRol() != null ? u.getRol().name() : "Sin rol",
                LinkedHashMap::new, Collectors.counting()
            ));
        }

        grupos = ordenarYLimitar(grupos, intent.getOrdenar(), intent.getLimite());
        if (intent.getTitulo() == null) intent.setTitulo("Usuarios por " + agrupacion);
        if (intent.getTipoVisualizacion() == null) intent.setTipoVisualizacion("doughnut");
        return construirResultado(intent, usuarios.size(), grupos);
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
        Map<String, Long> grupos;

        if ("mes".equals(agrupacion)) {
            grupos = logs.stream()
                .filter(l -> l.getFechaTimestamp() != null)
                .collect(Collectors.groupingBy(
                    l -> l.getFechaTimestamp().getYear() + "-"
                         + String.format("%02d", l.getFechaTimestamp().getMonthValue()) + " "
                         + l.getFechaTimestamp().getMonth().getDisplayName(TextStyle.SHORT, new Locale("es")),
                    TreeMap::new, Collectors.counting()
                ));
        } else if ("usuario".equals(agrupacion)) {
            grupos = logs.stream().collect(Collectors.groupingBy(
                l -> l.getUsuarioId() != null ? l.getUsuarioId() : "sistema",
                LinkedHashMap::new, Collectors.counting()
            ));
        } else {
            // default: agrupar por accion
            grupos = logs.stream().collect(Collectors.groupingBy(
                l -> l.getAccion() != null ? l.getAccion() : "DESCONOCIDO",
                LinkedHashMap::new, Collectors.counting()
            ));
        }

        grupos = ordenarYLimitar(grupos, intent.getOrdenar(), intent.getLimite());
        if (intent.getTitulo() == null) intent.setTitulo("Actividad de auditoría");
        if (intent.getTipoVisualizacion() == null) intent.setTipoVisualizacion("bar");
        return construirResultado(intent, logs.size(), grupos);
    }

    // =========================================================================
    //  CONSTRUCCIÓN DEL RESULTADO
    // =========================================================================

    private ResultadoReporteNlpDTO construirResultado(QueryIntentDTO intent, long total,
                                                       Map<String, Long> grupos) {
        ResultadoReporteNlpDTO res = new ResultadoReporteNlpDTO();
        res.setTitulo(intent.getTitulo() != null ? intent.getTitulo() : "Reporte");
        res.setTotalRegistros(total);
        res.setTipoVisualizacion(
            intent.getTipoVisualizacion() != null ? intent.getTipoVisualizacion() : "bar");
        res.setExportable(true);

        List<String> etiquetas = new ArrayList<>(grupos.keySet());
        List<Number> valores   = new ArrayList<>(grupos.values());

        res.setEtiquetas(etiquetas);

        // Colores: estado tiene colores semánticos, el resto usa la paleta
        List<String> colores     = new ArrayList<>();
        List<String> colorsFondo = new ArrayList<>();
        for (int i = 0; i < etiquetas.size(); i++) {
            String[] par = colorParaEtiqueta(etiquetas.get(i), i);
            colores.add(par[0]);
            colorsFondo.add(par[1]);
        }

        // Para pie/doughnut: una sola serie con N colores
        boolean esCircular = "pie".equals(res.getTipoVisualizacion()) ||
                             "doughnut".equals(res.getTipoVisualizacion());

        SerieDTO serie = new SerieDTO();
        serie.setNombre(intent.getAgrupacion() != null ? intent.getAgrupacion() : "Total");
        serie.setValores(valores);

        if (esCircular) {
            serie.setColores(colores);
            serie.setColoresFondo(colorsFondo);
        } else {
            serie.setColor(!colores.isEmpty() ? colores.get(0) : COLORES[0]);
            serie.setColorFondo(!colorsFondo.isEmpty() ? colorsFondo.get(0) : COLORES_FONDO[0]);
        }

        res.setSeries(List.of(serie));

        // Tabla paralela (siempre útil)
        String colNombre = nombreColumnaAgrupacion(intent.getAgrupacion());
        res.setColumnas(List.of(colNombre, "Cantidad"));
        List<List<Object>> filas = new ArrayList<>();
        for (int i = 0; i < etiquetas.size(); i++) {
            filas.add(List.of(etiquetas.get(i), valores.get(i)));
        }
        res.setFilas(filas);

        // Interpretación legible
        res.setInterpretacion(generarInterpretacion(intent, total, grupos));

        return res;
    }

    // =========================================================================
    //  HELPERS
    // =========================================================================

    private Map<String, Long> ordenarYLimitar(Map<String, Long> grupos, String orden, Integer limite) {
        int max = (limite != null && limite > 0) ? Math.min(limite, 50) : 15;
        boolean desc = !"asc".equalsIgnoreCase(orden);

        return grupos.entrySet().stream()
            .sorted(desc
                ? Map.Entry.<String, Long>comparingByValue().reversed()
                : Map.Entry.comparingByValue())
            .limit(max)
            .collect(Collectors.toMap(
                Map.Entry::getKey,
                Map.Entry::getValue,
                (a, b) -> a,
                LinkedHashMap::new));
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
            case "usuario"      -> "Usuario";
            default             -> "Estado";
        };
    }

    private String generarInterpretacion(QueryIntentDTO intent, long total, Map<String, Long> grupos) {
        String dim = nombreColumnaAgrupacion(intent.getAgrupacion()).toLowerCase();
        String top = grupos.entrySet().stream()
            .max(Map.Entry.comparingByValue())
            .map(e -> "\"" + e.getKey() + "\" con " + e.getValue() + " registros")
            .orElse("ninguno");

        return String.format(
            "Se encontraron %d registros en total, distribuidos en %d %s. El más alto es %s.",
            total, grupos.size(), dim.equals("estado") ? "estados" : dim + "s", top);
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
