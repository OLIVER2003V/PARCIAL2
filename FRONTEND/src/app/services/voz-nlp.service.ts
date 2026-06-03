import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, from, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { ApiConfigService } from '../core/api-config.service';
import { CampoFormulario } from '../models/proceso.model';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoVoz = 'idle' | 'recording' | 'processing' | 'done' | 'error';

export interface ArchivoSubido {
  url: string;
  nombreOriginal: string;
  tamano: number;
}

export interface VozFormularioResultado {
  transcript: string;
  camposLlenados: Record<string, any>;
  /** Solo presente en respuestas del endpoint /asistente-formulario */
  archivosSubidos?: Record<string, ArchivoSubido>;
  /** Solo en modo archivo — tipo de documento detectado por Gemini */
  tipoDocumento?: string;
  confianza: number;
  camposDetectados: number;
  archivosAsignados?: number;
  exito: boolean;
}

export interface VozFormularioError {
  tipo: 'MIC_DENEGADO' | 'NO_SOPORTADO' | 'NLP_CAIDO' | 'IA_SATURADA' | 'AUDIO_CORTO' | 'GENERICO';
  mensaje: string;
  detalle?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class VozNlpService {
  private http       = inject(HttpClient);
  private api        = inject(ApiConfigService);
  private platformId = inject(PLATFORM_ID);

  // ── Estado reactivo ────────────────────────────────────────────────────────
  private readonly _estado  = signal<EstadoVoz>('idle');
  readonly estado            = this._estado.asReadonly();
  readonly segundosGrabando  = signal(0);
  readonly amplitud          = signal(0);

  // ── Web Speech API — estado público ───────────────────────────────────────
  readonly speechListening   = signal(false);
  readonly speechTranscript  = signal('');   // texto parcial mientras habla

  // ── Auto-stop (legado audio) ───────────────────────────────────────────────
  private readonly _autoStop$ = new Subject<void>();
  readonly autoStop$           = this._autoStop$.asObservable();

  // ── Internos audio ────────────────────────────────────────────────────────
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private animFrame: number | null = null;
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;

  // ── Internos Speech Recognition ───────────────────────────────────────────
  private recognition: any = null;

  readonly DURACION_MAXIMA_SEG = 120;
  readonly MAX_TEXTO_CHARS     = 2000;

  // ─── API pública ───────────────────────────────────────────────────────────

  esSoportado(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return !!(navigator.mediaDevices && typeof MediaRecorder !== 'undefined');
  }

  /**
   * Comprueba si el navegador soporta Web Speech API (SpeechRecognition).
   * Chrome, Edge y los basados en Chromium lo soportan plenamente.
   */
  speechSupported(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const w = window as any;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  /**
   * Inicia el reconocimiento de voz del navegador.
   * - Los resultados parciales van apareciendo en `speechTranscript`.
   * - Cuando termina (pausa o el usuario detiene), llama a `onFinal(textoCompleto)`.
   * - Si hay error, llama a `onError(mensaje)`.
   */
  iniciarSpeechRecognition(
    onFinal: (texto: string) => void,
    onError: (msg: string) => void
  ): void {
    if (!this.speechSupported()) {
      onError('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
      return;
    }

    // Detener cualquier reconocimiento previo
    this.detenerSpeechRecognition();

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.recognition = new SR();
    this.recognition.lang             = 'es-ES';
    this.recognition.continuous       = false;   // se detiene automáticamente al pausar
    this.recognition.interimResults   = true;    // texto en tiempo real mientras habla
    this.recognition.maxAlternatives  = 1;

    this.speechTranscript.set('');
    this.speechListening.set(true);

    this.recognition.onresult = (event: any) => {
      let parcial = '';
      let final   = '';
      for (let i = 0; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) final += text;
        else parcial += text;
      }
      this.speechTranscript.set(final || parcial);
    };

    this.recognition.onspeechend = () => {
      // El navegador dejó de detectar habla — detener para obtener resultado final
      try { this.recognition?.stop(); } catch { /* ignorar */ }
    };

    this.recognition.onend = () => {
      this.speechListening.set(false);
      const texto = this.speechTranscript();
      this.speechTranscript.set('');
      if (texto.trim().length > 0) {
        onFinal(texto.trim());
      }
    };

    this.recognition.onerror = (event: any) => {
      this.speechListening.set(false);
      this.speechTranscript.set('');
      const errores: Record<string, string> = {
        'not-allowed'  : 'Permiso de micrófono denegado. Habilita el acceso en tu navegador.',
        'no-speech'    : 'No se detectó voz. Intenta hablar más claro y cerca del micrófono.',
        'audio-capture': 'No se pudo acceder al micrófono.',
        'network'      : 'Error de red durante el reconocimiento de voz.',
        'aborted'      : '',   // cancelado manualmente → no es un error real
      };
      const msg = errores[event.error] || `Error de reconocimiento: ${event.error}`;
      if (msg) onError(msg);
    };

    try {
      this.recognition.start();
    } catch (e: any) {
      this.speechListening.set(false);
      onError('No se pudo iniciar el reconocimiento de voz: ' + (e?.message || ''));
    }
  }

  /** Detiene el reconocimiento de voz inmediatamente. */
  detenerSpeechRecognition(): void {
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignorar */ }
      this.recognition = null;
    }
    this.speechListening.set(false);
    this.speechTranscript.set('');
  }

  // ─── Grabación de audio (legado — se mantiene como fallback) ──────────────

  async iniciarGrabacion(): Promise<void> {
    if (!this.esSoportado()) {
      throw this.crearError('NO_SOPORTADO', 'Tu navegador no soporta grabación de audio. Usa Chrome o Edge.');
    }
    if (this._estado() === 'recording') return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
    } catch (err: any) {
      const tipo = err?.name === 'NotAllowedError' ? 'MIC_DENEGADO' : 'GENERICO';
      throw this.crearError(tipo,
        tipo === 'MIC_DENEGADO'
          ? 'Permiso de micrófono denegado. Habilita el acceso en tu navegador e intenta de nuevo.'
          : 'No se pudo acceder al micrófono: ' + (err?.message || ''));
    }

    const mimeType = this.elegirMimeType();
    this.chunks = [];

    this.mediaRecorder = new MediaRecorder(stream, { mimeType });
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start(250);

    this.iniciarAnalizadorAmplitud(stream);

    this.segundosGrabando.set(0);
    this.timerInterval = setInterval(() => {
      const seg = this.segundosGrabando() + 1;
      this.segundosGrabando.set(seg);
      if (seg >= this.DURACION_MAXIMA_SEG) {
        this.limpiarTimer();
        this._autoStop$.next();
      }
    }, 1000);

    this._estado.set('recording');
  }

  detenerGrabacion(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(this.crearError('GENERICO', 'No hay grabación activa.'));
        return;
      }

      this.limpiarTimer();
      this.limpiarAnalizador();

      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mimeType });
        this.mediaRecorder?.stream.getTracks().forEach(t => t.stop());
        this.mediaRecorder = null;
        this.chunks = [];
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  cancelarGrabacion(): void {
    if (this.mediaRecorder) {
      this.limpiarTimer();
      this.limpiarAnalizador();
      this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
      try { this.mediaRecorder.stop(); } catch { /* ignorar */ }
      this.mediaRecorder = null;
      this.chunks = [];
    }
    this._estado.set('idle');
    this.segundosGrabando.set(0);
    this.amplitud.set(0);
  }

  // ─── Procesado ────────────────────────────────────────────────────────────

  procesarTexto(texto: string, campos: CampoFormulario[]): Observable<VozFormularioResultado> {
    if (!texto || texto.trim().length < 3) {
      return throwError(() => this.crearError('AUDIO_CORTO',
        'Escribe al menos una frase describiendo los datos del formulario.'));
    }
    if (texto.trim().length > this.MAX_TEXTO_CHARS) {
      return throwError(() => this.crearError('GENERICO',
        `El texto no puede superar los ${this.MAX_TEXTO_CHARS} caracteres.`));
    }
    this._estado.set('processing');
    return this.enviarAlBackend(null, texto.trim(), campos).pipe(
      catchError(err => {
        this._estado.set('error');
        return throwError(() => this.normalizarError(err));
      })
    );
  }

  /**
   * Modo combinado: envía texto libre + N archivos en una sola petición.
   * Gemini decide para cada archivo si es fuente de datos (extrae valores)
   * o valor de campo (lo sube y asigna al campo archivo/imagen correcto).
   *
   * @param texto    Texto libre del usuario (puede venir de voz o teclado). Puede ser null.
   * @param archivos Lista de archivos adjuntos (imágenes o PDFs). Puede estar vacía.
   * @param campos   Definición completa de los campos del formulario.
   */
  procesarCombinado(
    texto:   string | null,
    archivos: File[],
    campos:  CampoFormulario[]
  ): Observable<VozFormularioResultado> {

    const tieneTexto    = texto && texto.trim().length >= 2;
    const tieneArchivos = archivos.length > 0;

    if (!tieneTexto && !tieneArchivos) {
      return throwError(() => this.crearError('AUDIO_CORTO',
        'Debes escribir texto o adjuntar al menos un archivo.'));
    }

    this._estado.set('processing');

    // Schema COMPLETO que incluye campos archivo/imagen para que Gemini pueda asignarlos
    const schema   = this.construirSchemaCompletoJSON(campos);
    const formData = new FormData();
    formData.append('campos', schema);

    if (tieneTexto) {
      formData.append('texto', texto!.trim());
    }
    for (const archivo of archivos) {
      formData.append('archivos', archivo, archivo.name);
    }

    return new Observable(observer => {
      this.http.post<VozFormularioResultado>(this.api.ia.asistenteFormulario, formData).subscribe({
        next: (res) => {
          this._estado.set('done');
          observer.next(res);
          observer.complete();
        },
        error: (err) => {
          this._estado.set('error');
          observer.error(this.normalizarError(err));
        }
      });
    });
  }

  procesarArchivo(archivo: File, campos: CampoFormulario[]): Observable<VozFormularioResultado> {
    const TIPOS_VALIDOS = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
      'image/gif',  'image/heic', 'image/heif', 'application/pdf',
    ];

    if (!TIPOS_VALIDOS.includes(archivo.type)) {
      return throwError(() => this.crearError('GENERICO',
        'Tipo de archivo no válido. Usa JPG, PNG, WebP, HEIC o PDF.'));
    }
    const MAX_MB = 20;
    if (archivo.size > MAX_MB * 1024 * 1024) {
      return throwError(() => this.crearError('GENERICO',
        `El archivo supera los ${MAX_MB} MB permitidos (${(archivo.size / 1_048_576).toFixed(1)} MB).`));
    }

    this._estado.set('processing');

    const schema   = this.construirSchemaJSON(campos);
    const formData = new FormData();
    formData.append('campos',  schema);
    formData.append('archivo', archivo, archivo.name);

    return new Observable(observer => {
      this.http.post<VozFormularioResultado>(this.api.ia.archivoFormulario, formData).subscribe({
        next: (res) => {
          this._estado.set('done');
          observer.next(res);
          observer.complete();
        },
        error: (err) => {
          this._estado.set('error');
          observer.error(this.normalizarError(err));
        },
      });
    });
  }

  resetear(): void {
    this.cancelarGrabacion();
    this._estado.set('idle');
  }

  // ─── Internos ──────────────────────────────────────────────────────────────

  private enviarAlBackend(
    audioBlob: Blob | null,
    texto: string | null,
    campos: CampoFormulario[]
  ): Observable<VozFormularioResultado> {

    const schema = this.construirSchemaJSON(campos);
    const formData = new FormData();
    formData.append('campos', schema);

    if (audioBlob) {
      const ext = this.extensionDeMime(audioBlob.type);
      formData.append('audio', audioBlob, `grabacion.${ext}`);
    } else if (texto) {
      formData.append('texto', texto);
    }

    return new Observable(observer => {
      this.http.post<VozFormularioResultado>(this.api.ia.vozFormulario, formData).subscribe({
        next: (res) => {
          this._estado.set('done');
          observer.next(res);
          observer.complete();
        },
        error: (err) => {
          this._estado.set('error');
          observer.error(err);
        }
      });
    });
  }

  construirSchemaJSON(campos: CampoFormulario[]): string {
    const TIPOS_EXCLUIDOS = new Set([
      'titulo', 'subtitulo', 'parrafo', 'separador',
      'firma', 'archivo', 'imagen', 'ubicacion',
      'documento-texto', 'documento-hoja'
    ]);

    const schema = campos
      .filter(c => !TIPOS_EXCLUIDOS.has(c.tipo))
      .map(c => {
        const item: Record<string, any> = {
          id:        c.id,
          etiqueta:  c.etiqueta,
          tipo:      c.tipo,
          requerido: c.requerido ?? false,
        };
        if (c.descripcion) item['descripcion'] = c.descripcion;
        if (c.placeholder) item['placeholder'] = c.placeholder;

        if (c.opcionesList?.length) {
          item['opcionesList'] = c.opcionesList.map(o => ({ valor: o.valor, etiqueta: o.etiqueta }));
        } else if (c.opciones) {
          item['opcionesList'] = c.opciones.split(',').map(o => ({ valor: o.trim(), etiqueta: o.trim() }));
        }

        if (c.tipo === 'tabla' && c.columnasTabla?.length) {
          item['columnasTabla'] = c.columnasTabla.map(col => ({
            id: col.id, etiqueta: col.etiqueta, tipo: col.tipo,
            opciones: col.opciones?.map(o => o.valor),
          }));
        }

        if (c.tipo === 'calificacion') item['escalaMax'] = c.escalaMax ?? 5;
        if (c.minLongitud != null) item['minLongitud'] = c.minLongitud;
        if (c.maxLongitud != null) item['maxLongitud'] = c.maxLongitud;
        if (c.minValor    != null) item['minValor']    = c.minValor;
        if (c.maxValor    != null) item['maxValor']    = c.maxValor;

        return item;
      });

    return JSON.stringify(schema);
  }

  /**
   * Construye el schema JSON COMPLETO para el endpoint /asistente-formulario.
   * A diferencia de construirSchemaJSON(), este incluye campos tipo 'archivo' e 'imagen'
   * para que Gemini pueda asignarlos cuando el usuario adjunta archivos.
   */
  construirSchemaCompletoJSON(campos: CampoFormulario[]): string {
    // Solo excluimos campos puramente decorativos o sin valor de datos
    const TIPOS_EXCLUIDOS = new Set([
      'titulo', 'subtitulo', 'parrafo', 'separador',
      'firma',              // la firma manual no puede asignarse vía IA
      'documento-texto', 'documento-hoja', 'ubicacion'
    ]);
    // 'archivo' e 'imagen' SÍ se incluyen aquí

    const schema = campos
      .filter(c => !TIPOS_EXCLUIDOS.has(c.tipo))
      .map(c => {
        const item: Record<string, any> = {
          id:        c.id,
          etiqueta:  c.etiqueta,
          tipo:      c.tipo,
          requerido: c.requerido ?? false,
        };
        if (c.descripcion) item['descripcion'] = c.descripcion;
        if (c.placeholder) item['placeholder'] = c.placeholder;

        // Para campos de archivo/imagen: incluir tipos aceptados para que Gemini pueda matchear
        if (c.tipo === 'archivo' || c.tipo === 'imagen') {
          if ((c as any).tiposArchivoPermitidos?.length) {
            item['tiposPermitidos'] = (c as any).tiposArchivoPermitidos;
          }
          if ((c as any).tamanoMaxMB) item['tamanoMaxMB'] = (c as any).tamanoMaxMB;
        }

        if (c.opcionesList?.length) {
          item['opcionesList'] = c.opcionesList.map((o: any) => ({ valor: o.valor, etiqueta: o.etiqueta }));
        } else if (c.opciones) {
          item['opcionesList'] = c.opciones.split(',').map((o: string) => ({
            valor: o.trim(), etiqueta: o.trim()
          }));
        }

        if (c.tipo === 'tabla' && c.columnasTabla?.length) {
          item['columnasTabla'] = c.columnasTabla.map((col: any) => ({
            id: col.id, etiqueta: col.etiqueta, tipo: col.tipo,
            opciones: col.opciones?.map((o: any) => o.valor),
          }));
        }

        if (c.tipo === 'calificacion') item['escalaMax'] = (c as any).escalaMax ?? 5;
        if (c.minLongitud != null) item['minLongitud'] = c.minLongitud;
        if (c.maxLongitud != null) item['maxLongitud'] = c.maxLongitud;
        if (c.minValor    != null) item['minValor']    = c.minValor;
        if (c.maxValor    != null) item['maxValor']    = c.maxValor;

        return item;
      });

    return JSON.stringify(schema);
  }

  private elegirMimeType(): string {
    const preferidos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
    for (const mt of preferidos) {
      if (MediaRecorder.isTypeSupported(mt)) return mt;
    }
    return '';
  }

  private extensionDeMime(mime: string): string {
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('mp4')) return 'mp4';
    return 'webm';
  }

  private iniciarAnalizadorAmplitud(stream: MediaStream): void {
    try {
      this.audioCtx = new AudioContext();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      const source = this.audioCtx.createMediaStreamSource(stream);
      source.connect(this.analyser);
      const data = new Uint8Array(this.analyser.frequencyBinCount);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        this.amplitud.set(Math.min(100, Math.round(avg * 1.5)));
        this.animFrame = requestAnimationFrame(tick);
      };
      this.animFrame = requestAnimationFrame(tick);
    } catch { /* sin visualización de amplitud */ }
  }

  private limpiarAnalizador(): void {
    if (this.animFrame != null) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    this.analyser = null;
    try { this.audioCtx?.close(); } catch { /* ignorar */ }
    this.audioCtx = null;
    this.amplitud.set(0);
  }

  private limpiarTimer(): void {
    if (this.timerInterval != null) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }

  private crearError(tipo: VozFormularioError['tipo'], mensaje: string, detalle?: string): VozFormularioError {
    return { tipo, mensaje, detalle };
  }

  private normalizarError(err: any): VozFormularioError {
    if (err && err.tipo && err.mensaje) return err as VozFormularioError;

    const backendTipo = err?.error?.tipo as string | undefined;
    const backendMsg  = err?.error?.error as string | undefined;

    if (backendTipo === 'NLP_CAIDO')   return this.crearError('NLP_CAIDO',   backendMsg || 'Servicio de transcripción no disponible.');
    if (backendTipo === 'IA_SATURADA') return this.crearError('IA_SATURADA', backendMsg || 'IA saturada, intenta en unos segundos.');
    if (err?.status === 0)             return this.crearError('GENERICO',    'Sin conexión con el servidor. Verifica tu red.');
    if (err?.status === 503)           return this.crearError('NLP_CAIDO',   backendMsg || 'Servicio temporalmente no disponible.');

    return this.crearError('GENERICO', backendMsg || err?.message || 'Error inesperado al procesar la solicitud.');
  }

  formatearTiempo(seg: number): string {
    const m = Math.floor(seg / 60).toString().padStart(2, '0');
    const s = (seg % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }
}
