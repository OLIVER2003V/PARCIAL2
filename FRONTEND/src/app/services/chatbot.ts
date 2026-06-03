import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ChatbotRequest, ChatbotResponse,
  ConversacionHistorial, MensajeChat
} from '../models/chatbot.model';
import { ApiConfigService } from '../core/api-config.service';

const STORAGE_SESION     = 'bpms_chat_sesion';
const STORAGE_HISTORIAL  = 'bpms_chat_historial';
const MAX_CONVERSACIONES = 15;

@Injectable({ providedIn: 'root' })
export class ChatbotService {
  private readonly http = inject(HttpClient);
  private readonly api  = inject(ApiConfigService);

  mensajes  = signal<MensajeChat[]>(cargarDesdStorage<MensajeChat[]>(STORAGE_SESION, []));
  historial = signal<ConversacionHistorial[]>(cargarDesdStorage<ConversacionHistorial[]>(STORAGE_HISTORIAL, []));

  // ── Envío HTTP ─────────────────────────────────────────────────────────────

  enviar(mensaje: string): Observable<ChatbotResponse> {
    const recientes = this.mensajes().slice(-10);
    const req: ChatbotRequest = {
      mensaje,
      historial: recientes.map(m => ({ rol: m.rol, contenido: m.contenido }))
    };
    return this.http.post<ChatbotResponse>(this.api.ia.chatbotCliente, req);
  }

  // ── Mensajes ───────────────────────────────────────────────────────────────

  agregarMensaje(
    rol: 'user' | 'assistant',
    contenido: string,
    extras?: Pick<MensajeChat, 'procesoId' | 'accion' | 'procesoNombre' | 'candidatosAlternativos' | 'requisitos'>
  ): void {
    this.mensajes.update(arr => [
      ...arr,
      { rol, contenido, timestamp: new Date(), ...extras }
    ]);
    guardarEnStorage(STORAGE_SESION, this.mensajes());
  }

  /** Archiva la conversación actual (si tiene mensajes del usuario) y limpia el chat. */
  limpiar(): void {
    const msgs = this.mensajes();
    if (msgs.some(m => m.rol === 'user')) {
      this.archivar(msgs);
    }
    this.mensajes.set([]);
    eliminarDeStorage(STORAGE_SESION);
  }

  // ── Historial ──────────────────────────────────────────────────────────────

  /** Restaura una conversación archivada como sesión activa. */
  restaurarConversacion(conv: ConversacionHistorial): void {
    this.mensajes.set(conv.mensajes.map(m => ({ ...m })));
    guardarEnStorage(STORAGE_SESION, this.mensajes());
  }

  eliminarConversacion(id: string): void {
    this.historial.update(arr => arr.filter(c => c.id !== id));
    guardarEnStorage(STORAGE_HISTORIAL, this.historial());
  }

  limpiarHistorial(): void {
    this.historial.set([]);
    eliminarDeStorage(STORAGE_HISTORIAL);
  }

  // ── Privados ───────────────────────────────────────────────────────────────

  private archivar(msgs: MensajeChat[]): void {
    const primerUsuario = msgs.find(m => m.rol === 'user');
    let titulo = 'Conversación';
    if (primerUsuario) {
      const texto = primerUsuario.contenido;
      titulo = texto.length > 55 ? texto.slice(0, 55) + '…' : texto;
    }

    const nueva: ConversacionHistorial = {
      id: Date.now().toString(),
      titulo,
      fechaIso: new Date().toISOString(),
      mensajes: msgs
    };

    this.historial.update(arr => [nueva, ...arr].slice(0, MAX_CONVERSACIONES));
    guardarEnStorage(STORAGE_HISTORIAL, this.historial());
  }
}

// ── Helpers de localStorage (funciones puras, sin clase) ───────────────────

function cargarDesdStorage<T>(clave: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function guardarEnStorage(clave: string, valor: unknown): void {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* ignore quota */ }
}

function eliminarDeStorage(clave: string): void {
  try { localStorage.removeItem(clave); } catch { /* ignore */ }
}
