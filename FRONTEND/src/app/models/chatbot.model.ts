export interface RequisitoCampo {
  etiqueta: string;
  tipo: string;
  requerido: boolean;
}

export interface MensajeChat {
  rol: 'user' | 'assistant';
  contenido: string;
  timestamp?: Date;
  procesoId?: string;
  procesoNombre?: string;
  accion?: string;
  candidatosAlternativos?: { procesoId: string; nombre: string; confianza: number }[];
  requisitos?: RequisitoCampo[];
}

export interface ConversacionHistorial {
  id: string;
  titulo: string;
  fechaIso: string;
  mensajes: MensajeChat[];
}

export interface ChatbotRequest {
  mensaje: string;
  historial: { rol: string; contenido: string }[];
}

export interface ChatbotResponse {
  respuesta: string;
  sugerenciasRapidas: string[];
  advertencia?: string;
  accion?: string;
  procesoId?: string;
  procesoNombre?: string;
  requisitos?: RequisitoCampo[];
}
