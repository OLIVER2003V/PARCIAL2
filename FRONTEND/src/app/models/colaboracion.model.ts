// 👇 NUEVO Colaboración: tipos compartidos del módulo de edición en tiempo real

export interface PresenciaUsuario {
  username: string;
  nombreCompleto: string;
  color: string;       // hex, ej: "#a855f7"
  iniciales: string;   // ej: "OV"
  conectadoEn: number; // epoch ms
}

export interface EventoXml {
  emisor: string;
  xml: string;
  timestamp: number;
}

export interface EventoCursor {
  emisor: string;
  x: number;          // coordenadas en el modelo maxGraph, no de pantalla
  y: number;
  timestamp: number;
}

export interface EstadoSesion {
  procesoId: string;
  conectados: PresenciaUsuario[];
  borradorXml: string | null;
  fechaUltimoBorrador: number | null;
}

export interface NotificacionInvitacion {
  tipo: 'INVITACION_COLABORACION';
  invitador: string;
  procesoId: string;
  token: string;
  mensaje: string;
  timestamp: number;
}

export interface AdminDisponible {
  username: string;
  nombreCompleto: string;
  email: string;
}

// Modos de colaboración (kill switch)
export type ModoColaboracion = 'concurrente' | 'turnos';

// Cursor remoto enriquecido para renderizar (con info de presencia ya resuelta)
export interface CursorRemotoRender {
  username: string;
  nombreCompleto: string;
  color: string;
  iniciales: string;
  x: number;
  y: number;
  ultimoUpdate: number;  // para timeout (5s sin update → desaparece)
}