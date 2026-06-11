import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ProcesoService } from '../../services/proceso';
import { TramiteService } from '../../services/tramite';
import { ArchivoService } from '../../services/archivo';
import { CampoFormulario, Paso, ProcesoDefinicion } from '../../models/proceso.model';
import { CampoGridPipe } from '../../shared/pipes/campo-grid.pipe';
import { VozNlpService } from '../../services/voz-nlp.service';
import { VozFormularioComponent } from '../voz-formulario/voz-formulario';
import { EditorTextoColaborativoComponent } from '../editor-texto-colaborativo/editor-texto-colaborativo';
import { HojaCalculoColaborativaComponent } from '../hoja-calculo-colaborativa/hoja-calculo-colaborativa';
import { DocumentacionTramiteComponent } from '../documentacion-tramite/documentacion-tramite';

@Component({
  selector: 'app-nuevo-tramite',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, CampoGridPipe, VozFormularioComponent,
            EditorTextoColaborativoComponent, HojaCalculoColaborativaComponent,
            DocumentacionTramiteComponent],
  templateUrl: './nuevo-tramite.html',
  styleUrl: './nuevo-tramite.css'
})
export class NuevoTramiteComponent implements OnInit {
  private procesoService = inject(ProcesoService);
  private tramiteService = inject(TramiteService);
  private archivoService = inject(ArchivoService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  vozNlpService  = inject(VozNlpService);

  modalVozAbierto = signal(false);

  // FIX #6: ocultar el botón si no hay campos que la IA pueda rellenar
  readonly tieneCamposRellenables = computed(() => {
    const EXCLUIDOS = new Set([
      'titulo','subtitulo','parrafo','separador',
      'firma','archivo','imagen','ubicacion',
      'documento-texto','documento-hoja'
    ]);
    return this.camposFormularioInicial().some(c => !EXCLUIDOS.has(c.tipo));
  });

  // Estados generales
  listaServicios = signal<ProcesoDefinicion[]>([]);
  isLoading = signal(true);
  isSubmitting = signal(false);
  errorMsg = signal<string | null>(null);

  // Resultado
  tramiteCreado = signal<{ id: string; codigo: string; departamento: string } | null>(null);

  // Formulario
  clienteActual = signal<string>('');
  servicioSeleccionado = signal<ProcesoDefinicion | null>(null);

  // 👇 NUEVO: datos del formulario inicial y estado de archivos
  valoresFormularioInicial = signal<Record<string, any>>({});
  subiendoArchivo = signal<string | null>(null);

  // Computed: solo políticas listas para usarse
  serviciosValidos = computed(() =>
    this.listaServicios().filter(p =>
      p.activo && p.pasoInicialId && (p.pasos?.length ?? 0) > 0
    )
  );

  // 👇 Computed: el paso inicial de la política (si es INICIO_CLIENTE, tiene formulario)
  pasoInicialClienteDetectado = computed<Paso | null>(() => {
    const srv = this.servicioSeleccionado();
    if (!srv) return null;

    const pasoInicial = srv.pasos?.find(p => p.id === srv.pasoInicialId);
    if (!pasoInicial) return null;

    return pasoInicial.tipoResponsable === 'INICIO_CLIENTE' ? pasoInicial : null;
  });

  // 👇 Computed: campos que debe llenar el cliente (si existen)
  camposFormularioInicial = computed<CampoFormulario[]>(() => {
    const paso = this.pasoInicialClienteDetectado();
    return paso?.campos ?? [];
  });

  // 👇 Computed: ¿tiene el servicio un formulario inicial configurado?
  tieneFormularioInicial = computed(() => this.camposFormularioInicial().length > 0);

  // 👇 Computed: validar campos requeridos
  camposRequeridosFaltantes = computed<string[]>(() => {
    const campos = this.camposFormularioInicial();
    const valores = this.valoresFormularioInicial();

    return campos
      .filter(c => c.requerido && !['titulo', 'subtitulo', 'parrafo', 'separador'].includes(c.tipo))
      .filter(c => {
        const v = valores[c.id];
        if (v === undefined || v === null || v === '') return true;
        if (Array.isArray(v) && v.length === 0) return true;
        if ((c.tipo === 'archivo' || c.tipo === 'imagen') && !v.url) return true;
        if (c.tipo === 'documento-texto' && !v?.id) return true;
        if (c.tipo === 'documento-hoja' && !v?.id) return true;
        return false;
      })
      .map(c => c.etiqueta);
  });

  // 👇 Computed: ¿puede enviarse el formulario?
  puedeEnviar = computed(() =>
    this.camposRequeridosFaltantes().length === 0
  );

  ngOnInit() {
    const username = localStorage.getItem('username') || 'Cliente Web';
    this.clienteActual.set(username);

    // procesoId puede venir de la URL cuando el asistente de voz (CU17) redirige aquí
    const procesoIdVoz = this.route.snapshot.paramMap.get('procesoId');

    this.procesoService.obtenerProcesosPublicos().subscribe({
      next: (procesos) => {
        this.listaServicios.set(procesos);
        this.isLoading.set(false);

        if (procesoIdVoz) {
          const encontrado = procesos.find(
            p => p.id === procesoIdVoz || p.codigo === procesoIdVoz
          );
          if (encontrado) {
            this.seleccionarServicio(encontrado);
          }
        }
      },
      error: (err) => {
        console.error('Error cargando catálogo', err);
        this.errorMsg.set('No pudimos cargar los servicios disponibles. Intenta nuevamente.');
        this.isLoading.set(false);
      }
    });
  }

  seleccionarServicio(servicio: ProcesoDefinicion) {
    this.servicioSeleccionado.set(servicio);
    this.valoresFormularioInicial.set({});
    this.errorMsg.set(null);

    // 👇 NUEVO: Inicializar canvas blanco para cada campo de firma del formulario inicial
    this.camposFormularioInicial()
      .filter(c => c.tipo === 'firma')
      .forEach(c => this.inicializarCanvasFirma(c.id));
  }

  volverAlCatalogo() {
    this.servicioSeleccionado.set(null);
    this.valoresFormularioInicial.set({});
    this.errorMsg.set(null);
  }

  enviarSolicitud() {
    if (!this.servicioSeleccionado() || !this.puedeEnviar()) return;

    this.isSubmitting.set(true);
    this.errorMsg.set(null);

    const requestBody = {
      codigoProceso: this.servicioSeleccionado()!.codigo,
      clienteId: this.clienteActual(),
      descripcion: '',
      datosFormularioInicial: this.valoresFormularioInicial()
    };

    this.tramiteService.iniciarTramite(requestBody).subscribe({
      next: (resp) => {
        this.tramiteCreado.set({
          id:          resp.id ?? resp._id ?? '',
          codigo:      resp.codigoSeguimiento,
          departamento: resp.departamentoActualId
        });
        this.isSubmitting.set(false);
      },
      error: (err) => {
        console.error('Error al enviar solicitud', err);
        const msg = typeof err.error === 'string' ? err.error : (err.error?.message || 'Error al enviar la solicitud.');
        this.errorMsg.set(msg);
        this.isSubmitting.set(false);
      }
    });
  }

  copiarCodigo(codigo: string) {
    navigator.clipboard.writeText(codigo).then(() => {});
  }

  irARastreo() {
    this.router.navigate(['/rastrear']);
  }

  // ===== Métodos para el formulario dinámico =====

  getValorCampo(campoId: string): any {
    return this.valoresFormularioInicial()[campoId];
  }

  actualizarValorCampo(campoId: string, valor: any) {
    this.valoresFormularioInicial.update(v => ({ ...v, [campoId]: valor }));
  }

  // Archivos
  subirArchivo(campoId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    this.subiendoArchivo.set(campoId);

    this.archivoService.subirArchivo(archivo).subscribe({
      next: (resp) => {
        this.actualizarValorCampo(campoId, {
          nombreOriginal: resp.nombreOriginal,
          url: resp.url,
          tamano: resp.tamano
        });
        this.subiendoArchivo.set(null);
      },
      error: () => {
        this.errorMsg.set('Error al subir archivo');
        this.subiendoArchivo.set(null);
      }
    });
  }

  urlArchivoCompleta(urlRelativa: string): string {
    return this.archivoService.urlArchivo(urlRelativa);
  }

  // Checkbox múltiple
  toggleCheckbox(campoId: string, valor: string) {
    const actual = this.getValorCampo(campoId) || [];
    const arr = Array.isArray(actual) ? [...actual] : [];
    const idx = arr.indexOf(valor);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(valor);
    this.actualizarValorCampo(campoId, arr);
  }

  estaMarcado(campoId: string, valor: string): boolean {
    const actual = this.getValorCampo(campoId);
    return Array.isArray(actual) && actual.includes(valor);
  }

  // Calificación
  setCalificacion(campoId: string, valor: number) {
    this.actualizarValorCampo(campoId, valor);
  }

  // ============================================================================
  //  👇 NUEVO: FIRMA DIGITAL — Canvas HTML5 con captura mouse + touch
  // ============================================================================

  /** Estado de dibujo por campo */
  private firmaDibujando = new Map<string, boolean>();
  /** Última posición conocida del cursor */
  private firmaUltimoPunto = new Map<string, { x: number; y: number }>();
  /** Flag: ¿el canvas tiene algún trazo? */
  firmaConTrazos = signal<Record<string, boolean>>({});

  iniciarFirma(campoId: string, evento: MouseEvent | TouchEvent): void {
    evento.preventDefault();
    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;
    const punto = this.coordenadasCanvas(canvas, evento);
    this.firmaDibujando.set(campoId, true);
    this.firmaUltimoPunto.set(campoId, punto);
  }

  dibujarFirma(campoId: string, evento: MouseEvent | TouchEvent): void {
    if (!this.firmaDibujando.get(campoId)) return;
    evento.preventDefault();

    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ultimoPunto = this.firmaUltimoPunto.get(campoId);
    const punto = this.coordenadasCanvas(canvas, evento);

    if (ultimoPunto) {
      ctx.beginPath();
      ctx.moveTo(ultimoPunto.x, ultimoPunto.y);
      ctx.lineTo(punto.x, punto.y);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    this.firmaUltimoPunto.set(campoId, punto);
    this.firmaConTrazos.update(v => ({ ...v, [campoId]: true }));
  }

  terminarFirma(campoId: string): void {
    this.firmaDibujando.set(campoId, false);
    this.firmaUltimoPunto.delete(campoId);
  }

  limpiarFirma(campoId: string): void {
    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.firmaConTrazos.update(v => ({ ...v, [campoId]: false }));
  }

  /**
   * Convierte el canvas a PNG, lo sube a S3, y guarda el objeto resultado en el campo.
   */
  confirmarFirma(campoId: string): void {
    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;

    this.subiendoArchivo.set(campoId);

    canvas.toBlob((blob) => {
      if (!blob) {
        this.errorMsg.set('No se pudo capturar la firma. Inténtalo de nuevo.');
        this.subiendoArchivo.set(null);
        return;
      }

      const archivo = new File([blob], `firma-${Date.now()}.png`, { type: 'image/png' });

      this.archivoService.subirArchivo(archivo).subscribe({
        next: (resp) => {
          this.actualizarValorCampo(campoId, {
            nombreOriginal: resp.nombreOriginal,
            url: resp.url,
            tamano: resp.tamano
          });
          this.firmaConTrazos.update(v => ({ ...v, [campoId]: false }));
          this.subiendoArchivo.set(null);
        },
        error: () => {
          this.errorMsg.set('Error al subir la firma');
          this.subiendoArchivo.set(null);
        }
      });
    }, 'image/png');
  }

  private obtenerCanvasFirma(campoId: string): HTMLCanvasElement | null {
    return document.getElementById(`firma-${campoId}`) as HTMLCanvasElement | null;
  }

  private coordenadasCanvas(canvas: HTMLCanvasElement, evento: MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;

    if (evento instanceof TouchEvent) {
      const touch = evento.touches[0] || evento.changedTouches[0];
      clientX = touch.clientX;
      clientY = touch.clientY;
    } else {
      clientX = evento.clientX;
      clientY = evento.clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  /** Inicializa el canvas con fondo blanco apenas se renderiza. */
  inicializarCanvasFirma(campoId: string): void {
    setTimeout(() => {
      const canvas = this.obtenerCanvasFirma(campoId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, 50);
  }

  // Tabla
  agregarFilaTabla(campoId: string, columnas: any[]) {
    const actual = this.getValorCampo(campoId) || [];
    const nuevaFila: any = {};
    columnas.forEach(col => nuevaFila[col.id] = '');
    this.actualizarValorCampo(campoId, [...actual, nuevaFila]);
  }

  eliminarFilaTabla(campoId: string, idx: number, minFilas: number = 1) {
    const actual = this.getValorCampo(campoId) || [];
    if (actual.length <= minFilas) return;
    const nueva = [...actual];
    nueva.splice(idx, 1);
    this.actualizarValorCampo(campoId, nueva);
  }

  actualizarCeldaTabla(campoId: string, filaIdx: number, colId: string, valor: any) {
    const actual = this.getValorCampo(campoId) || [];
    const nueva = [...actual];
    nueva[filaIdx] = { ...nueva[filaIdx], [colId]: valor };
    this.actualizarValorCampo(campoId, nueva);
  }

  // ── CU21: Modal de dictado / texto ──────────────────────────────────────
  abrirModalVoz() { this.modalVozAbierto.set(true); }
  cerrarModalVoz() { this.modalVozAbierto.set(false); }

  // ── Tour ─────────────────────────────────────────────────────────────────
  tourActive = signal(false);
  tourStep   = signal(0);
  tourRect   = signal<DOMRect | null>(null);

  readonly tourPasos = [
    { id: 'tour-nt-header',   icono: '📝', titulo: 'Portal de Trámites',      desc: 'Aquí puedes iniciar cualquier solicitud oficial disponible en la institución. Solo necesitas seleccionar el tipo de trámite y completar el formulario correspondiente.' },
    { id: 'tour-nt-catalogo', icono: '🗂️', titulo: 'Catálogo de servicios',   desc: 'Cada tarjeta representa un tipo de trámite activo. Muestra el código, el nombre, la descripción y cuántos pasos tiene el flujo. Haz clic en una para comenzar tu solicitud.' },
    { id: 'tour-nt-formulario',icono:'📋', titulo: 'Formulario del servicio',  desc: 'Una vez seleccionado el servicio, aparece el formulario de requisitos inicial que debes completar. Los campos marcados con * son obligatorios. El formulario varía según el trámite elegido.' },
    { id: 'tour-nt-ia',       icono: '✨', titulo: 'Asistente IA',            desc: 'El botón "Asistente IA" puede completar el formulario automáticamente analizando la descripción que escribiste. Ahorra tiempo en trámites con muchos campos de texto.' }
  ];

  get tourPasoActual()  { return this.tourPasos[this.tourStep()]; }
  get esUltimoPasoTour(){ return this.tourStep() === this.tourPasos.length - 1; }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.tourActive()) this.cerrarTour(); }

  @HostListener('window:resize') @HostListener('window:scroll')
  onTourLayout(): void { if (this.tourActive()) this.actualizarRectTour(); }

  iniciarTour(): void {
    this.tourActive.set(true); this.tourStep.set(0);
    setTimeout(() => this.irAlPasoTour(0), 100);
  }
  siguientePasoTour(): void {
    if (this.esUltimoPasoTour) { this.cerrarTour(); return; }
    const n = this.tourStep() + 1; this.tourStep.set(n);
    setTimeout(() => this.irAlPasoTour(n), 150);
  }
  anteriorPasoTour(): void {
    if (this.tourStep() === 0) return;
    const n = this.tourStep() - 1; this.tourStep.set(n);
    setTimeout(() => this.irAlPasoTour(n), 150);
  }
  cerrarTour(): void { this.tourActive.set(false); this.tourRect.set(null); }

  private irAlPasoTour(paso: number): void {
    const el = document.getElementById(this.tourPasos[paso].id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => this.actualizarRectTour(), 450); }
    else this.tourRect.set(null);
  }
  private actualizarRectTour(): void {
    if (!this.tourActive()) return;
    const el = document.getElementById(this.tourPasoActual.id);
    this.tourRect.set(el ? el.getBoundingClientRect() : null);
  }
  // ─────────────────────────────────────────────────────────────────────────

  aplicarCamposVoz(camposLlenados: Record<string, any>) {
    Object.entries(camposLlenados).forEach(([id, valor]) => {
      this.actualizarValorCampo(id, valor);
    });
    this.cerrarModalVoz();
  }
}