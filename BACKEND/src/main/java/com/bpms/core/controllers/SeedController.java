package com.bpms.core.controllers;

import com.bpms.core.models.*;
import com.bpms.core.repositories.ProcesoDefinicionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/seed-demo")
@CrossOrigin(origins = "*")
public class SeedController {

    @Autowired
    private ProcesoDefinicionRepository repo;

    // ── POST /api/admin/seed-demo ─────────────────────────────────────────────
    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> sembrar() {
        repo.deleteByPublicadoPor("seed-demo");

        List<ProcesoDefinicion> todos = construirProcesos();
        repo.saveAll(todos);

        return ResponseEntity.ok(Map.of(
            "mensaje", "✅ " + todos.size() + " procesos de demo insertados correctamente.",
            "total", todos.size(),
            "con_formulario", todos.stream().filter(p -> p.getPasos() != null
                && !p.getPasos().isEmpty()
                && p.getPasos().get(0).getCampos() != null
                && !p.getPasos().get(0).getCampos().isEmpty()).count(),
            "eliminar", "DELETE /api/admin/seed-demo"
        ));
    }

    // ── DELETE /api/admin/seed-demo ───────────────────────────────────────────
    @DeleteMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Map<String, Object>> limpiar() {
        repo.deleteByPublicadoPor("seed-demo");
        return ResponseEntity.ok(Map.of("mensaje", "🗑️ Procesos de demo eliminados."));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BUILDERS
    // ═══════════════════════════════════════════════════════════════════════════

    /** Crea un proceso con sus pasos (sin campos en el formulario inicial). */
    private static ProcesoDefinicion p(String codigo, String nombre, String descripcion, String... nombresPasos) {
        ProcesoDefinicion pd = new ProcesoDefinicion();
        pd.setCodigo(codigo);
        pd.setCodigoBase(codigo);
        pd.setNombre(nombre);
        pd.setDescripcion(descripcion);
        pd.setEstado(EstadoProceso.ACTIVA);
        pd.setActivo(true);
        pd.setVersion("v1.0");
        pd.setNumeroVersion(1);
        pd.setPublicadoPor("seed-demo");
        pd.setFechaCreacion(LocalDateTime.now());
        pd.setFechaUltimaActualizacion(LocalDateTime.now());
        pd.setFechaPublicacion(LocalDateTime.now());

        List<Paso> pasos = new ArrayList<>();
        for (int i = 0; i < nombresPasos.length; i++) {
            Paso paso = new Paso();
            paso.setId(codigo + "-p" + (i + 1));
            paso.setNombre(nombresPasos[i]);
            paso.setTipo(TipoPaso.TAREA);
            paso.setTipoResponsable(i == 0 ? TipoResponsable.INICIO_CLIENTE : TipoResponsable.FUNCIONARIO);
            paso.setSlaHoras(48.0);
            pasos.add(paso);
        }
        pd.setPasos(pasos);
        pd.setPasoInicialId(codigo + "-p1");
        return pd;
    }

    /** Agrega campos al paso inicial de un proceso y lo devuelve. */
    private static ProcesoDefinicion conCampos(ProcesoDefinicion pd, CampoFormulario... campos) {
        if (pd.getPasos() != null && !pd.getPasos().isEmpty()) {
            List<CampoFormulario> lista = new ArrayList<>();
            for (CampoFormulario c : campos) lista.add(c);
            pd.getPasos().get(0).setCampos(lista);
        }
        return pd;
    }

    /** Crea un campo de formulario simple. */
    private static CampoFormulario c(String id, String etiqueta, String tipo, boolean requerido) {
        CampoFormulario c = new CampoFormulario();
        c.setId(id);
        c.setEtiqueta(etiqueta);
        c.setTipo(tipo);
        c.setRequerido(requerido);
        return c;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DATOS
    // ═══════════════════════════════════════════════════════════════════════════

    private List<ProcesoDefinicion> construirProcesos() {
        return List.of(

            // ── LICENCIAS Y PERMISOS ──────────────────────────────────────────

            conCampos(
                p("LIC001", "Licencia de Funcionamiento",
                  "Autorización municipal obligatoria para operar un establecimiento comercial, industrial o de servicios dentro del territorio. Cubre negocios como tiendas, restaurantes, talleres, consultorios y oficinas.",
                  "Presentación de solicitud y documentos",
                  "Inspección del establecimiento",
                  "Revisión de uso de suelo",
                  "Aprobación y emisión de licencia"),
                c("nombre_negocio",   "Nombre del establecimiento",                "texto",    true),
                c("tipo_actividad",   "Tipo de actividad comercial",               "texto",    true),
                c("direccion",        "Dirección exacta del local",                "texto",    true),
                c("propietario",      "Nombre del propietario o representante",    "texto",    true),
                c("dpi_nit",          "DPI o NIT del propietario",                 "texto",    true),
                c("telefono",         "Teléfono de contacto",                      "telefono", true),
                c("email",            "Correo electrónico",                        "email",    false),
                c("num_empleados",    "Número de empleados",                       "numero",   true),
                c("area_m2",          "Área del local en m²",                      "numero",   true),
                c("horario",          "Horario de atención al público",            "texto",    true),
                c("croquis",          "Croquis de ubicación del local",            "archivo",  true),
                c("patente",          "Patente de comercio o razón social",        "archivo",  true)
            ),

            conCampos(
                p("LIC002", "Renovación de Licencia de Funcionamiento",
                  "Actualización anual obligatoria de la licencia de un negocio ya establecido. No requiere nueva inspección si no hubo cambios en la actividad.",
                  "Solicitud de renovación con documentos vigentes",
                  "Verificación de cumplimiento de condiciones",
                  "Pago de tasa de renovación",
                  "Emisión de licencia renovada"),
                c("num_licencia",     "Número de licencia a renovar",              "texto",    true),
                c("nombre_negocio",   "Nombre del establecimiento",                "texto",    true),
                c("propietario",      "Nombre del propietario",                    "texto",    true),
                c("dpi_nit",          "DPI o NIT del propietario",                 "texto",    true),
                c("sin_cambios",      "¿Ha habido cambios en la actividad?",       "si_no",    true),
                c("licencia_vigente", "Copia de la licencia del año anterior",     "archivo",  true)
            ),

            p("LIC003", "Permiso de Venta Ambulante",
              "Autorización temporal para ejercer comercio en espacios públicos como mercados, ferias, calles peatonales o plazas. Se renueva cada seis meses.",
              "Solicitud y selección de espacio",
              "Revisión sanitaria del puesto",
              "Asignación de lugar y horario",
              "Emisión de carnet de vendedor"),

            p("LIC004", "Cambio de Giro Comercial",
              "Modificación de la actividad económica autorizada en una licencia de funcionamiento existente. Requiere nueva evaluación de uso de suelo.",
              "Presentación de solicitud de cambio",
              "Evaluación de compatibilidad de uso de suelo",
              "Inspección del local si aplica",
              "Actualización y emisión de nueva licencia"),

            conCampos(
                p("LIC005", "Licencia para Eventos Masivos",
                  "Permiso municipal para organizar conciertos, ferias, exposiciones o cualquier evento con afluencia de más de 100 personas en espacios públicos o privados.",
                  "Presentación de solicitud con plan del evento",
                  "Revisión de aforo y medidas de seguridad",
                  "Coordinación con seguridad pública",
                  "Emisión de permiso de evento"),
                c("nombre_evento",    "Nombre del evento",                         "texto",    true),
                c("tipo_evento",      "Tipo de evento",                            "texto",    true),
                c("fecha_evento",     "Fecha del evento",                          "fecha",    true),
                c("lugar",            "Lugar o dirección del evento",              "texto",    true),
                c("aforo",            "Aforo estimado de asistentes",              "numero",   true),
                c("organizador",      "Nombre del organizador responsable",        "texto",    true),
                c("telefono",         "Teléfono de contacto del organizador",      "telefono", true),
                c("plan_seguridad",   "Plan de seguridad y emergencia (PDF)",      "archivo",  true),
                c("seguro_evento",    "Póliza de seguro del evento",               "archivo",  false)
            ),

            // ── CONSTRUCCIÓN Y URBANISMO ──────────────────────────────────────

            conCampos(
                p("CON001", "Permiso de Construcción de Obra Nueva",
                  "Autorización para ejecutar la construcción de una edificación nueva en un terreno. Aplica para viviendas, locales comerciales, bodegas e infraestructura.",
                  "Presentación de planos y documentos técnicos",
                  "Revisión de planos por arquitecto municipal",
                  "Verificación de normativa urbana",
                  "Pago de derechos de construcción",
                  "Emisión de permiso de construcción"),
                c("propietario",      "Nombre del propietario del terreno",        "texto",    true),
                c("dpi_propietario",  "DPI del propietario",                       "texto",    true),
                c("ubicacion",        "Dirección exacta del predio",               "texto",    true),
                c("area_m2",          "Área total a construir en m²",              "numero",   true),
                c("niveles",          "Número de niveles o pisos",                 "numero",   true),
                c("uso_edificacion",  "Uso de la edificación",                     "texto",    true),
                c("profesional",      "Nombre del arquitecto o ingeniero responsable", "texto", true),
                c("num_colegiado",    "Número de colegiatura del profesional",     "texto",    true),
                c("planos",           "Planos arquitectónicos firmados y sellados","archivo",  true),
                c("memoria_calculo",  "Memoria de cálculo estructural",            "archivo",  true),
                c("escritura",        "Escritura de propiedad del terreno",        "archivo",  true)
            ),

            p("CON002", "Permiso de Ampliación o Remodelación",
              "Autorización para realizar modificaciones, ampliaciones o remodelaciones en una edificación existente.",
              "Presentación de planos de modificación",
              "Inspección de la obra existente",
              "Revisión técnica de los cambios propuestos",
              "Aprobación y emisión de permiso"),

            p("CON003", "Certificado de Habitabilidad",
              "Documento que certifica que una construcción terminada cumple con las condiciones mínimas de seguridad y salubridad para ser habitada o usada comercialmente.",
              "Solicitud de inspección final de obra",
              "Inspección técnica del inmueble terminado",
              "Verificación de instalaciones eléctricas y sanitarias",
              "Emisión de certificado de habitabilidad"),

            p("CON004", "Permiso de Demolición",
              "Autorización para derribar total o parcialmente una estructura existente. Requiere plan de manejo de escombros.",
              "Solicitud con plano de ubicación de la obra",
              "Inspección del estado estructural a demoler",
              "Plan de seguridad y manejo de escombros",
              "Emisión de permiso de demolición"),

            // ── REGISTROS Y CERTIFICADOS ──────────────────────────────────────

            conCampos(
                p("REG001", "Certificado de Residencia",
                  "Documento oficial que acredita el domicilio habitual del solicitante dentro del municipio. Requerido para trámites escolares, bancarios, laborales o médicos. Se emite en 24 horas hábiles.",
                  "Presentación de solicitud con identificación",
                  "Verificación en padrón de residentes",
                  "Emisión y firma del certificado"),
                c("nombre_completo",  "Nombre completo del solicitante",           "texto",    true),
                c("dpi",              "Número de DPI",                             "texto",    true),
                c("direccion",        "Dirección de residencia actual",            "texto",    true),
                c("tiempo_residencia","Tiempo de residir en el municipio",         "texto",    true),
                c("motivo",           "Motivo o destino del certificado",          "texto",    false),
                c("telefono",         "Teléfono de contacto",                      "telefono", true),
                c("dpi_foto",         "Fotografía del DPI (ambos lados)",          "archivo",  true)
            ),

            p("REG002", "Registro de Nacimiento Extemporáneo",
              "Inscripción en el registro civil de personas que no fueron registradas dentro del plazo legal. Requiere declaración de testigos y documentos médicos del parto.",
              "Presentación de solicitud y documentos de sustento",
              "Verificación documental y declaración de testigos",
              "Dictamen del registro civil",
              "Inscripción y emisión de acta de nacimiento"),

            conCampos(
                p("REG003", "Constancia de No Antecedentes Municipales",
                  "Certificado que acredita que el ciudadano no tiene deudas tributarias, multas ni infracciones administrativas pendientes con el gobierno municipal.",
                  "Presentación de solicitud con cédula de identidad",
                  "Consulta en sistema de deudas municipales",
                  "Consulta en registro de infracciones",
                  "Emisión de constancia firmada"),
                c("nombre_completo",  "Nombre completo del solicitante",           "texto",    true),
                c("dpi",              "Número de DPI",                             "texto",    true),
                c("nit",              "NIT (si aplica para empresa)",              "texto",    false),
                c("motivo",           "Finalidad de la constancia",                "texto",    true),
                c("dpi_copia",        "Copia del DPI",                             "archivo",  true)
            ),

            p("REG004", "Actualización de Datos en Padrón Municipal",
              "Corrección o actualización de información personal en el padrón de ciudadanos del municipio.",
              "Solicitud con documentos justificativos del cambio",
              "Revisión y validación de documentos",
              "Actualización en sistema",
              "Confirmación de cambios al ciudadano"),

            p("REG005", "Expedición de Partida de Matrimonio",
              "Obtención de copia certificada del acta de matrimonio registrada en el municipio.",
              "Presentación de solicitud e identificación",
              "Búsqueda en archivo de registros civiles",
              "Emisión de copia certificada",
              "Entrega al solicitante"),

            // ── SERVICIOS MUNICIPALES ─────────────────────────────────────────

            conCampos(
                p("SRV001", "Conexión de Agua Potable",
                  "Solicitud para instalar un nuevo servicio de agua potable en una propiedad residencial, comercial o industrial. Incluye evaluación técnica, instalación de medidor y activación del servicio.",
                  "Presentación de solicitud con plano de ubicación",
                  "Inspección técnica de la red en la zona",
                  "Instalación de acometida y medidor",
                  "Activación del servicio y lectura inicial"),
                c("propietario",      "Nombre del propietario del inmueble",       "texto",    true),
                c("dpi",              "DPI del propietario",                       "texto",    true),
                c("direccion",        "Dirección del inmueble a conectar",         "texto",    true),
                c("tipo_inmueble",    "Tipo de inmueble",                          "texto",    true),
                c("escritura",        "Escritura o constancia de propiedad",       "archivo",  true),
                c("plano_ubicacion",  "Plano de ubicación del predio",             "archivo",  false)
            ),

            p("SRV002", "Reclamo por Fallo en Servicio Público",
              "Canal formal para reportar fallas en servicios municipales: alumbrado público, recolección de basura, mantenimiento de calles o fugas de agua.",
              "Presentación de reclamo con evidencia fotográfica",
              "Asignación a departamento responsable",
              "Inspección y verificación en campo",
              "Resolución y notificación al ciudadano"),

            p("SRV003", "Exoneración de Impuesto Predial",
              "Solicitud de exención del impuesto sobre la propiedad inmueble. Aplica para adultos mayores, personas con discapacidad, instituciones sin fines de lucro y familias en situación de vulnerabilidad.",
              "Presentación de solicitud con documentos que acreditan la condición",
              "Verificación socioeconómica por trabajador social",
              "Dictamen del departamento de rentas",
              "Notificación de resolución y aplicación del beneficio"),

            p("SRV004", "Permiso de Corte de Calle o Acera",
              "Autorización temporal para cortar o bloquear parcialmente la vía pública con fines de obra o instalación de servicios. Plazo máximo de 10 días hábiles.",
              "Solicitud con plano de afectación y cronograma",
              "Evaluación de impacto vial",
              "Coordinación con tránsito municipal",
              "Emisión de permiso con condiciones"),

            p("SRV005", "Recolección Especial de Desechos Voluminosos",
              "Servicio de recolección de desechos de gran tamaño que no pueden ser recogidos por el camión regular: muebles, electrodomésticos o materiales de demolición menor.",
              "Solicitud con descripción del tipo y volumen de desechos",
              "Programación de fecha de recolección",
              "Visita y recolección por cuadrilla especializada",
              "Confirmación de servicio realizado"),

            // ── TRÁMITES EMPRESARIALES ────────────────────────────────────────

            conCampos(
                p("EMP001", "Registro de Nueva Empresa",
                  "Inscripción de una persona jurídica o negocio nuevo en el padrón municipal de contribuyentes. Requisito previo para obtener licencia de funcionamiento.",
                  "Presentación de documentos de constitución legal",
                  "Verificación de datos en registro mercantil",
                  "Asignación de número de contribuyente municipal",
                  "Activación en padrón de contribuyentes"),
                c("razon_social",     "Nombre o razón social de la empresa",       "texto",    true),
                c("tipo_empresa",     "Tipo de empresa (S.A., persona natural…)",  "texto",    true),
                c("actividad",        "Actividad económica principal",              "texto",    true),
                c("nit",              "NIT de la empresa",                         "texto",    true),
                c("representante",    "Nombre del representante legal",            "texto",    true),
                c("dpi_repres",       "DPI del representante legal",               "texto",    true),
                c("domicilio_fiscal", "Domicilio fiscal",                          "texto",    true),
                c("telefono",         "Teléfono de la empresa",                    "telefono", true),
                c("email",            "Correo electrónico de contacto",            "email",    true),
                c("acta_const",       "Acta de constitución de la empresa",        "archivo",  true),
                c("patente_soc",      "Patente de sociedad (Registro Mercantil)",  "archivo",  true)
            ),

            p("EMP002", "Baja de Actividad Comercial",
              "Proceso para dar de baja oficialmente un negocio que cesa operaciones. Cancela la licencia activa y cierra el registro en el padrón.",
              "Solicitud de baja con carta de cese de actividades",
              "Liquidación de impuestos y multas pendientes",
              "Inspección para verificar cese de operaciones",
              "Cancelación oficial de registro y licencia"),

            p("EMP003", "Declaración Anual de Impuesto de Industria y Comercio",
              "Presentación de la declaración tributaria anual sobre ingresos brutos por actividades comerciales, industriales o de servicios en el municipio.",
              "Presentación de declaración con estados financieros",
              "Revisión y validación por fiscalización",
              "Liquidación del impuesto a pagar",
              "Pago y expedición de paz y salvo tributario"),

            p("EMP004", "Certificado de Paz y Salvo Municipal",
              "Documento que certifica que una empresa o persona no tiene deudas pendientes con el municipio. Obligatorio para renovación de licencias y licitaciones.",
              "Solicitud con NIT o cédula del titular",
              "Verificación en sistema tributario municipal",
              "Revisión de multas e infracciones",
              "Emisión del certificado firmado"),

            p("EMP005", "Permiso de Publicidad Exterior",
              "Autorización para instalar vallas publicitarias, letreros luminosos, rótulos de fachada o cualquier elemento de publicidad exterior.",
              "Presentación de diseño y medidas del aviso",
              "Evaluación de impacto visual y normativa",
              "Revisión de compatibilidad con plan de imagen urbana",
              "Emisión de permiso con vigencia anual"),

            // ── APOYO SOCIAL ──────────────────────────────────────────────────

            p("SOC001", "Subsidio de Mejoramiento de Vivienda",
              "Apoyo económico no reembolsable para familias de escasos recursos para reparaciones estructurales, impermeabilización, mejoras sanitarias o conexión a servicios básicos.",
              "Solicitud con documentos de propiedad y situación económica",
              "Visita domiciliaria por trabajador social",
              "Dictamen técnico del estado de la vivienda",
              "Aprobación del comité de subsidios",
              "Desembolso y seguimiento de obras"),

            conCampos(
                p("SOC002", "Beca Escolar Municipal",
                  "Apoyo económico mensual para estudiantes de educación básica, media o superior de familias de bajos ingresos. Requiere mantener un rendimiento académico mínimo del 70%.",
                  "Presentación de solicitud con certificado de matrícula",
                  "Verificación de situación socioeconómica familiar",
                  "Evaluación académica y entrevista",
                  "Aprobación y registro en programa de becas",
                  "Entrega mensual del apoyo económico"),
                c("nombre_estudiante","Nombre completo del estudiante",            "texto",    true),
                c("fecha_nacimiento", "Fecha de nacimiento del estudiante",        "fecha",    true),
                c("nombre_tutor",     "Nombre del padre, madre o tutor",           "texto",    true),
                c("dpi_tutor",        "DPI del tutor",                             "texto",    true),
                c("telefono",         "Teléfono de contacto",                      "telefono", true),
                c("centro_educativo", "Centro educativo donde estudia",            "texto",    true),
                c("grado",            "Grado o año que cursa",                     "texto",    true),
                c("ingresos_familia", "Ingresos familiares mensuales aproximados", "numero",   true),
                c("num_dependientes", "Número de personas que dependen del ingreso","numero",  true),
                c("cert_matricula",   "Certificado de matrícula del ciclo actual", "archivo",  true),
                c("calificaciones",   "Constancia de calificaciones del ciclo anterior","archivo",false)
            ),

            p("SOC003", "Inscripción en Programa de Empleo Temporal",
              "Registro para participar en el programa de generación de empleo temporal para jefes de hogar desempleados. Duración de 3 meses en brigadas de obras de infraestructura o limpieza.",
              "Presentación de solicitud con comprobante de desempleo",
              "Entrevista de selección y evaluación de capacidades",
              "Asignación a brigada según perfil",
              "Inducción y capacitación en seguridad laboral",
              "Inicio de actividades y seguimiento mensual"),

            p("SOC004", "Programa de Atención al Adulto Mayor",
              "Inscripción en el programa integral de asistencia para personas mayores de 65 años. Incluye consultas médicas, talleres físicos y cognitivos, nutrición y acompañamiento social.",
              "Solicitud con cédula de identidad y comprobante de residencia",
              "Valoración médica y social inicial",
              "Inscripción en módulos del programa",
              "Asignación de gestor social de seguimiento"),

            p("SOC005", "Apoyo para Personas con Discapacidad",
              "Gestión de beneficios para personas con discapacidad certificada: exoneración de impuestos, acceso prioritario a servicios, ayudas técnicas y registro en el padrón de discapacidad.",
              "Presentación de carnet o certificado de discapacidad",
              "Evaluación de necesidades por trabajador social",
              "Gestión de beneficios según tipo de discapacidad",
              "Registro en padrón y entrega de carnet municipal"),

            // ── EDUCACIÓN Y CULTURA ───────────────────────────────────────────

            p("EDU001", "Permiso para Uso de Espacios Culturales",
              "Autorización para el uso de teatros, auditorios, plazas culturales o casas comunales para eventos culturales, artísticos o educativos.",
              "Solicitud con descripción del evento y público esperado",
              "Verificación de disponibilidad del espacio",
              "Revisión de requisitos técnicos y de seguridad",
              "Confirmación de reserva"),

            conCampos(
                p("EDU002", "Inscripción en Talleres Municipales Gratuitos",
                  "Registro para participar en talleres gratuitos de computación, música, pintura, idiomas, carpintería, costura y más. Dirigidos a todas las edades. Cupos limitados por orden de solicitud.",
                  "Solicitud de inscripción con datos personales",
                  "Verificación de residencia en el municipio",
                  "Asignación de cupo según disponibilidad",
                  "Confirmación e inicio del taller"),
                c("nombre_completo",  "Nombre completo del participante",          "texto",    true),
                c("fecha_nacimiento", "Fecha de nacimiento",                       "fecha",    true),
                c("dpi",              "Número de DPI (o de padre/madre si es menor)","texto",  true),
                c("telefono",         "Teléfono de contacto",                      "telefono", true),
                c("taller_interes",   "Taller de interés",                         "texto",    true),
                c("direccion",        "Dirección de residencia",                   "texto",    true)
            ),

            p("EDU003", "Donación de Material Bibliográfico",
              "Proceso para que ciudadanos, empresas o instituciones realicen donaciones de libros o material didáctico a la red de bibliotecas municipales.",
              "Presentación de lista de materiales a donar",
              "Evaluación de pertinencia y estado del material",
              "Recepción y catalogación de la donación",
              "Emisión de certificado de donación"),

            // ── SALUD Y SANIDAD ───────────────────────────────────────────────

            conCampos(
                p("SAL001", "Permiso Sanitario para Expendio de Alimentos",
                  "Certificación de que un establecimiento que manipula o vende alimentos cumple las normas de higiene y sanidad alimentaria. Aplica a restaurantes, panaderías, comedores y puestos de comida. Renovación anual obligatoria.",
                  "Solicitud con plano del área de preparación de alimentos",
                  "Inspección sanitaria del establecimiento",
                  "Revisión de certificados de manipuladores de alimentos",
                  "Emisión de permiso sanitario"),
                c("nombre_local",     "Nombre del establecimiento",                "texto",    true),
                c("tipo_local",       "Tipo de establecimiento",                   "texto",    true),
                c("propietario",      "Nombre del propietario",                    "texto",    true),
                c("dpi",              "DPI del propietario",                       "texto",    true),
                c("direccion",        "Dirección del establecimiento",             "texto",    true),
                c("num_manipuladores","Número de manipuladores de alimentos",      "numero",   true),
                c("tipo_alimentos",   "Tipo de alimentos que se preparan o venden","texto",    true),
                c("cert_manipuladores","Certificados de manipuladores de alimentos","archivo", true),
                c("plano_prep",       "Plano del área de preparación",             "archivo",  false)
            ),

            p("SAL002", "Fumigación y Control de Plagas en Zona Pública",
              "Solicitud para que el municipio realice operativos de fumigación o control de plagas en colonias con problemas de mosquitos, roedores u otras plagas que representen riesgo para la salud pública.",
              "Solicitud comunitaria con descripción del problema",
              "Evaluación epidemiológica de la zona",
              "Programación del operativo de fumigación",
              "Ejecución y reporte de resultados")
        );
    }
}
