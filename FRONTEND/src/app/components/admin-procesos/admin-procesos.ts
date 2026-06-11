import { Component, OnInit, ViewChild, inject, signal, computed, HostListener, effect, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IaService } from '../../services/ia.service';
import { DiagramadorBpmnComponent } from '../diagramador-bpmn/diagramador-bpmn';
import { ProcesoService } from '../../services/proceso';
import { DepartamentoService } from '../../services/departamento';
import { Departamento } from '../../models/departamento.model';
import { EditorFormularioPasoComponent } from '../editor-formulario-paso/editor-formulario-paso';
import { CampoFormulario, Paso, ProcesoDefinicion, TipoResponsable } from '../../models/proceso.model';
import { BpmnThumbnailComponent } from '../bpmn-thumbnail/bpmn-thumbnail';
import { VozReconocimientoService } from '../../services/voz-reconocimiento.service';
import { AuditoriaService } from '../../services/auditoria';
import { AuditLog } from '../../models/audit-log.model';

// 👇 NUEVO Colaboración
import { ActivatedRoute, Router } from '@angular/router';
import { ColaboracionService } from '../../services/colaboracion';
import { PresenciaToolbarComponent } from '../presencia-toolbar/presencia-toolbar';
import { InvitarColaboradoresComponent } from '../invitar-colaboradores/invitar-colaboradores';
// 👇 NUEVO UX
import { LayoutService } from '../../services/layout.service';

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
type Vista = 'lista' | 'creador';
type TabCreador = 'diagrama' | 'departamentos' | 'formularios';
type VistaLista = 'tarjetas' | 'tabla';

interface Toast {
  id: number;
  tipo: 'ok' | 'error' | 'info' | 'warning';
  titulo: string;
  texto?: string;
}

interface ConfirmacionConfig {
  titulo: string;
  mensaje: string;
  textoConfirmar: string;
  textoCancelar: string;
  tipo: 'danger' | 'warning' | 'info';
  onConfirmar: () => void;
}

@Component({
  selector: 'app-admin-procesos',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    DiagramadorBpmnComponent, EditorFormularioPasoComponent,
    BpmnThumbnailComponent,
    // 👇 NUEVO Colaboración
    PresenciaToolbarComponent, InvitarColaboradoresComponent
  ],
  templateUrl: './admin-procesos.html',
  styleUrl: './admin-procesos.css'
})
export class AdminProcesosComponent implements OnInit {
  private procesoService    = inject(ProcesoService);
  private departamentoService = inject(DepartamentoService);
  private iaService         = inject(IaService);
  private auditoriaService  = inject(AuditoriaService);
  vozService = inject(VozReconocimientoService);
  // 👇 NUEVO Colaboración
  private colaboracionService = inject(ColaboracionService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
   private layoutService = inject(LayoutService);
    private sanitizer = inject(DomSanitizer);
    private aplicandoMetadatosRemotos = false;
  @ViewChild(DiagramadorBpmnComponent) diagramador?: DiagramadorBpmnComponent;

  // ========== NAVEGACIÓN ==========
  vistaActual = signal<Vista>('lista');
  tabActiva  = signal<TabCreador>('diagrama');
  pasoActual = signal<number>(1); // 1=Información 2=Diagrama 3=Áreas 4=Formularios 5=Publicar
  vistaLista = signal<VistaLista>(this.cargarVistaGuardada());

  // ========== DATOS ==========
  procesos = signal<ProcesoDefinicion[]>([]);
  departamentos = signal<Departamento[]>([]);
  isLoading = signal(false);
  isSaving = signal(false);

  // ========== ESTADO DEL EDITOR ==========
  procesoEditando = signal<ProcesoDefinicion | null>(null);
  xmlActual = signal<string>('');
  nombrePolitica = signal<string>('');
  codigoPolitica = signal<string>('');
  descripcionPolitica = signal<string>('');
  lanesActuales = signal<string[]>([]);
  pasosDetectados = signal<Paso[]>([]);
  pasoSeleccionado = signal<Paso | null>(null);
  camposPorPaso = signal<Record<string, CampoFormulario[] | undefined>>({});
  hayCambiosPendientes = signal(false);
  responsablesPorPaso = signal<Record<string, TipoResponsable | undefined>>({});
  camposVisiblesPorPaso = signal<Record<string, string[] | undefined>>({});

  // ========== FILTROS LISTA ==========
  terminoBusqueda = signal('');
  filtroEstado = signal<'TODOS' | 'BORRADOR' | 'ACTIVA' | 'OBSOLETA'>('TODOS');
  
  // ========== ESTADOS DE PUBLICACIÓN Y VALIDACIÓN ==========
  publicando = signal(false);
  erroresValidacion = signal<string[]>([]);
  mostrandoValidacion = signal(false);

  // ========== CU20: CONTROL DE VERSIONES ==========
  mostrandoVersiones  = signal<ProcesoDefinicion | null>(null);
  procesoVersiones    = signal<ProcesoDefinicion[]>([]);
  cargandoVersiones   = signal(false);
  versionXmlVisible   = signal<ProcesoDefinicion | null>(null);
  auditoriaVersion    = signal<Record<string, AuditLog[]>>({});
  cargandoAuditoriaId = signal<string | null>(null);

  // ========== CU20: FLUJOS DE EDICIÓN CONTROLADA ==========
  // Modal: ya existe un BORRADOR para este codigoBase
  mostrandoBorradorExistente = signal(false);
  borradorExistenteId        = signal<string | null>(null);
  // Modal: hay colaboradores activos al intentar publicar
  mostrandoAlertaColaboradores = signal(false);
  colaboradoresActivos         = signal<any[]>([]);
  idPublicandoConColaboradores = signal<string | null>(null);

  // 👇 NUEVO CU17: Signals para el modal IA
  mostrarModalIA   = signal(false);
  promptIA         = signal('');
  historialPrompts = signal<string[]>([]);
  /** true cuando el diagrama ya tiene nodos → la IA entra en modo edición */
  modoEdicionIA    = computed(() => this.pasosDetectados().length > 0);
  // 👇 NUEVO UX: Estado de UI del editor
  drawerMetadatosAbierto = signal<boolean>(this.cargarEstadoDrawer());
  modoFoco = signal<boolean>(false);
  @ViewChild('pantallaCompleta') contenedorPantallaCompleta!: ElementRef;
  esPantallaCompleta = signal(false);
  private estadoSidebarPrevio: boolean | null = null;
  // 👇 NUEVO Colaboración
  modoColaborativo = signal(false);
  mostrarInvitar = signal(false);
  mostrarModalBorrador = signal(false);
  borradorPendiente = signal<{ borradorXml: string; borradorPor: string; fechaUltimoBorrador: string } | null>(null);

  // Computed: pasamos el modeler al componente cursor-remoto
  modelerActual = computed(() => this.diagramador?.modelerRef() ?? null);
  
  // Estado de presencia (lo expone el service via signals)
  conectados = this.colaboracionService.conectados;
  notificacionesEntrantes = this.colaboracionService.notificacionesEntrantes;
  // 👇 NUEVO CU17: ejemplos pre-armados para acelerar la demo
  ejemplosPrompt = [
    {
      label: '🌴 Vacaciones',
      prompt: 'Trámite de solicitud de vacaciones que inicia el Cliente / Solicitante llenando los datos. Luego pasa por revisión del jefe en el Departamento Técnico, quien aprueba o rechaza. Si se aprueba, finaliza. Si se rechaza, vuelve al cliente para corregir.'
    },
    {
      label: '📋 Inscripción',
      prompt: 'Trámite de inscripción donde el Cliente / Solicitante envía sus documentos. Atención al Cliente revisa que los documentos estén completos. Si están completos pasa a validación técnica en el Departamento Técnico. Si validación técnica aprueba, finaliza con éxito. Si rechaza, vuelve al cliente.'
    },
    {
      label: '💰 Reembolso',
      prompt: 'Trámite de reembolso iniciado por el Cliente / Solicitante con sus comprobantes. Atención al Cliente verifica los gastos. Luego el Departamento Técnico valida el monto. Si aprueba se finaliza el pago. Si rechaza se notifica al cliente.'
    },
    {
      label: '🏗️ Licencia',
      prompt: 'Solicitud de licencia donde el Cliente / Solicitante presenta planos. El Departamento Técnico revisa los planos. Si aprueba pasa a Atención al Cliente para entregar el certificado. Si rechaza vuelve al cliente para correcciones.'
    }
  ];

  // 👇 NUEVO CU17
  usarEjemploPrompt(prompt: string): void {
    this.promptIA.set(prompt);
  }
  cargandoIA = signal(false);

  // ========== NOTIFICACIONES ==========
  toasts = signal<Toast[]>([]);
  confirmacion = signal<ConfirmacionConfig | null>(null);
  private nextToastId = 0;
  
  // ========== COMPUTED: FILTRADO ==========
  procesosFiltrados = computed(() => {
    const termino = this.terminoBusqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    return this.procesos().filter(p => {
      const matchEstado = estado === 'TODOS' || p.estado === estado;
      const matchBusqueda = !termino ||
        p.nombre.toLowerCase().includes(termino) ||
        p.codigo.toLowerCase().includes(termino) ||
        (p.descripcion?.toLowerCase().includes(termino) ?? false);
      return matchEstado && matchBusqueda;
    });
  });

  aplicarFiltroEstado(v: string): void {
    if (v === 'TODOS' || v === 'BORRADOR' || v === 'ACTIVA' || v === 'OBSOLETA') {
      this.filtroEstado.set(v);
    }
  }
  constructor() {
    effect(() => {
      const dictado = this.vozService.textoReconocido();
      // Solo actualizamos el prompt si estamos escuchando activamente
      if (this.vozService.isListening()) {
        this.promptIA.set(dictado);
      }
    }, { allowSignalWrites: true });
  }

  // 👇 NUEVO CU17: Función para encender/apagar el micrófono
  toggleDictado(): void {
    this.vozService.toggle(this.promptIA());
  }
  totalesLista = computed(() => {
    const todos = this.procesos();
    return {
      total: todos.length,
      activos: todos.filter(p => p.activo).length,
      inactivos: todos.filter(p => !p.activo).length,
      totalPasos: todos.reduce((acc, p) => acc + (p.pasos?.length ?? 0), 0)
    };
  });

  hayFiltrosActivos = computed(() => {
    return this.terminoBusqueda().trim() !== '' || this.filtroEstado() !== 'TODOS';
  });

  async publicarPolitica(p: ProcesoDefinicion) {
    if (!p.id || p.estado !== 'BORRADOR') return;

    this.pedirConfirmacion({
      titulo: '¿Publicar política?',
      mensaje: `Al publicar "${p.nombre}", se validará integridad y quedará disponible para los clientes. Si existía una versión anterior activa, se marcará como OBSOLETA (los trámites activos seguirán funcionando con su versión original).`,
      textoConfirmar: 'Sí, publicar',
      textoCancelar: 'Cancelar',
      tipo: 'info',
      onConfirmar: () => this.ejecutarPublicacion(p.id!)
    });
  }

  private ejecutarPublicacion(id: string) {
    this.publicando.set(true);
    this.procesoService.publicar(id).subscribe({
      next: (publicado) => {
        this.publicando.set(false);
        this.mostrarToast('ok', 'Política publicada', `"${publicado.nombre}" ${publicado.version} ahora está activa.`);
        // Si estamos en el editor, cerrarlo y volver a la lista
        if (this.vistaActual() === 'creador') {
          this.cerrarCreador();
        } else {
          this.cargarProcesos();
        }
      },
      error: (err) => {
        this.publicando.set(false);
        if (err.status === 409 && err.error?.error === 'COLABORADORES_ACTIVOS') {
          this.colaboradoresActivos.set(err.error.colaboradores ?? []);
          this.idPublicandoConColaboradores.set(id);
          this.mostrandoAlertaColaboradores.set(true);
          return;
        }
        const msg = err.error?.error || err.message || 'Error al publicar';
        this.mostrarToast('error', 'No se pudo publicar', msg, 8000);
      }
    });
  }

  publicarForzado(): void {
    const id = this.idPublicandoConColaboradores();
    if (!id) return;
    this.mostrandoAlertaColaboradores.set(false);
    this.colaboradoresActivos.set([]);
    this.publicando.set(true);
    this.procesoService.publicarForzar(id).subscribe({
      next: (publicado) => {
        this.publicando.set(false);
        this.mostrarToast('ok', 'Política publicada', `"${publicado.nombre}" ${publicado.version} ahora está activa.`);
        this.idPublicandoConColaboradores.set(null);
        if (this.vistaActual() === 'creador') {
          this.cerrarCreador();
        } else {
          this.cargarProcesos();
        }
      },
      error: (err) => {
        this.publicando.set(false);
        const msg = err.error?.error || err.message || 'Error al publicar';
        this.mostrarToast('error', 'No se pudo publicar', msg, 8000);
      }
    });
  }

  validarAntesDePublicar(p: ProcesoDefinicion) {
    if (!p.id) return;
    this.procesoService.validar(p.id).subscribe({
      next: (resp) => {
        this.erroresValidacion.set(resp.errores);
        this.mostrandoValidacion.set(true);
      },
      error: () => {
        this.mostrarToast('error', 'Error', 'No se pudo validar la política');
      }
    });
  }

  crearNuevaVersion(p: ProcesoDefinicion) {
    if (!p.id) return;
    this.pedirConfirmacion({
      titulo: '¿Crear nueva versión?',
      mensaje: `Se creará un borrador editable de "${p.nombre}". Los trámites activos seguirán funcionando con la versión actual ${p.version}.`,
      textoConfirmar: 'Sí, crear',
      textoCancelar: 'Cancelar',
      tipo: 'info',
      onConfirmar: () => {
        this.procesoService.crearNuevaVersion(p.id!).subscribe({
          next: (borrador) => {
            this.mostrarToast('ok', 'Borrador creado', `Puedes editarlo libremente. Cuando esté listo, publícalo.`);
            this.cargarProcesos();
            this.abrirEditor(borrador);
          },
          error: (err) => {
            if (err.status === 409 && err.error?.error === 'BORRADOR_EXISTENTE') {
              this.borradorExistenteId.set(err.error.borradorId);
              this.mostrandoBorradorExistente.set(true);
              return;
            }
            this.mostrarToast('error', 'Error', err.error?.error || 'No se pudo crear la nueva versión');
          }
        });
      }
    });
  }

  restaurarVersion(v: ProcesoDefinicion, event?: Event): void {
    event?.stopPropagation();
    if (!v.id) return;
    this.pedirConfirmacion({
      titulo: `¿Restaurar ${v.version ?? 'esta versión'}?`,
      mensaje: `Se creará un borrador editable con el contenido de "${v.nombre}" ${v.version ?? ''}. Cuando lo publiques se generará la siguiente versión numerada. Los trámites activos no se afectan hasta la publicación.`,
      textoConfirmar: 'Sí, crear borrador',
      textoCancelar: 'Cancelar',
      tipo: 'info',
      onConfirmar: () => {
        this.procesoService.restaurarVersion(v.id!).subscribe({
          next: (borrador) => {
            this.cerrarVersiones();
            this.mostrarToast('ok', 'Borrador de restauración creado',
              `Edítalo y publícalo cuando esté listo.`);
            this.cargarProcesos();
            this.abrirEditor(borrador);
          },
          error: (err) => {
            if (err.status === 409 && err.error?.error === 'BORRADOR_EXISTENTE') {
              this.borradorExistenteId.set(err.error.borradorId);
              this.cerrarVersiones();
              this.mostrandoBorradorExistente.set(true);
              return;
            }
            this.mostrarToast('error', 'Error',
              err.error?.error || 'No se pudo crear el borrador de restauración');
          }
        });
      }
    });
  }

  irAlBorradorExistente(): void {
    const id = this.borradorExistenteId();
    if (!id) return;
    this.mostrandoBorradorExistente.set(false);
    this.procesoService.obtenerPorId(id).subscribe({
      next: (borrador) => { this.cargarProcesos(); this.abrirEditor(borrador); },
      error: () => this.mostrarToast('error', 'Error', 'No se pudo abrir el borrador existente')
    });
  }

  colabBorradorExistente(): void {
    const id = this.borradorExistenteId();
    if (!id) return;
    this.mostrandoBorradorExistente.set(false);
    this.entrarAColaboracion(id);
  }

  cerrarValidacion() {
    this.mostrandoValidacion.set(false);
    this.erroresValidacion.set([]);
  }

  // ========== COMPUTED: EDITOR ==========
  deptosConEstado = computed(() => {
    const lanesNorm = this.lanesActuales().map(l => this.normalizarNombreLane(l));
    const nombresClienteNorm = ['cliente', 'solicitante', 'cliente / solicitante'];

    const opcionCliente = {
      id: '__CLIENTE__',
      nombre: 'Cliente / Solicitante',
      descripcion: 'Rol virtual — los pasos en esta calle los llena el cliente',
      activo: true,
      esCliente: true,
      enDiagrama: lanesNorm.some(l => nombresClienteNorm.includes(l))
    };

    const deptosReales = this.departamentos().map(d => ({
      ...d,
      esCliente: false,
      enDiagrama: lanesNorm.includes(this.normalizarNombreLane(d.nombre))
    }));

    return [opcionCliente, ...deptosReales];
  });

  private normalizarNombreLane(s: string): string {
    if (!s) return '';
    return s.trim().toLowerCase()
      .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
      .replace(/ó/g, 'o').replace(/ú/g, 'u').replace(/ñ/g, 'n');
  }

  // 👇 NUEVO UX: Lista plana de nombres de departamentos disponibles para el diagramador
  // (incluye "Cliente / Solicitante" como rol virtual + departamentos reales activos)
  nombresDepartamentosDisponibles = computed(() => {
    return this.deptosConEstado()
      .filter(d => d.activo !== false)
      .map(d => d.nombre);
  });

  metadatosValidos = computed(() => {
    return this.codigoPolitica().trim().length >= 3 &&
      this.nombrePolitica().trim().length >= 3;
  });

  resumenValidacion = computed(() => {
    const pasos = this.pasosDetectados();
    const campos = this.camposPorPaso();
    const pasosConFormulario = pasos.filter(p => (campos[p.id]?.length ?? 0) > 0).length;
    return {
      codigoOk: this.codigoPolitica().trim().length >= 3,
      nombreOk: this.nombrePolitica().trim().length >= 3,
      tienePasos: pasos.length > 0,
      tieneLanes: this.lanesActuales().length > 0,
      totalPasos: pasos.length,
      totalLanes: this.lanesActuales().length,
      pasosConFormulario,
      totalCampos: Object.values(campos).reduce((acc, arr) => acc + (arr?.length ?? 0), 0)
    };
  });

  puedeGuardar = computed(() => this.metadatosValidos() && !this.isSaving());

  tituloEditor = computed(() => {
    const editando = this.procesoEditando();
    return editando ? `Editando: ${editando.nombre}` : 'Nueva política';
  });

  camposGlobalesDelPasoActual = computed(() => {
    const sel = this.pasoSeleccionado();
    if (!sel) return [];

    const pasos = this.pasosDetectados();
    const camposMap = this.camposPorPaso();
    const responsables = this.responsablesPorPaso();

    const idxActual = pasos.findIndex(p => p.id === sel.id);
    if (idxActual < 0) return [];

    const resultado: Array<{ id: string; etiqueta: string; tipo: string; origen: string; origenTipo: 'cliente' | 'paso' }> = [];

    for (let i = 0; i < idxActual; i++) {
      const p = pasos[i];
      const campos = camposMap[p.id] || [];
      const esCliente = responsables[p.id] === 'INICIO_CLIENTE';
      const origen = esCliente ? 'Datos del cliente' : `Paso: ${p.nombre}`;

      campos
        .filter(c => !['titulo', 'subtitulo', 'parrafo', 'separador'].includes(c.tipo))
        .forEach(c => {
          resultado.push({
            id: c.id,
            etiqueta: c.etiqueta || 'Sin etiqueta',
            tipo: c.tipo,
            origen,
            origenTipo: esCliente ? 'cliente' : 'paso'
          });
        });
    }

    return resultado;
  });

  async ngOnInit(): Promise<void> {
    this.cargarProcesos();
    this.cargarDepartamentos();

    // 👇 NUEVO Colaboración: conectar al WS al entrar a la página
    try {
      await this.colaboracionService.conectar();
    } catch (e) {
      console.warn('[Colaboración] No se pudo conectar al WS:', e);
      // No es crítico — la página sigue funcionando sin colaboración
    }

    // Registrar callback para recibir notificación cuando otro admin publica el borrador que estamos editando
    this.colaboracionService.onPublicacionRecibida((notif) => {
      if (notif?.tipo === 'PROCESO_PUBLICADO') {
        this.mostrarToast('warning', '⚠️ Borrador publicado',
          `"${notif.nombre}" ${notif.version} fue publicado por ${notif.por}. Tus cambios locales quedaron descartados.`,
          8000);
        // Recargar para reflejar el nuevo estado
        this.cargarProcesos();
        if (this.vistaActual() === 'creador') {
          this.cerrarCreador();
        }
      }
    });

    // 👇 NUEVO Colaboración: si llegamos vía /colaborar/:token (procesoId en query)
    this.route.queryParamMap.subscribe(params => {
      const procesoId = params.get('procesoColaborativo');
      if (procesoId) {
        this.entrarAColaboracion(procesoId);
      }
    });

    // 👇 NUEVO UX: Escuchar cambios de Fullscreen nativo del navegador
    document.addEventListener('fullscreenchange', () => {
      this.esPantallaCompleta.set(!!document.fullscreenElement);
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.tourActive()) { this.cerrarTour(); return; }
    if (this.mostrandoBorradorExistente()) { this.mostrandoBorradorExistente.set(false); return; }
    if (this.mostrandoAlertaColaboradores()) { this.mostrandoAlertaColaboradores.set(false); return; }
    if (this.mostrandoVersiones()) { this.cerrarVersiones(); return; }
    if (this.confirmacion()) { this.confirmacion.set(null); return; }
    if (this.modoFoco()) { this.toggleModoFoco(); }
  }

  // 👇 NUEVO UX: Atajos 1/2/3 para tabs (solo en el editor)
  @HostListener('document:keydown', ['$event'])
  onKeyDownGlobal(event: KeyboardEvent): void {
    if (this.vistaActual() !== 'creador') return;
    // Ignorar si el usuario está escribiendo en un input/textarea
    const target = event.target as HTMLElement;
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    // Ignorar combinaciones con modificadores
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

    switch (event.key) {
      case '1': this.cambiarTab('diagrama'); break;
      case '2': this.cambiarTab('departamentos'); break;
      case '3': this.cambiarTab('formularios'); break;
      case 'f':
      case 'F':
        this.toggleModoFoco();
        break;
    }
  }

  @HostListener('document:keydown.control.s', ['$event'])
  @HostListener('document:keydown.meta.s', ['$event'])
  onCtrlS(event: Event): void {
    if (this.vistaActual() === 'creador') {
      event.preventDefault();
      this.guardarDesdeBoton();
    }
  }

  onTipoResponsableCambiado(tipo: TipoResponsable) {
    const p = this.pasoSeleccionado();
    if (!p) return;
    this.responsablesPorPaso.update(map => ({ ...map, [p.id]: tipo }));
    this.hayCambiosPendientes.set(true);

    if (this.modoColaborativo() && !this.aplicandoMetadatosRemotos) {
      this.colaboracionService.emitirCambioMetadatos({ tipo: 'RESPONSABLE', pasoId: p.id, responsable: tipo });
    }
  }

  onCamposVisiblesCambiados(ids: string[]) {
    const p = this.pasoSeleccionado();
    if (!p) return;
    this.camposVisiblesPorPaso.update(map => ({ ...map, [p.id]: ids }));
    this.hayCambiosPendientes.set(true);

    if (this.modoColaborativo() && !this.aplicandoMetadatosRemotos) {
      this.colaboracionService.emitirCambioMetadatos({ tipo: 'VISIBLES', pasoId: p.id, visibles: ids });
    }
  }

  private cargarVistaGuardada(): VistaLista {
    const v = localStorage.getItem('admin_procesos_vista');
    return v === 'tabla' ? 'tabla' : 'tarjetas';
  }

  // ========== CARGA DE DATOS ==========
  cargarProcesos(): void {
    this.isLoading.set(true);
    this.procesoService.obtenerProcesos().subscribe({
      next: (lista) => {
        this.procesos.set(lista);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error al cargar procesos:', err);
        this.isLoading.set(false);
        this.mostrarToast('error', 'Error al cargar', 'No se pudieron cargar las políticas');
      }
    });
  }

  cargarDepartamentos(): void {
    this.departamentoService.getDepartamentos().subscribe({
      next: (d) => this.departamentos.set(d),
      error: (e) => console.error('Error cargando departamentos:', e)
    });
  }

  // ========== NAVEGACIÓN ==========
  abrirCreador(): void {
    this.procesoEditando.set(null);
    this.nombrePolitica.set('');
    this.codigoPolitica.set('');
    this.descripcionPolitica.set('');
    this.xmlActual.set('');
    this.lanesActuales.set([]);
    this.camposPorPaso.set({});
    this.pasosDetectados.set([]);
    this.pasoSeleccionado.set(null);
    this.hayCambiosPendientes.set(false);
    this.tabActiva.set('diagrama');
    this.pasoActual.set(1);
    this.vistaActual.set('creador');
    this.camposVisiblesPorPaso.set({});
    // 👇 NUEVO UX: Colapsar sidebar global al entrar al editor
    this.estadoSidebarPrevio = this.layoutService.sidebarColapsado();
    this.layoutService.colapsarSidebar();
    setTimeout(() => {
      if (this.diagramador) {
        this.lanesActuales.set(this.diagramador.obtenerNombresLanes());
      }
    }, 500);
  }

  /** Punto de entrada desde la lista: bloquea la apertura en ACTIVA/OBSOLETA. */
  intentarAbrirEditor(p: ProcesoDefinicion): void {
    if (p.estado === 'ACTIVA') {
      this.mostrarToast('info', 'Versión publicada',
        `"${p.nombre}" está activa. Usa "Nueva Versión" para crear un borrador editable.`, 5000);
      return;
    }
    if (p.estado === 'OBSOLETA') {
      this.mostrarToast('info', 'Versión obsoleta',
        `Esta versión ya fue reemplazada. Busca la versión activa o crea una nueva.`, 5000);
      return;
    }
    this.abrirEditor(p);
  }

  abrirEditor(proceso: ProcesoDefinicion): void {
    this.procesoEditando.set(proceso);
    this.nombrePolitica.set(proceso.nombre);
    this.codigoPolitica.set(proceso.codigo);
    this.descripcionPolitica.set(proceso.descripcion ?? '');
    this.xmlActual.set(proceso.bpmnXml ?? '');
    this.lanesActuales.set([]);
    this.hayCambiosPendientes.set(false);
    this.tabActiva.set('diagrama');
    this.vistaActual.set('creador');
    this.pasoActual.set(2);
    // 👇 NUEVO UX: Colapsar sidebar global al entrar al editor
    this.estadoSidebarPrevio = this.layoutService.sidebarColapsado();
    this.layoutService.colapsarSidebar();
    const mapa: Record<string, CampoFormulario[] | undefined> = {};
    const mapaResp: Record<string, TipoResponsable | undefined> = {};
    const mapaVis: Record<string, string[] | undefined> = {}
    proceso.pasos?.forEach(p => {
      mapaResp[p.id] = p.tipoResponsable ?? 'FUNCIONARIO';
    });
    this.responsablesPorPaso.set(mapaResp);
    proceso.pasos?.forEach(p => { mapa[p.id] = p.campos ?? []; });
    this.camposPorPaso.set(mapa);
    this.pasosDetectados.set(proceso.pasos ?? []);
    proceso.pasos?.forEach(p => {
      mapaVis[p.id] = p.camposVisibles ?? [];
    });
    this.camposVisiblesPorPaso.set(mapaVis);
    setTimeout(() => {
      if (this.diagramador) {
        this.lanesActuales.set(this.diagramador.obtenerNombresLanes());
      }
    }, 500);
  }

  solicitarCerrarCreador(): void {
    if (this.hayCambiosPendientes()) {
      this.pedirConfirmacion({
        titulo: '¿Descartar cambios?',
        mensaje: 'Tienes cambios sin guardar en esta política. Si cierras ahora, se perderán definitivamente.',
        textoConfirmar: 'Sí, descartar',
        textoCancelar: 'Seguir editando',
        tipo: 'warning',
        onConfirmar: () => this.cerrarCreador()
      });
    } else {
      this.cerrarCreador();
    }
  }

  private cerrarCreador(): void {
    this.cerrarCreadorConSalida();

    // 👇 NUEVO UX: Restaurar estado del sidebar global
    if (this.estadoSidebarPrevio === false) {
      this.layoutService.expandirSidebar();
    }
    this.estadoSidebarPrevio = null;
    this.modoFoco.set(false);

    this.hayCambiosPendientes.set(false);
    this.vistaActual.set('lista');
    this.cargarProcesos();
  }

  cambiarTab(t: TabCreador): void {
    this.tabActiva.set(t);
    if (t === 'diagrama')     { this.pasoActual.set(2); setTimeout(() => this.diagramador?.ajustarVista(), 100); }
    if (t === 'departamentos')  this.pasoActual.set(3);
    if (t === 'formularios')    this.pasoActual.set(4);
  }

  irAlPaso(n: number): void {
    this.pasoActual.set(n);
    if (n === 2) { this.tabActiva.set('diagrama');     setTimeout(() => this.diagramador?.ajustarVista(), 150); }
    if (n === 3)   this.tabActiva.set('departamentos');
    if (n === 4)   this.tabActiva.set('formularios');
  }

  siguientePaso(): void {
    const actual = this.pasoActual();
    if (actual === 1 && !this.metadatosValidos()) {
      this.mostrarToast('warning', 'Datos incompletos', 'Completa el código y el nombre del proceso antes de continuar.');
      return;
    }
    if (actual < 5) this.irAlPaso(actual + 1);
  }

  pasoAnterior(): void {
    const n = this.pasoActual();
    if (n > 1) this.irAlPaso(n - 1);
  }

  cambiarVistaLista(v: VistaLista): void {
    this.vistaLista.set(v);
    localStorage.setItem('admin_procesos_vista', v);
  }

  // 👇 NUEVO CU17: Genera/edita flujo con IA
  generarFlujoConIA(): void {
    if (this.promptIA().trim().length < 10) return;
    this.agregarAlHistorial(this.promptIA().trim());
    this.ejecutarGeneracionIA();
  }

  /** Guarda el prompt en el historial (máx. 3, sin duplicados). */
  private agregarAlHistorial(prompt: string): void {
    const sin = this.historialPrompts().filter(p => p !== prompt);
    this.historialPrompts.set([prompt, ...sin].slice(0, 3));
  }

  /** Pre-carga en el textarea "continúa desde [nombre del nodo seleccionado]". */
  continuarDesdeSeleccionado(): void {
    const sel = this.diagramador?.elementoSeleccionado();
    if (!sel) return;
    const nombre = sel.nombre?.trim() || 'el paso seleccionado';
    this.promptIA.set(
      `Continúa el flujo desde "${nombre}": agrega los siguientes pasos necesarios hasta llegar al fin del proceso.`
    );
  }

  /** Fuerza modo CREAR aunque el diagrama tenga nodos (reemplaza todo). */
  forzarCreacionIA(): void {
    this.pedirConfirmacion({
      titulo: '¿Reemplazar el diagrama?',
      mensaje: 'Se borrará el flujo actual y se generará uno nuevo desde cero con la IA.',
      textoConfirmar: 'Sí, reemplazar',
      textoCancelar:  'Cancelar',
      tipo:           'warning',
      onConfirmar:    () => {
        // Vaciar el diagrama antes de generar para que la detección sea "crear"
        this.diagramador?.cargarXml(
          '<?xml version="1.0" encoding="UTF-8"?><umlActivity xmlns:uml="http://www.omg.org/spec/UML/20131001" id="Activity_1" name="Política de Negocio"><partitions/><nodes/><edges/></umlActivity>'
        );
        setTimeout(() => this.ejecutarGeneracionIA(), 80);
      }
    });
  }

  private ejecutarGeneracionIA(): void {
    this.cargandoIA.set(true);
    const deptosValidos = this.deptosConEstado().map(d => d.nombre).join(', ');

    // Detección automática: si el diagrama ya tiene nodos → modo edición colaborativa
    const modoEdicion = this.diagramador ? !this.diagramador.isEmpty() : false;

    if (modoEdicion) {
      this.ejecutarEdicionIA(deptosValidos);
    } else {
      this.ejecutarCreacionIA(deptosValidos);
    }
  }

  /** Crea un diagrama desde cero a partir del prompt */
  private ejecutarCreacionIA(deptosValidos: string): void {
    this.iaService.generarFlujo(this.promptIA(), deptosValidos).subscribe({
      next: async (res: any) => {
        try {
          this.cambiarTab('diagrama');

          if (this.diagramador) {
            const { pasos: pasosIA, transiciones, nodosOmitidos } = await this.diagramador.generarDesdeIA(res);

            setTimeout(() => this.integrarTransicionesIA(transiciones), 0);

            if (nodosOmitidos.length > 0) {
              setTimeout(() => this.mostrarToast(
                'warning', 'Nodos no ubicados',
                `Nodos omitidos por carril no encontrado: ${nodosOmitidos.join(', ')}`, 8000
              ), 800);
            }
          }

          this.mostrarModalIA.set(false);
          this.promptIA.set('');
          this.mostrarToast('ok', '¡Diagrama generado!', `${res.totalNodos} nodos · ${res.totalConexiones} conexiones`);

          (res.advertencias ?? []).forEach((adv: string, i: number) =>
            setTimeout(() => this.mostrarToast('info', 'Aviso de la IA', adv, 6000), 500 + i * 300));

          if (res.departamentosNoMatcheados?.length > 0) {
            setTimeout(() => this.mostrarToast(
              'warning', 'Departamentos no encontrados',
              `Considera crear: ${res.departamentosNoMatcheados.join(', ')}. Mientras, asígnalos manualmente.`, 8000
            ), 1500);
          }

          this.hayCambiosPendientes.set(true);
        } catch (error: any) {
          this.mostrarToast('error', 'Error al renderizar diagrama', error.message || 'Estructura inválida.');
        } finally {
          this.cargandoIA.set(false);
        }
      },
      error: (err) => { this.cargandoIA.set(false); this.manejarErrorIA(err); }
    });
  }

  /** Edita el diagrama existente aplicando operaciones delta devueltas por la IA */
  private ejecutarEdicionIA(deptosValidos: string): void {
    const contexto = this.diagramador!.diagramToContext();

    this.iaService.editarFlujo(this.promptIA(), contexto, deptosValidos).subscribe({
      next: (res: any) => {
        try {
          this.cambiarTab('diagrama');

          const ops: any[] = res.operaciones ?? [];
          if (ops.length === 0) {
            this.mostrarToast('info', 'Sin cambios', res.resumen ?? 'La IA no generó operaciones para esta instrucción.');
            this.cargandoIA.set(false);
            return;
          }

          const { aplicadas, errores } = this.diagramador!.aplicarOperacionesIA(ops);

          this.mostrarModalIA.set(false);
          this.promptIA.set('');

          const resumen = res.resumen ? `"${res.resumen}"` : `${aplicadas} operación(es) aplicada(s)`;
          this.mostrarToast('ok', 'Diagrama actualizado', resumen);

          if (errores.length > 0) {
            setTimeout(() => this.mostrarToast(
              'warning', 'Algunos cambios fallaron',
              errores.slice(0, 3).join(' | '), 8000
            ), 600);
          }

          (res.advertencias ?? []).forEach((adv: string, i: number) =>
            setTimeout(() => this.mostrarToast('info', 'Aviso de la IA', adv, 6000), 800 + i * 300));

          this.hayCambiosPendientes.set(true);
        } catch (error: any) {
          this.mostrarToast('error', 'Error al aplicar cambios', error.message || 'Error inesperado.');
        } finally {
          this.cargandoIA.set(false);
        }
      },
      error: (err) => { this.cargandoIA.set(false); this.manejarErrorIA(err); }
    });
  }

  private manejarErrorIA(err: any): void {
    const tipo     = err.error?.tipo;
    const msgServer = err.error?.error || 'Error desconocido';
    if      (tipo === 'FLUJO_INCOHERENTE') this.mostrarToast('warning', 'Prompt poco claro', msgServer, 8000);
    else if (tipo === 'IA_SATURADA')       this.mostrarToast('error',   'IA saturada',       msgServer, 6000);
    else                                   this.mostrarToast('error',   'Error de la IA',    msgServer);
  }

  /**
   * 👇 NUEVO CU17 (D): Después de que bpmn-js dibujó los nodos y disparó el evento `cambio`,
   * los pasos están en `pasosDetectados` con id real generado por bpmn-js.
   * Pero las transiciones que vienen de la IA usan los IDs originales (StartEvent_1, Task_1, etc.).
   *
   * Como bpmn-js puede asignar el mismo ID que pidió la IA, normalmente los IDs coinciden.
   * Aquí integramos las conexiones a los pasos.
   */
  private integrarTransicionesIA(transiciones: any[]): void {
    const pasos = this.pasosDetectados();
    if (pasos.length === 0 || transiciones.length === 0) return;

    const pasosActualizados = pasos.map(paso => {
      const salientes = transiciones
        .filter(t => t.origen === paso.id)
        .map(t => ({
          estadoCondicion: t.nombre || 'DEFAULT',
          pasoDestinoId: t.destino,
          nombreAccion: t.nombre || ''
        }));

      return {
        ...paso,
        transiciones: salientes
      };
    });

    this.pasosDetectados.set(pasosActualizados);
  }

  // ========== HANDLERS DEL EDITOR ==========
  onCamposCambiaron(campos: CampoFormulario[]): void {
    const p = this.pasoSeleccionado();
    if (!p) return;
    this.camposPorPaso.update(map => ({ ...map, [p.id]: campos }));
    this.hayCambiosPendientes.set(true);

    if (this.modoColaborativo() && !this.aplicandoMetadatosRemotos) {
      this.colaboracionService.emitirCambioMetadatos({ tipo: 'CAMPOS', pasoId: p.id, campos });
    }
  }

  toggleDepartamento(nombre: string, agregar: boolean): void {
    if (!this.diagramador) return;
    if (agregar) {
      this.diagramador.agregarLanePorNombre(nombre);
    } else {
      this.diagramador.eliminarLanePorNombre(nombre);
    }
    setTimeout(() => {
      this.lanesActuales.set(this.diagramador!.obtenerNombresLanes());
    }, 100);
  }

  toggleDepartamentoODCliente(depto: any): void {
    // 👇 CU17: usar siempre el nombre canónico "Cliente / Solicitante"
    // para que matche con lo que devuelve la IA
    const nombre = depto.esCliente ? 'Cliente / Solicitante' : depto.nombre;
    this.toggleDepartamento(nombre, !depto.enDiagrama);
  }

  onLanesCambiadas(nombres: string[]): void {
    this.lanesActuales.set(nombres);
  }

  onCambio(xml: string): void {
    this.xmlActual.set(xml);
    this.hayCambiosPendientes.set(true);

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      const pasos: Paso[] = [];
      const esFormatoUml = !!doc.querySelector('umlActivity');

      if (esFormatoUml) {
        // Formato UML: <node type="OpaqueAction|AcceptEventAction" id="..." name="..." partition="..."/>
        const particionesCliente = new Set<string>();
        doc.querySelectorAll('partition').forEach(p => {
          const nombre = (p.getAttribute('name') || '').trim().toLowerCase();
          const esCliente = ['cliente', 'solicitante', 'cliente / solicitante', 'cliente/solicitante'].includes(nombre);
          if (esCliente) particionesCliente.add(p.getAttribute('id') || '');
        });

        doc.querySelectorAll('node[type="OpaqueAction"], node[type="AcceptEventAction"]').forEach(node => {
          const id = node.getAttribute('id');
          const name = node.getAttribute('name');
          const partId = node.getAttribute('partition') || '';
          const esCliente = particionesCliente.has(partId);
          if (id) {
            pasos.push({
              id,
              nombre: name || 'Sin nombre',
              departamentoAsignadoId: esCliente ? 'PORTAL_WEB' : '',
              transiciones: [],
              tipoResponsable: esCliente ? 'INICIO_CLIENTE' : 'FUNCIONARIO'
            });
          }
        });
      } else {
        // Formato BPMN 2.0 (legado)
        const lanesCliente = new Set<string>();
        doc.querySelectorAll('lane').forEach(lane => {
          const nombre = (lane.getAttribute('name') || '').trim().toLowerCase();
          const esCliente = ['cliente', 'solicitante', 'cliente / solicitante', 'cliente/solicitante'].includes(nombre);
          if (esCliente) {
            lane.querySelectorAll('flowNodeRef').forEach(ref => {
              if (ref.textContent) lanesCliente.add(ref.textContent.trim());
            });
          }
        });

        doc.querySelectorAll('task, userTask, manualTask, serviceTask, scriptTask, businessRuleTask').forEach(task => {
          const id = task.getAttribute('id');
          const name = task.getAttribute('name');
          if (id) {
            pasos.push({
              id,
              nombre: name || 'Sin nombre',
              departamentoAsignadoId: lanesCliente.has(id) ? 'PORTAL_WEB' : '',
              transiciones: [],
              tipoResponsable: lanesCliente.has(id) ? 'INICIO_CLIENTE' : 'FUNCIONARIO'
            });
          }
        });
      }

      let primerPasoClienteDetectado = false;
      pasos.forEach(p => {
        if (p.departamentoAsignadoId === 'PORTAL_WEB') {
          if (!primerPasoClienteDetectado) {
            p.tipoResponsable = 'INICIO_CLIENTE';
            primerPasoClienteDetectado = true;
          } else {
            p.tipoResponsable = 'SOLICITUD_CLIENTE';
          }
        }
      });

      this.pasosDetectados.set(pasos);

      const nuevosResp: Record<string, TipoResponsable | undefined> = { ...this.responsablesPorPaso() };
      pasos.forEach(p => {
        if (p.tipoResponsable) {
          nuevosResp[p.id] = p.tipoResponsable;
        }
      });
      this.responsablesPorPaso.set(nuevosResp);

      const sel = this.pasoSeleccionado();
      if (sel && !pasos.find(p => p.id === sel.id)) {
        this.pasoSeleccionado.set(null);
      }
    } catch (e) {
      console.error('Error parseando XML para detectar tareas:', e);
    }
  }

  onGuardar(payload: { xml: string; svg: string }): void {
    if (!this.metadatosValidos()) {
      this.mostrarToast('warning', 'Datos incompletos', 'Completa el código y nombre antes de guardar');
      return;
    }

    const editando = this.procesoEditando();
    const camposMap = this.camposPorPaso();

    const pasosConCampos = this.pasosDetectados().map(p => ({
      id: p.id,
      nombre: p.nombre,
      departamentoAsignadoId: p.departamentoAsignadoId ?? '',
      transiciones: p.transiciones ?? [],
      campos: camposMap[p.id] ?? [],
      tipoResponsable: this.responsablesPorPaso()[p.id] ?? 'FUNCIONARIO',
      camposVisibles: this.camposVisiblesPorPaso()[p.id] ?? []
    }));

    const datos: ProcesoDefinicion = {
      codigo: this.codigoPolitica().trim().toUpperCase(),
      nombre: this.nombrePolitica().trim(),
      descripcion: this.descripcionPolitica().trim(),
      bpmnXml: payload.xml,
      svgPreview: payload.svg,
      activo: true,
      pasos: pasosConCampos
    };

    this.isSaving.set(true);
    const obs = editando?.id
      ? this.procesoService.actualizarProceso(editando.id, datos)
      : this.procesoService.crearProceso(datos);

    obs.subscribe({
      next: (resp) => {
        this.isSaving.set(false);
        this.hayCambiosPendientes.set(false);
        this.mostrarToast('ok', 'Guardado exitosamente', `"${resp.nombre}" con ${resp.pasos?.length ?? 0} pasos`);
        // Si el proceso guardado es un BORRADOR: quedarse en el editor
        // para que el usuario pueda publicar de inmediato desde aquí.
        if (resp.estado === 'BORRADOR') {
          this.procesoEditando.set(resp);
        } else {
          this.cerrarCreador();
        }
      },
      error: (err) => {
        this.isSaving.set(false);
        const msg = typeof err.error === 'string'
          ? err.error
          : (err.error?.message || err.message || 'Error desconocido');
        this.mostrarToast('error', 'No se pudo guardar', msg, 6000);
      }
    });
  }

  guardarDesdeBoton(): void {
    if (!this.metadatosValidos()) {
      this.mostrarToast('warning', 'Datos incompletos', 'Completa el código y nombre antes de guardar');
      this.tabActiva.set('diagrama');
      return;
    }
    this.diagramador?.exportar();
  }

  // ========== ACCIONES EN LISTA ==========
  toggleActivoProceso(p: ProcesoDefinicion, event: Event): void {
    event.stopPropagation();
    if (!p.id) return;
    this.procesoService.toggleActivo(p.id).subscribe({
      next: (actualizado) => {
        this.mostrarToast('ok', actualizado.activo ? 'Política activada' : 'Política desactivada');
        this.cargarProcesos();
      },
      error: () => this.mostrarToast('error', 'Error', 'No se pudo cambiar el estado')
    });
  }

  limpiarBusqueda(): void { this.terminoBusqueda.set(''); }

  limpiarFiltros(): void {
    this.terminoBusqueda.set('');
    this.filtroEstado.set('TODOS');
  }

  // ========== SISTEMA DE TOASTS ==========
  private mostrarToast(tipo: Toast['tipo'], titulo: string, texto?: string, duracion = 4500): void {
    const id = ++this.nextToastId;
    this.toasts.update(list => [...list, { id, tipo, titulo, texto }]);
    setTimeout(() => this.cerrarToast(id), duracion);
  }

  cerrarToast(id: number): void {
    this.toasts.update(list => list.filter(t => t.id !== id));
  }

  // ========== SISTEMA DE CONFIRMACIÓN ==========
  private pedirConfirmacion(config: ConfirmacionConfig): void {
    this.confirmacion.set(config);
  }

  ejecutarConfirmacion(): void {
    const conf = this.confirmacion();
    if (!conf) return;
    conf.onConfirmar();
    this.confirmacion.set(null);
  }

  cerrarConfirmacion(): void {
    this.confirmacion.set(null);
  }
  // 👇 NUEVO CU17: Reorganiza el diagrama actual (lo expone el componente diagramador)
  autoOrganizarDiagrama(): void {
    if (!this.diagramador) {
      this.mostrarToast('warning', 'Sin diagrama', 'No hay diagrama para reorganizar');
      return;
    }
    this.diagramador.autoOrganizar();
    this.mostrarToast('ok', 'Diagrama reorganizado', 'Los anchos, alturas y posiciones se ajustaron automáticamente.');
    this.hayCambiosPendientes.set(true);
  }
  // ============================================================================
  //  👇 NUEVO Colaboración
  // ============================================================================

  /**
   * Inicia una sesión colaborativa para la política actualmente abierta.
   */
  iniciarCoEdicion(): void {
    const editando = this.procesoEditando();
    if (!editando?.id) {
      this.mostrarToast('warning', 'Guarda primero', 'Debes guardar la política al menos una vez antes de co-editar');
      return;
    }
    this.entrarAColaboracion(editando.id);
  }

  /**
   * Entra a una sala colaborativa por procesoId.
   * Se llama tanto desde botón "Co-editar" como desde link de invitación.
   */
  async entrarAColaboracion(procesoId: string): Promise<void> {
    // Si no estamos en el editor, abrir el proceso primero
    if (this.vistaActual() !== 'creador' || this.procesoEditando()?.id !== procesoId) {
      // Cargar el proceso y abrirlo
      this.procesoService.obtenerPorId(procesoId).subscribe({
        next: (proceso) => {
          this.abrirEditor(proceso);
          // Esperar a que el editor esté montado
          setTimeout(() => this.activarSalaColaborativa(procesoId), 800);
        },
        error: () => {
          this.mostrarToast('error', 'Proceso no encontrado', 'El proceso al que intentas unirte ya no existe.');
        }
      });
    } else {
      this.activarSalaColaborativa(procesoId);
    }
  }

  private async activarSalaColaborativa(procesoId: string): Promise<void> {
    try {
      // 👇 NUEVO Colaboración: Configurar la escucha de formularios colaborativos
      // Lo ponemos aquí para que el "túnel" esté listo antes de entrar a la sala
      this.colaboracionService.onMetadatosRecibidos((evento) => {
        this.aplicandoMetadatosRemotos = true;
        const data = evento.payload;

        // Actualizamos los signals silenciosamente dependiendo de qué cambió el otro admin
        if (data.tipo === 'CAMPOS') {
          this.camposPorPaso.update(map => ({ ...map, [data.pasoId]: data.campos }));
        } else if (data.tipo === 'RESPONSABLE') {
          this.responsablesPorPaso.update(map => ({ ...map, [data.pasoId]: data.responsable }));
        } else if (data.tipo === 'VISIBLES') {
          this.camposVisiblesPorPaso.update(map => ({ ...map, [data.pasoId]: data.visibles }));
        }
        
        this.hayCambiosPendientes.set(true);
        
        // Liberar el candado (evita que re-emitamos el cambio que acabamos de recibir)
        setTimeout(() => this.aplicandoMetadatosRemotos = false, 150);
      });

      // Verificar si hay borrador colaborativo pendiente
      this.procesoService.obtenerBorrador(procesoId).subscribe({
        next: (resp) => {
          if (resp.hayBorradorReciente && resp.borradorXml &&
            this.procesoEditando()?.bpmnXml !== resp.borradorXml) {
            // Hay un borrador distinto al XML guardado → preguntar al usuario
            this.borradorPendiente.set({
              borradorXml: resp.borradorXml,
              borradorPor: resp.borradorPor || 'desconocido',
              fechaUltimoBorrador: resp.fechaUltimoBorrador || ''
            });
            this.mostrarModalBorrador.set(true);
          } else {
            this.confirmarEntradaSala(procesoId);
          }
        },
        error: () => this.confirmarEntradaSala(procesoId)
      });
    } catch (e) {
      this.mostrarToast('error', 'Error', 'No se pudo iniciar la sesión colaborativa');
    }
  }

  private async confirmarEntradaSala(procesoId: string): Promise<void> {
    try {
      await this.colaboracionService.unirseSala(procesoId);
      this.modoColaborativo.set(true);
      this.mostrarToast('ok', '🤝 Sesión colaborativa', 'Ahora puedes editar en tiempo real con otros admins');
    } catch (e: any) {
      this.mostrarToast('error', 'Error', 'No se pudo unir a la sala: ' + (e.message || 'desconocido'));
    }
  }

  /**
   * Recuperar borrador: cargar el borradorXml en el editor y entrar a la sala.
   */
  recuperarBorrador(): void {
    const pend = this.borradorPendiente();
    if (!pend) return;

    this.xmlActual.set(pend.borradorXml);
    this.mostrarModalBorrador.set(false);
    this.borradorPendiente.set(null);

    const procesoId = this.procesoEditando()?.id;
    if (procesoId) this.confirmarEntradaSala(procesoId);
  }

  /**
   * Descartar borrador: ignorar el borrador y entrar a la sala con el XML oficial.
   */
  descartarBorrador(): void {
    const procesoId = this.procesoEditando()?.id;
    this.mostrarModalBorrador.set(false);
    this.borradorPendiente.set(null);
    if (procesoId) this.confirmarEntradaSala(procesoId);
  }

  /**
   * Sale de la sala colaborativa actual.
   */
  salirCoEdicion(): void {
    this.colaboracionService.salirSala();
    this.modoColaborativo.set(false);
    this.mostrarToast('info', 'Sesión cerrada', 'Saliste de la sesión colaborativa');
  }

  /**
   * Abre el modal de invitación.
   */
  abrirModalInvitar = (): void => {
    this.mostrarInvitar.set(true);
  };

  cerrarModalInvitar(): void {
    this.mostrarInvitar.set(false);
  }

  /**
   * Acepta una invitación entrante (desde notificación in-app).
   */
  aceptarInvitacion(notif: any): void {
    this.colaboracionService.marcarNotificacionLeida(notif.timestamp);
    // Navegar a la URL con el token (entra automáticamente vía guard)
    this.router.navigate(['/colaborar', notif.token]);
  }

  rechazarInvitacion(timestamp: number): void {
    this.colaboracionService.marcarNotificacionLeida(timestamp);
  }

  /**
   * Override de cerrarCreador para salir de la sala primero.
   */
  private cerrarCreadorConSalida(): void {
    if (this.modoColaborativo()) {
      this.salirCoEdicion();
    }
  }
  // ============================================================================
  //  👇 NUEVO UX: Modo Foco + Drawer + persistencia
  // ============================================================================

  toggleDrawerMetadatos(): void {
    this.drawerMetadatosAbierto.update(v => !v);
    localStorage.setItem('ui_drawer_metadatos', this.drawerMetadatosAbierto() ? 'true' : 'false');
  }

  toggleModoFoco(): void {
    const nuevo = !this.modoFoco();
    this.modoFoco.set(nuevo);
    if (nuevo) {
      // Entrar a modo foco: cerrar drawer y colapsar sidebar
      this.drawerMetadatosAbierto.set(false);
      this.layoutService.colapsarSidebar();
      this.mostrarToast('info', 'Modo Foco activado', 'Presiona Esc o F para salir', 2500);
    } else {
      // Salir: NO restauramos drawer (usuario decide). Sí restauramos sidebar.
      // Solo restauramos sidebar si el usuario lo tenía expandido antes
      if (this.estadoSidebarPrevio === false) {
        this.layoutService.expandirSidebar();
      }
    }
  }


  private cargarEstadoDrawer(): boolean {
    const v = localStorage.getItem('ui_drawer_metadatos');
    return v === null ? true : v === 'true';
  }
  svgSeguro(svgRaw: string | undefined): SafeHtml {
    if (!svgRaw) return '';
    return this.sanitizer.bypassSecurityTrustHtml(svgRaw);
  }

  /** Actualiza el svgPreview en el signal local cuando el thumbnail lo genera al vuelo. */
  guardarPreviewLocal(proceso: ProcesoDefinicion, svg: string): void {
    this.procesos.update(lista =>
      lista.map(p => p.id === proceso.id ? { ...p, svgPreview: svg } : p)
    );
  }

  // ============================================================================
  //  CU20: Historial de versiones
  // ============================================================================

  verVersiones(p: ProcesoDefinicion, event?: Event): void {
    event?.stopPropagation();
    this.mostrandoVersiones.set(p);
    this.procesoVersiones.set([]);
    this.versionXmlVisible.set(null);
    this.auditoriaVersion.set({});
    const codigoBase = p.codigoBase || p.codigo;
    if (!codigoBase) return;
    this.cargandoVersiones.set(true);
    this.procesoService.obtenerVersiones(codigoBase).subscribe({
      next:  (vers) => { this.procesoVersiones.set(vers); this.cargandoVersiones.set(false); },
      error: ()     => { this.cargandoVersiones.set(false); this.mostrarToast('error', 'Error', 'No se pudo cargar el historial de versiones'); }
    });
  }

  cerrarVersiones(): void {
    this.mostrandoVersiones.set(null);
    this.procesoVersiones.set([]);
    this.versionXmlVisible.set(null);
    this.auditoriaVersion.set({});
  }

  toggleXmlVersion(v: ProcesoDefinicion): void {
    this.versionXmlVisible.set(this.versionXmlVisible()?.id === v.id ? null : v);
  }

  toggleAuditoriaVersion(v: ProcesoDefinicion): void {
    if (!v.id) return;
    const actual = this.auditoriaVersion();
    if (actual[v.id] !== undefined) {
      const copia = { ...actual };
      delete copia[v.id];
      this.auditoriaVersion.set(copia);
    } else {
      this.cargandoAuditoriaId.set(v.id);
      this.auditoriaService.porEntidad(v.id).subscribe({
        next:  (logs) => { this.cargandoAuditoriaId.set(null); this.auditoriaVersion.update(m => ({ ...m, [v.id!]: logs })); },
        error: ()     => { this.cargandoAuditoriaId.set(null); this.mostrarToast('error', 'Error', 'No se pudo cargar la auditoría de esta versión'); }
      });
    }
  }

  formatearFechaV(iso?: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-BO', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  }
  // ============================================================================
  //  👇 NUEVO UX: PANTALLA COMPLETA Y PUENTE MÁGICO
  // ============================================================================

  togglePantallaCompleta(): void {
    if (!document.fullscreenElement) {
      this.contenedorPantallaCompleta?.nativeElement.requestFullscreen().catch(() => {
        this.mostrarToast('error', 'Error', 'Tu navegador bloqueó la pantalla completa');
      });
    } else {
      document.exitFullscreen();
    }
  }

  // ── Tour ─────────────────────────────────────────────────────────────────
  tourActive = signal(false);
  tourStep   = signal(0);
  tourRect   = signal<DOMRect | null>(null);

  readonly tourPasos = [
    { id: 'tour-ap-nueva',   icono: '➕', titulo: 'Nueva Política',        desc: 'Crea un borrador de proceso BPMN desde cero. Pasarás por 5 pasos: información, diagrama, áreas, formularios y publicación.' },
    { id: 'tour-ap-stats',   icono: '📊', titulo: 'Resumen de Políticas',  desc: 'Totales en tiempo real: cuántas políticas existen, cuántas están activas, inactivas y el total acumulado de pasos entre todos los flujos.' },
    { id: 'tour-ap-busqueda',icono: '🔍', titulo: 'Buscar Políticas',      desc: 'Filtra por código, nombre o descripción. La búsqueda es instantánea mientras escribes.' },
    { id: 'tour-ap-filtros', icono: '🏷️', titulo: 'Filtrar por Estado',    desc: 'Muestra solo Borradores (editables), Activas (en producción) u Obsoletas (reemplazadas por versiones nuevas).' },
    { id: 'tour-ap-vistas',  icono: '🗂️', titulo: 'Vista Tarjetas / Tabla', desc: 'Cambia entre vista de tarjetas con previsualización del diagrama BPMN o tabla compacta. Tu preferencia se guarda automáticamente.' },
    { id: 'tour-ap-grid',    icono: '📋', titulo: 'Lista de Políticas',     desc: 'Haz clic en una tarjeta para editarla si es Borrador. Las Activas requieren "Nueva Versión" para editar. Usa "Historial" para ver versiones anteriores.' },
  ];

  get tourPasoActual()  { return this.tourPasos[this.tourStep()]; }
  get esUltimoPasoTour(){ return this.tourStep() === this.tourPasos.length - 1; }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onTourLayout(): void { if (this.tourActive()) this.actualizarRectTour(); }

  iniciarTour(): void {
    this.tourActive.set(true);
    this.tourStep.set(0);
    setTimeout(() => this.irAlPasoTour(0), 100);
  }

  siguientePasoTour(): void {
    if (this.esUltimoPasoTour) { this.cerrarTour(); return; }
    const next = this.tourStep() + 1;
    this.tourStep.set(next);
    setTimeout(() => this.irAlPasoTour(next), 150);
  }

  anteriorPasoTour(): void {
    if (this.tourStep() === 0) return;
    const prev = this.tourStep() - 1;
    this.tourStep.set(prev);
    setTimeout(() => this.irAlPasoTour(prev), 150);
  }

  cerrarTour(): void {
    this.tourActive.set(false);
    this.tourRect.set(null);
  }

  private irAlPasoTour(paso: number): void {
    const el = document.getElementById(this.tourPasos[paso].id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => this.actualizarRectTour(), 450);
    } else {
      this.tourRect.set(null);
    }
  }

  private actualizarRectTour(): void {
    if (!this.tourActive()) return;
    const el = document.getElementById(this.tourPasoActual.id);
    this.tourRect.set(el ? el.getBoundingClientRect() : null);
  }
  // ─────────────────────────────────────────────────────────────────────────

  irAFormularioDesdeDiagrama(tareaId: string): void {
    const paso = this.pasosDetectados().find(p => p.id === tareaId);
    
    if (paso) {
      // 1. Si estaba en fullscreen, salimos suavemente
      if (document.fullscreenElement) document.exitFullscreen();
      
      // 2. Seteamos el paso y cambiamos de tab
      this.pasoSeleccionado.set(paso);
      this.pasoActual.set(4);
      this.cambiarTab('formularios');
      this.mostrarToast('info', 'Constructor abierto', `Configurando formulario para: ${paso.nombre}`);
    } else {
      this.mostrarToast('warning', 'Paso no detectado', 'Guarda el diagrama primero o mueve ligeramente la tarea para que el sistema la registre.');
    }
  }
}