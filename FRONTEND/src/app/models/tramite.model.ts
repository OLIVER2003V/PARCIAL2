// src/app/models/tramite.model.ts
export interface Tramite {
  id: number;
  codigoSeguimiento: string;
  nombreProceso?: string;
  fechaCreacion: string;
  clienteId: string;
  descripcion: string;
  estado?: string;

  estadoSemaforo: string; 
  departamentoActualId: string | number;
  fechaUltimaActualizacion: string;
  procesoDefinicionId?: string;   // 👈 NUEVO
  pasoActualId?: string;    
  datosFormularioInicial?: Record<string, any>;
  pasosActivosIds?: string[];
  pasosCompletadosIds?: string[];
  tipoResponsableActual?: 'INICIO_CLIENTE' | 'FUNCIONARIO' | 'SOLICITUD_CLIENTE' | 'AUTOMATICO';
  contadorIteraciones?: Record<string, number>;
  accionActor?: string;
  // CU24: metadatos predictivos
  riesgoDemora?:             number;
  esAnomalia?:               boolean;
  nivelPrioridad?:           'NORMAL' | 'ALTO' | 'CRITICO';
  funcionarioRecomendadoId?: string;
  motivoPrediccion?:         string;
}