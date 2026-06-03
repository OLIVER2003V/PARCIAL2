import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * 👇 Servicio centralizado de configuración de API.
 *
 * Toda la app pregunta a este servicio en lugar de hardcodear URLs.
 * Single Source of Truth: si cambia el host o un endpoint, se cambia
 * solo aquí y se refleja en toda la aplicación.
 *
 * Beneficios:
 *  - Cambio de host: una sola edición en environment.ts
 *  - Testeable: se puede mockear este servicio en pruebas unitarias
 *  - Type-safe: autocompletado en IDE para todos los endpoints
 *  - Mantenible: si una ruta cambia en backend, una sola edición aquí
 */
@Injectable({ providedIn: 'root' })
export class ApiConfigService {
  /** Base de la API REST: ej. http://13.59.124.116:8080/api */
  readonly apiUrl = environment.apiUrl;

  /** Host base sin /api (para archivos estáticos): ej. http://13.59.124.116:8080 */
  readonly apiHost = environment.apiHost;

  /** URL del WebSocket — en producción se deriva del host actual para funcionar en cualquier servidor */
  readonly wsUrl = environment.production
    ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws-colaboracion`
    : environment.wsUrl;

  /** Flag útil para debug, logging o features ocultas en prod */
  readonly esProduccion = environment.production;

  // ============================================================================
  //  ENDPOINTS — registro centralizado por dominio
  // ============================================================================

  /** Auth (login, registro, FCM token) */
  readonly auth = {
    login:           `${this.apiUrl}/auth/login`,
    registro:        `${this.apiUrl}/auth/register`,
    guardarFcmToken: `${this.apiUrl}/auth/guardar-token-push`,
  };

  /** Usuarios (CRUD + estados) */
  readonly usuarios = {
    base:    `${this.apiUrl}/usuarios`,
    porId:   (id: string) => `${this.apiUrl}/usuarios/${id}`,
    estado:  (id: string) => `${this.apiUrl}/usuarios/${id}/estado`,
  };

  /** Departamentos (CRUD + stats + toggle) */
  readonly departamentos = {
    base:         `${this.apiUrl}/departamentos`,
    porId:        (id: string) => `${this.apiUrl}/departamentos/${id}`,
    stats:        `${this.apiUrl}/departamentos/stats`,                          // 👈 CORRECCIÓN
    toggleActivo: (id: string) => `${this.apiUrl}/departamentos/${id}/toggle-activo`, // 👈 CORRECCIÓN
  };

  /** Procesos / Políticas (CRUD + versionamiento + colaboración) */
  readonly procesos = {
    base:           `${this.apiUrl}/admin/procesos`,
    porId:          (id: string) => `${this.apiUrl}/admin/procesos/${id}`,
    publicar:       (id: string) => `${this.apiUrl}/admin/procesos/${id}/publicar`,
    publicarForzar: (id: string) => `${this.apiUrl}/admin/procesos/${id}/publicar?forzar=true`,
    validar:        (id: string) => `${this.apiUrl}/admin/procesos/${id}/validar`,
    nuevaVersion:   (id: string) => `${this.apiUrl}/admin/procesos/${id}/nueva-version`,
    versiones:      (codigoBase: string) => `${this.apiUrl}/admin/procesos/versiones/${codigoBase}`,
    borrador:       (id: string) => `${this.apiUrl}/admin/procesos/${id}/borrador`,
    toggleActivo:   (id: string) => `${this.apiUrl}/admin/procesos/${id}/toggle-activo`,
    restaurar:      (id: string) => `${this.apiUrl}/admin/procesos/${id}/restaurar`,
    publicos:       `${this.apiUrl}/admin/procesos/publicos`,
  };

  /** Trámites (CRUD + bandeja + dashboard + rastreo) */
  readonly tramites = {
    base:               `${this.apiUrl}/tramites`,
    porId:              (id: string) => `${this.apiUrl}/tramites/${id}`,
    iniciar:            `${this.apiUrl}/tramites/iniciar`,
    misTramites:        `${this.apiUrl}/tramites/mis-tramites`,
    rastrear:           (codigo: string) => `${this.apiUrl}/tramites/rastrear/${codigo}`,
    bandeja:            (deptoId: string) => `${this.apiUrl}/tramites/bandeja/${deptoId}`,
    historial:          (id: string) => `${this.apiUrl}/tramites/${id}/historial`,
    dashboardStats:     `${this.apiUrl}/tramites/dashboard/stats`,
    dashboardPolitica:  `${this.apiUrl}/tramites/dashboard/por-politica`,
  };

  /** Archivos (upload + URL pública para servir + listado CU22) */
  readonly archivos = {
    subir:      `${this.apiUrl}/archivos/subir`,
    eliminar:   `${this.apiUrl}/archivos/eliminar`,
    porTramite: (tramiteId: string) => `${this.apiUrl}/archivos/tramite/${tramiteId}`,
    /** Convierte ruta relativa "/uploads/..." a URL absoluta */
    urlVer:     (urlRelativa: string) => `${this.apiHost}${urlRelativa}`,
  };

  /** Documentos colaborativos (CU14) */
  readonly documentos = {
    crear:             `${this.apiUrl}/documentos/crear`,
    porTramite:        (id: string) => `${this.apiUrl}/documentos/tramite/${id}`,
    porProceso:        (id: string) => `${this.apiUrl}/documentos/proceso/${id}`,
    obtener:           (id: string) => `${this.apiUrl}/documentos/${id}`,
    eliminar:          (id: string) => `${this.apiUrl}/documentos/${id}`,
    estadoYjs:         (id: string) => `${this.apiUrl}/documentos/${id}/estado-yjs`,
    archivosPorTramite:(id: string) => `${this.apiUrl}/documentos/archivos/tramite/${id}`,
    archivosPorProceso:(id: string) => `${this.apiUrl}/documentos/archivos/proceso/${id}`,
    googleDoc:         `${this.apiUrl}/documentos/google-doc`,
    tiptap:            `${this.apiUrl}/documentos/tiptap`,
  };

  /** IA — Copiloto (CU17), Chatbot cliente, Sugerencias (CU09), Voz formulario (CU21) */
  readonly ia = {
    sugerir:        `${this.apiUrl}/ia/sugerir`,
    generarFlujo:   `${this.apiUrl}/ia/generar-flujo`,
    editarFlujo:    `${this.apiUrl}/ia/editar-flujo`,
    chatbotCliente: `${this.apiUrl}/ia/chatbot-cliente`,
    vozFormulario:        `${this.apiUrl}/ia/voz-formulario`,
    archivoFormulario:    `${this.apiUrl}/ia/archivo-formulario`,
    asistenteFormulario:  `${this.apiUrl}/ia/asistente-formulario`,
    // CU24 monitor
    monitorEstado:      `${this.apiUrl}/ia/estado`,
    monitorDistribucion:`${this.apiUrl}/ia/distribucion`,
    monitorAnomalias:   `${this.apiUrl}/ia/anomalias`,
    monitorCriticos:    `${this.apiUrl}/ia/criticos`,
    monitorPorDep:      `${this.apiUrl}/ia/por-departamento`,
    monitorEntrenar:    `${this.apiUrl}/ia/entrenar`,
  };

  /** Reportes gerenciales (CU13) + Minería (CU14) + NLP (CU23) */
  readonly reportes = {
    preview:           `${this.apiUrl}/reportes/preview`,
    excel:             `${this.apiUrl}/reportes/excel`,
    pdf:               `${this.apiUrl}/reportes/pdf`,
    mineriaPorProceso: (procesoId: string) => `${this.apiUrl}/reportes/mineria/${procesoId}`,
    nlp:               `${this.apiUrl}/reportes/nlp`,
    nlpPdf:            `${this.apiUrl}/reportes/nlp/pdf`,
    nlpExcel:          `${this.apiUrl}/reportes/nlp/excel`,
  };

  /** Auditoría (CU16 + CU20) — solo lectura */
  readonly auditoria = {
    consultar:      `${this.apiUrl}/auditoria/consultar`,
    opcionesFiltro: `${this.apiUrl}/auditoria/opciones-filtro`,
    categorias:     `${this.apiUrl}/auditoria/categorias`,
    porEntidad:     (entidadId: string) => `${this.apiUrl}/auditoria/entidad/${entidadId}`,
    exportar:       `${this.apiUrl}/auditoria/exportar`,
  };



  /** Colaboración: REST de invitaciones */
  readonly colaboracion = {
    generarLink:        `${this.apiUrl}/colaboracion/generar-link`,
    adminsDisponibles:  `${this.apiUrl}/colaboracion/admins-disponibles`,
    invitar:            `${this.apiUrl}/colaboracion/invitar`,
    validarToken:       (token: string) => `${this.apiUrl}/colaboracion/validar/${token}`,
  };
}
