// 👇 NUEVO CU16: Modelo del log de auditoría

export interface AuditLog {
  id: string;
  tramiteId?: string | null;
  usuarioId: string;
  departamentoId?: string | null;
  accion: string;
  categoria?: string | null;          // AUTH, POLITICA, USUARIO, DEPARTAMENTO, TRAMITE, SISTEMA
  pasoId?: string | null;
  pasoNombre?: string | null;
  detalle: string;
  fechaTimestamp: string;             // ISO-8601
  datosFormulario?: { [key: string]: any } | null;
  ipOrigen?: string | null;
  entidadId?: string | null;          // CU20: ID del objeto afectado
  entidadTipo?: string | null;        // CU20: PROCESO | TRAMITE | USUARIO | DEPARTAMENTO
}

export interface AuditoriaFiltro {
  usuarioId?: string;
  categoria?: string;
  accion?: string;
  ipOrigen?: string;
  desde?: string;       // ISO-8601 ej: "2026-04-25T00:00:00"
  hasta?: string;
  textoLibre?: string;
  entidadId?: string;   // CU20: filtrar por entidad vinculada
  pagina?: number;      // 0-indexed
  tamano?: number;      // default 50
}

export interface AuditoriaResultado {
  items: AuditLog[];
  total: number;
  pagina: number;
  tamano: number;
  totalPaginas: number;
}

export interface AuditoriaOpciones {
  usuarios: string[];
  acciones: string[];
  categorias: string[];
}