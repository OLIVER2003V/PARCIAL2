import { Injectable, inject, signal, computed, OnDestroy } from '@angular/core';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';
import { AuthService } from './auth';
import {
  PresenciaUsuario,
  EventoXml,
  EventoCursor,
  EstadoSesion,
  NotificacionInvitacion,
  ModoColaboracion,
  CursorRemotoRender
} from '../models/colaboracion.model';
import { ApiConfigService } from '../core/api-config.service';

/**
 * 👇 NUEVO Colaboración: cliente STOMP + estado reactivo de la sala activa.
 *
 * Arquitectura:
 *  - Una única conexión STOMP por sesión del navegador (singleton via providedIn:'root')
 *  - Suscripciones por sala activa, se limpian al cerrar la sala
 *  - Signals reactivos consumibles desde cualquier componente
 *  - Timer interno para descartar cursores stale (5s sin update)
 *
 * Kill switch (línea MODO_COLABORACION):
 *   'concurrente' → Nivel 2: cualquiera puede editar, last-write-wins
 *   'turnos'      → Nivel 1.5: solo quien tiene el lápiz emite cambios
 *
 *   Si en la prueba final algo se rompe, cambia a 'turnos' y queda Nivel 1.5
 *   sin tocar más código.
 */
export interface EventoMetadatos {
  emisor: string;
  timestamp: number;
  payload: any;
}
@Injectable({ providedIn: 'root' })
export class ColaboracionService implements OnDestroy {


  private authService = inject(AuthService);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  // 👈 KILL SWITCH — Cambiar a 'turnos' si Nivel 2 falla en demo
  public readonly MODO_COLABORACION: ModoColaboracion = 'concurrente';

  // ===== Configuración =====
 
  private readonly TIMEOUT_CURSOR_MS = 5000;
  private readonly DEBOUNCE_XML_MS = 500;
  private readonly THROTTLE_CURSOR_MS = 50;

  // ===== Cliente STOMP =====
  private stompClient: Client | null = null;
  private conexionActiva = signal(false);

  // Variable para el callback
  private onMetadatosEntrante: ((evento: EventoMetadatos) => void) | null = null;
  private onNotificacionSala: ((notif: any) => void) | null = null;

  // Registrar el callback
  onMetadatosRecibidos(callback: (evento: EventoMetadatos) => void): void {
    this.onMetadatosEntrante = callback;
  }

  /** Registra el callback que se invoca cuando un proceso en la sala activa es publicado. */
  onPublicacionRecibida(callback: (notif: any) => void): void {
    this.onNotificacionSala = callback;
  }

  // Emitir hacia el backend
  emitirCambioMetadatos(payload: any): void {
    const procesoId = this.procesoIdActivo();
    if (!procesoId || !this.stompClient || !this.stompClient.active) return;

    const evento: Partial<EventoMetadatos> = {
      payload,
      timestamp: Date.now()
    };

    this.stompClient.publish({
      destination: `/app/sesion/${procesoId}/cambio-metadatos`,
      body: JSON.stringify(evento)
    });
  }

  // ===== Estado de la sala activa =====
  procesoIdActivo = signal<string | null>(null);
  conectados = signal<PresenciaUsuario[]>([]);
  cursoresRemotos = signal<CursorRemotoRender[]>([]);
  estadoInicial = signal<EstadoSesion | null>(null);
  notificacionesEntrantes = signal<NotificacionInvitacion[]>([]);

  // Computed: indica si estoy yo solo o hay más gente
  estoySolo = computed(() => this.conectados().length <= 1);
  totalConectados = computed(() => this.conectados().length);

  // ===== Callbacks que el componente del editor puede registrar =====
  // El editor escucha cambios entrantes para aplicarlos al modeler
  private onXmlEntrante: ((evento: EventoXml) => void) | null = null;

  // ===== Tracking interno =====
  private suscripciones: StompSubscription[] = [];
  private timerLimpiezaCursores: any = null;
  private debounceXmlTimeout: any = null;
  private ultimoCursorEnviado = 0;

  // === API PÚBLICA ===

  /**
   * Conecta al servidor WebSocket.
   * Idempotente: si ya está conectado no hace nada.
   */
  async conectar(): Promise<void> {
    if (this.stompClient && this.stompClient.active) {
      console.log('[Colaboración] Ya conectado');
      return;
    }

    const token = this.authService.getToken();
    if (!token) {
      throw new Error('No hay token JWT en localStorage');
    }

    return new Promise((resolve, reject) => {
      this.stompClient = new Client({
        brokerURL: this.api.wsUrl,
        connectHeaders: {
          Authorization: `Bearer ${token}`
        },
        debug: () => { /* silencio en producción; descomenta para debug */ },
        reconnectDelay: 5000,
        heartbeatIncoming: 0,
        heartbeatOutgoing: 0,

        onConnect: () => {
          console.log('✅ [Colaboración] STOMP conectado');
          this.conexionActiva.set(true);

          // Suscribirse a notificaciones personales (válido para toda la sesión)
          this.suscribirseANotificacionesPersonales();

          // Resubscribe all open document editors after reconnect
          this.onDocUpdate.forEach((onUpdate, docId) => {
            const onPres = this.onDocPresencia.get(docId) ?? (() => {});
            this._suscribirTopicsDoc(docId, onUpdate, onPres);
          });

          resolve();
        },

        onStompError: (frame) => {
          console.error('❌ [Colaboración] STOMP error:', frame.headers['message']);
          this.conexionActiva.set(false);
          reject(new Error(frame.headers['message'] || 'Error STOMP'));
        },

        onWebSocketError: (event) => {
          console.error('❌ [Colaboración] WebSocket error:', event);
          this.conexionActiva.set(false);
        },

        onWebSocketClose: () => {
          console.log('🔌 [Colaboración] WebSocket cerrado');
          this.conexionActiva.set(false);
        }
      });

      this.stompClient.activate();
    });
  }
  
  /**
   * Entra a una sala (proceso). Si ya estaba en otra, sale primero.
   */
  async unirseSala(procesoId: string): Promise<void> {
    if (!this.stompClient || !this.stompClient.active) {
      await this.conectar();
    }

    if (this.procesoIdActivo() === procesoId) {
      console.log('[Colaboración] Ya estoy en esta sala');
      return;
    }

    if (this.procesoIdActivo()) {
      this.salirSala();
    }

    this.procesoIdActivo.set(procesoId);

    // Suscribirse a topics de la sala ANTES de mandar el "unirse"
    // (si no, llega el broadcast antes de tener listener y se pierde)
    this.suscribirseATopicsDeSala(procesoId);

    // Mandar "unirse" al servidor
    this.stompClient!.publish({
      destination: `/app/sesion/${procesoId}/unirse`,
      body: ''
    });

    // Iniciar timer de limpieza de cursores stale
    this.iniciarTimerLimpiezaCursores();

    console.log(`👋 [Colaboración] Unido a sala ${procesoId}`);
  }

  /**
   * Sale de la sala actual.
   */
  salirSala(): void {
    const procesoId = this.procesoIdActivo();
    if (!procesoId || !this.stompClient || !this.stompClient.active) return;

    this.stompClient.publish({
      destination: `/app/sesion/${procesoId}/salir`,
      body: ''
    });

    // Cancelar suscripciones de la sala
    this.suscripciones.forEach(s => {
      try { s.unsubscribe(); } catch { /* no-op */ }
    });
    this.suscripciones = [];

    // Reset estado
    this.procesoIdActivo.set(null);
    this.conectados.set([]);
    this.cursoresRemotos.set([]);
    this.estadoInicial.set(null);
    this.detenerTimerLimpiezaCursores();

    console.log(`👋 [Colaboración] Salí de sala ${procesoId}`);
  }

  /**
   * Emite un cambio de XML al servidor (con debounce).
   * Llamado desde el componente diagramador cuando detecta un cambio del modeler.
   */
  emitirCambioXml(xml: string): void {
    if (this.MODO_COLABORACION === 'turnos') {
      // En modo turnos, solo emite quien "tiene el lápiz".
      // Por ahora siempre emitimos en modo concurrente.
      // Si quieres añadir el "lápiz" lo haríamos en una iteración futura.
    }

    const procesoId = this.procesoIdActivo();
    if (!procesoId) return;

    // Debounce: si llegan muchos cambios seguidos, solo enviamos el último.
    if (this.debounceXmlTimeout) clearTimeout(this.debounceXmlTimeout);
    this.debounceXmlTimeout = setTimeout(() => {
      if (!this.stompClient || !this.stompClient.active) return;

      const evento: Partial<EventoXml> = {
        xml,
        timestamp: Date.now()
        // emisor lo setea el backend desde el Principal autenticado
      };

      this.stompClient.publish({
        destination: `/app/sesion/${procesoId}/cambio-xml`,
        body: JSON.stringify(evento)
      });
    }, this.DEBOUNCE_XML_MS);
  }

  /**
   * Emite la posición del cursor (con throttle).
   */
  emitirCursor(x: number, y: number): void {
    const procesoId = this.procesoIdActivo();
    if (!procesoId || !this.stompClient || !this.stompClient.active) return;

    const ahora = Date.now();
    if (ahora - this.ultimoCursorEnviado < this.THROTTLE_CURSOR_MS) return;
    this.ultimoCursorEnviado = ahora;

    const evento: Partial<EventoCursor> = {
      x,
      y,
      timestamp: ahora
    };

    this.stompClient.publish({
      destination: `/app/sesion/${procesoId}/cursor`,
      body: JSON.stringify(evento)
    });
  }

  /**
   * Registra el callback que se invoca cuando llega un EventoXml de otro usuario.
   * El componente diagramador lo registra para aplicar el XML al modeler.
   */
  onXmlRecibido(callback: (evento: EventoXml) => void): void {
    this.onXmlEntrante = callback;
  }

  // === HELPERS PRIVADOS ===

  private suscribirseATopicsDeSala(procesoId: string): void {
    if (!this.stompClient || !this.stompClient.active) return;

    // Topic: presencia (lista de conectados)
    this.suscripciones.push(
      this.stompClient.subscribe(
        `/topic/sesion/${procesoId}/presencia`,
        (msg: IMessage) => {
          try {
            const lista: PresenciaUsuario[] = JSON.parse(msg.body);
            this.conectados.set(lista);
          } catch (e) {
            console.error('[Colaboración] Error parsing presencia:', e);
          }
        }
      )
    );

    // Topic: cambios de XML
    this.suscripciones.push(
      this.stompClient.subscribe(
        `/topic/sesion/${procesoId}/cambio-xml`,
        (msg: IMessage) => {
          try {
            const evento: EventoXml = JSON.parse(msg.body);
            const yo = this.authService.getUsername();
            // Ignorar eco propio
            if (evento.emisor === yo) return;
            // Notificar al componente diagramador
            if (this.onXmlEntrante) this.onXmlEntrante(evento);
          } catch (e) {
            console.error('[Colaboración] Error parsing cambio-xml:', e);
          }
        }
      )
    );

    // Topic: cursores
    this.suscripciones.push(
      this.stompClient.subscribe(
        `/topic/sesion/${procesoId}/cursor`,
        (msg: IMessage) => {
          try {
            const evento: EventoCursor = JSON.parse(msg.body);
            const yo = this.authService.getUsername();
            if (evento.emisor === yo) return;
            this.actualizarCursorRemoto(evento);
          } catch (e) {
            console.error('[Colaboración] Error parsing cursor:', e);
          }
        }
      )
    );

    // Personal: estado inicial al entrar
    this.suscripciones.push(
      this.stompClient.subscribe(
        `/user/queue/sesion/${procesoId}/estado`,
        (msg: IMessage) => {
          try {
            const estado: EstadoSesion = JSON.parse(msg.body);
            this.estadoInicial.set(estado);
            this.conectados.set(estado.conectados ?? []);
            console.log('📥 [Colaboración] Estado inicial recibido:', estado);
          } catch (e) {
            console.error('[Colaboración] Error parsing estado inicial:', e);
          }
        }
      )
    );
    // Topic: cambios de metadata (formularios)
    this.suscripciones.push(
      this.stompClient.subscribe(
        `/topic/sesion/${procesoId}/cambio-metadatos`,
        (msg: IMessage) => {
          try {
            const evento: EventoMetadatos = JSON.parse(msg.body);
            const yo = this.authService.getUsername();
            if (evento.emisor === yo) return; // Ignorar eco propio
            if (this.onMetadatosEntrante) this.onMetadatosEntrante(evento);
          } catch (e) {
            console.error('[Colaboración] Error parsing cambio-metadatos:', e);
          }
        }
      )
    );

    // Topic: notificaciones de la sala (ej. proceso publicado por otro admin)
    this.suscripciones.push(
      this.stompClient.subscribe(
        `/topic/sesion/${procesoId}/notificacion`,
        (msg: IMessage) => {
          try {
            const notif = JSON.parse(msg.body);
            if (this.onNotificacionSala) this.onNotificacionSala(notif);
          } catch (e) {
            console.error('[Colaboración] Error parsing notificacion:', e);
          }
        }
      )
    );
  }

  private suscribirseANotificacionesPersonales(): void {
    if (!this.stompClient || !this.stompClient.active) return;

    this.suscripciones.push(
      this.stompClient.subscribe(
        `/user/queue/notificaciones`,
        (msg: IMessage) => {
          try {
            const notif: NotificacionInvitacion = JSON.parse(msg.body);
            // Mantenemos las últimas 10 notificaciones
            this.notificacionesEntrantes.update(arr => [notif, ...arr].slice(0, 10));
            console.log('📨 [Colaboración] Notificación recibida:', notif);
          } catch (e) {
            console.error('[Colaboración] Error parsing notificación:', e);
          }
        }
      )
    );
  }

  private actualizarCursorRemoto(evento: EventoCursor): void {
    const presencias = this.conectados();
    const presencia = presencias.find(p => p.username === evento.emisor);
    if (!presencia) return; // todavía no llegó la presencia, ignoramos

    this.cursoresRemotos.update(arr => {
      const sinEmisor = arr.filter(c => c.username !== evento.emisor);
      const nuevo: CursorRemotoRender = {
        username: presencia.username,
        nombreCompleto: presencia.nombreCompleto,
        color: presencia.color,
        iniciales: presencia.iniciales,
        x: evento.x,
        y: evento.y,
        ultimoUpdate: Date.now()
      };
      return [...sinEmisor, nuevo];
    });
  }

  private iniciarTimerLimpiezaCursores(): void {
    this.detenerTimerLimpiezaCursores();
    this.timerLimpiezaCursores = setInterval(() => {
      const ahora = Date.now();
      this.cursoresRemotos.update(arr =>
        arr.filter(c => ahora - c.ultimoUpdate < this.TIMEOUT_CURSOR_MS)
      );
    }, 1000);
  }

  private detenerTimerLimpiezaCursores(): void {
    if (this.timerLimpiezaCursores) {
      clearInterval(this.timerLimpiezaCursores);
      this.timerLimpiezaCursores = null;
    }
  }

  marcarNotificacionLeida(timestamp: number): void {
    this.notificacionesEntrantes.update(arr =>
      arr.filter(n => n.timestamp !== timestamp)
    );
  }

  // ── Documentos colaborativos (Yjs) ──────────────────────────────────────────

  /** Callbacks por documentoId registrados por los editores abiertos. */
  private onDocUpdate    = new Map<string, (ev: any) => void>();
  private onDocPresencia = new Map<string, (ev: any) => void>();

  /** Suscribe el cliente al canal de un documento colaborativo. */
  suscribirDocumento(documentoId: string,
                     onUpdate: (ev: any) => void,
                     onPresencia: (ev: any) => void): void {
    this.onDocUpdate.set(documentoId, onUpdate);
    this.onDocPresencia.set(documentoId, onPresencia);
    this._suscribirTopicsDoc(documentoId, onUpdate, onPresencia);
  }

  private _suscribirTopicsDoc(documentoId: string,
                               onUpdate: (ev: any) => void,
                               onPresencia: (ev: any) => void): void {
    if (!this.stompClient?.connected) return;

    this.suscripciones.push(
      this.stompClient.subscribe(`/topic/doc/${documentoId}/update`, (msg) => {
        try {
          const ev = JSON.parse(msg.body);
          if (ev.emisor === this.authService.getUsername()) return;
          onUpdate(ev);
        } catch { /* ignorar */ }
      })
    );

    this.suscripciones.push(
      this.stompClient.subscribe(`/topic/doc/${documentoId}/presencia`, (msg) => {
        try {
          const ev = JSON.parse(msg.body);
          if (ev.emisor === this.authService.getUsername()) return;
          onPresencia(ev);
        } catch { /* ignorar */ }
      })
    );
  }

  /** Envía un Yjs binary update (Uint8Array → base64) al canal del documento. */
  emitirYjsUpdate(documentoId: string, updateBase64: string): void {
    if (!this.stompClient?.connected) return;
    try {
      this.stompClient.publish({
        destination: `/app/doc/${documentoId}/update`,
        body: JSON.stringify({ tipo: 'yjs-update', payload: updateBase64 })
      });
    } catch { /* WS in reconnecting state — update dropped */ }
  }

  /** Envía la celda activa en una hoja de cálculo. */
  emitirPresenciaCelda(documentoId: string, fila: number, columna: number): void {
    if (!this.stompClient || !this.stompClient.active) return;
    this.stompClient.publish({
      destination: `/app/doc/${documentoId}/presencia-celda`,
      body: JSON.stringify({ tipo: 'presencia-celda', fila, columna })
    });
  }

  /** Solicita guardado del snapshot actual en el servidor. */
  guardarDocumento(documentoId: string, contenido: string, estadoYjs: string): void {
    if (!this.stompClient?.connected) return;
    try {
      this.stompClient.publish({
        destination: `/app/doc/${documentoId}/guardar`,
        body: JSON.stringify({ payload: contenido, archivoUrl: estadoYjs })
      });
    } catch { /* WS in reconnecting state — save will retry */ }
  }

  ngOnDestroy(): void {
    this.salirSala();
    if (this.stompClient) {
      this.stompClient.deactivate();
      this.stompClient = null;
    }
  }
}