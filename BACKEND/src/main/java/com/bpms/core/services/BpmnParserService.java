package com.bpms.core.services;

import com.bpms.core.models.*;
import com.bpms.core.repositories.DepartamentoRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Parsea el XML UML 2.5 Activity Diagram producido por el diagramador maxGraph
 * y rellena la ProcesoDefinicion con los pasos y transiciones extraídos.
 *
 * Formato esperado:
 * <umlActivity ...>
 *   <partitions>
 *     <partition id="p1" name="Recursos Humanos" .../>
 *   </partitions>
 *   <nodes>
 *     <node id="n1" type="OpaqueAction" name="Revisar solicitud" partition="p1" .../>
 *   </nodes>
 *   <edges>
 *     <edge id="e1" type="ControlFlow" source="n1" target="n2" guard="APROBADO"/>
 *   </edges>
 * </umlActivity>
 *
 * Mapeo UML → TipoPaso:
 *   OpaqueAction        → TAREA
 *   AcceptEventAction   → EVENTO_INTERMEDIO
 *   DecisionNode        → GATEWAY_EXCLUSIVO
 *   MergeNode           → GATEWAY_EXCLUSIVO
 *   ForkNode            → GATEWAY_PARALELO_SPLIT
 *   JoinNode            → GATEWAY_PARALELO_JOIN
 *   ActivityFinalNode   → (edges that point here → destinoId="FIN_TERMINA_TODO")
 *   FlowFinalNode       → (edges that point here → destinoId="FIN")
 *   InitialNode         → (edges from here → define pasoInicialId, no paso created)
 *   Note                → ignorado
 */
@Service
public class BpmnParserService {

    @Autowired
    private DepartamentoRepository departamentoRepository;

    public ProcesoDefinicion parsearYRellenar(ProcesoDefinicion definicion, String umlXml) {
        if (umlXml == null || umlXml.isBlank()) {
            throw new IllegalArgumentException("El XML UML está vacío");
        }

        // Preservar datos editados en el frontend que no vienen del diagrama
        Map<String, List<CampoFormulario>> camposOriginales = new HashMap<>();
        Map<String, TipoResponsable>       responsablesOriginales = new HashMap<>();
        Map<String, List<String>>          camposVisiblesOriginales = new HashMap<>();

        if (definicion.getPasos() != null) {
            for (Paso p : definicion.getPasos()) {
                if (p.getId() == null) continue;
                if (p.getCampos()         != null) camposOriginales.put(p.getId(), p.getCampos());
                if (p.getTipoResponsable() != null) responsablesOriginales.put(p.getId(), p.getTipoResponsable());
                if (p.getCamposVisibles() != null) camposVisiblesOriginales.put(p.getId(), p.getCamposVisibles());
            }
        }

        Document doc = parsearXml(umlXml);
        Element root = doc.getDocumentElement();

        if (!"umlActivity".equals(root.getNodeName())) {
            throw new IllegalArgumentException("XML no es un umlActivity válido");
        }

        // ── 1. Particiones → mapa nodeId → departamentoId ─────────────────────
        Map<String, String> nodoADepartamento = construirMapaLanes(root);

        // ── 2. Nodos UML → Pasos ───────────────────────────────────────────────
        // Clasificar nodos por tipo semántico
        Set<String> idsInicial      = new HashSet<>();   // InitialNode
        Set<String> idsFinalTotal   = new HashSet<>();   // ActivityFinalNode
        Set<String> idsFinalFlujo   = new HashSet<>();   // FlowFinalNode
        Set<String> idsIgnorados    = new HashSet<>();   // Note

        Map<String, Paso> pasosById = new LinkedHashMap<>();

        NodeList nodeEls = root.getElementsByTagName("node");
        for (int i = 0; i < nodeEls.getLength(); i++) {
            Element el = (Element) nodeEls.item(i);
            String id   = el.getAttribute("id");
            String type = el.getAttribute("type");
            String name = el.getAttribute("name");

            switch (type) {
                case "InitialNode"       -> idsInicial.add(id);
                case "ActivityFinalNode" -> idsFinalTotal.add(id);
                case "FlowFinalNode"     -> idsFinalFlujo.add(id);
                case "Note"              -> idsIgnorados.add(id);
                default -> {
                    TipoPaso tipoPaso = umlTypeATipoPaso(type);
                    String nombreDefault = nombreDefaultParaTipo(type);
                    Paso paso = crearPaso(id, name, nombreDefault, tipoPaso,
                            nodoADepartamento, camposOriginales,
                            responsablesOriginales, camposVisiblesOriginales);
                    pasosById.put(id, paso);
                }
            }
        }

        // ── 3. Aristas → Transiciones ─────────────────────────────────────────
        NodeList edgeEls = root.getElementsByTagName("edge");
        for (int i = 0; i < edgeEls.getLength(); i++) {
            Element el     = (Element) edgeEls.item(i);
            String srcId   = el.getAttribute("source");
            String tgtId   = el.getAttribute("target");
            String guard   = el.getAttribute("guard");

            if (srcId.isBlank() || tgtId.isBlank()) continue;

            // Aristas que salen de InitialNode definen el paso inicial
            if (idsInicial.contains(srcId)) {
                if (pasosById.containsKey(tgtId)) {
                    definicion.setPasoInicialId(tgtId);
                }
                continue;
            }

            // Aristas que apuntan a terminadores → no crean paso, solo ajustan destinoId
            String destinoId;
            if (idsFinalTotal.contains(tgtId)) {
                destinoId = "FIN_TERMINA_TODO";
            } else if (idsFinalFlujo.contains(tgtId)) {
                destinoId = "FIN";
            } else {
                destinoId = tgtId;
            }

            Paso pasoOrigen = pasosById.get(srcId);
            if (pasoOrigen == null) continue;  // arista desde Note u otro ignorado

            String condicion = determinarCondicion(pasoOrigen.getTipo(), guard);
            String nombreAccion = guard != null && !guard.isBlank() ? guard : null;
            Transicion t = new Transicion(condicion, destinoId, nombreAccion);
            pasoOrigen.getTransiciones().add(t);
        }

        // Auto-completar TAREA / EVENTO_INTERMEDIO sin salidas → FIN implícito
        for (Paso p : pasosById.values()) {
            boolean esTareaOEvento = p.getTipo() == TipoPaso.TAREA
                    || p.getTipo() == TipoPaso.EVENTO_INTERMEDIO;
            if (esTareaOEvento && (p.getTransiciones() == null || p.getTransiciones().isEmpty())) {
                p.getTransiciones().add(new Transicion("APROBADO", "FIN", null));
            }
        }

        // Fallback pasoInicial: primer paso en orden de inserción
        if (definicion.getPasoInicialId() == null && !pasosById.isEmpty()) {
            definicion.setPasoInicialId(pasosById.keySet().iterator().next());
        }

        // ── 4. Marcar loops ────────────────────────────────────────────────────
        detectarLoops(pasosById);

        // ── 5. Segundo pase: INICIO_CLIENTE vs SOLICITUD_CLIENTE ──────────────
        String pasoInicialId = definicion.getPasoInicialId();
        for (Paso p : pasosById.values()) {
            if ("PORTAL_WEB".equals(p.getDepartamentoAsignadoId())) {
                p.setTipoResponsable(
                    p.getId().equals(pasoInicialId)
                        ? TipoResponsable.INICIO_CLIENTE
                        : TipoResponsable.SOLICITUD_CLIENTE
                );
            }
        }

        definicion.setPasos(new ArrayList<>(pasosById.values()));
        return definicion;
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private Document parsearXml(String xml) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            // Deshabilitar entidades externas (XXE protection)
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            return factory.newDocumentBuilder()
                    .parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalArgumentException("Error al parsear XML UML: " + e.getMessage(), e);
        }
    }

    /**
     * Construye mapa nodeId → departamentoId a partir de las particiones y sus
     * nodos hijos.  El nombre de la partición se normaliza y busca en la BD.
     * Partición con nombre "Cliente" / "Solicitante" → valor especial "PORTAL_WEB".
     */
    private Map<String, String> construirMapaLanes(Element root) {
        // deptoNombreNorm → deptoId
        Map<String, String> deptosPorNombre = new HashMap<>();
        for (Departamento d : departamentoRepository.findAll()) {
            deptosPorNombre.put(normalizar(d.getNombre()), d.getId());
        }

        // partitionId → departamentoId
        Map<String, String> particionADepto = new HashMap<>();
        NodeList partEls = root.getElementsByTagName("partition");
        for (int i = 0; i < partEls.getLength(); i++) {
            Element el   = (Element) partEls.item(i);
            String pid   = el.getAttribute("id");
            String pname = el.getAttribute("name");
            String norm  = normalizar(pname);

            String deptoId;
            if (esNombreCliente(norm)) {
                deptoId = "PORTAL_WEB";
            } else {
                deptoId = deptosPorNombre.getOrDefault(norm, "NO_EXISTE:" + pname);
            }
            particionADepto.put(pid, deptoId);
        }

        // nodeId → departamentoId
        Map<String, String> mapa = new HashMap<>();
        NodeList nodeEls = root.getElementsByTagName("node");
        for (int i = 0; i < nodeEls.getLength(); i++) {
            Element el     = (Element) nodeEls.item(i);
            String nodeId  = el.getAttribute("id");
            String partId  = el.getAttribute("partition");
            String deptoId = particionADepto.getOrDefault(partId, "SIN_ASIGNAR");
            mapa.put(nodeId, deptoId);
        }
        return mapa;
    }

    private TipoPaso umlTypeATipoPaso(String umlType) {
        return switch (umlType) {
            case "OpaqueAction"      -> TipoPaso.TAREA;
            case "AcceptEventAction" -> TipoPaso.EVENTO_INTERMEDIO;
            case "DecisionNode",
                 "MergeNode"         -> TipoPaso.GATEWAY_EXCLUSIVO;
            case "ForkNode"          -> TipoPaso.GATEWAY_PARALELO_SPLIT;
            case "JoinNode"          -> TipoPaso.GATEWAY_PARALELO_JOIN;
            default                  -> TipoPaso.TAREA;
        };
    }

    private String nombreDefaultParaTipo(String umlType) {
        return switch (umlType) {
            case "OpaqueAction"      -> "Acción";
            case "AcceptEventAction" -> "Evento";
            case "DecisionNode"      -> "Decisión";
            case "MergeNode"         -> "Convergencia";
            case "ForkNode"          -> "Fork Paralelo";
            case "JoinNode"          -> "Join Paralelo";
            default                  -> "Nodo";
        };
    }

    private String determinarCondicion(TipoPaso tipo, String guard) {
        if (tipo == TipoPaso.GATEWAY_PARALELO_SPLIT) return "PARALELO";
        if (guard != null && !guard.isBlank()) return guard.toUpperCase();
        return "APROBADO";
    }

    private Paso crearPaso(String id, String nombre, String nombreDefault,
            TipoPaso tipo,
            Map<String, String> mapaDepartamentos,
            Map<String, List<CampoFormulario>> camposOriginales,
            Map<String, TipoResponsable> responsablesOriginales,
            Map<String, List<String>> camposVisiblesOriginales) {

        Paso paso = new Paso();
        paso.setId(id);
        paso.setNombre(nombre != null && !nombre.isBlank() ? nombre : nombreDefault);
        paso.setTipo(tipo);

        String deptoId = mapaDepartamentos.getOrDefault(id, "SIN_ASIGNAR");
        paso.setDepartamentoAsignadoId(deptoId);

        List<CampoFormulario> campos = camposOriginales.get(id);
        if (campos != null) paso.setCampos(campos);

        List<String> visibles = camposVisiblesOriginales.get(id);
        if (visibles != null) paso.setCamposVisibles(visibles);

        if ("PORTAL_WEB".equals(deptoId)) {
            paso.setTipoResponsable(TipoResponsable.INICIO_CLIENTE); // corregido en segundo pase
        } else {
            TipoResponsable resp = responsablesOriginales.get(id);
            if (resp != null) {
                paso.setTipoResponsable(resp);
            } else {
                paso.setTipoResponsable(tipo == TipoPaso.TAREA
                        ? TipoResponsable.FUNCIONARIO
                        : TipoResponsable.AUTOMATICO);
            }
        }
        return paso;
    }

    private void detectarLoops(Map<String, Paso> pasosById) {
        for (Paso paso : pasosById.values()) {
            if (puedeAlcanzarseDesdeSiMismo(paso.getId(), pasosById)) {
                paso.setPermiteReejecucion(true);
            }
        }
    }

    private boolean puedeAlcanzarseDesdeSiMismo(String origenId, Map<String, Paso> pasos) {
        Set<String> visitados = new HashSet<>();
        Deque<String> pila = new ArrayDeque<>();
        Paso origen = pasos.get(origenId);
        if (origen == null) return false;
        for (Transicion t : origen.getTransiciones()) pila.push(t.getPasoDestinoId());

        while (!pila.isEmpty()) {
            String actual = pila.pop();
            if (actual.equals(origenId)) return true;
            if (visitados.contains(actual)) continue;
            visitados.add(actual);
            Paso p = pasos.get(actual);
            if (p != null) {
                for (Transicion t : p.getTransiciones()) pila.push(t.getPasoDestinoId());
            }
        }
        return false;
    }

    private boolean esNombreCliente(String nombreNormalizado) {
        if (nombreNormalizado == null) return false;
        return nombreNormalizado.equals("cliente")
                || nombreNormalizado.equals("solicitante")
                || nombreNormalizado.equals("cliente / solicitante")
                || nombreNormalizado.equals("cliente/solicitante");
    }

    private String normalizar(String s) {
        if (s == null) return "";
        return s.trim().toLowerCase()
                .replace("á", "a").replace("é", "e").replace("í", "i")
                .replace("ó", "o").replace("ú", "u").replace("ñ", "n");
    }
}
