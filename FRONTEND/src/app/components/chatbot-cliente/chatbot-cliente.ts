import {
  AfterViewChecked, Component, ElementRef, OnDestroy, OnInit,
  ViewChild, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ChatbotService } from '../../services/chatbot';
import { AuthService } from '../../services/auth';
import { AsistenteVozService, VozResponse } from '../../services/asistente-voz.service';
import { ConversacionHistorial } from '../../models/chatbot.model';

@Component({
  selector: 'app-chatbot-cliente',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './chatbot-cliente.html'
})
export class ChatbotClienteComponent implements OnInit, AfterViewChecked, OnDestroy {
  private readonly chatbotService = inject(ChatbotService);
  private readonly authService    = inject(AuthService);
  private readonly vozService     = inject(AsistenteVozService);
  private readonly router         = inject(Router);

  @ViewChild('scrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

  // ── Estado general ────────────────────────────────────────────────────────
  abierto  = signal(false);
  cargando = signal(false);
  visible  = signal(false);

  // ── Estado de voz ─────────────────────────────────────────────────────────
  grabandoVoz  = signal(false);
  cargandoVoz  = signal(false);
  vozMuteada   = signal(false);
  vozSoportada = this.vozService.estaSoportado();
  textoInterim = this.vozService.textoInterim;
  nivelAudio   = this.vozService.nivelAudio;

  // ── Chat ──────────────────────────────────────────────────────────────────
  mensajeInputValue   = '';
  mensajes            = this.chatbotService.mensajes;
  historial           = this.chatbotService.historial;
  sugerenciasActuales = signal<string[]>([]);
  mostrandoHistorial  = signal(false);

  sugerenciasIniciales = [
    '¿Qué trámites puedo solicitar?',
    '¿Cómo va el estado de mis trámites?',
    '¿Cómo inicio un nuevo trámite?',
    '¿Qué documentos necesito?'
  ];

  private hayQueScrollear = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.visible.set(this.authService.getRol() === 'CLIENTE');
  }

  ngAfterViewChecked(): void {
    if (this.hayQueScrollear) { this.scrollAlFondo(); this.hayQueScrollear = false; }
  }

  ngOnDestroy(): void {
    if (this.grabandoVoz()) this.vozService.cancelarGrabacion();
    if (!this.vozMuteada() && 'speechSynthesis' in globalThis) globalThis.speechSynthesis.cancel();
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  toggle(): void {
    this.abierto.update(v => !v);
    if (this.abierto()) this.hayQueScrollear = true;
  }

  toggleMute(): void { this.vozMuteada.update(v => !v); }

  // ── Texto ─────────────────────────────────────────────────────────────────

  enviar(mensajeForzado?: string): void {
    const texto = (mensajeForzado ?? this.mensajeInputValue).trim();
    if (!texto || this.cargando() || this.cargandoVoz()) return;

    this.chatbotService.agregarMensaje('user', texto);
    this.mensajeInputValue = '';
    this.sugerenciasActuales.set([]);
    this.cargando.set(true);
    this.hayQueScrollear = true;

    this.chatbotService.enviar(texto).subscribe({
      next: (resp) => {
        let extras: Parameters<typeof this.chatbotService.agregarMensaje>[2];
        if (resp.accion === 'INICIAR_TRAMITE' && resp.procesoId) {
          extras = { accion: resp.accion, procesoId: resp.procesoId, procesoNombre: resp.procesoNombre };
        } else if (resp.accion === 'MOSTRAR_REQUISITOS' && resp.procesoId) {
          extras = { accion: resp.accion, procesoId: resp.procesoId, procesoNombre: resp.procesoNombre, requisitos: resp.requisitos };
        }
        this.chatbotService.agregarMensaje('assistant', resp.respuesta || '(sin respuesta)', extras);
        this.sugerenciasActuales.set(resp.sugerenciasRapidas || []);
        this.cargando.set(false);
        this.hayQueScrollear = true;
      },
      error: (err) => {
        const msg = err?.error?.error || 'No pude procesar tu mensaje. Intenta de nuevo.';
        this.chatbotService.agregarMensaje('assistant', '⚠️ ' + msg);
        this.cargando.set(false);
        this.hayQueScrollear = true;
      }
    });
  }

  usarSugerencia(s: string): void { this.enviar(s); }

  limpiarChat(): void {
    this.chatbotService.limpiar();
    this.sugerenciasActuales.set([]);
    this.mostrandoHistorial.set(false);
  }

  // ── Historial ─────────────────────────────────────────────────────────────

  toggleHistorial(): void  { this.mostrandoHistorial.update(v => !v); }
  limpiarHistorial(): void { this.chatbotService.limpiarHistorial(); }

  restaurarConversacion(conv: ConversacionHistorial): void {
    this.chatbotService.restaurarConversacion(conv);
    this.sugerenciasActuales.set([]);
    this.mostrandoHistorial.set(false);
    this.hayQueScrollear = true;
  }

  eliminarConversacion(id: string, event: MouseEvent): void {
    event.stopPropagation();
    this.chatbotService.eliminarConversacion(id);
  }

  formatearFecha(fechaIso: string): string {
    const fecha    = new Date(fechaIso);
    const ahora    = new Date();
    const diffDias = Math.floor((ahora.getTime() - fecha.getTime()) / 86_400_000);
    const hora     = fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    if (diffDias === 0) return `Hoy, ${hora}`;
    if (diffDias === 1) return `Ayer, ${hora}`;
    if (diffDias < 7)  return `Hace ${diffDias} días`;
    return fecha.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.enviar(); }
  }

  // ── Voz: toggle (un clic activa, otro detiene) ────────────────────────────

  toggleVoz(): void {
    if (this.cargando() || this.cargandoVoz()) return;
    this.grabandoVoz() ? this.detenerVoz() : this.iniciarVoz();
  }

  cancelarVoz(): void {
    if (!this.grabandoVoz()) return;
    this.vozService.cancelarGrabacion();
    this.grabandoVoz.set(false);
    this.hayQueScrollear = false;
  }

  private iniciarVoz(): void {
    try {
      this.vozService.iniciarEscucha(() => this.detenerVoz());
      this.grabandoVoz.set(true);
      this.hayQueScrollear = true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No pude acceder al micrófono.';
      this.chatbotService.agregarMensaje('assistant', `❌ ${msg}`);
      this.hayQueScrollear = true;
    }
  }

  private detenerVoz(): void {
    if (!this.grabandoVoz()) return;
    this.grabandoVoz.set(false);

    const textoEscuchado = this.textoInterim().trim();
    if (textoEscuchado) {
      this.chatbotService.agregarMensaje('user', textoEscuchado);
      this.hayQueScrollear = true;
    }

    this.cargandoVoz.set(true);
    this.sugerenciasActuales.set([]);

    const historial = this.chatbotService.mensajes()
      .slice(-10)
      .map(m => ({ rol: m.rol, contenido: m.contenido }));

    this.vozService.detenerYEnviar(historial).subscribe({
      next:  (res) => this.procesarRespuestaVoz(res),
      error: (err: unknown) => {
        this.cargandoVoz.set(false);
        const msg = err === 'TEXTO_DEMASIADO_CORTO'
          ? '🎙️ No escuché nada. Pulsa el micrófono y habla con calma.'
          : '⚠️ No pude conectarme con el asistente. Intenta de nuevo.';
        this.chatbotService.agregarMensaje('assistant', msg);
        this.hayQueScrollear = true;
      }
    });
  }

  // ── Navegación desde tarjetas ─────────────────────────────────────────────

  navegarATramite(procesoId: string): void {
    this.abierto.set(false);
    this.router.navigate(['/nuevo-tramite', procesoId]);
  }

  navegarACatalogo(): void {
    this.abierto.set(false);
    this.router.navigate(['/nuevo-tramite']);
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private procesarRespuestaVoz(res: VozResponse): void {
    this.cargandoVoz.set(false);
    if (!this.vozMuteada()) this.hablar(res.mensaje);

    if (res.sugerenciasRapidas?.length) {
      this.sugerenciasActuales.set(res.sugerenciasRapidas);
    }

    const accion = res.accion;

    if (accion === 'REDIRECCIONAR_FORMULARIO' && res.procesoId) {
      this.chatbotService.agregarMensaje('assistant', res.mensaje, {
        accion, procesoId: res.procesoId, procesoNombre: res.procesoNombre,
        candidatosAlternativos: res.candidatosAlternativos ?? []
      });
    } else if (accion === 'MOSTRAR_REQUISITOS' && res.procesoId) {
      this.chatbotService.agregarMensaje('assistant', res.mensaje, {
        accion, procesoId: res.procesoId, procesoNombre: res.procesoNombre,
        requisitos: res.requisitos ?? [],
        candidatosAlternativos: res.candidatosAlternativos ?? []
      });
    } else if (accion === 'CATALOGO_MANUAL' || accion === 'NO_RECONOCIDO') {
      this.chatbotService.agregarMensaje('assistant', res.mensaje, {
        accion, candidatosAlternativos: res.candidatosAlternativos ?? []
      });
    } else {
      // CONVERSACION, CHARLAR — solo texto, sin botones
      this.chatbotService.agregarMensaje('assistant', res.mensaje);
    }

    this.hayQueScrollear = true;
  }

  tipoLabel(tipo: string): string {
    const mapa: Record<string, string> = {
      texto: 'Texto', textarea: 'Texto largo', email: 'Correo', telefono: 'Teléfono',
      numero: 'Número', fecha: 'Fecha', hora: 'Hora', fecha_hora: 'Fecha/Hora',
      si_no: 'Sí / No', seleccion: 'Lista', radio: 'Opción única', checkbox: 'Múltiple',
      archivo: 'Archivo', imagen: 'Imagen', tabla: 'Tabla', calificacion: 'Calificación'
    };
    return mapa[tipo] ?? tipo;
  }

  private hablar(texto: string): void {
    if (!('speechSynthesis' in globalThis)) return;
    globalThis.speechSynthesis.cancel();

    // Eliminar emojis y símbolos decorativos para que la voz no los lea
    const textoLimpio = texto
      .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // bloques emoji principales
      .replace(/[\u{2600}-\u{27BF}]/gu, '')      // símbolos misc y dingbats
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')      // selectores de variación (modificadores emoji)
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!textoLimpio) return;

    const u = new SpeechSynthesisUtterance(textoLimpio);
    u.lang  = 'es-ES';
    u.rate  = 0.88;
    u.pitch = 1;

    // Seleccionar la mejor voz española disponible (Natural > Google > Microsoft > cualquier español)
    const voices = globalThis.speechSynthesis.getVoices();
    const voz =
      voices.find(v => v.lang.startsWith('es') && /natural/i.test(v.name))   ||
      voices.find(v => v.lang.startsWith('es') && /google/i.test(v.name))    ||
      voices.find(v => v.lang.startsWith('es') && /microsoft/i.test(v.name)) ||
      voices.find(v => v.lang.startsWith('es')) ||
      null;

    if (voz) u.voice = voz;

    globalThis.speechSynthesis.speak(u);
  }

  private scrollAlFondo(): void {
    try {
      const el = this.scrollContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch { /* ignore */ }
  }
}
