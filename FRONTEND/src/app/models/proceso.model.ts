export type TipoCampo =
  // Originales (retrocompat con backend actual)
  | 'texto' | 'numero' | 'textarea' | 'si_no' | 'fecha' | 'seleccion'
  // Numéricos
  | 'decimal'
  // Nuevos
  | 'email' | 'telefono' | 'hora' | 'fecha_hora'
  | 'radio' | 'checkbox'
  | 'archivo' | 'imagen'
  | 'firma'
  | 'ubicacion'
  | 'calificacion'
  | 'tabla'
  // Documentos colaborativos (Word / Excel integrados en el paso)
  | 'documento-texto' | 'documento-hoja'
  // Decorativos
  | 'titulo' | 'subtitulo' | 'parrafo' | 'separador';

export type AnchoCampo = 'completo' | 'medio' | 'tercio';
export type TipoResponsable = 'INICIO_CLIENTE' | 'FUNCIONARIO' | 'SOLICITUD_CLIENTE' | 'AUTOMATICO';
export interface OpcionCampo {
  id: string;
  etiqueta: string;
  valor: string;
}

export interface ColumnaTabla {
  id: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'fecha' | 'select' | 'checkbox' | 'booleano';
  requerido?: boolean;
  placeholder?: string;
  ancho?: 'auto' | 'pequeno' | 'medio' | 'grande';
  opciones?: OpcionCampo[]; // solo cuando tipo = 'select'
}

export interface CampoFormulario {
  id: string;
  etiqueta: string;
  tipo: TipoCampo;
  requerido: boolean;

  // Compat con versión anterior
  opciones?: string; // string separado por comas (legacy)

  // Nuevas propiedades
  descripcion?: string;           // texto de ayuda bajo el campo
  placeholder?: string;
  ancho?: AnchoCampo;             // diseño de layout
  valorPorDefecto?: string;

  // Validación
  minLongitud?: number;
  maxLongitud?: number;
  minValor?: number;
  maxValor?: number;
  patronRegex?: string;
  mensajeError?: string;

  // Opciones estructuradas (nuevo formato para select/radio/checkbox)
  opcionesList?: OpcionCampo[];

  // Archivos
  tiposArchivoPermitidos?: string[];  // ['pdf', 'jpg', 'png']
  tamanoMaxMB?: number;
  permiteMultiples?: boolean;

  // Calificación
  escalaMax?: number;                 // 5 o 10
  iconoCalificacion?: 'estrella' | 'corazon' | 'numero';

  // Tabla
  columnasTabla?: ColumnaTabla[];
  filasMinimas?: number;
  filasMaximas?: number;

  // Decorativos
  contenidoTexto?: string;            // para título/subtítulo/párrafo

  // Grid de layout (sistema de 12 columnas — reemplaza a ancho para casos nuevos)
  columnaSpan?: number;   // 1–12: cuántas columnas ocupa el campo
  columnaSalto?: boolean; // true = fuerza inicio en nueva fila del grid
}

export interface Transicion {
  estadoCondicion: string;
  pasoDestinoId: string;
  nombreAccion?: string;  // 👈 debe existir
  condicionExpr?: string;
}

export type TipoPaso =
  | 'TAREA'
  | 'GATEWAY_EXCLUSIVO'
  | 'GATEWAY_PARALELO_SPLIT'
  | 'GATEWAY_PARALELO_JOIN'
  | 'GATEWAY_INCLUSIVO'
  | 'NODO_FINAL'
  | 'NODO_TERMINACION'
  | 'EVENTO_INTERMEDIO'
  | 'SUBPROCESO';

export interface Paso {
  id: string;
  nombre: string;
  departamentoAsignadoId: string;
  transiciones: Transicion[];
  campos?: CampoFormulario[];
  tipoResponsable?: TipoResponsable;
  camposVisibles?: string[];
  tipo?: TipoPaso;              // 👈 NUEVO: viene del backend
  permiteReejecucion?: boolean; // 👈 NUEVO: viene del backend
  slaHoras?: number;
}

export interface PasoMetrica {
  pasoId: string;
  nombrePaso: string;
  cantidadTramites: number;
  tiempoPromedioHoras: number;
  tiempoMedianaHoras: number;
  tiempoP75Horas: number;
  slaObjetivoHoras: number;
  desviacionHoras: number;
  colorSemaforo: 'VERDE' | 'AMARILLO' | 'ROJO';
  slaAutoCalculado: boolean;
}

export interface AnalisisCuellosBotella {
  procesoId: string;
  nombreProceso: string;
  totalTramitesAnalizados: number;
  datosInsuficientes: boolean;
  mensajeAdvertencia?: string;
  metricasPorPaso: PasoMetrica[];
}

// === Tema visual del formulario (opcional, por paso o por proceso) ===
export type TemaFormulario = 'corporativo' | 'minimal' | 'vibrante' | 'naturaleza';

export type EstadoProceso = 'BORRADOR' | 'ACTIVA' | 'OBSOLETA' | 'ARCHIVADA';

export interface ProcesoDefinicion {
  id?: string;
  codigo: string;
  codigoBase?: string;          // 👈 NUEVO
  nombre: string;
  descripcion?: string;
  activo?: boolean;
  fechaCreacion?: string;
  fechaUltimaActualizacion?: string;
  pasoInicialId?: string;
  pasos?: Paso[];
  bpmnXml?: string;
  svgPreview?: string;
  temaFormulario?: TemaFormulario;
  // 👇 NUEVOS campos de versionamiento
  estado?: EstadoProceso;
  version?: string;
  numeroVersion?: number;
  publicadoPor?: string;
  fechaPublicacion?: string;
  motivoObsolescencia?: string;
}
