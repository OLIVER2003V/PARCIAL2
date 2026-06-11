import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy,
  Input, Output, EventEmitter, inject, PLATFORM_ID, signal, SimpleChanges, OnChanges, HostListener
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ColaboracionService } from '../../services/colaboracion';
import { EventoXml } from '../../models/colaboracion.model';
import { CursorRemotoComponent } from '../cursor-remoto/cursor-remoto';
import {
  Graph, Cell, InternalEvent, UndoManager, RubberBandHandler, ConnectionHandler, SelectionHandler, type CellStyle
} from '@maxgraph/core';
import { registrarFormasUML } from './uml-shapes';
import { UmlActivitySerializer, type UmlCellValue } from './uml-serializer';
import {
  UML_ESTILOS, UML_TAMANOS, UML_TIPOS_NODO, UML_TIPOS_LABEL_EXTERNO,
  ENTRADAS_PALETA, type EntradaPaleta
} from './paleta-personalizada';

// Subclase de Graph que convierte valores UmlCellValue a string para el renderizado.
// Se usa subclase (no override de instancia) porque maxGraph llama convertValueToString
// desde el prototipo en ciertas rutas de render (swimlane header, edges) sin pasar por 'this'.
class GraphUML extends Graph {
  override convertValueToString(cell: Cell): string {
    const v = cell.getValue();
    if (v && typeof v === 'object') {
      const uv = v as UmlCellValue;
      return uv.name || uv.guard || '';
    }
    return v != null ? String(v) : '';
  }
}

// ────────────────────────────────────────────────────────────────────────────────
//  Constantes de layout — ajustar aquí para tunear el diagrama.
// ────────────────────────────────────────────────────────────────────────────────
const LAYOUT = {
  TAREA_W:            160,
  TAREA_H:            56,
  EVENTO_SIZE:        30,
  GATEWAY_SIZE:       50,
  FORK_W:             120,
  FORK_H:             8,
  STRIDE:             120,   // gap vertical entre niveles; nodos paralelos van LADO A LADO
  PARALLEL_GAP:       16,    // gap horizontal entre nodos paralelos en el mismo nivel/carril
  PADDING_TOP_NODOS:  70,
  PADDING_BOTTOM:     60,
  HEADER_LANE:        30,
  LANE_ANCHO_MIN:     200,
  LANE_ANCHO_MAX:     600,   // ampliado para acomodar nodos paralelos
  LANE_LATERAL_PAD:   20,
  NODO_CHAR_W:        9,
  NODO_TEXT_PAD:      44,
  NODO_MIN_W:         110,
  WP_GAP:             20,    // offset de waypoints en flechas cross-lane
} as const;

/** XML vacío inicial — actividad UML con particiones vacías. */
const XML_INICIAL = `<?xml version="1.0" encoding="UTF-8"?>
<umlActivity xmlns:uml="http://www.omg.org/spec/UML/20131001" id="Activity_1" name="Política de Negocio">
  <partitions/>
  <nodes/>
  <edges/>
</umlActivity>`;

@Component({
  selector: 'app-diagramador-bpmn',
  standalone: true,
  imports: [CommonModule, CursorRemotoComponent],
  templateUrl: './diagramador-bpmn.html',
  styleUrls: ['./diagramador-bpmn.css']
})
export class DiagramadorBpmnComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLDivElement>;

  @Input() xmlInicial: string | null = null;
  @Input() soloLectura = false;
  @Input() pasoActualId: string | null = null;
  @Input() pasosCompletados: string[] = [];
  @Input() modoColaborativo = false;
  @Input() departamentosDisponibles: string[] = [];

  modelerRef = signal<any>(null);

  @Output() guardar       = new EventEmitter<{ xml: string; svg: string }>();
  @Output() cambio        = new EventEmitter<string>();
  @Output() lanesCambiadas = new EventEmitter<string[]>();
  @Output() editarFormulario = new EventEmitter<string>();

  // Signals de estado
  zoomActual        = signal(100);
  canUndo           = signal(false);
  canRedo           = signal(false);
  mostrarLeyenda    = signal(false);
  mostrarAtajos     = signal(false);
  herramientaActiva = signal<string | null>(null);
  elementoSeleccionado = signal<{ tipo: string; nombre: string; id: string; esTarea?: boolean; esConexion?: boolean } | null>(null);
  posicionFlotante  = signal<{ x: number; y: number } | null>(null);
  elementoHover     = signal<{ tipo: string; descripcion: string; x: number; y: number } | null>(null);
  dropdownLane      = signal<{ laneId: string; x: number; y: number; nombreActual: string } | null>(null);
  busquedaDropdown     = signal('');
  estadisticasDiagrama = signal<{ carriles: number; nodos: number; conexiones: number }>({ carriles: 0, nodos: 0, conexiones: 0 });
  validacionAvisos     = signal<string[]>([]);
  mostrarValidacion    = signal(false);

  readonly entradasPaleta = ENTRADAS_PALETA;

  private graph: Graph | null = null;
  private undoManager: UndoManager | null = null;
  private serializer = new UmlActivitySerializer();
  private aplicandoCambioRemoto = false;
  private ignorarUndoCapture   = false; // evita que las operaciones del undo/redo se autocapturen
  private mouseMoveHandler: ((e: MouseEvent) => void) | null = null;
  private wheelHandler:     ((e: WheelEvent)  => void) | null = null;
  private cursorListenerAttached = false;
  private nodoOrigenConexion: Cell | null = null;
  private resizingSincronizacion           = false;
  private rerouteTimer: any                = null;
  private nodoOrigenConexionResaltado: Cell | null = null;
  condicionPendiente = signal<Cell | null>(null);

  private platformId  = inject(PLATFORM_ID);
  private colaboracionService = inject(ColaboracionService);

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    registrarFormasUML();

    const container = this.canvasRef.nativeElement;
    this.graph = new GraphUML(container);

    this.configurarGraph();
    this.configurarEstilos();

    if (!this.soloLectura) {
      new RubberBandHandler(this.graph);
      this.undoManager = new UndoManager(50);

      const undoListener = (_sender: any, evt: any) => {
        if (this.ignorarUndoCapture) return;
        const edit = evt.getProperty('edit');
        if (!edit) return;
        this.undoManager!.undoableEditHappened(edit);
        this.canUndo.set(this.undoManager!.canUndo());
        this.canRedo.set(this.undoManager!.canRedo());
      };
      this.graph.getDataModel().addListener(InternalEvent.UNDO, undoListener);
      this.graph.getView().addListener(InternalEvent.UNDO, undoListener);
    }

    this.registrarListeners();

    // Rueda: Ctrl+Scroll → zoom anclado al cursor; Scroll → pan
    this.wheelHandler = (e: WheelEvent) => this.onWheel(e);
    container.addEventListener('wheel', this.wheelHandler, { passive: false });

    this.cargarXml(this.xmlInicial ?? XML_INICIAL);

    if (this.modoColaborativo) this.activarColaboracion();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['pasoActualId'] || changes['pasosCompletados']) && this.graph) {
      setTimeout(() => this.aplicarResaltado(), 50);
    }
    if (changes['modoColaborativo'] && this.graph) {
      this.modoColaborativo ? this.activarColaboracion() : this.desactivarColaboracion();
    }
  }

  ngOnDestroy(): void {
    if (this.wheelHandler) {
      this.canvasRef?.nativeElement.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = null;
    }
    this.desactivarColaboracion();
    this.graph?.destroy();
  }

  // ── Inicialización maxGraph ───────────────────────────────────────────────────

  private configurarGraph(): void {
    const g = this.graph!;
    g.setPanning(true);
    g.setTooltips(false);
    g.setCellsEditable(true);
    g.setDisconnectOnMove(false);
    g.setSplitEnabled(false);
    g.setDropEnabled(true);
    g.setCellsCloneable(false);

    if (this.soloLectura) {
      g.setEnabled(false);
    } else {
      g.setConnectable(true);
      // Drag-to-connect desactivado: las conexiones solo se crean mediante el botón "Conectar"
      g.getPlugin<ConnectionHandler>(ConnectionHandler.pluginId)?.setEnabled(false);
      // Live preview al arrastrar nodos
      const sh = g.getPlugin<SelectionHandler>(SelectionHandler.pluginId);
      if (sh) sh.allowLivePreview = true;
    }

    // Qué celdas permiten edición de nombre con doble clic
    g.isCellEditable = (cell: Cell): boolean => {
      if (this.soloLectura) return false;
      const v = cell.getValue() as UmlCellValue | undefined;
      return v?.umlType !== 'ActivityPartition';
    };

    // Cuando el usuario confirma la edición inline, actualiza el objeto UmlCellValue
    const origCellLabelChanged = g.cellLabelChanged.bind(g);
    g.cellLabelChanged = (cell: Cell, newValue: string, autoSize: boolean) => {
      const v = cell.getValue();
      if (v && typeof v === 'object') {
        g.getDataModel().setValue(cell, { ...(v as UmlCellValue), name: newValue });
      } else {
        origCellLabelChanged(cell, newValue, autoSize);
      }
    };

    // Texto inicial mostrado en el input de edición al hacer doble clic
    g.getEditingValue = (cell: Cell, _evt?: any): string => {
      const v = cell.getValue();
      if (v && typeof v === 'object') return (v as UmlCellValue).name ?? '';
      return v != null ? String(v) : '';
    };
  }

  private configurarEstilos(): void {
    const ss = this.graph!.getStylesheet();

    // Edge por defecto
    ss.putDefaultEdgeStyle({
      edgeStyle:   'orthogonalEdgeStyle',
      rounded:     false,
      strokeColor: '#64748b',
      fontSize:    10,
      fontColor:   '#475569',
      endArrow:    'block',
      endFill:     true,
    } as any);

    // Vertex por defecto
    ss.putDefaultVertexStyle({
      fillColor:   '#ffffff',
      strokeColor: '#64748b',
      fontColor:   '#1e293b',
      fontSize:    12,
      fontStyle:   0,
      perimeter:   'rectanglePerimeter',
    } as any);
  }

  private registrarListeners(): void {
    const g = this.graph!;

    g.addListener(InternalEvent.SCALE, () => {
      const s = g.getView().getScale();
      this.zoomActual.set(Math.round(s * 100));
    });

    g.getSelectionModel().addListener(InternalEvent.CHANGE, () => {
      const celdas = g.getSelectionCells();
      if (celdas.length === 1) {
        const c = celdas[0];
        const v = c.getValue() as UmlCellValue | undefined;
        const umlType = v?.umlType ?? '';
        this.elementoSeleccionado.set({
          id:     c.getId() ?? '',
          tipo:   this.formatearTipo(umlType),
          nombre: v?.name ?? '(sin nombre)',
          esTarea: umlType === 'OpaqueAction' || umlType === 'AcceptEventAction',
          esConexion: c.isEdge()
        });
        // Posición del toolbar flotante: a la DERECHA del nodo seleccionado
        const state = g.getView().getState(c);
        if (state) {
          this.posicionFlotante.set({
            x: state.x + state.width + 10,
            y: state.y + state.height / 2,
          });
        }
      } else {
        this.elementoSeleccionado.set(null);
        this.posicionFlotante.set(null);
      }
    });

    if (!this.soloLectura) {
      g.getDataModel().addListener(InternalEvent.CHANGE, async () => {
        if (this.aplicandoCambioRemoto) return;
        const xml = this.serializer.serialize(g);
        this.cambio.emit(xml);
        this.lanesCambiadas.emit(this.obtenerNombresLanes());
        if (this.modoColaborativo && this.colaboracionService.procesoIdActivo()) {
          this.colaboracionService.emitirCambioXml(xml);
        }
        this.actualizarUndoRedo();
        this.actualizarEstadisticas();
        if (!this.resizingSincronizacion && !this.ignorarUndoCapture) {
          requestAnimationFrame(() => this.sincronizarPosicionesCarriles());
          this.reroutearFlechasDebounced();
        }
      });

      // Doble clic en partición → dropdown de departamento
      g.addListener(InternalEvent.DOUBLE_CLICK, (_sender: any, evt: any) => {
        const cell: Cell | null = evt.getProperty('cell');
        if (!cell) return;
        const v = cell.getValue() as UmlCellValue | undefined;
        if (v?.umlType === 'ActivityPartition') {
          evt.consume();
          this.abrirDropdownLane(cell);
        } else if (cell.isEdge()) {
          const srcUmlType = (cell.source?.getValue() as UmlCellValue | undefined)?.umlType;
          if (srcUmlType === 'DecisionNode') {
            evt.consume();
            this.condicionPendiente.set(cell);
          }
        }
      });

      // Nueva partición sin nombre → abrir dropdown
      g.addListener(InternalEvent.CELLS_ADDED, (_sender: any, evt: any) => {
        const cells: Cell[] = evt.getProperty('cells') ?? [];
        for (const c of cells) {
          const v = c.getValue() as UmlCellValue | undefined;
          if (v?.umlType === 'ActivityPartition' && !v.name) {
            setTimeout(() => this.abrirDropdownLane(c), 150);
          }
        }
      });
    }
  }

  // ── Carga / exportación ───────────────────────────────────────────────────────

  cargarXml(xml: string): void {
    if (!this.graph || !xml?.trim()) return;

    // La carga de XML no debe ocupar historial de undo
    this.ignorarUndoCapture = true;
    try {
      this.graph.batchUpdate(() => {
        const parent = this.graph!.getDefaultParent();
        this.graph!.removeCells(parent.children ?? [], true);
      });
      if (xml.includes('<umlActivity')) {
        this.serializer.deserialize(xml, this.graph, UML_ESTILOS);
      }
    } catch (e) {
      console.error('[Diagramador UML] Error al cargar XML:', e);
    } finally {
      this.ignorarUndoCapture = false;
      this.undoManager?.clear();
      this.canUndo.set(false);
      this.canRedo.set(false);
    }

    setTimeout(() => {
      this.graph!.fit();
      const view = (this.graph as any).view;
      if (view?.scale < 0.65) view.setScale(0.65);
      this.zoomActual.set(Math.round((view?.getScale?.() ?? 0.65) * 100));
      this.aplicarResaltado();
    }, 100);
  }

  async exportar(): Promise<void> {
    if (!this.graph) return;
    const xml = this.serializer.serialize(this.graph);
    const svg = this.exportarSVG();
    this.guardar.emit({ xml, svg });
  }

  private exportarSVG(): string {
    if (!this.graph) return '';
    try {
      const container = this.canvasRef.nativeElement;
      const svgEl = container.querySelector('svg');
      if (!svgEl) return '';
      let svg = new XMLSerializer().serializeToString(svgEl);
      svg = svg.replace(/<svg([^>]*)width="[^"]*"/, '<svg$1');
      svg = svg.replace(/<svg([^>]*)height="[^"]*"/, '<svg$1');
      return svg;
    } catch {
      return '';
    }
  }

  // ── Herramienta de inserción ──────────────────────────────────────────────────

  activarInsercion(tipo: string): void {
    this.herramientaActiva.set(tipo);
    this.canvasRef.nativeElement.style.cursor = 'crosshair';

    const handler = (_sender: any, evt: any) => {
      const tipoActivo = this.herramientaActiva();
      if (!tipoActivo) return;

      const cell: Cell | null = evt.getProperty('cell');
      const umlType = (cell?.getValue() as UmlCellValue | undefined)?.umlType;
      
      // Permitir insertar si el clic fue en el vacío o sobre un carril (ActivityPartition)
      if (cell && umlType !== 'ActivityPartition') {
        return;
      }

      const mouseEvent = evt.getProperty('event') as MouseEvent;
      const pt = this.graph!.getPointForEvent(mouseEvent);

      this.insertar(tipoActivo, pt.x, pt.y);
      this.herramientaActiva.set(null);
      this.canvasRef.nativeElement.style.cursor = 'default';
      this.graph!.removeListener(handler);
    };

    this.graph!.addListener(InternalEvent.CLICK, handler);
  }

  activarConexion(): void {
    this.herramientaActiva.set('connect');
    this.canvasRef.nativeElement.style.cursor = 'crosshair';
    
    // Si hay un nodo ya seleccionado, lo tomamos como origen para una conexión rápida (de 1 solo clic al destino)
    const seleccionadas = this.graph?.getSelectionCells() ?? [];
    if (seleccionadas.length === 1 && seleccionadas[0].isVertex()) {
      this.nodoOrigenConexion = seleccionadas[0];
    } else {
      this.nodoOrigenConexion = null;
    }

    const handler = (_sender: any, evt: any) => {
      if (this.herramientaActiva() !== 'connect') {
        this.graph!.removeListener(handler);
        return;
      }
      const cell: Cell | null = evt.getProperty('cell');
      if (cell && cell.isVertex() && (cell.getValue() as UmlCellValue)?.umlType !== 'ActivityPartition') {
        if (!this.nodoOrigenConexion) {
          this.nodoOrigenConexion = cell;
          this.resaltarNodoConexion(cell);
        } else {
          if (this.nodoOrigenConexion !== cell) {
            const val: UmlCellValue = { umlType: 'ControlFlow', name: '' };
            const edge = this.graph!.insertEdge(this.graph!.getDefaultParent(), null, val, this.nodoOrigenConexion, cell, UML_ESTILOS['ControlFlow']);
            if ((this.nodoOrigenConexion?.getValue() as UmlCellValue)?.umlType === 'DecisionNode') {
              this.condicionPendiente.set(edge);
            }
          }
          this.cancelarHerramienta();
          this.graph!.removeListener(handler);
          requestAnimationFrame(() => this.reroutearFlechas());
        }
      } else if (!cell) {
        this.cancelarHerramienta();
        this.graph!.removeListener(handler);
      }
    };
    this.graph!.addListener(InternalEvent.CLICK, handler);
  }

  cancelarHerramienta(): void {
    this.herramientaActiva.set(null);
    this.nodoOrigenConexion = null;
    this.resaltarNodoConexion(null);
    this.canvasRef.nativeElement.style.cursor = 'default';
  }

  private insertar(tipo: string, absX: number, absY: number): void {
    if (!this.graph) return;
    const tam = UML_TAMANOS[tipo] ?? { w: 120, h: 60 };
    const estilo = UML_ESTILOS[tipo] ?? UML_ESTILOS['OpaqueAction'];
    
    // Asignar un nombre visual por defecto si no es un bloque que oculta sus labels
    const omitirNombre = tipo === 'ActivityPartition' || (estilo as any).noLabel;
    const val: UmlCellValue = { umlType: tipo, name: omitirNombre ? '' : this.formatearTipo(tipo) };

    // ¿Hay una partición que contenga ese punto?
    const particion = this.obtenerParticionEnPunto(absX, absY);

    if (!particion && tipo !== 'ActivityPartition' && tipo !== 'Note') {
      alert('Debes insertar el nodo dentro de un carril (departamento).');
      return;
    }

    this.graph.batchUpdate(() => {
      if (particion) {
        const pGeo = particion.getGeometry()!;
        const relX = absX - pGeo.x - (tam.w / 2);
        const relY = absY - pGeo.y - (tam.h / 2);
        this.graph!.insertVertex(particion, null, val, relX, relY, tam.w, tam.h, estilo);
      } else {
        const x = absX - tam.w / 2;
        const y = absY - tam.h / 2;
        this.graph!.insertVertex(this.graph!.getDefaultParent(), null, val, x, y, tam.w, tam.h, estilo);
      }
    });
  }

  agregarParticion(): void {
    if (!this.graph) return;
    const lanes = this.getLanes();
    const x = lanes.length === 0 ? 160 : lanes[lanes.length - 1].getGeometry()!.x + lanes[lanes.length - 1].getGeometry()!.width;
    const y = lanes.length === 0 ? 80 : lanes[0].getGeometry()!.y;
    const h = lanes.length === 0 ? 600 : lanes[0].getGeometry()!.height;
    const val: UmlCellValue = { umlType: 'ActivityPartition', name: '' };
    const cell = this.graph.insertVertex(this.graph.getDefaultParent(), null, val, x, y, LAYOUT.LANE_ANCHO_MIN, h, UML_ESTILOS['ActivityPartition']);
    setTimeout(() => this.abrirDropdownLane(cell), 150);
  }

  // ── API pública — gestión de particiones ─────────────────────────────────────

  agregarLanePorNombre(nombre: string): boolean {
    if (!this.graph || this.existeLane(nombre)) return false;
    const lanes = this.getLanes();
    const x = lanes.length === 0 ? 160 : lanes[lanes.length - 1].getGeometry()!.x + lanes[lanes.length - 1].getGeometry()!.width;
    const y = lanes[0]?.getGeometry()?.y ?? 80;
    // Usar la altura real del pool si ya hay nodos; si no, una altura inicial razonable
    const todosNodos = this.getTodosNodos();
    const h = todosNodos.length > 0
      ? this.calcularAlturaDesdeNiveles(this.asignarNivelesGlobales(todosNodos, this.getEdges()))
      : (lanes[0]?.getGeometry()?.height ?? 480);
    const val: UmlCellValue = { umlType: 'ActivityPartition', name: nombre };
    this.graph.insertVertex(this.graph.getDefaultParent(), null, val, x, y, LAYOUT.LANE_ANCHO_MIN, h, UML_ESTILOS['ActivityPartition']);
    return true;
  }

  eliminarLanePorNombre(nombre: string): boolean {
    if (!this.graph) return false;
    const lane = this.getLanes().find(l => (l.getValue() as UmlCellValue)?.name === nombre);
    if (!lane) return false;
    this.graph.removeCells([lane], true);
    return true;
  }

  obtenerNombresLanes(): string[] {
    return this.getLanes()
      .map(l => (l.getValue() as UmlCellValue)?.name ?? '')
      .filter(n => n.length > 0);
  }

  // ── Heatmap y resaltado ───────────────────────────────────────────────────────

  private aplicarResaltado(): void {
    if (!this.graph) return;
    const todos = this.getTodosNodos();

    for (const n of todos) {
      const id = n.getId() ?? '';
      const esCurrent   = id === this.pasoActualId;
      const esCompletado = this.pasosCompletados.includes(id);
      // En maxGraph se usa style overrides para marcadores
      const s = this.graph!.getCellStyle(n);
      const base = { ...(UML_ESTILOS[(n.getValue() as UmlCellValue)?.umlType] ?? {}) };
      if (esCurrent)    { (base as any).strokeColor = '#f97316'; (base as any).strokeWidth = 3; }
      if (esCompletado) { (base as any).strokeColor = '#10b981'; (base as any).strokeWidth = 2; }
      this.graph!.getDataModel().setStyle(n, base as CellStyle);
    }
    this.graph!.refresh();
  }

  aplicarHeatmap(metricas: any[]): void {
    if (!this.graph) return;
    for (const m of metricas) {
      const cell = this.getCellById(m.pasoId);
      if (!cell) continue;
      const colorMap: Record<string, string> = { verde: '#10b981', amarillo: '#f59e0b', rojo: '#ef4444' };
      const base = { ...(UML_ESTILOS[(cell.getValue() as UmlCellValue)?.umlType] ?? {}) };
      (base as any).strokeColor = colorMap[m.colorSemaforo?.toLowerCase()] ?? '#64748b';
      (base as any).strokeWidth = 3;
      this.graph!.getDataModel().setStyle(cell, base as CellStyle);
    }
    this.graph!.refresh();
  }

  /** Centra la vista del diagrama sobre el nodo con el ID dado. */
  centrarEnNodo(pasoId: string): void {
    if (!this.graph) return;
    const cell = this.getCellById(pasoId);
    if (!cell) return;
    this.graph.setSelectionCell(cell);
    this.graph.scrollCellToVisible(cell, true);
  }

  // ── Auto-organización ─────────────────────────────────────────────────────────

  autoOrganizar(): void {
    if (!this.graph) return;
    const lanes = this.getLanes();
    if (lanes.length === 0) return;

    const todosNodos  = this.getTodosNodos();
    if (todosNodos.length === 0) return;

    const edges        = this.getEdges();
    const niveles      = this.asignarNivelesGlobales(todosNodos, edges);
    const maxNivel     = niveles.size > 0 ? Math.max(...niveles.values()) : 0;
    const nodosPorLane = this.agruparNodosPorLane(lanes);

    // Construir conteos por (carril, nivel) para calcular alturas dinámicas
    const conteosPorLane = new Map<string, Map<number, number>>();
    for (const [laneId, nds] of nodosPorLane) {
      const lm = new Map<number, number>();
      for (const n of nds) {
        const nv = niveles.get(n.getId()!) ?? 0;
        lm.set(nv, (lm.get(nv) ?? 0) + 1);
      }
      conteosPorLane.set(laneId, lm);
    }

    const { infoNiveles, alturaTotal } = this.calcularInfoNiveles(maxNivel, conteosPorLane);
    const anchoPorLane   = this.calcularAnchoPorLaneConNiveles(nodosPorLane, niveles);
    const lanesOrdenados = this.ordenarLanesParaLayout(lanes);

    this.ignorarUndoCapture = true;
    this.reposicionarLanes(lanesOrdenados, anchoPorLane, alturaTotal);
    this.posicionarPorNivelesGlobales(lanesOrdenados, nodosPorLane, niveles, infoNiveles);

    requestAnimationFrame(() => {
      this.reroutearFlechas();
      requestAnimationFrame(() => {
        this.graph!.fit();
        const view = (this.graph as any).view;
        if (view?.scale < 0.65) view.setScale(0.65);
        this.zoomActual.set(Math.round((view?.getScale?.() ?? 0.65) * 100));
        this.exportar();
        this.ignorarUndoCapture = false;
      });
    });
  }

  // ── Helpers de layout global (Sugiyama simplificado) ─────────────────────────

  /** Asigna a cada nodo el nivel de "camino más largo" desde cualquier raíz.
   *  Esto garantiza que dos nodos al mismo "paso lógico" queden a la misma Y
   *  aunque estén en carriles distintos, eliminando el cruce de aristas. */
  private asignarNivelesGlobales(nodos: Cell[], edges: Cell[]): Map<string, number> {
    const ids   = new Set(nodos.map(n => n.getId()!));
    const succs = new Map<string, string[]>();
    const inDeg = new Map<string, number>();

    for (const n of nodos) { succs.set(n.getId()!, []); inDeg.set(n.getId()!, 0); }

    for (const e of edges) {
      const s = e.source?.getId();
      const t = e.target?.getId();
      if (!s || !t || !ids.has(s) || !ids.has(t)) continue;
      succs.get(s)!.push(t);
      inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
    }

    const niveles = new Map<string, number>();
    const queue: string[] = [];
    for (const [id, deg] of inDeg) {
      if (deg === 0) { queue.push(id); niveles.set(id, 0); }
    }

    while (queue.length > 0) {
      const actual     = queue.shift()!;
      const nivelActual = niveles.get(actual) ?? 0;
      for (const succ of succs.get(actual) ?? []) {
        // Nivel = máximo de todos los predecesores + 1 (camino más largo)
        const nv = nivelActual + 1;
        if (!niveles.has(succ) || niveles.get(succ)! < nv) niveles.set(succ, nv);
        inDeg.set(succ, (inDeg.get(succ) ?? 1) - 1);
        if (inDeg.get(succ) === 0) queue.push(succ);
      }
    }

    // Segunda pasada: nodos que quedaron sin nivel porque forman parte de ciclos
    // (back-edges como "Solicitar Documentos → Verificar").
    // Se itera ignorando las aristas de retorno y asignando nivel = maxPredecesorConocido + 1.
    let pasadoCiclo = true;
    while (pasadoCiclo) {
      pasadoCiclo = false;
      for (const n of nodos) {
        if (niveles.has(n.getId()!)) continue;
        let maxPred = -1;
        for (const e of edges) {
          const s = e.source?.getId();
          const t = e.target?.getId();
          if (t === n.getId()! && s && niveles.has(s)) {
            maxPred = Math.max(maxPred, niveles.get(s)!);
          }
        }
        if (maxPred >= 0) { niveles.set(n.getId()!, maxPred + 1); pasadoCiclo = true; }
      }
    }
    // Nodos verdaderamente desconectados: todos al mismo nivel, lado a lado
    const maxNAntes = niveles.size > 0 ? Math.max(...niveles.values()) : -1;
    const nivelHuerfanos = maxNAntes + 1;
    for (const n of nodos) {
      if (!niveles.has(n.getId()!)) niveles.set(n.getId()!, nivelHuerfanos);
    }
    // Forzar nodos de fin al nivel más bajo (siempre al fondo del diagrama)
    const nivelMaxFin = niveles.size > 0 ? Math.max(...niveles.values()) : 0;
    for (const n of nodos) {
      const t = (n.getValue() as UmlCellValue)?.umlType;
      if ((t === 'ActivityFinalNode' || t === 'FlowFinalNode') && (niveles.get(n.getId()!) ?? 0) < nivelMaxFin) {
        niveles.set(n.getId()!, nivelMaxFin + 1);
      }
    }
    return niveles;
  }

  /** Posiciona cada nodo según su nivel global usando los yBase dinámicos
   *  de `infoNiveles`, apilando verticalmente los nodos paralelos del mismo
   *  carril/nivel sin que se solapen. */
  private posicionarPorNivelesGlobales(
    lanesOrdenados: Cell[],
    nodosPorLane:   Map<string, Cell[]>,
    niveles:        Map<string, number>,
    infoNiveles:    Map<number, { yBase: number; alturaSlot: number }>
  ): void {
    this.graph!.batchUpdate(() => {
      for (const lane of lanesOrdenados) {
        const nodos  = nodosPorLane.get(lane.getId()!) ?? [];
        if (nodos.length === 0) continue;
        const laneGeo = lane.getGeometry()!;

        // Agrupar nodos de este carril por nivel
        const porNivel = new Map<number, Cell[]>();
        for (const n of nodos) {
          const nivel = niveles.get(n.getId()!) ?? 0;
          if (!porNivel.has(nivel)) porNivel.set(nivel, []);
          porNivel.get(nivel)!.push(n);
        }

        for (const [nivel, nodosEnNivel] of porNivel) {
          const info  = infoNiveles.get(nivel);
          const yBase = info?.yBase ?? (LAYOUT.HEADER_LANE + LAYOUT.PADDING_TOP_NODOS + nivel * LAYOUT.STRIDE);

          // Calcular anchos individuales para distribución lado a lado
          const widths = nodosEnNivel.map(n => {
            const val = n.getValue() as UmlCellValue;
            return this.calcularAnchoNodo(val.name ?? '', laneGeo.width, val.umlType ?? 'OpaqueAction');
          });
          const totalW = widths.reduce((s, w) => s + w, 0)
            + (nodosEnNivel.length - 1) * LAYOUT.PARALLEL_GAP;
          let xCursor  = Math.max(LAYOUT.LANE_LATERAL_PAD, (laneGeo.width - totalW) / 2);

          for (let i = 0; i < nodosEnNivel.length; i++) {
            const n   = nodosEnNivel[i];
            const geo = n.getGeometry()!.clone();
            geo.width = widths[i];
            geo.x     = xCursor;
            geo.y     = yBase;
            this.graph!.getDataModel().setGeometry(n, geo);
            xCursor += widths[i] + LAYOUT.PARALLEL_GAP;
          }
        }
      }
    });
  }

  /**
   * Calcula, para cada nivel topológico, la posición Y de inicio (yBase) y
   * la altura del slot, teniendo en cuenta que puede haber varios nodos
   * apilados verticalmente en el mismo carril/nivel (ramas paralelas).
   *
   * @param maxNivel  nivel máximo presente en el diagrama
   * @param conteos   Map<laneKey, Map<nivel, cantidad_de_nodos>>
   * @returns infoNiveles y alturaTotal del carril
   */
  /**
   * Calcula la posición Y de inicio (yBase) de cada nivel.
   * Los nodos paralelos van LADO A LADO (mismo Y), por lo que el stride
   * es fijo e independiente del número de nodos paralelos.
   * El ancho del carril es quien crece cuando hay nodos paralelos.
   */
  private calcularInfoNiveles(
    maxNivel: number,
    _conteos: Map<string, Map<number, number>>
  ): { infoNiveles: Map<number, { yBase: number; alturaSlot: number }>; alturaTotal: number } {
    const infoNiveles = new Map<number, { yBase: number; alturaSlot: number }>();
    let yCursor = LAYOUT.HEADER_LANE + LAYOUT.PADDING_TOP_NODOS;
    for (let n = 0; n <= maxNivel; n++) {
      infoNiveles.set(n, { yBase: yCursor, alturaSlot: LAYOUT.STRIDE });
      yCursor += LAYOUT.STRIDE;
    }
    return { infoNiveles, alturaTotal: yCursor + LAYOUT.PADDING_BOTTOM };
  }

  private calcularAlturaDesdeNiveles(niveles: Map<string, number>): number {
    if (niveles.size === 0) return 400;
    const maxNivel = Math.max(...niveles.values());
    const { alturaTotal } = this.calcularInfoNiveles(maxNivel, new Map());
    return alturaTotal;
  }

  /** Calcula el ancho de cada carril considerando que nodos paralelos
   *  (mismo nivel, mismo carril) van LADO A LADO: el carril crece horizontalmente. */
  private calcularAnchoPorLaneConNiveles(
    nodosPorLane: Map<string, Cell[]>,
    niveles:      Map<string, number>
  ): Map<string, number> {
    const mapa = new Map<string, number>();
    for (const [id, nodos] of nodosPorLane.entries()) {
      // Agrupar nodos por nivel
      const porNivel = new Map<number, Cell[]>();
      for (const n of nodos) {
        const nv = niveles.get(n.getId()!) ?? 0;
        if (!porNivel.has(nv)) porNivel.set(nv, []);
        porNivel.get(nv)!.push(n);
      }

      let maxW: number = LAYOUT.LANE_ANCHO_MIN;
      for (const nodosNivel of porNivel.values()) {
        // Ancho total del nivel = suma de anchos individuales + gaps entre nodos + padding lateral
        const widths = nodosNivel.map(n => {
          const val = n.getValue() as UmlCellValue;
          // Usar anchoParaCarril (considera texto de gateways) para dimensionar la lane
          return this.anchoParaCarril(val.name ?? '', val.umlType ?? 'OpaqueAction');
        });
        const row = widths.reduce((s, w) => s + w, 0)
          + (nodosNivel.length - 1) * LAYOUT.PARALLEL_GAP
          + LAYOUT.LANE_LATERAL_PAD * 2;
        if (row > maxW) maxW = row;
      }
      mapa.set(id, Math.min(LAYOUT.LANE_ANCHO_MAX, maxW));
    }
    return mapa;
  }

  private getEdges(): Cell[] {
    const edges: Cell[] = [];
    for (const cell of this.graph!.getDefaultParent().children ?? []) {
      if (cell.isEdge()) {
        edges.push(cell);
      } else if (cell.isVertex()) {
        // maxGraph reparents edges to their lane when source+target share the same lane
        for (const child of cell.children ?? []) {
          if (child.isEdge()) edges.push(child);
        }
      }
    }
    return edges;
  }

  /**
   * Calcula el ancho adecuado para un nodo según el tipo y la longitud del texto.
   * Para nodos sin texto (eventos, forks) devuelve el tamaño fijo del tipo.
   * Para nodos de texto (acciones, gateways con label) el ancho es proporcional
   * al número de caracteres, clampeado para que nunca supere el carril.
   */
  /** Ancho del SHAPE del nodo — lo que ocupa visualmente la figura en el carril. */
  private calcularAnchoNodo(nombre: string, anchoCarril: number, umlTipo: string): number {
    if (['InitialNode', 'ActivityFinalNode', 'FlowFinalNode'].includes(umlTipo)) {
      return UML_TAMANOS[umlTipo]?.w ?? LAYOUT.EVENTO_SIZE;
    }
    if (['ForkNode', 'JoinNode'].includes(umlTipo)) {
      return UML_TAMANOS[umlTipo]?.w ?? LAYOUT.FORK_W;
    }
    if (['DecisionNode', 'MergeNode'].includes(umlTipo)) {
      // El rombo es pequeño; el texto va debajo mediante estilo externo
      return UML_TAMANOS[umlTipo]?.w ?? 44;
    }
    const desired = Math.max(LAYOUT.NODO_MIN_W, nombre.length * LAYOUT.NODO_CHAR_W + LAYOUT.NODO_TEXT_PAD);
    return Math.min(desired, Math.max(LAYOUT.NODO_MIN_W, anchoCarril - LAYOUT.LANE_LATERAL_PAD * 2));
  }

  /** Ancho que un nodo NECESITA en el carril para verse bien, considerando
   *  también el texto externo de gateways y el tamaño de eventos.
   *  Se usa para calcular el ancho del carril, no el shape en sí. */
  private anchoParaCarril(nombre: string, umlTipo: string): number {
    if (['ForkNode', 'JoinNode', 'InitialNode', 'ActivityFinalNode', 'FlowFinalNode'].includes(umlTipo)) {
      return UML_TAMANOS[umlTipo]?.w ?? LAYOUT.EVENTO_SIZE;
    }
    // Para gateways: el rombo es pequeño pero el texto va debajo → usar texto como referencia
    // Para acciones: igual que calcularAnchoNodo sin clampear
    return Math.max(LAYOUT.NODO_MIN_W, nombre.length * LAYOUT.NODO_CHAR_W + LAYOUT.NODO_TEXT_PAD);
  }

  /**
   * Calcula los niveles topológicos (camino más largo) directamente desde el JSON
   * devuelto por la IA, ANTES de insertar nodos en el grafo.
   * Permite posicionar los nodos verticalmente desde el primer insert,
   * evitando el efecto "todos en fila horizontal" del contador por carril.
   */
  private calcularNivelesJson(nodos: any[], conexiones: any[]): Map<string, number> {
    const ids   = new Set<string>(nodos.map((n: any) => n.id));
    const succs = new Map<string, string[]>();
    const inDeg = new Map<string, number>();

    for (const n of nodos) { succs.set(n.id, []); inDeg.set(n.id, 0); }
    for (const c of conexiones) {
      if (!ids.has(c.origen) || !ids.has(c.destino)) continue;
      succs.get(c.origen)!.push(c.destino);
      inDeg.set(c.destino, (inDeg.get(c.destino) ?? 0) + 1);
    }

    const niveles = new Map<string, number>();
    const queue: string[] = [];
    for (const [id, deg] of inDeg) {
      if (deg === 0) { queue.push(id); niveles.set(id, 0); }
    }
    while (queue.length > 0) {
      const actual  = queue.shift()!;
      const nAct    = niveles.get(actual) ?? 0;
      for (const succ of succs.get(actual) ?? []) {
        const nv = nAct + 1;
        if (!niveles.has(succ) || niveles.get(succ)! < nv) niveles.set(succ, nv);
        inDeg.set(succ, (inDeg.get(succ) ?? 1) - 1);
        if (inDeg.get(succ) === 0) queue.push(succ);
      }
    }
    // Segunda pasada: nodos bloqueados por ciclos (back-edges del proceso)
    let pasadoCiclo = true;
    while (pasadoCiclo) {
      pasadoCiclo = false;
      for (const n of nodos) {
        if (niveles.has(n.id)) continue;
        let maxPred = -1;
        for (const c of conexiones) {
          if (c.destino === n.id && niveles.has(c.origen)) {
            maxPred = Math.max(maxPred, niveles.get(c.origen)!);
          }
        }
        if (maxPred >= 0) { niveles.set(n.id, maxPred + 1); pasadoCiclo = true; }
      }
    }
    // Nodos verdaderamente desconectados: mismo nivel, lado a lado
    const maxNAntes = niveles.size > 0 ? Math.max(...niveles.values()) : -1;
    const nivelHuerfanos = maxNAntes + 1;
    for (const n of nodos) {
      if (!niveles.has(n.id)) niveles.set(n.id, nivelHuerfanos);
    }
    // Forzar nodos de fin al nivel más bajo
    const nivelMaxFin = niveles.size > 0 ? Math.max(...niveles.values()) : 0;
    for (const n of nodos) {
      if ((n.tipo === 'EndEvent' || n.tipo === 'ActivityFinalNode' || n.tipo === 'FlowFinalNode') && (niveles.get(n.id) ?? 0) < nivelMaxFin) {
        niveles.set(n.id, nivelMaxFin + 1);
      }
    }
    return niveles;
  }

  /** Devuelve true si el grafo no tiene ningún nodo (útil para detectar si
   *  la IA debe crear desde cero o editar el diagrama existente). */
  isEmpty(): boolean {
    return this.getTodosNodos().length === 0;
  }

  // ── IA Colaborativa ───────────────────────────────────────────────────────────

  /** Serializa el estado actual del grafo a un JSON compacto que la IA puede
   *  leer como contexto para ediciones colaborativas. */
  diagramToContext(): string {
    const lanes       = this.getLanes();
    const todosNodos  = this.getTodosNodos();
    const edges       = this.getEdges();

    const departamentos = lanes
      .map(l => (l.getValue() as UmlCellValue)?.name ?? '')
      .filter(n => n.length > 0);

    const nodos = todosNodos.map(n => {
      const val     = n.getValue() as UmlCellValue;
      const laneVal = (n.parent as Cell)?.getValue() as UmlCellValue;
      return {
        id:          n.getId() ?? '',
        nombre:      val.name ?? '',
        tipo:        val.umlType,
        departamento: laneVal?.name ?? ''
      };
    });

    const conexiones = edges
      .map(e => ({
        origen:    e.source?.getId() ?? '',
        destino:   e.target?.getId() ?? '',
        condicion: (e.getValue() as UmlCellValue)?.guard ?? ''
      }))
      .filter(c => c.origen && c.destino);

    return JSON.stringify({ departamentos, nodos, conexiones });
  }

  /** Aplica una lista de operaciones delta devueltas por el endpoint de edición IA.
   *  Orden de precedencia: AGREGAR_DEPARTAMENTO siempre primero (viene ya ordenado). */
  aplicarOperacionesIA(operaciones: any[]): { aplicadas: number; errores: string[] } {
    if (!this.graph || !operaciones?.length) return { aplicadas: 0, errores: [] };

    const errores: string[] = [];
    let aplicadas = 0;

    this.graph.batchUpdate(() => {
      for (const op of operaciones) {
        try {
          switch (op.tipo) {

            case 'AGREGAR_DEPARTAMENTO':
              this.agregarLanePorNombre(op.nombre ?? '');
              aplicadas++;
              break;

            case 'AGREGAR_NODO': {
              const lanes    = this.getLanes();
              const laneNorm = this.normalizarNombre(op.departamento ?? '');
              const lane     = lanes.find(l =>
                this.normalizarNombre((l.getValue() as UmlCellValue)?.name ?? '') === laneNorm
              ) ?? lanes[0];
              if (!lane) { errores.push(`AGREGAR_NODO ${op.id}: carril "${op.departamento}" no encontrado`); break; }

              const umlTipo = this.maparTipoIA(op.tipoNodo ?? 'UserTask');
              const tam     = UML_TAMANOS[umlTipo] ?? { w: LAYOUT.TAREA_W, h: LAYOUT.TAREA_H };
              const val: UmlCellValue = { umlType: umlTipo, name: op.nombre ?? '' };
              const laneGeo = lane.getGeometry()!;
              this.graph!.insertVertex(lane, op.id, val,
                (laneGeo.width - tam.w) / 2, LAYOUT.HEADER_LANE + 60,
                tam.w, tam.h, UML_ESTILOS[umlTipo] ?? UML_ESTILOS['OpaqueAction']);
              aplicadas++;
              break;
            }

            case 'AGREGAR_CONEXION': {
              const src = this.getCellById(op.origen);
              const tgt = this.getCellById(op.destino);
              if (!src || !tgt) { errores.push(`AGREGAR_CONEXION: nodo "${op.origen}" o "${op.destino}" no existe`); break; }
              const val: UmlCellValue = { umlType: 'ControlFlow', guard: op.condicion || undefined };
              this.graph!.insertEdge(this.graph!.getDefaultParent(), null, val, src, tgt, UML_ESTILOS['ControlFlow']);
              aplicadas++;
              break;
            }

            case 'ACTUALIZAR_NODO': {
              const cell = this.getCellById(op.id);
              if (!cell) { errores.push(`ACTUALIZAR_NODO: nodo "${op.id}" no existe`); break; }
              const oldVal = cell.getValue() as UmlCellValue;
              this.graph!.getDataModel().setValue(cell, { ...oldVal, name: op.nombre ?? oldVal.name });
              // Cambio de departamento: mover la celda al nuevo lane
              if (op.departamento) {
                const laneNorm = this.normalizarNombre(op.departamento);
                const nuevoLane = this.getLanes().find(l =>
                  this.normalizarNombre((l.getValue() as UmlCellValue)?.name ?? '') === laneNorm
                );
                if (nuevoLane && nuevoLane !== cell.parent) {
                  const laneGeo = nuevoLane.getGeometry()!;
                  const geo     = cell.getGeometry()!.clone();
                  geo.x = (laneGeo.width - geo.width) / 2;
                  geo.y = LAYOUT.HEADER_LANE + 60;
                  this.graph!.getDataModel().setGeometry(cell, geo);
                  this.graph!.getDataModel().add(nuevoLane, cell);
                }
              }
              aplicadas++;
              break;
            }

            case 'ELIMINAR_NODO': {
              const cell = this.getCellById(op.id);
              if (!cell) { errores.push(`ELIMINAR_NODO: nodo "${op.id}" no existe`); break; }
              this.graph!.removeCells([cell], true);
              aplicadas++;
              break;
            }

            case 'ELIMINAR_CONEXION': {
              const edge = this.getEdges().find(e =>
                e.source?.getId() === op.origen && e.target?.getId() === op.destino
              );
              if (!edge) { errores.push(`ELIMINAR_CONEXION: arista ${op.origen}→${op.destino} no existe`); break; }
              this.graph!.removeCells([edge], false);
              aplicadas++;
              break;
            }

            default:
              errores.push(`Operación desconocida: ${op.tipo}`);
          }
        } catch (e: any) {
          errores.push(`Error en ${op.tipo}: ${e?.message ?? e}`);
        }
      }
    });

    // Re-layout tras aplicar todas las operaciones
    requestAnimationFrame(() => requestAnimationFrame(() => this.autoOrganizar()));

    return { aplicadas, errores };
  }

  // ── Generación desde IA ───────────────────────────────────────────────────────

  async generarDesdeIA(flujoData: any): Promise<{ pasos: any[]; transiciones: any[]; nodosOmitidos: string[] }> {
    if (!this.graph) throw new Error('Graph no inicializado');
    const flujo     = flujoData?.flujo ?? flujoData;
    const nodos:     any[] = flujo?.nodos     ?? [];
    const conexiones: any[] = flujo?.conexiones ?? [];
    if (!nodos.length) throw new Error('La IA no devolvió un flujo válido.');

    // ── 1. Preparar datos ANTES de tocar el grafo ────────────────────────────
    const deptos = this.ordenarDepartamentos(flujo.departamentos ?? []);

    // Niveles topológicos calculados desde el JSON (no desde el grafo),
    // para garantizar posición vertical correcta desde el primer insert.
    const nivelesJson = this.calcularNivelesJson(nodos, conexiones);
    const maxNivel    = nivelesJson.size > 0 ? Math.max(...nivelesJson.values()) : 0;

    // ── Calcular ancho de cada carril considerando nodos paralelos lado a lado ──
    // Agrupar nodos por (deptoNorm, nivel) para calcular fila más ancha
    const anchosPorDepto = new Map<string, number>(); // normName → px
    const slotWidths      = new Map<string, number[]>(); // `${deptoNorm}:${nivel}` → [w0,w1,…]

    for (const nodo of nodos) {
      const dk  = this.normalizarNombre(nodo.departamento ?? deptos[0]);
      const nv  = nivelesJson.get(nodo.id) ?? 0;
      const ut  = this.maparTipoIA(nodo.tipo);
      // anchoParaCarril para dimensionar el lane (incluye texto externo de gateways)
      const w   = this.anchoParaCarril(nodo.nombre ?? '', ut);
      const key = `${dk}:${nv}`;
      if (!slotWidths.has(key)) slotWidths.set(key, []);
      slotWidths.get(key)!.push(w);
    }

    for (const depto of deptos) {
      const dk  = this.normalizarNombre(depto);
      let maxW: number = LAYOUT.LANE_ANCHO_MIN;
      for (const [key, widths] of slotWidths) {
        if (!key.startsWith(`${dk}:`)) continue;
        const row = widths.reduce((s, w) => s + w, 0)
          + (widths.length - 1) * LAYOUT.PARALLEL_GAP
          + LAYOUT.LANE_LATERAL_PAD * 2;
        if (row > maxW) maxW = row;
      }
      anchosPorDepto.set(dk, Math.min(LAYOUT.LANE_ANCHO_MAX, maxW));
    }

    const { infoNiveles, alturaTotal: alturaLane } =
      this.calcularInfoNiveles(maxNivel, new Map());

    // Índice de sub-posición por (carril, nivel) para distribución lateral
    const subIdx = new Map<string, number>(); // key = `${laneNorm}:${nivel}`

    // ── 2. Un único batchUpdate: reset + carriles + nodos + aristas ──────────
    const cellPorId    = new Map<string, Cell>();
    const laneMap      = new Map<string, Cell>(); // normName → Cell
    const nodosOmitidos: string[] = [];

    // La generación IA no debe ocupar el historial de undo del usuario;
    // solo sus edits manuales posteriores deben ser deshechos con Ctrl+Z.
    this.ignorarUndoCapture = true;
    this.graph.batchUpdate(() => {
      // Borrar todo lo existente
      this.graph!.removeCells(this.graph!.getDefaultParent().children ?? [], true);

      // Crear carriles con ancho correcto (basado en nodos paralelos lado a lado)
      let xActual = 160;
      for (const depto of deptos) {
        const dk  = this.normalizarNombre(depto);
        const w   = anchosPorDepto.get(dk) ?? LAYOUT.LANE_ANCHO_MIN;
        const val: UmlCellValue = { umlType: 'ActivityPartition', name: depto };
        const lane = this.graph!.insertVertex(
          this.graph!.getDefaultParent(), null, val,
          xActual, 80, w, alturaLane,
          UML_ESTILOS['ActivityPartition']
        );
        laneMap.set(dk, lane);
        xActual += w;
      }

      // Insertar nodos distribuidos LADO A LADO en niveles con nodos paralelos
      for (const nodo of this.ordenarNodosTopologicamente(nodos, conexiones)) {
        const laneNorm = this.normalizarNombre(nodo.departamento ?? deptos[0]);
        const lane     = laneMap.get(laneNorm);
        if (!lane) { nodosOmitidos.push(nodo.nombre ?? nodo.id); continue; }

        const umlTipo   = this.maparTipoIA(nodo.tipo);
        const tamBase   = UML_TAMANOS[umlTipo] ?? { w: LAYOUT.TAREA_W, h: LAYOUT.TAREA_H };
        const laneW     = lane.getGeometry()!.width;
        const anchoNodo = this.calcularAnchoNodo(nodo.nombre ?? '', laneW, umlTipo);
        const nivel     = nivelesJson.get(nodo.id) ?? 0;

        // Índice lateral del nodo dentro del slot (mismo nivel, mismo carril)
        const slotKey = `${laneNorm}:${nivel}`;
        const idx     = subIdx.get(slotKey) ?? 0;
        subIdx.set(slotKey, idx + 1);

        // Y: inicio del nivel (todos los nodos del slot comparten la misma Y)
        const info  = infoNiveles.get(nivel);
        const yRel  = info?.yBase ?? (LAYOUT.HEADER_LANE + LAYOUT.PADDING_TOP_NODOS + nivel * LAYOUT.STRIDE);

        // X: posición lateral en la fila del slot (lado a lado)
        const ws        = slotWidths.get(slotKey) ?? [anchoNodo];
        const totalW    = ws.reduce((s: number, w: number) => s + w, 0)
                          + (ws.length - 1) * LAYOUT.PARALLEL_GAP;
        const startX    = Math.max(LAYOUT.LANE_LATERAL_PAD, (laneW - totalW) / 2);
        const xOffset   = ws.slice(0, idx).reduce((s: number, w: number) => s + w + LAYOUT.PARALLEL_GAP, 0);
        const xRel      = startX + xOffset;

        const val: UmlCellValue = { umlType: umlTipo, name: nodo.nombre };
        const cell = this.graph!.insertVertex(
          lane, nodo.id, val, xRel, yRel, anchoNodo, tamBase.h,
          UML_ESTILOS[umlTipo] ?? UML_ESTILOS['OpaqueAction']
        );
        cellPorId.set(nodo.id, cell);
      }

      // Insertar aristas
      for (const conn of conexiones) {
        const src = cellPorId.get(conn.origen);
        const tgt = cellPorId.get(conn.destino);
        if (!src || !tgt) continue;
        const val: UmlCellValue = { umlType: 'ControlFlow', guard: conn.nombre || undefined };
        this.graph!.insertEdge(
          this.graph!.getDefaultParent(), null, val, src, tgt,
          UML_ESTILOS['ControlFlow']
        );
      }
    });

    // ── 3. Routing + fit — todo fuera del historial de undo ─────────────────
    requestAnimationFrame(() => {
      this.reroutearFlechas();
      this.herramientaActiva.set(null);
      requestAnimationFrame(() => {
        this.graph!.fit();
        const view = (this.graph as any).view;
        if (view?.scale < 0.65) view.setScale(0.65);
        this.zoomActual.set(Math.round((view?.getScale?.() ?? 0.65) * 100));
        this.exportar();
        // Limpiar historial: Ctrl+Z solo deshará edits MANUALES posteriores
        this.ignorarUndoCapture = false;
        this.undoManager?.clear();
        this.canUndo.set(false);
        this.canRedo.set(false);
      });
    });

    this.lanesCambiadas.emit(this.obtenerNombresLanes());

    const pasos = nodos
      .filter((n: any) => n.tipo === 'UserTask' || n.tipo === 'OpaqueAction')
      .map((n: any) => ({ idIA: n.id, nombre: n.nombre, departamento: n.departamento }));
    const transiciones = conexiones
      .map((c: any) => ({ origen: c.origen, destino: c.destino, nombre: c.nombre ?? '' }));

    return { pasos, transiciones, nodosOmitidos };
  }

  private maparTipoIA(tipo: string): string {
    const mapa: Record<string, string> = {
      UserTask:          'OpaqueAction',
      Task:              'OpaqueAction',
      StartEvent:        'InitialNode',
      EndEvent:          'ActivityFinalNode',
      ExclusiveGateway:  'DecisionNode',
      ParallelGateway:   'ForkNode',
      InclusiveGateway:  'MergeNode',
    };
    return mapa[tipo] ?? tipo;
  }

  // ── Layout: reposicionamiento ─────────────────────────────────────────────────

  private reposicionarLanes(
    lanes: Cell[],
    anchoPorLane: Map<string, number>,
    alturaMaxima: number
  ): void {
    const baseX = 160;
    const baseY = 80;
    let xActual = baseX;

    this.graph!.batchUpdate(() => {
      for (const lane of lanes) {
        const ancho = anchoPorLane.get(lane.getId()!) ?? LAYOUT.LANE_ANCHO_MIN;
        const geo = lane.getGeometry()!.clone();
        geo.x = xActual;
        geo.y = baseY;
        geo.width = ancho;
        geo.height = alturaMaxima;
        this.graph!.getDataModel().setGeometry(lane, geo);
        xActual += ancho;
      }
    });
  }


  // ── Routing ortogonal ─────────────────────────────────────────────────────────

  private spreadOffset(idx: number, count: number, spread = 20): number {
    return count > 1 ? (idx - (count - 1) / 2) * spread : 0;
  }

  private reroutearFlechas(): void {
    if (!this.graph) return;
    const edges = this.getEdges();

    // Pre-computar entradas/salidas por nodo para el cálculo de dispersión
    const incomingPorNodo = new Map<string, Cell[]>();
    const outgoingPorNodo = new Map<string, Cell[]>();
    for (const e of edges) {
      const tId = e.target?.getId();
      const sId = e.source?.getId();
      if (tId) {
        if (!incomingPorNodo.has(tId)) incomingPorNodo.set(tId, []);
        incomingPorNodo.get(tId)!.push(e);
      }
      if (sId) {
        if (!outgoingPorNodo.has(sId)) outgoingPorNodo.set(sId, []);
        outgoingPorNodo.get(sId)!.push(e);
      }
    }

    const dp = this.graph!.getDefaultParent();

    this.graph.batchUpdate(() => {
      for (const edge of edges) {
        const src = edge.source;
        const tgt = edge.target;
        const geo = edge.getGeometry()!.clone();

        if (!src || !tgt) {
          geo.points = null;
          this.graph!.getDataModel().setGeometry(edge, geo);
          continue;
        }

        // Aristas hijas de un carril almacenan waypoints en coordenadas relativas al carril.
        // wp() convierte coordenadas absolutas al espacio correcto para cada arista.
        const edgePGeo = edge.parent?.getId() !== dp.getId() ? edge.parent?.getGeometry() : null;
        const wp = (ax: number, ay: number): any =>
          edgePGeo ? { x: ax - edgePGeo.x, y: ay - edgePGeo.y } : { x: ax, y: ay };

        const srcAbs = this.absPos(src);
        const tgtAbs = this.absPos(tgt);
        const srcCy  = srcAbs.y + srcAbs.h / 2;
        const tgtCy  = tgtAbs.y + tgtAbs.h / 2;

        const allIncoming = incomingPorNodo.get(tgt.getId()!) ?? [];
        const idxIn       = allIncoming.indexOf(edge);
        const allOutgoing = outgoingPorNodo.get(src.getId()!) ?? [];
        const idxOut      = allOutgoing.indexOf(edge);

        const srcLaneGeo  = src.parent?.getGeometry();
        const tgtLaneGeo  = tgt.parent?.getGeometry();
        const mismoCarril = src.parent?.getId() === tgt.parent?.getId();
        const isBackEdge  = tgtAbs.y + tgtAbs.h < srcAbs.y;

        if (isBackEdge) {
          if (!mismoCarril && srcLaneGeo && tgtLaneGeo) {
            // Back-edge cross-lane: igual que forward cross-lane, va por el borde del carril destino.
            // Esto evita salir del área visible de los carriles.
            const borderX     = tgtLaneGeo.x >= srcLaneGeo.x
              ? tgtLaneGeo.x + 14                          // 14 px dentro del carril — en el canal libre (nodos empiezan a 20px)
              : tgtLaneGeo.x + tgtLaneGeo.width - 14;      // 14 px desde el borde derecho
            const exitOffset  = this.spreadOffset(idxOut, allOutgoing.length);
            const entryOffset = this.spreadOffset(idxIn,  allIncoming.length);
            geo.points = [
              wp(borderX, srcCy + exitOffset),
              wp(borderX, tgtCy + entryOffset),
            ];
            const tgtToRightBC = tgtLaneGeo.x >= srcLaneGeo.x;
            this.applyEdgeConstraints(edge, {
              entryX: tgtToRightBC ? 0 : 1, entryY: 0.5, entryDy: entryOffset,
              exitX:  tgtToRightBC ? 1 : 0, exitY:  0.5, exitDy:  exitOffset,
            });
          } else {
            // Back-edge mismo carril: sube por el margen izquierdo y entra al destino
            // por ARRIBA (hueco entre niveles) para no cruzar ningún nodo existente.
            const marginX    = (srcLaneGeo?.x ?? 160) + 12;
            const exitOffset = this.spreadOffset(idxOut, allOutgoing.length, 15);
            const entryXOff  = this.spreadOffset(idxIn,  allIncoming.length, 28);
            const aboveTgt   = tgtAbs.y - LAYOUT.WP_GAP;
            geo.points = [
              wp(srcAbs.x - LAYOUT.WP_GAP + exitOffset, srcCy),
              wp(marginX,                                srcCy),
              wp(marginX,                                aboveTgt),
              wp(tgtAbs.x + tgtAbs.w / 2 + entryXOff,  aboveTgt),
            ];
            this.applyEdgeConstraints(edge, { entryX: 0.5, entryY: 0, entryDx: entryXOff });
          }
          this.graph!.getDataModel().setGeometry(edge, geo);
          continue;
        }

        if (mismoCarril) {
          // Mismo carril, forward: si hay múltiples entradas, distribuirlas horizontalmente
          const sameLaneIn = allIncoming.filter(e => {
            if (e.source?.parent?.getId() !== tgt.parent?.getId()) return false;
            const sa = this.absPos(e.source!);
            return sa.y + sa.h <= tgtAbs.y;
          });
          const siIdx    = sameLaneIn.indexOf(edge);
          const entryXOff = this.spreadOffset(siIdx, sameLaneIn.length, 28);
          if (sameLaneIn.length > 1) {
            geo.points = [wp(tgtAbs.x + tgtAbs.w / 2 + entryXOff, tgtAbs.y - LAYOUT.WP_GAP)];
            this.applyEdgeConstraints(edge, { entryX: 0.5, entryY: 0, entryDx: entryXOff });
          } else {
            geo.points = null;
            this.applyEdgeConstraints(edge, {});
          }
        } else if (srcLaneGeo && tgtLaneGeo) {
          // Carril distinto, forward — forma de L por el hueco inter-nivel:
          //   1. Baja al fondo del nodo fuente (zona libre entre niveles)
          //   2. Va horizontal hasta el centro X del nodo destino
          //   3. Baja hasta entrar al destino por arriba
          // Esto evita que la línea cruce nodos intermedios y se confunda con bordes de carril.
          const srcBottom   = srcAbs.y + srcAbs.h + LAYOUT.WP_GAP;
          const tgtTop      = tgtAbs.y - LAYOUT.WP_GAP;
          const exitOffset  = this.spreadOffset(idxOut, allOutgoing.length, 12);
          const entryOffset = this.spreadOffset(idxIn,  allIncoming.length, 20);

          if (srcBottom < tgtTop) {
            // Caso normal: destino por debajo → L-shape limpia por hueco inter-nivel
            const pivotXSrc = srcAbs.x + srcAbs.w / 2 + exitOffset;
            const pivotXTgt = tgtAbs.x + tgtAbs.w / 2 + entryOffset;
            geo.points = [
              wp(pivotXSrc, srcBottom),
              wp(pivotXTgt, srcBottom),
              wp(pivotXTgt, tgtTop),
            ];
            this.applyEdgeConstraints(edge, {
              entryX: 0.5, entryY: 0, entryDx: entryOffset,
              exitX:  0.5, exitY:  1, exitDx:  exitOffset,
            });
          } else {
            // Mismo nivel o destino ligeramente arriba: margen lateral del carril
            const borderX = tgtLaneGeo.x >= srcLaneGeo.x
              ? tgtLaneGeo.x + 14
              : tgtLaneGeo.x + tgtLaneGeo.width - 14;
            geo.points = [
              wp(borderX, srcCy + exitOffset),
              wp(borderX, tgtCy + entryOffset),
            ];
            const tgtToRightFW = tgtLaneGeo.x >= srcLaneGeo.x;
            this.applyEdgeConstraints(edge, {
              entryX: tgtToRightFW ? 0 : 1, entryY: 0.5, entryDy: entryOffset,
              exitX:  tgtToRightFW ? 1 : 0, exitY:  0.5, exitDy:  exitOffset,
            });
          }
        } else {
          geo.points = null;
          this.applyEdgeConstraints(edge, {});
        }

        this.graph!.getDataModel().setGeometry(edge, geo);
      }
    });

    this.graph!.refresh();
  }

  private applyEdgeConstraints(edge: Cell, opts: {
    entryX?: number; entryY?: number; entryDx?: number; entryDy?: number;
    exitX?: number;  exitY?: number;  exitDx?: number;  exitDy?: number;
  }): void {
    const style = { ...(edge.getStyle() ?? {}) } as any;
    delete style.entryX; delete style.entryY; delete style.entryDx; delete style.entryDy;
    delete style.exitX;  delete style.exitY;  delete style.exitDx;  delete style.exitDy;
    const entryDx = opts.entryDx ?? 0;
    const entryDy = opts.entryDy ?? 0;
    if (entryDx !== 0 || entryDy !== 0) {
      style.entryX  = opts.entryX  ?? 0.5;
      style.entryY  = opts.entryY  ?? 0;
      style.entryDx = entryDx;
      style.entryDy = entryDy;
    }
    const exitDx = opts.exitDx ?? 0;
    const exitDy = opts.exitDy ?? 0;
    if (exitDx !== 0 || exitDy !== 0) {
      style.exitX  = opts.exitX  ?? 0.5;
      style.exitY  = opts.exitY  ?? 1;
      style.exitDx = exitDx;
      style.exitDy = exitDy;
    }
    this.graph!.getDataModel().setStyle(edge, style as CellStyle);
  }

  // ── Helpers de geometría / modelo ─────────────────────────────────────────────

  private absPos(cell: Cell): { x: number; y: number; w: number; h: number } {
    const geo = cell.getGeometry()!;
    const parent = cell.parent;
    if (parent && parent.getId() !== '1') {
      const pGeo = parent.getGeometry()!;
      return { x: pGeo.x + geo.x, y: pGeo.y + geo.y, w: geo.width, h: geo.height };
    }
    return { x: geo.x, y: geo.y, w: geo.width, h: geo.height };
  }

  private getLanes(): Cell[] {
    return (this.graph!.getDefaultParent().children ?? []).filter((c: Cell) => {
      const v = c.getValue() as UmlCellValue | undefined;
      return c.isVertex() && v?.umlType === 'ActivityPartition';
    });
  }

  private getTodosNodos(): Cell[] {
    const nodos: Cell[] = [];
    for (const lane of this.getLanes()) {
      for (const child of lane.children ?? []) {
        if (child.isVertex()) nodos.push(child);
      }
    }
    return nodos;
  }

  private getCellById(id: string): Cell | null {
    const buscar = (cell: Cell): Cell | null => {
      if (cell.getId() === id) return cell;
      for (const c of cell.children ?? []) {
        const found = buscar(c);
        if (found) return found;
      }
      return null;
    };
    return buscar(this.graph!.getDefaultParent());
  }

  private obtenerParticionEnPunto(absX: number, absY: number): Cell | null {
    return this.getLanes().find(l => {
      const g = l.getGeometry()!;
      return absX >= g.x && absX <= g.x + g.width && absY >= g.y && absY <= g.y + g.height;
    }) ?? null;
  }

  private agruparNodosPorLane(lanes: Cell[]): Map<string, Cell[]> {
    const mapa = new Map<string, Cell[]>();
    for (const lane of lanes) {
      mapa.set(lane.getId()!, lane.children?.filter((c: Cell) => c.isVertex()) ?? []);
    }
    return mapa;
  }

  private ordenarLanesParaLayout(lanes: Cell[]): Cell[] {
    return [...lanes].sort((a, b) => {
      const aCliente = this.esLaneCliente((a.getValue() as UmlCellValue)?.name);
      const bCliente = this.esLaneCliente((b.getValue() as UmlCellValue)?.name);
      if (aCliente && !bCliente) return -1;
      if (!aCliente && bCliente) return 1;
      return (a.getGeometry()?.x ?? 0) - (b.getGeometry()?.x ?? 0);
    });
  }

  private esLaneCliente(nombre?: string): boolean {
    if (!nombre) return false;
    const n = this.normalizarNombre(nombre);
    return n.includes('cliente') || n.includes('solicitante');
  }

  private existeLane(nombre: string): boolean {
    return this.obtenerNombresLanes().some(n => n.toLowerCase() === nombre.toLowerCase());
  }

  private ordenarDepartamentos(deptos: string[]): string[] {
    const cliente: string[] = [];
    const resto: string[] = [];
    for (const d of deptos) (this.esLaneCliente(d) ? cliente : resto).push(d);
    return [...cliente, ...resto];
  }

  private ordenarNodosTopologicamente(nodos: any[], conexiones: any[]): any[] {
    const grafo = new Map<string, string[]>();
    const grado = new Map<string, number>();
    for (const n of nodos) { grafo.set(n.id, []); grado.set(n.id, 0); }
    for (const c of conexiones) {
      if (!grafo.has(c.origen) || !grafo.has(c.destino)) continue;
      grafo.get(c.origen)!.push(c.destino);
      grado.set(c.destino, (grado.get(c.destino) ?? 0) + 1);
    }
    const cola = [...grado.entries()].filter(([, g]) => g === 0).map(([id]) => id);
    const orden: string[] = [];
    while (cola.length) {
      const actual = cola.shift()!;
      orden.push(actual);
      for (const s of grafo.get(actual) ?? []) {
        grado.set(s, (grado.get(s) ?? 1) - 1);
        if (grado.get(s) === 0) cola.push(s);
      }
    }
    const usados = new Set(orden);
    nodos.filter(n => !usados.has(n.id)).forEach(n => orden.push(n.id));
    const m = new Map(nodos.map(n => [n.id, n]));
    return orden.map(id => m.get(id)).filter(Boolean);
  }

  private normalizarNombre(s: string): string {
    if (!s) return '';
    return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\/\\]/g, ' ').replace(/\s+/g, ' ');
  }

  // ── Dropdown de asignación de departamento ────────────────────────────────────

  departamentosNoUsados(): string[] {
    const usados = new Set(this.obtenerNombresLanes().map(n => n.toLowerCase()));
    const termino = this.busquedaDropdown().toLowerCase();
    return this.departamentosDisponibles
      .filter(d => !usados.has(d.toLowerCase()))
      .filter(d => !termino || d.toLowerCase().includes(termino));
  }

  private abrirDropdownLane(lane: Cell): void {
    if (!this.graph || !this.canvasRef?.nativeElement) return;
    const geo = lane.getGeometry()!;
    const view = this.graph.getView();
    const scale = view.getScale();
    const tx = view.getTranslate();
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const compRect = this.canvasRef.nativeElement.parentElement?.getBoundingClientRect();
    const offsetLeft = compRect ? rect.left - compRect.left : 0;
    const offsetTop  = compRect ? rect.top  - compRect.top  : 0;
    const screenX = (geo.x + 30 + tx.x) * scale + offsetLeft;
    const screenY = (geo.y + 30 + tx.y) * scale + offsetTop;
    this.busquedaDropdown.set('');
    this.dropdownLane.set({ laneId: lane.getId()!, x: screenX, y: screenY, nombreActual: (lane.getValue() as UmlCellValue)?.name ?? '' });
  }

  cerrarDropdownLane(): void { this.dropdownLane.set(null); this.busquedaDropdown.set(''); }

  asignarDepartamentoALane(nombre: string): void {
    const drop = this.dropdownLane();
    if (!drop || !this.graph) return;
    const cell = this.getCellById(drop.laneId);
    if (cell) {
      this.graph.batchUpdate(() => {
        const val: UmlCellValue = { umlType: 'ActivityPartition', name: nombre };
        this.graph!.getDataModel().setValue(cell, val);
      });
      this.lanesCambiadas.emit(this.obtenerNombresLanes());
    }
    this.cerrarDropdownLane();
  }

  quitarLaneDesdeDropdown(): void {
    const drop = this.dropdownLane();
    if (!drop || !this.graph) return;
    const cell = this.getCellById(drop.laneId);
    if (cell) this.graph.removeCells([cell], true);
    this.lanesCambiadas.emit(this.obtenerNombresLanes());
    this.cerrarDropdownLane();
  }

  // ── Atajos de teclado ─────────────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.tourActive()) {
      this.cerrarTour();
      return;
    }
    if (this.soloLectura || this.aplicandoCambioRemoto) return;

    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;

    if (event.key === 'Escape') {
      this.cancelarHerramienta();
      this.cerrarDropdownLane();
    } else if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (this.herramientaActiva()) {
        this.cancelarHerramienta();
      } else {
        this.undo();
      }
    } else if (event.key === 'y' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!this.herramientaActiva()) this.redo();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !this.herramientaActiva()) {
      this.eliminarSeleccionados();
    }
  }

  // ── Controles del editor ──────────────────────────────────────────────────────

  emitirEdicionFormulario(): void {
    const sel = this.elementoSeleccionado();
    if (sel && sel.esTarea) {
      this.editarFormulario.emit(sel.id);
    }
  }

  eliminarSeleccionados(): void {
    if (!this.graph || this.soloLectura) return;
    const celdas = this.graph.getSelectionCells();
    if (celdas.length > 0) {
      this.graph.removeCells(celdas, true);
      this.elementoSeleccionado.set(null);
    }
  }

  zoomIn(): void {
    if (!this.graph) return;
    const c = this.canvasRef.nativeElement;
    this.zoomAtPoint(c.clientWidth / 2, c.clientHeight / 2, this.graph.zoomFactor ?? 1.25);
  }

  zoomOut(): void {
    if (!this.graph) return;
    const c = this.canvasRef.nativeElement;
    this.zoomAtPoint(c.clientWidth / 2, c.clientHeight / 2, 1 / (this.graph.zoomFactor ?? 1.25));
  }

  zoomReset(): void {
    if (!this.graph) return;
    this.graph.fit();
    const view = (this.graph as any).view;
    this.zoomActual.set(Math.round((view?.getScale?.() ?? 1) * 100));
  }

  ajustarVista(): void { this.zoomReset(); }

  /** Zoom manteniendo el punto de pantalla (screenX, screenY) fijo en el modelo. */
  private zoomAtPoint(screenX: number, screenY: number, factor: number): void {
    if (!this.graph) return;
    const view     = this.graph.getView();
    const scale    = view.getScale();
    const tx       = view.getTranslate();
    const newScale = Math.max(0.15, Math.min(4, scale * factor));
    view.scaleAndTranslate(
      newScale,
      screenX / newScale - screenX / scale + tx.x,
      screenY / newScale - screenY / scale + tx.y,
    );
    this.zoomActual.set(Math.round(newScale * 100));
  }

  /** Manejador de rueda: Ctrl+Scroll → zoom en cursor; Scroll → pan. */
  private onWheel(e: WheelEvent): void {
    if (!this.graph) return;
    e.preventDefault();
    const container = this.canvasRef.nativeElement;
    const rect      = container.getBoundingClientRect();
    const cx        = e.clientX - rect.left;
    const cy        = e.clientY - rect.top;
    // Normalizar delta (pixels en trackpad, líneas en rueda convencional)
    const deltaY    = e.deltaMode === 0 ? e.deltaY : e.deltaY * 20;
    const deltaX    = e.deltaMode === 0 ? e.deltaX : e.deltaX * 20;

    if (e.ctrlKey || e.metaKey) {
      // Zoom anclado al cursor
      const factor = deltaY < 0 ? 1.1 : 1 / 1.1;
      this.zoomAtPoint(cx, cy, factor);
    } else {
      const view  = this.graph.getView();
      const scale = view.getScale();
      const tx    = view.getTranslate();
      if (e.shiftKey) {
        // Shift+Scroll → pan horizontal
        view.scaleAndTranslate(scale, tx.x - deltaY / scale, tx.y);
      } else {
        // Scroll normal → pan vertical + trackpad horizontal
        view.scaleAndTranslate(scale, tx.x - deltaX / scale, tx.y - deltaY / scale);
      }
    }
  }

  undo(): void {
    if (!this.undoManager?.canUndo()) return;
    this.ignorarUndoCapture = true;
    try { this.undoManager.undo(); } finally { this.ignorarUndoCapture = false; }
    this.graph!.refresh();
    this.actualizarUndoRedo();
  }

  redo(): void {
    if (!this.undoManager?.canRedo()) return;
    this.ignorarUndoCapture = true;
    try { this.undoManager.redo(); } finally { this.ignorarUndoCapture = false; }
    this.graph!.refresh();
    this.actualizarUndoRedo();
  }

  private actualizarUndoRedo(): void {
    this.canUndo.set(this.undoManager?.canUndo() ?? false);
    this.canRedo.set(this.undoManager?.canRedo() ?? false);
  }

  toggleLeyenda(): void { this.mostrarLeyenda.update(v => !v); }
  toggleAtajos():  void { this.mostrarAtajos.update(v => !v); }

  async descargarSVG(): Promise<void> { this.descargarArchivo(this.exportarSVG(), 'diagrama-uml.svg', 'image/svg+xml'); }
  async descargarXML(): Promise<void> { this.descargarArchivo(this.serializer.serialize(this.graph!), 'diagrama-uml.xml', 'application/xml'); }

  private descargarArchivo(contenido: string, nombre: string, tipo: string): void {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    Object.assign(document.createElement('a'), { href: url, download: nombre }).click();
    URL.revokeObjectURL(url);
  }

  // ── Re-ruteo con debounce ─────────────────────────────────────────────────────

  private reroutearFlechasDebounced(): void {
    if (this.rerouteTimer) clearTimeout(this.rerouteTimer);
    this.rerouteTimer = setTimeout(() => {
      this.reroutearFlechas();
      this.rerouteTimer = null;
    }, 400);
  }

  // ── Resaltado de nodo origen de conexión ──────────────────────────────────────

  private resaltarNodoConexion(cell: Cell | null): void {
    if (!this.graph) return;
    if (this.nodoOrigenConexionResaltado) {
      const v = this.nodoOrigenConexionResaltado.getValue() as UmlCellValue;
      const base = { ...(UML_ESTILOS[v?.umlType ?? 'OpaqueAction'] ?? UML_ESTILOS['OpaqueAction']) };
      this.graph.getDataModel().setStyle(this.nodoOrigenConexionResaltado, base as any);
      this.nodoOrigenConexionResaltado = null;
      this.graph.refresh();
    }
    if (cell) {
      const v = cell.getValue() as UmlCellValue;
      const resaltado = {
        ...(UML_ESTILOS[v?.umlType ?? 'OpaqueAction'] ?? UML_ESTILOS['OpaqueAction']),
        strokeColor: '#6366f1',
        strokeWidth: 3,
      };
      this.graph.getDataModel().setStyle(cell, resaltado as any);
      this.nodoOrigenConexionResaltado = cell;
      this.graph.refresh();
    }
  }

  // ── Estadísticas del diagrama ─────────────────────────────────────────────────

  private actualizarEstadisticas(): void {
    if (!this.graph) return;
    this.estadisticasDiagrama.set({
      carriles:   this.getLanes().length,
      nodos:      this.getTodosNodos().length,
      conexiones: this.getEdges().length,
    });
  }

  // ── Validación del diagrama ───────────────────────────────────────────────────

  validarDiagrama(): void {
    if (!this.graph) return;
    const nodos  = this.getTodosNodos();
    const edges  = this.getEdges();
    const avisos: string[] = [];

    const iniciales = nodos.filter(n => (n.getValue() as UmlCellValue)?.umlType === 'InitialNode');
    if (iniciales.length === 0) avisos.push('Falta el nodo de inicio (círculo negro).');
    if (iniciales.length > 1)   avisos.push(`Hay ${iniciales.length} nodos de inicio — solo debe haber uno.`);

    const finales = nodos.filter(n => {
      const t = (n.getValue() as UmlCellValue)?.umlType;
      return t === 'ActivityFinalNode' || t === 'FlowFinalNode';
    });
    if (finales.length === 0) avisos.push('Falta el nodo de fin.');

    const conectados = new Set<string>();
    for (const e of edges) {
      if (e.source?.getId()) conectados.add(e.source.getId()!);
      if (e.target?.getId()) conectados.add(e.target.getId()!);
    }
    const huerfanos = nodos.filter(n => {
      const t = (n.getValue() as UmlCellValue)?.umlType;
      if (t === 'InitialNode' || t === 'ActivityFinalNode' || t === 'FlowFinalNode') return false;
      return !conectados.has(n.getId()!);
    });
    if (huerfanos.length > 0) {
      const nombres = huerfanos.map(n => `"${(n.getValue() as UmlCellValue)?.name || '(sin nombre)'}"`)
        .join(', ');
      avisos.push(`${huerfanos.length} nodo(s) sin conexiones: ${nombres}.`);
    }

    for (const n of nodos) {
      if ((n.getValue() as UmlCellValue)?.umlType === 'DecisionNode') {
        const salidas = edges.filter(e => e.source?.getId() === n.getId());
        if (salidas.length < 2) {
          const nombre = (n.getValue() as UmlCellValue)?.name || '(sin nombre)';
          avisos.push(`Rombo "${nombre}" tiene ${salidas.length} salida(s) — necesita al menos 2.`);
        }
      }
    }

    this.validacionAvisos.set(avisos.length === 0 ? ['✓ El diagrama es válido.'] : avisos);
    this.mostrarValidacion.set(true);
  }

  toggleValidacion(): void { this.mostrarValidacion.update(v => !v); }

  // ── Exportar PNG ──────────────────────────────────────────────────────────────

  async descargarPNG(): Promise<void> {
    if (!this.graph) return;
    try {
      const svgEl = this.canvasRef.nativeElement.querySelector('svg') as SVGSVGElement | null;
      if (!svgEl) return;
      const w = svgEl.clientWidth  || 1200;
      const h = svgEl.clientHeight || 800;
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const blob    = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url     = URL.createObjectURL(blob);
      const img     = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = url; });
      URL.revokeObjectURL(url);
      const canvas  = document.createElement('canvas');
      canvas.width  = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(2, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      this.descargarArchivo(canvas.toDataURL('image/png'), 'diagrama.png', 'image/png');
    } catch (e) {
      console.error('[PNG] Error al exportar:', e);
    }
  }

  // ── Condición de aristas de decisión ─────────────────────────────────────────

  aplicarCondicion(condicion: string): void {
    const edge = this.condicionPendiente();
    if (!edge || !this.graph) { this.condicionPendiente.set(null); return; }
    const trimmed = condicion.trim();
    const val: UmlCellValue = { umlType: 'ControlFlow', name: trimmed, guard: trimmed };
    this.graph.getDataModel().setValue(edge, val);
    this.condicionPendiente.set(null);
  }

  cancelarCondicion(): void {
    this.condicionPendiente.set(null);
  }

  // ── Sincronización de posiciones de carriles ──────────────────────────────────

  private sincronizarPosicionesCarriles(): void {
    if (!this.graph || this.resizingSincronizacion) return;
    const lanes = this.getLanes();
    if (lanes.length < 2) return;

    const sorted = [...lanes].sort((a, b) =>
      (a.getGeometry()?.x ?? 0) - (b.getGeometry()?.x ?? 0)
    );
    const maxH = Math.max(...sorted.map(l => l.getGeometry()!.height));

    // Verificar si hay desajuste antes de modificar (evita loops innecesarios)
    let xCursor = sorted[0].getGeometry()!.x;
    let necesita = false;
    for (const lane of sorted) {
      const g = lane.getGeometry()!;
      if (g.x !== xCursor || g.height !== maxH) { necesita = true; break; }
      xCursor += g.width;
    }
    if (!necesita) return;

    this.resizingSincronizacion = true;
    try {
      this.graph.batchUpdate(() => {
        let x = sorted[0].getGeometry()!.x;
        for (const lane of sorted) {
          const geo = lane.getGeometry()!.clone();
          let changed = false;
          if (geo.x !== x)     { geo.x = x;       changed = true; }
          if (geo.height !== maxH) { geo.height = maxH; changed = true; }
          if (changed) this.graph!.getDataModel().setGeometry(lane, geo);
          x += geo.width;
        }
      });
    } finally {
      this.resizingSincronizacion = false;
    }
  }

  // ── Colaboración ──────────────────────────────────────────────────────────────

  private activarColaboracion(): void {
    if (!this.graph || this.cursorListenerAttached) return;
    this.modelerRef.set(this.graph);

    this.colaboracionService.onXmlRecibido((evento: EventoXml) => {
      this.aplicarXmlRemoto(evento.xml);
    });

    if (this.canvasRef?.nativeElement) {
      this.mouseMoveHandler = (e: MouseEvent) => {
        if (!this.modoColaborativo || !this.colaboracionService.procesoIdActivo()) return;
        const view = this.graph!.getView();
        const rect = this.canvasRef.nativeElement.getBoundingClientRect();
        const scale = view.getScale();
        const tx = view.getTranslate();
        const modelX = (e.clientX - rect.left) / scale - tx.x;
        const modelY = (e.clientY - rect.top)  / scale - tx.y;
        this.colaboracionService.emitirCursor(modelX, modelY);
      };
      this.canvasRef.nativeElement.addEventListener('mousemove', this.mouseMoveHandler);
      this.cursorListenerAttached = true;
    }
  }

  private async aplicarXmlRemoto(xmlRemoto: string): Promise<void> {
    if (!this.graph || !xmlRemoto) return;
    try {
      this.aplicandoCambioRemoto = true;
      this.cargarXml(xmlRemoto);
      this.aplicarResaltado();
      setTimeout(() => { this.aplicandoCambioRemoto = false; }, 150);
    } catch (e) {
      console.error('[Colaboración] Error aplicando XML remoto:', e);
      this.aplicandoCambioRemoto = false;
    }
  }

  private desactivarColaboracion(): void {
    if (this.mouseMoveHandler && this.canvasRef?.nativeElement) {
      this.canvasRef.nativeElement.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = null;
      this.cursorListenerAttached = false;
    }
    this.modelerRef.set(null);
  }

  // ── Utilidades de presentación ────────────────────────────────────────────────

  formatearTipo(umlType: string): string {
    const m: Record<string, string> = {
      InitialNode:         'Nodo Inicial',
      OpaqueAction:        'Acción',
      DecisionNode:        'Nodo de Decisión',
      MergeNode:           'Nodo de Convergencia',
      ForkNode:            'Fork Paralelo',
      JoinNode:            'Join Paralelo',
      ActivityFinalNode:   'Fin de Actividad',
      FlowFinalNode:       'Fin de Flujo',
      AcceptEventAction:   'Aceptar Evento',
      Note:                'Nota',
      ControlFlow:         'Flujo de Control',
      ActivityPartition:   'Partición',
    };
    return m[umlType] ?? umlType;
  }

  descripcionEducativa(umlType: string): string {
    const m: Record<string, string> = {
      InitialNode:         'Punto de inicio de la actividad. Solo puede haber uno.',
      OpaqueAction:        'Actividad realizada por un rol o departamento.',
      DecisionNode:        'Bifurcación condicional: solo un camino se activa.',
      MergeNode:           'Une ramas condicionales alternativas en un flujo.',
      ForkNode:            'Inicia flujos paralelos simultáneos.',
      JoinNode:            'Sincroniza todos los flujos paralelos antes de continuar.',
      ActivityFinalNode:   'Termina toda la actividad incluyendo flujos paralelos.',
      FlowFinalNode:       'Termina solo este camino; otros flujos continúan.',
      AcceptEventAction:   'Espera la recepción de un evento o señal externa.',
      Note:                'Comentario informativo. No afecta el flujo.',
      ActivityPartition:   'Carril de responsabilidad (departamento o rol). Doble clic para asignar.',
    };
    return m[umlType] ?? '';
  }

  // ── Tour interactivo ──────────────────────────────────────────────────────────

  tourActive = signal(false);
  tourStep   = signal(0);
  tourRect   = signal<DOMRect | null>(null);
  private leyendaAbiertaPorTour = false;

  readonly tourPasos = [
    {
      id: 'tour-bpmn-paleta',
      icono: '🧰',
      titulo: 'Panel de Herramientas',
      desc: 'El panel izquierdo agrupa todas las herramientas del editor: modos de cursor, elementos UML para insertar en el lienzo y el botón de auto-organización. Es el punto de partida para construir cualquier diagrama de actividades.'
    },
    {
      id: 'tour-bpmn-nav',
      icono: '🖱️',
      titulo: 'Modos de Cursor',
      desc: 'Seleccionar/Mover: arrastra nodos para reposicionarlos. Conectar: traza una flecha de flujo haciendo clic en el nodo origen y luego en el destino. Agregar Carril: añade una nueva partición de departamento al pool.'
    },
    {
      id: 'tour-bpmn-nodos',
      icono: '🔷',
      titulo: 'Paleta de Nodos UML',
      desc: 'Activa un tipo de nodo y haz clic en el lienzo para insertarlo. Acciones (rectángulos azules), Aceptar Evento (banderas verdes), Gateways (rombos para decisiones), Fork/Join (barras para paralelismo), Terminadores y Notas de comentario.'
    },
    {
      id: 'tour-bpmn-auto',
      icono: '✨',
      titulo: 'Auto-Organizar',
      desc: 'Aplica el algoritmo Sugiyama para ordenar el diagrama: los nodos al mismo nivel lógico quedan alineados en horizontal, los carriles se ajustan en anchura al contenido y las flechas se re-rutean sin cruces innecesarios.'
    },
    {
      id: 'tour-bpmn-canvas',
      icono: '🎨',
      titulo: 'El Lienzo',
      desc: 'Aquí se construye el diagrama. Haz clic para insertar nodos (tras activar un tipo en la paleta). Arrastra para mover elementos. Ctrl+Scroll para zoom centrado en el cursor. Scroll para desplazar. Doble clic en un carril para asignar su departamento.'
    },
    {
      id: 'tour-bpmn-toolbar',
      icono: '🛠️',
      titulo: 'Barra de Herramientas',
      desc: 'Deshacer/Rehacer (Ctrl+Z / Ctrl+Y), control de zoom con ajuste automático al hacer clic en el porcentaje, leyenda de símbolos UML 2.5 (abierta ahora para que la veas), validador estructural y exportación a PNG de alta resolución.'
    },
  ];

  get tourPasoActual()   { return this.tourPasos[this.tourStep()]; }
  get esUltimoPasoTour() { return this.tourStep() === this.tourPasos.length - 1; }

  @HostListener('window:resize') @HostListener('window:scroll')
  onTourLayout(): void { if (this.tourActive()) this.actualizarRectTour(); }

  iniciarTour(): void {
    this.tourActive.set(true);
    this.tourStep.set(0);
    setTimeout(() => this.irAlPasoTour(0), 100);
  }

  siguientePasoTour(): void {
    if (this.esUltimoPasoTour) { this.cerrarTour(); return; }
    const n = this.tourStep() + 1;
    this.tourStep.set(n);
    setTimeout(() => this.irAlPasoTour(n), 150);
  }

  anteriorPasoTour(): void {
    if (this.tourStep() === 0) return;
    const n = this.tourStep() - 1;
    this.tourStep.set(n);
    setTimeout(() => this.irAlPasoTour(n), 150);
  }

  cerrarTour(): void {
    if (this.leyendaAbiertaPorTour && this.mostrarLeyenda()) {
      this.toggleLeyenda();
      this.leyendaAbiertaPorTour = false;
    }
    this.tourActive.set(false);
    this.tourRect.set(null);
  }

  private irAlPasoTour(paso: number): void {
    // Cierra leyenda si fue abierta por el tour y ya no estamos en ese paso
    if (this.leyendaAbiertaPorTour && this.mostrarLeyenda() && paso !== 5) {
      this.toggleLeyenda();
      this.leyendaAbiertaPorTour = false;
    }
    // En el paso de toolbar (índice 5): abrir leyenda para demostración en vivo
    if (paso === 5 && !this.mostrarLeyenda()) {
      this.toggleLeyenda();
      this.leyendaAbiertaPorTour = true;
    }
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

  // ─────────────────────────────────────────────────────────────────────────────
}
