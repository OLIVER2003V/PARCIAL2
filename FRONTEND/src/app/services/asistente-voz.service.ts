import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '../core/api-config.service';
import { AuthService } from './auth';

export interface CandidatoAlternativo {
  procesoId: string;
  nombre: string;
  confianza: number;
}

export interface RequisitoCampoVoz {
  etiqueta: string;
  tipo: string;
  requerido: boolean;
}

export interface VozResponse {
  exito: boolean;
  accion: string;
  procesoId?: string;
  procesoNombre?: string;
  mensaje: string;
  textoTranscrito?: string;
  candidatosAlternativos?: CandidatoAlternativo[];
  sugerenciasRapidas?: string[];
  requisitos?: RequisitoCampoVoz[];
}

const TIMEOUT_GRABACION_MS  = 30_000;
const SILENCIO_AUTO_STOP_MS = 3_000;  // parar automáticamente tras 3 s de silencio

/**
 * Servicio de reconocimiento de voz usando la Web Speech API del navegador (STT local).
 * El audio NUNCA sale del dispositivo — el navegador transcribe y solo enviamos texto al backend.
 * El backend llama al microservicio Python únicamente para NLP (clasificación de intención),
 * eliminando el problema de compatibilidad con formatos de audio (webm/wav).
 */
@Injectable({ providedIn: 'root' })
export class AsistenteVozService {
  private readonly http = inject(HttpClient);
  private readonly api  = inject(ApiConfigService);
  private readonly auth = inject(AuthService);

  /** Nivel de audio simulado (0–100) para la barra visual mientras se graba */
  nivelAudio   = signal(0);
  /** Texto transcrito en tiempo real mientras el usuario habla */
  textoInterim = signal('');

  private recognition: any = null;
  private grabando = false;
  private recordingTimeout: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private animInterval: ReturnType<typeof setInterval> | null = null;

  /** Devuelve true si el navegador soporta Web Speech API */
  estaSoportado(): boolean {
    return !!(globalThis as any).SpeechRecognition || !!(globalThis as any).webkitSpeechRecognition;
  }

  /**
   * Inicia el reconocimiento de voz.
   * @param onAutoStop callback invocado si se supera el límite de 30 s
   * @throws Error si el navegador no soporta la API o si el micrófono está bloqueado
   */
  iniciarEscucha(onAutoStop?: () => void): void {
    const SpeechRecognition =
      (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      throw new Error('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
    }

    this.textoInterim.set('');
    this.grabando = true;

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'es-ES';
    this.recognition.continuous = true;       // Sigue escuchando sin parar automáticamente
    this.recognition.interimResults = true;   // Muestra resultados parciales mientras habla
    this.recognition.maxAlternatives = 1;

    let transcriptFinal = '';

    this.recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          transcriptFinal += t + ' ';
        } else {
          interim = t;
        }
      }
      this.textoInterim.set((transcriptFinal + interim).trim());
    };

    this.recognition.onerror = (event: any) => {
      // 'no-speech' es silencio normal; 'aborted' ocurre cuando nosotros llamamos abort() al detener
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('[STT] Error de reconocimiento:', event.error);
      }
    };

    // Auto-stop por silencio: cuando el usuario deja de hablar arrancamos cuenta regresiva
    this.recognition.onspeechend = () => {
      if (this.textoInterim().trim().length > 2) {
        this.silenceTimer = setTimeout(() => {
          if (this.grabando) onAutoStop?.();
        }, SILENCIO_AUTO_STOP_MS);
      }
    };

    // Si retoma el habla, cancelamos la cuenta regresiva
    this.recognition.onspeechstart = () => {
      if (this.silenceTimer !== null) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    };

    this.recognition.start();
    this.iniciarAnimacionNivel();

    this.recordingTimeout = setTimeout(() => {
      if (this.grabando) onAutoStop?.();
    }, TIMEOUT_GRABACION_MS);
  }

  /** Envía texto escrito manualmente (sin voz) al mismo endpoint de clasificación NLP. */
  enviarTexto(texto: string): Observable<VozResponse> {
    const formData = new FormData();
    formData.append('texto',     texto.trim());
    formData.append('clienteId', this.auth.getUsername() || 'SISTEMA');
    return this.http.post<VozResponse>(`${this.api.apiUrl}/tramites/voz-texto`, formData);
  }

  /**
   * Detiene el reconocimiento y envía el texto transcrito al backend para clasificación NLP.
   */
  detenerYEnviar(historial: { rol: string; contenido: string }[] = []): Observable<VozResponse> {
    return new Observable<VozResponse>((observer) => {
      clearTimeout(this.recordingTimeout ?? undefined);
      clearTimeout(this.silenceTimer ?? undefined);
      this.silenceTimer = null;
      this.grabando = false;
      this.detenerAnimacionNivel();

      const texto = this.textoInterim().trim();

      // Abortar reconocimiento inmediatamente (no esperamos más resultados)
      if (this.recognition) {
        this.recognition.abort();
        this.recognition = null;
      }

      if (texto.length < 3) {
        this.textoInterim.set('');
        observer.error('TEXTO_DEMASIADO_CORTO');
        return;
      }

      const formData = new FormData();
      formData.append('texto',     texto);
      formData.append('clienteId', this.auth.getUsername() || 'SISTEMA');
      formData.append('historial', JSON.stringify(historial));

      this.http
        .post<VozResponse>(`${this.api.apiUrl}/tramites/voz-texto`, formData)
        .subscribe({
          next:     (res) => { this.textoInterim.set(''); observer.next(res); observer.complete(); },
          error:    (err) => { this.textoInterim.set(''); observer.error(err); }
        });
    });
  }

  /** Cancela la escucha sin enviar (usado en ngOnDestroy o si el usuario cancela). */
  cancelarGrabacion(): void {
    clearTimeout(this.recordingTimeout ?? undefined);
    clearTimeout(this.silenceTimer ?? undefined);
    this.silenceTimer = null;
    this.grabando = false;
    this.detenerAnimacionNivel();
    this.textoInterim.set('');
    if (this.recognition) {
      this.recognition.abort();
      this.recognition = null;
    }
  }

  // ── Animación de nivel (simulada, no hay AudioContext sin MediaRecorder) ──

  private iniciarAnimacionNivel(): void {
    let nivel = 30;
    this.animInterval = setInterval(() => {
      nivel += (Math.random() * 22 - 11);
      nivel = Math.max(15, Math.min(88, nivel));
      this.nivelAudio.set(Math.round(nivel));
    }, 110);
  }

  private detenerAnimacionNivel(): void {
    if (this.animInterval !== null) {
      clearInterval(this.animInterval);
      this.animInterval = null;
    }
    this.nivelAudio.set(0);
  }
}
