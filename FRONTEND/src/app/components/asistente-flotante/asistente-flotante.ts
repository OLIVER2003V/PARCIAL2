import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AsistenteVozService, VozResponse } from '../../services/asistente-voz.service';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-asistente-flotante',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './asistente-flotante.html',
  styleUrls: ['./asistente-flotante.css']
})
export class AsistenteFlotanteComponent implements OnDestroy {
  private asistenteService = inject(AsistenteVozService);
  private router = inject(Router);
  private auth   = inject(AuthService);

  grabando      = signal(false);
  cargando      = signal(false);
  mensajeIA     = signal<string | null>(null);
  transcrito    = signal<string | null>(null);
  mostrarInput  = signal(false);
  textoManual   = signal('');
  vozSoportada  = this.asistenteService.estaSoportado();

  /** Texto que el navegador está reconociendo en tiempo real */
  textoInterim = this.asistenteService.textoInterim;
  nivelAudio   = this.asistenteService.nivelAudio;

  esCliente = computed(() => this.auth.esCliente());

  /** Previene que touchstart + mousedown se disparen juntos en móvil */
  private grabandoFlag = false;
  private timeoutMensaje: ReturnType<typeof setTimeout> | null = null;

  toggleInput(): void {
    if (this.grabando() || this.cargando()) return;
    this.mostrarInput.update(v => !v);
    this.mensajeIA.set(null);
  }

  enviarTextoManual(): void {
    const texto = this.textoManual().trim();
    if (!texto || this.cargando() || this.grabando()) return;

    this.mostrarInput.set(false);
    this.transcrito.set(`"${texto}"`);
    this.textoManual.set('');
    this.cargando.set(true);
    this.mensajeIA.set('🧠 Clasificando intención…');

    this.asistenteService.enviarTexto(texto).subscribe({
      next:  (res) => this.manejarRespuesta(res),
      error: ()    => {
        this.cargando.set(false);
        this.mostrarMensaje('⚠️ No pude conectarme con el asistente. Intenta de nuevo.', 4000);
      }
    });
  }

  onInputKeydown(evento: KeyboardEvent): void {
    if (evento.key === 'Enter' && !evento.shiftKey) {
      evento.preventDefault();
      this.enviarTextoManual();
    }
    if (evento.key === 'Escape') {
      this.mostrarInput.set(false);
    }
  }

  iniciarEscucha(evento: Event): void {
    evento.preventDefault();
    evento.stopPropagation();
    if (this.grabandoFlag || this.grabando() || this.cargando()) return;
    this.grabandoFlag = true;

    clearTimeout(this.timeoutMensaje ?? undefined);
    this.transcrito.set(null);
    this.mensajeIA.set('🎙️ Escuchando… habla ahora');
    this.grabando.set(true);

    try {
      this.asistenteService.iniciarEscucha(() => {
        // Auto-detener al llegar al límite de 30 s
        this.detenerEscucha(new MouseEvent('auto'));
      });
    } catch (e: unknown) {
      this.grabando.set(false);
      this.grabandoFlag = false;
      const msg = e instanceof Error ? e.message : 'No pude acceder al micrófono.';
      this.mostrarMensaje(`❌ ${msg}`, 5000);
    }
  }

  detenerEscucha(evento: Event): void {
    evento.preventDefault();
    evento.stopPropagation();
    if (!this.grabando()) return;

    this.grabando.set(false);
    this.grabandoFlag = false;

    // Guardar lo que escuchó antes de limpiar el signal
    const textoEscuchado = this.textoInterim().trim();
    if (textoEscuchado) {
      this.transcrito.set(`"${textoEscuchado}"`);
    }

    this.cargando.set(true);
    this.mensajeIA.set('🧠 Clasificando intención…');

    this.asistenteService.detenerYEnviar().subscribe({
      next:  (res) => this.manejarRespuesta(res),
      error: (err: unknown) => {
        this.cargando.set(false);
        this.transcrito.set(null);
        if (err === 'TEXTO_DEMASIADO_CORTO') {
          this.mostrarMensaje('🎙️ No escuché nada. Mantén presionado y habla con calma.', 4000);
        } else {
          this.mostrarMensaje('⚠️ No pude conectarme con el asistente. Intenta de nuevo.', 4000);
        }
      }
    });
  }

  cancelarSiSale(evento: Event): void {
    if (this.grabando()) this.detenerEscucha(evento);
  }

  ngOnDestroy(): void {
    clearTimeout(this.timeoutMensaje ?? undefined);
    if (this.grabando()) {
      this.grabando.set(false);
      this.asistenteService.cancelarGrabacion();
    }
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  private manejarRespuesta(res: VozResponse): void {
    this.cargando.set(false);

    if (res.textoTranscrito) {
      this.transcrito.set(`"${res.textoTranscrito}"`);
    }

    this.hablar(res.mensaje);

    if (res.accion === 'REDIRECCIONAR_FORMULARIO' && res.procesoId) {
      this.mensajeIA.set(`✅ ${res.mensaje}`);
      this.timeoutMensaje = setTimeout(() => {
        this.router.navigate(['/nuevo-tramite', res.procesoId]);
        this.limpiar();
      }, 2500);

    } else if (res.accion === 'CATALOGO_MANUAL' || res.accion === 'NO_RECONOCIDO') {
      this.mensajeIA.set('🔍 No identifiqué el trámite. Abriendo el catálogo…');
      this.timeoutMensaje = setTimeout(() => {
        this.router.navigate(['/nuevo-tramite']);
        this.limpiar();
      }, 2500);

    } else {
      // CHARLAR — respuesta conversacional de Gemini
      this.mostrarMensaje(res.mensaje, 7000);
    }
  }

  private mostrarMensaje(msg: string, duracion: number): void {
    clearTimeout(this.timeoutMensaje ?? undefined);
    this.mensajeIA.set(msg);
    this.timeoutMensaje = setTimeout(() => this.limpiar(), duracion);
  }

  private limpiar(): void {
    this.mensajeIA.set(null);
    this.transcrito.set(null);
  }

  private hablar(texto: string): void {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'es-ES';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }
}
