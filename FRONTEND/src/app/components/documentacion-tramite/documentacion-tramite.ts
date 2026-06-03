import {
  Component, Input, OnInit, inject, signal, computed, ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ArchivoService, RegistroArchivo, VersionArchivo } from '../../services/archivo';

@Component({
  selector: 'app-documentacion-tramite',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './documentacion-tramite.html',
})
export class DocumentacionTramiteComponent implements OnInit {

  /** ID del trámite cuyos documentos se gestionan */
  @Input({ required: true }) tramiteId!: string;

  /** true = puede subir documentos al expediente; false = solo lectura */
  @Input() modoEdicion = true;

  /** Permite borrar documentos. Mantener false para clientes en rastreo. */
  @Input() permiteEliminar = true;

  /** Nombre del paso actual del proceso (se guarda como etiqueta del documento) */
  @Input() paso = '';

  @ViewChild('fileInputRef') fileInputRef!: ElementRef<HTMLInputElement>;

  private readonly archivoService = inject(ArchivoService);

  // ── Estado ────────────────────────────────────────────────────────────────
  documentos  = signal<RegistroArchivo[]>([]);
  cargando    = signal(true);
  subiendo    = signal(false);
  errorMsg    = signal<string | null>(null);
  arrastrando = signal(false);
  colapsado   = signal(false);

  /** URL de imagen abierta en el modal de previsualización */
  imagenModal = signal<string | null>(null);

  /** Documento cuyo historial de versiones está expandido */
  historialAbierto = signal<string | null>(null);

  readonly totalDocs = computed(() => this.documentos().length);

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit() {
    this.cargar();
  }

  // ─── Carga ─────────────────────────────────────────────────────────────────

  cargar() {
    this.cargando.set(true);
    this.errorMsg.set(null);
    this.archivoService.listarPorTramite(this.tramiteId).subscribe({
      next:  (docs) => { this.documentos.set(docs); this.cargando.set(false); },
      error: ()     => {
        this.errorMsg.set('No se pudo cargar la documentación del expediente.');
        this.cargando.set(false);
      },
    });
  }

  // ─── Subida ────────────────────────────────────────────────────────────────

  abrirSelector() {
    this.fileInputRef?.nativeElement.click();
  }

  onArchivoSeleccionado(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    Array.from(input.files).forEach(f => this.subirUnArchivo(f));
    input.value = ''; // permite volver a seleccionar el mismo archivo
  }

  private static readonly MAX_BYTES = 10 * 1024 * 1024; // 10 MB
  private static readonly TIPOS_PERMITIDOS = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
  ]);

  private validarArchivo(file: File): string | null {
    if (file.size > DocumentacionTramiteComponent.MAX_BYTES) {
      return `"${file.name}" supera el límite de 10 MB (${(file.size / 1_048_576).toFixed(1)} MB).`;
    }
    if (!DocumentacionTramiteComponent.TIPOS_PERMITIDOS.has(file.type)) {
      return `Formato no permitido: "${file.name}". Usa PDF, Word, Excel, JPG, PNG o WebP.`;
    }
    return null;
  }

  private subirUnArchivo(file: File) {
    const error = this.validarArchivo(file);
    if (error) {
      this.errorMsg.set(error);
      setTimeout(() => this.errorMsg.set(null), 6000);
      return;
    }

    this.subiendo.set(true);
    this.errorMsg.set(null);

    this.archivoService.subirDocumentacion(file, this.tramiteId, this.paso || undefined)
      .subscribe({
        next:  () => { this.cargar(); this.subiendo.set(false); },
        error: (err) => {
          const msg = err?.error?.error || err?.error?.message || 'Error al subir el archivo.';
          this.errorMsg.set(msg);
          this.subiendo.set(false);
          setTimeout(() => this.errorMsg.set(null), 6000);
        },
      });
  }

  // ─── Eliminación ───────────────────────────────────────────────────────────

  eliminar(doc: RegistroArchivo) {
    if (!this.permiteEliminar) return;
    if (!confirm(`¿Eliminar "${doc.nombreOriginal}" del expediente?\nEsta acción no se puede deshacer.`)) return;

    this.archivoService.eliminarArchivo(doc.urlActual).subscribe({
      next:  () => this.cargar(),
      error: () => {
        this.errorMsg.set('No se pudo eliminar el documento.');
        setTimeout(() => this.errorMsg.set(null), 5000);
      },
    });
  }

  // ─── Drag & drop ───────────────────────────────────────────────────────────

  onDragOver(event: DragEvent) {
    event.preventDefault();
    if (this.modoEdicion) this.arrastrando.set(true);
  }

  onDragLeave() { this.arrastrando.set(false); }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.arrastrando.set(false);
    if (!this.modoEdicion || !event.dataTransfer?.files) return;
    Array.from(event.dataTransfer.files).forEach(f => this.subirUnArchivo(f));
  }

  // ─── Previsualización ──────────────────────────────────────────────────────

  previsualizarOAbrir(doc: RegistroArchivo) {
    const url  = this.archivoService.urlArchivo(doc.urlActual);
    const mime = (doc.tipoMime || '').toLowerCase();
    if (mime.startsWith('image/')) {
      this.imagenModal.set(url);
    } else {
      window.open(url, '_blank');
    }
  }

  cerrarModal() { this.imagenModal.set(null); }

  toggleHistorial(docId: string) {
    this.historialAbierto.update(v => v === docId ? null : docId);
  }

  // ─── Helpers para el template ──────────────────────────────────────────────

  versionActual(doc: RegistroArchivo): VersionArchivo | null {
    return doc.versiones?.length ? doc.versiones[doc.versiones.length - 1] : null;
  }

  iconoTipo(mime: string): string {
    if (!mime) return '📄';
    const m = mime.toLowerCase();
    if (m.includes('pdf'))        return '📕';
    if (m.startsWith('image/'))   return '🖼️';
    if (m.includes('word'))       return '📘';
    if (m.includes('excel') || m.includes('spreadsheet')) return '📗';
    return '📄';
  }

  etiquetaTipo(mime: string): string {
    if (!mime) return 'Archivo';
    const m = mime.toLowerCase();
    if (m.includes('pdf'))        return 'PDF';
    if (m.startsWith('image/'))   return 'Imagen';
    if (m.includes('word'))       return 'Word';
    if (m.includes('excel') || m.includes('spreadsheet')) return 'Excel';
    return 'Archivo';
  }

  formatearTamano(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1_024)           return `${bytes} B`;
    if (bytes < 1_048_576)       return `${(bytes / 1_024).toFixed(0)} KB`;
    return `${(bytes / 1_048_576).toFixed(2)} MB`;
  }

  formatearFecha(iso: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('es-PE', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  }
}
