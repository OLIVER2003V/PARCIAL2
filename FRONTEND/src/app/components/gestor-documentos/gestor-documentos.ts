import {
  Component, Input, OnInit, OnChanges, SimpleChanges,
  inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  DocumentoColaborativoService,
  DocumentoColaborativo,
  RegistroArchivo,
} from '../../services/documento-colaborativo';
import { ArchivoService } from '../../services/archivo';
import { ColaboracionService } from '../../services/colaboracion';
import { ApiConfigService } from '../../core/api-config.service';
import { EditorTextoColaborativoComponent } from '../editor-texto-colaborativo/editor-texto-colaborativo';
import { HojaCalculoColaborativaComponent } from '../hoja-calculo-colaborativa/hoja-calculo-colaborativa';

type TabActiva = 'documentos' | 'archivos';
type VistaPreview = 'pdf' | 'imagen' | 'office' | 'descarga';

@Component({
  selector: 'app-gestor-documentos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    EditorTextoColaborativoComponent,
    HojaCalculoColaborativaComponent,
  ],
  templateUrl: './gestor-documentos.html',
})
export class GestorDocumentosComponent implements OnInit, OnChanges {

  @Input() tramiteId?: string;
  @Input() procesoId?: string;
  /** false = modo completo (ADMIN/FUNCIONARIO); true = solo lectura (CLIENTE) */
  @Input() soloLectura = false;

  private docService    = inject(DocumentoColaborativoService);
  private archivoService = inject(ArchivoService);
  private colaboracion  = inject(ColaboracionService);
  private api           = inject(ApiConfigService);
  private http          = inject(HttpClient);

  // ── Estado general ─────────────────────────────────────────────────────────
  tabActiva    = signal<TabActiva>('documentos');
  cargando     = signal(false);
  errorMsg     = signal<string | null>(null);

  // ── Documentos colaborativos ───────────────────────────────────────────────
  documentos          = signal<DocumentoColaborativo[]>([]);
  documentoAbierto    = signal<DocumentoColaborativo | null>(null);
  creandoDocumento    = signal(false);
  nuevoDocNombre      = signal('');
  nuevoDocTipo        = signal<'texto' | 'hoja'>('texto');

  // ── Archivos S3 ────────────────────────────────────────────────────────────
  archivos            = signal<RegistroArchivo[]>([]);
  subiendoArchivo     = signal(false);
  archivoPreview      = signal<RegistroArchivo | null>(null);
  vistaPreview        = signal<VistaPreview>('descarga');
  mostrarVersiones    = signal<string | null>(null);   // id del registro expandido
  comentarioSubida    = signal('');

  // ── Computed ───────────────────────────────────────────────────────────────
  tieneContenido = computed(() =>
    this.documentos().length > 0 || this.archivos().length > 0
  );

  ngOnInit(): void { this.cargar(); }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['tramiteId'] || changes['procesoId']) this.cargar();
  }

  private cargar(): void {
    const id = this.tramiteId ?? this.procesoId;
    if (!id) return;
    this.cargando.set(true);

    if (this.tramiteId) {
      this.docService.listarPorTramite(this.tramiteId).subscribe({
        next: docs => this.documentos.set(docs),
        error: () => this.documentos.set([]),
      });
      this.docService.archivosPorTramite(this.tramiteId).subscribe({
        next: files => { this.archivos.set(files); this.cargando.set(false); },
        error: () => this.cargando.set(false),
      });
    } else if (this.procesoId) {
      this.docService.listarPorProceso(this.procesoId).subscribe({
        next: docs => this.documentos.set(docs),
        error: () => this.documentos.set([]),
      });
      this.docService.archivosPorProceso(this.procesoId).subscribe({
        next: files => { this.archivos.set(files); this.cargando.set(false); },
        error: () => this.cargando.set(false),
      });
    }
  }

  // ── Documentos colaborativos ───────────────────────────────────────────────

  abrirDocumento(doc: DocumentoColaborativo): void {
    this.documentoAbierto.set(doc);
  }

  cerrarDocumento(): void {
    this.documentoAbierto.set(null);
  }

  crearDocumento(): void {
    const nombre = this.nuevoDocNombre().trim() || 'Nuevo documento';
    this.docService.crear(nombre, this.nuevoDocTipo(),
      this.tramiteId, this.procesoId).subscribe({
      next: doc => {
        this.documentos.update(arr => [doc, ...arr]);
        this.nuevoDocNombre.set('');
        this.creandoDocumento.set(false);
        this.abrirDocumento(doc);
      },
      error: () => this.errorMsg.set('No se pudo crear el documento.'),
    });
  }

  eliminarDocumento(doc: DocumentoColaborativo, event: Event): void {
    event.stopPropagation();
    if (!confirm(`¿Eliminar "${doc.nombre}"?`)) return;
    this.docService.eliminar(doc.id).subscribe({
      next: () => {
        this.documentos.update(arr => arr.filter(d => d.id !== doc.id));
        if (this.documentoAbierto()?.id === doc.id) this.documentoAbierto.set(null);
      },
    });
  }

  // ── Archivos S3 ────────────────────────────────────────────────────────────

  seleccionarArchivo(event: Event): void {
    if (this.soloLectura) return;
    const input = event.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    this.subiendoArchivo.set(true);
    this.errorMsg.set(null);

    const formData = new FormData();
    formData.append('archivo', file);
    if (this.tramiteId) formData.append('tramiteId', this.tramiteId);
    if (this.procesoId) formData.append('procesoId', this.procesoId);
    if (this.comentarioSubida()) formData.append('comentario', this.comentarioSubida());

    this.http.post<any>(this.api.archivos.subir, formData).subscribe({
      next: (resp) => {
        this.subiendoArchivo.set(false);
        this.comentarioSubida.set('');
        this.cargar();  // recargar lista con nueva versión

        // Notificar a otros usuarios vía WebSocket
        this.colaboracion.emitirCambioMetadatos({
          tipo: 'archivo-subido',
          archivoNombre: resp.nombreOriginal,
          archivoUrl: resp.url,
          registroId: resp.registroId,
        });
        input.value = '';
      },
      error: (e) => {
        this.subiendoArchivo.set(false);
        this.errorMsg.set('Error al subir: ' + (e.error?.error ?? 'Error desconocido'));
      },
    });
  }

  abrirPreview(registro: RegistroArchivo): void {
    this.archivoPreview.set(registro);
    this.vistaPreview.set(this.detectarVistaPreview(registro.tipoMime, registro.urlActual));
  }

  cerrarPreview(): void { this.archivoPreview.set(null); }

  private detectarVistaPreview(mime: string, url: string): VistaPreview {
    if (mime?.startsWith('image/')) return 'imagen';
    if (mime === 'application/pdf') return 'pdf';
    const ext = url.split('.').pop()?.toLowerCase();
    if (['doc','docx','xls','xlsx','ppt','pptx'].includes(ext ?? '')) return 'office';
    return 'descarga';
  }

  /** URL del viewer de Microsoft Office Online (gratuito para archivos públicos). */
  officeViewerUrl(url: string): string {
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
  }

  toggleVersiones(id: string): void {
    this.mostrarVersiones.update(v => v === id ? null : id);
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  iconoArchivo(mime: string): string {
    if (mime?.startsWith('image/')) return '🖼️';
    if (mime === 'application/pdf') return '📄';
    if (mime?.includes('word') || mime?.includes('document')) return '📝';
    if (mime?.includes('excel') || mime?.includes('sheet')) return '📊';
    if (mime?.includes('powerpoint') || mime?.includes('presentation')) return '📋';
    return '📎';
  }
}
