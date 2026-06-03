import {
  Component, Input, Output, EventEmitter,
  OnInit, OnDestroy, inject, signal, computed, ViewChild, ElementRef, AfterViewChecked
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VozNlpService, VozFormularioResultado, VozFormularioError, ArchivoSubido } from '../../services/voz-nlp.service';
import { CampoFormulario } from '../../models/proceso.model';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CampoPreview {
  id:        string;
  etiqueta:  string;
  tipo:      string;
  valorIA:   any;
  archivoIA: ArchivoSubido | null; // para campos tipo archivo/imagen
  yaLleno:   boolean;
  valido:    boolean;
}

type MensajeTipo = 'saludo' | 'usuario-texto' | 'usuario-archivo' | 'procesando' | 'resultado' | 'error';

interface ArchivoAdjunto {
  file:      File;
  previewUrl: string | null; // data URL para imágenes
}

export interface MensajeChat {
  id:          string;
  rol:         'bot' | 'usuario';
  tipo:        MensajeTipo;
  texto?:      string;
  resultado?:  VozFormularioResultado;
  preview?:    CampoPreview[];
  soloVacios?: boolean;
  archivos?:   Array<{ nombre: string; tamano: string; esImagen: boolean; preview?: string }>;
  error?:      VozFormularioError;
}

// ─── Componente ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-voz-formulario',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './voz-formulario.html',
})
export class VozFormularioComponent implements OnInit, OnDestroy, AfterViewChecked {

  @Input() campos:          CampoFormulario[]   = [];
  @Input() valoresActuales: Record<string, any> = {};
  @Output() camposAplicados = new EventEmitter<Record<string, any>>();
  @Output() cerrar          = new EventEmitter<void>();

  @ViewChild('chatContainer') chatContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('archivoInputRef') archivoInputRef!: ElementRef<HTMLInputElement>;

  readonly voz = inject(VozNlpService);

  // ── Estado de la UI ───────────────────────────────────────────────────────
  mensajes       = signal<MensajeChat[]>([]);
  inputTexto     = signal('');
  procesando     = signal(false);
  debeScroll     = false;

  // ── Archivos adjuntos (múltiples) ─────────────────────────────────────────
  archivosAdjuntos = signal<ArchivoAdjunto[]>([]);
  arrastrando      = signal(false);

  // ── Computed ─────────────────────────────────────────────────────────────
  readonly escuchando     = computed(() => this.voz.speechListening());
  readonly transcriptVivo = computed(() => this.voz.speechTranscript());
  readonly puedeEnviar    = computed(() =>
    !this.procesando() &&
    (this.inputTexto().trim().length >= 2 || this.archivosAdjuntos().length > 0)
  );
  readonly totalArchivos  = computed(() => this.archivosAdjuntos().length);

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  ngOnInit() {
    const tieneVoz = this.voz.speechSupported();
    const modos = tieneVoz
      ? 'Habla, escribe o adjunta documentos/fotos.'
      : 'Escribe los datos o adjunta documentos.';

    this.agregarMensaje({
      rol:  'bot',
      tipo: 'saludo',
      texto: `¡Hola! Puedo ayudarte a completar el formulario automáticamente.\n${modos}\n\n`
           + `Puedes combinar texto + archivos en un mismo mensaje. `
           + `Si adjuntas una foto de tu DNI, por ejemplo, extraeré los datos _y_ la colocaré en el campo correspondiente.`,
    });
  }

  ngOnDestroy() {
    this.voz.detenerSpeechRecognition();
  }

  ngAfterViewChecked() {
    if (this.debeScroll) {
      this.scrollAlFinal();
      this.debeScroll = false;
    }
  }

  // ─── Envío de mensajes ────────────────────────────────────────────────────

  enviar() {
    const texto    = this.inputTexto().trim();
    const archivos = this.archivosAdjuntos();

    if ((!texto || texto.length < 2) && archivos.length === 0) return;
    if (this.procesando()) return;

    // Construir representación de los archivos para el chat
    const archivosChat = archivos.map(a => ({
      nombre:   a.file.name,
      tamano:   (a.file.size / 1_048_576).toFixed(2) + ' MB',
      esImagen: a.file.type.startsWith('image/'),
      preview:  a.previewUrl ?? undefined,
    }));

    // Mensaje de usuario en el chat
    if (texto && archivos.length > 0) {
      // Texto + archivos: un solo mensaje combinado
      this.agregarMensaje({
        rol:     'usuario',
        tipo:    'usuario-archivo',
        texto,
        archivos: archivosChat,
      });
    } else if (texto) {
      this.agregarMensaje({ rol: 'usuario', tipo: 'usuario-texto', texto });
    } else {
      this.agregarMensaje({ rol: 'usuario', tipo: 'usuario-archivo', archivos: archivosChat });
    }

    const textoCopy    = texto || null;
    const archivosCopy = archivos.map(a => a.file);

    this.inputTexto.set('');
    this.archivosAdjuntos.set([]);

    this.procesarConIA(textoCopy, archivosCopy);
  }

  onEnterPresionado(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.enviar();
    }
  }

  // ─── Voz ─────────────────────────────────────────────────────────────────

  toggleMic() {
    if (this.escuchando()) {
      this.voz.detenerSpeechRecognition();
      return;
    }

    if (!this.voz.speechSupported()) {
      this.agregarMensaje({
        rol:   'bot',
        tipo:  'error',
        error: { tipo: 'NO_SOPORTADO', mensaje: 'Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.' }
      });
      return;
    }

    this.voz.iniciarSpeechRecognition(
      (texto) => {
        this.inputTexto.set(texto);
        if (texto.trim().length >= 3 && !this.procesando()) {
          // Auto-enviar al terminar de hablar (con pequeño delay para que el usuario vea el texto)
          setTimeout(() => this.enviar(), 400);
        }
      },
      (msg) => {
        if (msg) {
          this.agregarMensaje({ rol: 'bot', tipo: 'error', error: { tipo: 'GENERICO', mensaje: msg } });
        }
      }
    );
  }

  // ─── Archivos (múltiples) ─────────────────────────────────────────────────

  abrirSelectorArchivo() {
    this.archivoInputRef?.nativeElement.click();
  }

  onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    Array.from(input.files).forEach(f => this.agregarArchivo(f));
    input.value = ''; // reset para permitir seleccionar el mismo archivo de nuevo
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.arrastrando.set(true);
  }

  onDragLeave() {
    this.arrastrando.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.arrastrando.set(false);
    if (event.dataTransfer?.files) {
      Array.from(event.dataTransfer.files).forEach(f => this.agregarArchivo(f));
    }
  }

  quitarArchivo(idx: number) {
    this.archivosAdjuntos.update(lista => lista.filter((_, i) => i !== idx));
  }

  // ─── Acciones sobre resultado ─────────────────────────────────────────────

  aplicarResultado(mensaje: MensajeChat, soloVacios: boolean) {
    const res = mensaje.resultado;
    if (!res) return;

    // 1. Campos de texto/fecha/selección (con filtro de solo-vacíos)
    const camposTexto = soloVacios
      ? Object.fromEntries(
          Object.entries(res.camposLlenados).filter(([id]) => {
            const actual = this.valoresActuales[id];
            return actual === undefined || actual === null || actual === ''
              || (Array.isArray(actual) && actual.length === 0);
          })
        )
      : { ...res.camposLlenados };

    // 2. Archivos subidos (van directamente, siempre se aplican)
    const camposArchivo = res.archivosSubidos
      ? Object.fromEntries(
          Object.entries(res.archivosSubidos).filter(([id]) => {
            if (!soloVacios) return true;
            const actual = this.valoresActuales[id];
            return !actual?.url; // solo si el campo de archivo estaba vacío
          })
        )
      : {};

    this.camposAplicados.emit({ ...camposTexto, ...camposArchivo });
    this.cerrar.emit();
  }

  reintentar(mensaje: MensajeChat) {
    const msgs = this.mensajes();
    const idx  = msgs.indexOf(mensaje);
    for (let i = idx - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.rol === 'usuario') {
        if (m.tipo === 'usuario-texto' && m.texto) this.inputTexto.set(m.texto);
        break;
      }
    }
  }

  cancelar() {
    this.voz.detenerSpeechRecognition();
    this.cerrar.emit();
  }

  // ─── Helpers para el template ─────────────────────────────────────────────

  camposAAplicar(preview: CampoPreview[], soloVacios: boolean): number {
    return preview.filter(c => {
      // Campo de datos
      if (c.tipo !== 'archivo' && c.tipo !== 'imagen') {
        if (c.valorIA === null || !c.valido) return false;
        return !(soloVacios && c.yaLleno);
      }
      // Campo de archivo
      if (!c.archivoIA) return false;
      return !(soloVacios && c.yaLleno);
    }).length;
  }

  hayValoresAReemplazar(preview: CampoPreview[]): boolean {
    return preview.some(c => {
      if (c.tipo === 'archivo' || c.tipo === 'imagen') return c.archivoIA !== null && c.yaLleno;
      return c.valorIA !== null && c.yaLleno && c.valido;
    });
  }

  formatearValor(valor: any, tipo: string): string {
    if (valor === null || valor === undefined) return '—';
    if (Array.isArray(valor)) return valor.join(', ');
    if (tipo === 'si_no') return (valor === true || valor === 'true' || valor === 'SI') ? 'Sí' : 'No';
    if (typeof valor === 'object') return JSON.stringify(valor);
    return String(valor);
  }

  porcentajeConfianza(resultado: VozFormularioResultado): number {
    return Math.round((resultado.confianza ?? 0) * 100);
  }

  // ─── Privados ─────────────────────────────────────────────────────────────

  private procesarConIA(texto: string | null, archivos: File[]) {
    const idProc = this.agregarMensaje({ rol: 'bot', tipo: 'procesando' });
    this.procesando.set(true);

    // Siempre usar el endpoint combinado: maneja solo-texto, solo-archivos y ambos
    const obs = this.voz.procesarCombinado(texto, archivos, this.campos);

    obs.subscribe({
      next: (res) => {
        this.reemplazarMensaje(idProc, {
          rol:       'bot',
          tipo:      'resultado',
          resultado:  res,
          preview:    this.construirPreview(res),
          soloVacios: true,
        });
        this.procesando.set(false);
      },
      error: (err: VozFormularioError) => {
        this.reemplazarMensaje(idProc, { rol: 'bot', tipo: 'error', error: err });
        this.procesando.set(false);
      }
    });
  }

  private construirPreview(res: VozFormularioResultado): CampoPreview[] {
    const EXCLUIDOS = new Set([
      'titulo','subtitulo','parrafo','separador',
      'firma','ubicacion','documento-texto','documento-hoja'
    ]);
    // archivo e imagen SÍ se incluyen en el preview

    return this.campos
      .filter(c => !EXCLUIDOS.has(c.tipo))
      .map(c => {
        const esUpload = c.tipo === 'archivo' || c.tipo === 'imagen';
        const valorIA  = esUpload ? null : (res.camposLlenados?.[c.id] ?? null);
        const archivoIA = esUpload ? (res.archivosSubidos?.[c.id] ?? null) : null;

        const actual   = this.valoresActuales[c.id];
        const yaLleno  = esUpload
          ? !!(actual?.url)
          : (actual !== undefined && actual !== null && actual !== ''
             && !(Array.isArray(actual) && actual.length === 0));

        return {
          id:       c.id,
          etiqueta: c.etiqueta,
          tipo:     c.tipo,
          valorIA,
          archivoIA,
          yaLleno,
          valido:   valorIA !== null ? this.validarValor(c, valorIA) : true,
        };
      })
      .filter(c => c.valorIA !== null || c.archivoIA !== null); // ocultar campos sin detección
  }

  private validarValor(campo: CampoFormulario, valor: any): boolean {
    if (valor === null || valor === undefined) return true;
    switch (campo.tipo) {
      case 'numero':
      case 'decimal': {
        const n = Number(valor);
        if (isNaN(n)) return false;
        if (campo.minValor != null && n < campo.minValor) return false;
        if (campo.maxValor != null && n > campo.maxValor) return false;
        return true;
      }
      case 'texto':
      case 'textarea': {
        const s = String(valor);
        if (campo.minLongitud != null && s.length < campo.minLongitud) return false;
        if (campo.maxLongitud != null && s.length > campo.maxLongitud) return false;
        return true;
      }
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(valor));
      case 'telefono':
        return String(valor).replace(/\D/g, '').length >= 7;
      case 'fecha':
        return /^\d{4}-\d{2}-\d{2}$/.test(String(valor));
      case 'hora':
        return /^\d{2}:\d{2}$/.test(String(valor));
      case 'fecha_hora':
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(valor));
      case 'seleccion':
      case 'radio': {
        const ops = this.opcionesDelCampo(campo);
        return ops.length === 0 || ops.includes(String(valor));
      }
      case 'checkbox': {
        if (!Array.isArray(valor)) return false;
        const ops = this.opcionesDelCampo(campo);
        return ops.length === 0 || (valor as any[]).every(v => ops.includes(String(v)));
      }
      case 'calificacion': {
        const n = Number(valor);
        return !isNaN(n) && n >= 1 && n <= ((campo as any).escalaMax ?? 5);
      }
      default: return true;
    }
  }

  private opcionesDelCampo(campo: CampoFormulario): string[] {
    if (campo.opcionesList?.length) return campo.opcionesList.map((o: any) => o.valor);
    if (campo.opciones) return campo.opciones.split(',').map((o: string) => o.trim());
    return [];
  }

  private agregarMensaje(parcial: Omit<MensajeChat, 'id'>): string {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    this.mensajes.update(prev => [...prev, { id, ...parcial }]);
    this.debeScroll = true;
    return id;
  }

  private reemplazarMensaje(id: string, parcial: Omit<MensajeChat, 'id'>) {
    this.mensajes.update(prev => prev.map(m => m.id === id ? { id, ...parcial } : m));
    this.debeScroll = true;
  }

  private scrollAlFinal() {
    try {
      const el = this.chatContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch { /* ignorar */ }
  }

  private agregarArchivo(file: File) {
    const TIPOS_VALIDOS = [
      'image/jpeg','image/jpg','image/png','image/webp',
      'image/gif','image/heic','image/heif','application/pdf',
    ];
    if (!TIPOS_VALIDOS.includes(file.type)) {
      this.agregarMensaje({
        rol:   'bot',
        tipo:  'error',
        error: { tipo: 'GENERICO', mensaje: `"${file.name}": formato no válido. Usa JPG, PNG, WebP, HEIC o PDF.` }
      });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      this.agregarMensaje({
        rol:   'bot',
        tipo:  'error',
        error: { tipo: 'GENERICO', mensaje: `"${file.name}" supera los 20 MB (${(file.size / 1_048_576).toFixed(1)} MB).` }
      });
      return;
    }

    const adjunto: ArchivoAdjunto = { file, previewUrl: null };

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.archivosAdjuntos.update(lista =>
          lista.map(a => a.file === file ? { ...a, previewUrl: e.target?.result as string } : a)
        );
      };
      reader.readAsDataURL(file);
    }

    // Máximo 10 archivos por mensaje
    if (this.archivosAdjuntos().length >= 10) {
      this.agregarMensaje({
        rol:   'bot',
        tipo:  'error',
        error: { tipo: 'GENERICO', mensaje: 'Máximo 10 archivos por mensaje.' }
      });
      return;
    }

    this.archivosAdjuntos.update(lista => [...lista, adjunto]);
  }
}
