import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CampoFormulario, OpcionCampo, TemaFormulario, TipoCampo, ColumnaTabla, TipoResponsable } from '../../models/proceso.model';

interface DefinicionTipo {
  tipo: TipoCampo;
  nombre: string;
  descripcion: string;
  categoria: 'texto' | 'fecha' | 'seleccion' | 'archivo' | 'avanzado' | 'decorativo';
  icono: string;
}

interface DefinicionTema {
  id: TemaFormulario;
  nombre: string;
  descripcion: string;
  primario: string;
  fondo: string;
  texto: string;
  borde: string;
}

// 👇 NUEVO: información de un campo global (para el panel de visibilidad)
export interface CampoGlobal {
  id: string;
  etiqueta: string;
  tipo: string;
  origen: string;      // "Cliente (inicio)" o "Paso: Verificar documentos"
  origenTipo: 'cliente' | 'paso';
}

@Component({
  selector: 'app-editor-formulario-paso',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './editor-formulario-paso.html',
  styleUrls: ['./editor-formulario-paso.css']
})
export class EditorFormularioPasoComponent {

  // ========== INPUTS ==========
  @Input() set valoresIniciales(v: CampoFormulario[] | undefined) {
    this.campos.set(this.normalizarCampos(v ?? []));
  }
  @Input() set tema(t: TemaFormulario | undefined) {
    if (t) this.temaActual.set(t);
  }
  @Input() set tipoResponsableInicial(t: TipoResponsable | undefined) {
    this.tipoResponsable.set(t ?? 'FUNCIONARIO');
  }
  // 👇 NUEVOS INPUTS
  @Input() set camposGlobalesDisponibles(campos: CampoGlobal[] | undefined) {
    this.camposGlobales.set(campos ?? []);
  }
  @Input() set camposVisiblesIniciales(ids: string[] | undefined) {
    this.camposVisibles.set(ids ?? []);
  }
  @Input() nombrePaso = '';

  // ========== OUTPUTS ==========
  @Output() cambio = new EventEmitter<CampoFormulario[]>();
  @Output() temaCambiado = new EventEmitter<TemaFormulario>();
  @Output() tipoResponsableCambiado = new EventEmitter<TipoResponsable>();
  // 👇 NUEVO
  @Output() camposVisiblesCambiados = new EventEmitter<string[]>();

  // ========== ESTADO ==========
  campos = signal<CampoFormulario[]>([]);
  campoSeleccionadoId = signal<string | null>(null);
  tabPropiedades = signal<'general' | 'opciones' | 'validacion' | 'avanzado' | 'visibilidad'>('general');
  modoVistaPrevia = signal(false);
  temaActual = signal<TemaFormulario>('corporativo');
  busquedaTipo = signal('');
  tipoResponsable = signal<TipoResponsable>('FUNCIONARIO');

  // Historial undo/redo
  private historialUndo: CampoFormulario[][] = [];
  private historialRedo: CampoFormulario[][] = [];
  canUndoCampos = signal(false);
  canRedoCampos = signal(false);

  // 👇 NUEVOS SIGNALS
  camposGlobales = signal<CampoGlobal[]>([]);
  camposVisibles = signal<string[]>([]);
  busquedaVisibilidad = signal('');

  // Drag & drop
  campoArrastrado = signal<string | null>(null);
  campoSobre = signal<string | null>(null);
  modalVisibilidadAbierto = signal(false);

  // Dropdown tema — usa fixed para no ser recortado por overflow del padre
  temaDropdownAbierto = signal(false);
  temaDropdownPos     = signal<{ top: number; right: number } | null>(null);

  @ViewChild('temaBtn') temaBtnRef!: ElementRef<HTMLButtonElement>;

  // === Catálogo de tipos disponibles ===
  tiposDisponibles: DefinicionTipo[] = [
    { tipo: 'texto', nombre: 'Texto corto', descripcion: 'Una sola línea', categoria: 'texto', icono: 'text-short' },
    { tipo: 'textarea', nombre: 'Texto largo', descripcion: 'Múltiples líneas', categoria: 'texto', icono: 'text-long' },
    { tipo: 'numero', nombre: 'Número', descripcion: 'Solo cifras', categoria: 'texto', icono: 'number' },
    { tipo: 'email', nombre: 'Email', descripcion: 'Correo electrónico', categoria: 'texto', icono: 'email' },
    { tipo: 'telefono', nombre: 'Teléfono', descripcion: 'Número telefónico', categoria: 'texto', icono: 'phone' },
    { tipo: 'fecha', nombre: 'Fecha', descripcion: 'Selector de fecha', categoria: 'fecha', icono: 'calendar' },
    { tipo: 'hora', nombre: 'Hora', descripcion: 'Selector de hora', categoria: 'fecha', icono: 'clock' },
    { tipo: 'fecha_hora', nombre: 'Fecha y hora', descripcion: 'Fecha + hora juntas', categoria: 'fecha', icono: 'datetime' },
    { tipo: 'seleccion', nombre: 'Desplegable', descripcion: 'Lista colapsable', categoria: 'seleccion', icono: 'dropdown' },
    { tipo: 'radio', nombre: 'Opción única', descripcion: 'Radio buttons', categoria: 'seleccion', icono: 'radio' },
    { tipo: 'checkbox', nombre: 'Casillas', descripcion: 'Múltiple selección', categoria: 'seleccion', icono: 'check' },
    { tipo: 'si_no', nombre: 'Sí / No', descripcion: 'Switch binario', categoria: 'seleccion', icono: 'toggle' },
    { tipo: 'archivo', nombre: 'Archivo', descripcion: 'PDF, Word, Excel', categoria: 'archivo', icono: 'file' },
    { tipo: 'imagen', nombre: 'Imagen', descripcion: 'JPG, PNG, WebP', categoria: 'archivo', icono: 'image' },
    { tipo: 'firma', nombre: 'Firma digital', descripcion: 'Dibujar firma', categoria: 'avanzado', icono: 'signature' },
    { tipo: 'ubicacion', nombre: 'Ubicación', descripcion: 'GPS / coordenadas', categoria: 'avanzado', icono: 'location' },
    { tipo: 'calificacion', nombre: 'Calificación', descripcion: 'Estrellas 1-5 o 1-10', categoria: 'avanzado', icono: 'star' },
    { tipo: 'tabla', nombre: 'Tabla editable', descripcion: 'Matriz de datos', categoria: 'avanzado', icono: 'table' },
    { tipo: 'documento-texto', nombre: 'Doc. Word colaborativo', descripcion: 'Editor de texto compartido en tiempo real', categoria: 'avanzado', icono: 'doc-texto' },
    { tipo: 'documento-hoja', nombre: 'Doc. Excel colaborativo', descripcion: 'Hoja de cálculo compartida en tiempo real', categoria: 'avanzado', icono: 'doc-hoja' },
    { tipo: 'titulo', nombre: 'Título', descripcion: 'Encabezado grande', categoria: 'decorativo', icono: 'heading' },
    { tipo: 'subtitulo', nombre: 'Subtítulo', descripcion: 'Encabezado mediano', categoria: 'decorativo', icono: 'subheading' },
    { tipo: 'parrafo', nombre: 'Párrafo', descripcion: 'Texto informativo', categoria: 'decorativo', icono: 'paragraph' },
    { tipo: 'separador', nombre: 'Separador', descripcion: 'Línea divisoria', categoria: 'decorativo', icono: 'separator' }
  ];

  temas: DefinicionTema[] = [
    { id: 'corporativo', nombre: 'Corporativo', descripcion: 'Azul profesional', primario: '#2563eb', fondo: '#f8fafc', texto: '#1e293b', borde: '#cbd5e1' },
    { id: 'minimal', nombre: 'Minimal', descripcion: 'Gris sobrio', primario: '#475569', fondo: '#ffffff', texto: '#0f172a', borde: '#e2e8f0' },
    { id: 'vibrante', nombre: 'Vibrante', descripcion: 'Púrpura moderno', primario: '#9333ea', fondo: '#faf5ff', texto: '#1e1b4b', borde: '#d8b4fe' },
    { id: 'naturaleza', nombre: 'Naturaleza', descripcion: 'Verde fresco', primario: '#059669', fondo: '#f0fdf4', texto: '#14532d', borde: '#86efac' }
  ];

  // === Computed ===
  campoSeleccionado = computed<CampoFormulario | null>(() => {
    const id = this.campoSeleccionadoId();
    if (!id) return null;
    return this.campos().find(c => c.id === id) ?? null;
  });

  // 👇 NUEVO UX: Mapeo de tipos a meta-categorías (Básicos/Avanzados/Decorativos)
private tiposBasicos: Set<TipoCampo> = new Set([
  'texto', 'textarea', 'numero', 'email', 'fecha', 'si_no'
]);

// 👇 NUEVO UX: Estado abierto/cerrado de cada meta-categoría (con persistencia)
seccionesAbiertas = signal<{ basicos: boolean; avanzados: boolean; decorativos: boolean }>(
  this.cargarEstadoSecciones()
);

private cargarEstadoSecciones(): { basicos: boolean; avanzados: boolean; decorativos: boolean } {
  try {
    const guardado = localStorage.getItem('ui_categorias_form');
    if (guardado) return JSON.parse(guardado);
  } catch { /* ignorar JSON inválido */ }
  // Default: básicos abierto, avanzados cerrado, decorativos cerrado
  return { basicos: true, avanzados: false, decorativos: false };
}

toggleSeccion(seccion: 'basicos' | 'avanzados' | 'decorativos'): void {
  this.seccionesAbiertas.update(s => {
    const nuevo = { ...s, [seccion]: !s[seccion] };
    localStorage.setItem('ui_categorias_form', JSON.stringify(nuevo));
    return nuevo;
  });
}

// 👇 NUEVO UX: Tipos agrupados en 3 meta-categorías, filtrados por búsqueda
tiposPorMetaCategoria = computed(() => {
  const termino = this.busquedaTipo().toLowerCase().trim();
  const filtrados = termino
    ? this.tiposDisponibles.filter(t =>
        t.nombre.toLowerCase().includes(termino) ||
        t.descripcion.toLowerCase().includes(termino))
    : this.tiposDisponibles;

  const basicos: DefinicionTipo[] = [];
  const avanzados: DefinicionTipo[] = [];
  const decorativos: DefinicionTipo[] = [];

  for (const t of filtrados) {
    if (t.categoria === 'decorativo') {
      decorativos.push(t);
    } else if (this.tiposBasicos.has(t.tipo)) {
      basicos.push(t);
    } else {
      avanzados.push(t);
    }
  }

  return { basicos, avanzados, decorativos };
});

// 👇 NUEVO UX: Si hay búsqueda activa, expandir todo automáticamente
hayBusquedaActiva = computed(() => this.busquedaTipo().trim().length > 0);

  // 👇 NUEVO: campos globales agrupados por origen, filtrados por búsqueda
  camposGlobalesAgrupados = computed(() => {
    const termino = this.busquedaVisibilidad().toLowerCase().trim();
    const filtrados = termino
      ? this.camposGlobales().filter(c =>
          c.etiqueta.toLowerCase().includes(termino) ||
          c.origen.toLowerCase().includes(termino))
      : this.camposGlobales();

    const grupos: Record<string, CampoGlobal[]> = {};
    for (const c of filtrados) {
      if (!grupos[c.origen]) grupos[c.origen] = [];
      grupos[c.origen].push(c);
    }
    return grupos;
  });

  totalCamposGlobales = computed(() => this.camposGlobales().length);
  totalVisibles = computed(() => this.camposVisibles().length);

  cambiarTipoResponsable(t: TipoResponsable) {
    this.tipoResponsable.set(t);
    this.tipoResponsableCambiado.emit(t);
  }

  temaSeleccionado = computed(() =>
    this.temas.find(t => t.id === this.temaActual()) ?? this.temas[0]
  );

  resumen = computed(() => {
    const total = this.campos().length;
    const requeridos = this.campos().filter(c => c.requerido).length;
    return { total, requeridos, opcionales: total - requeridos };
  });

  @HostListener('document:keydown', ['$event'])
  onKey(e: Event): void {
    const ev = e as KeyboardEvent;
    const target = ev.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

    // Undo/Redo — disponibles aunque no haya campo seleccionado
    if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
      ev.preventDefault(); this.undoCampos(); return;
    }
    if ((ev.key === 'y' && (ev.ctrlKey || ev.metaKey)) ||
        (ev.key === 'z' && (ev.ctrlKey || ev.metaKey) && ev.shiftKey)) {
      ev.preventDefault(); this.redoCampos(); return;
    }

    const seleccionado = this.campoSeleccionado();
    if (!seleccionado) return;

    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      this.eliminarCampo(seleccionado.id);
    } else if (ev.key === 'd' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      this.duplicarCampo(seleccionado.id);
    }
  }

  private normalizarCampos(campos: CampoFormulario[]): CampoFormulario[] {
    return campos.map(c => {
      const normalizado: CampoFormulario = { ...c };
      if (c.opciones && !c.opcionesList && (c.tipo === 'seleccion' || c.tipo === 'radio' || c.tipo === 'checkbox')) {
        normalizado.opcionesList = c.opciones.split(',').map(o => ({
          id: this.generarId('opt'), etiqueta: o.trim(), valor: o.trim()
        }));
      }
      if (!normalizado.ancho) normalizado.ancho = 'completo';
      return normalizado;
    });
  }

  private generarId(prefijo: string): string {
    return `${prefijo}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  }

  agregarCampo(tipo: TipoCampo): void {
    this.guardarEnHistorial();
    const def = this.tiposDisponibles.find(t => t.tipo === tipo);
    const nuevo: CampoFormulario = {
      id: this.generarId('campo'),
      etiqueta: this.etiquetaDefault(tipo),
      tipo, requerido: false, ancho: 'completo', placeholder: '', descripcion: ''
    };

    if (tipo === 'seleccion' || tipo === 'radio' || tipo === 'checkbox') {
      nuevo.opcionesList = [
        { id: this.generarId('opt'), etiqueta: 'Opción 1', valor: 'opcion_1' },
        { id: this.generarId('opt'), etiqueta: 'Opción 2', valor: 'opcion_2' }
      ];
    }
    if (tipo === 'archivo') {
      nuevo.tiposArchivoPermitidos = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
      nuevo.tamanoMaxMB = 10; nuevo.permiteMultiples = false;
    }
    if (tipo === 'imagen') {
      nuevo.tiposArchivoPermitidos = ['jpg', 'jpeg', 'png', 'webp'];
      nuevo.tamanoMaxMB = 5; nuevo.permiteMultiples = false;
    }
    if (tipo === 'calificacion') {
      nuevo.escalaMax = 5; nuevo.iconoCalificacion = 'estrella';
    }
    if (tipo === 'tabla') {
      nuevo.columnasTabla = [
        { id: this.generarId('col'), etiqueta: 'Columna 1', tipo: 'texto' },
        { id: this.generarId('col'), etiqueta: 'Columna 2', tipo: 'texto' }
      ];
      nuevo.filasMinimas = 1; nuevo.filasMaximas = 10;
    }
    if (tipo === 'titulo' || tipo === 'subtitulo' || tipo === 'parrafo') {
      nuevo.contenidoTexto = def?.nombre ?? 'Texto';
      nuevo.etiqueta = '';
    }
    if (tipo === 'separador') nuevo.etiqueta = '';

    this.campos.update(arr => [...arr, nuevo]);
    this.seleccionarCampo(nuevo.id);
    this.emitir();
  }

  private etiquetaDefault(tipo: TipoCampo): string {
    const mapa: Record<string, string> = {
      texto: 'Pregunta de texto', textarea: 'Respuesta larga', numero: 'Cantidad',
      email: 'Correo electrónico', telefono: 'Teléfono', fecha: 'Fecha', hora: 'Hora',
      fecha_hora: 'Fecha y hora', seleccion: 'Elige una opción', radio: 'Selecciona una',
      checkbox: 'Marca las que apliquen', si_no: '¿Confirmas?', archivo: 'Adjunta un archivo',
      imagen: 'Sube una imagen', firma: 'Firma aquí', ubicacion: 'Ubicación',
      calificacion: '¿Cómo lo calificarías?', tabla: 'Completa la tabla',
      titulo: '', subtitulo: '', parrafo: '', separador: ''
    };
    return mapa[tipo] ?? 'Nuevo campo';
  }

  seleccionarCampo(id: string): void {
    this.campoSeleccionadoId.set(id);
    this.tabPropiedades.set('general');
  }

  deseleccionar(): void {
    this.campoSeleccionadoId.set(null);
  }

  actualizarCampo(id: string, cambios: Partial<CampoFormulario>): void {
    this.campos.update(arr => arr.map(c => c.id === id ? { ...c, ...cambios } : c));
    this.emitir();
  }

  eliminarCampo(id: string): void {
    this.guardarEnHistorial();
    this.campos.update(arr => arr.filter(c => c.id !== id));
    if (this.campoSeleccionadoId() === id) this.deseleccionar();
    this.emitir();
  }

  duplicarCampo(id: string): void {
    this.guardarEnHistorial();
    const campo = this.campos().find(c => c.id === id);
    if (!campo) return;
    const copia: CampoFormulario = {
      ...JSON.parse(JSON.stringify(campo)),
      id: this.generarId('campo'),
      etiqueta: campo.etiqueta ? `${campo.etiqueta} (copia)` : ''
    };
    const idx = this.campos().findIndex(c => c.id === id);
    this.campos.update(arr => {
      const nueva = [...arr];
      nueva.splice(idx + 1, 0, copia);
      return nueva;
    });
    this.seleccionarCampo(copia.id);
    this.emitir();
  }

  moverArriba(id: string): void {
    const idx = this.campos().findIndex(c => c.id === id);
    if (idx <= 0) return;
    this.guardarEnHistorial();
    this.campos.update(arr => {
      const nueva = [...arr];
      [nueva[idx - 1], nueva[idx]] = [nueva[idx], nueva[idx - 1]];
      return nueva;
    });
    this.emitir();
  }

  moverAbajo(id: string): void {
    const idx = this.campos().findIndex(c => c.id === id);
    if (idx < 0 || idx >= this.campos().length - 1) return;
    this.guardarEnHistorial();
    this.campos.update(arr => {
      const nueva = [...arr];
      [nueva[idx + 1], nueva[idx]] = [nueva[idx], nueva[idx + 1]];
      return nueva;
    });
    this.emitir();
  }

  onDragStart(id: string): void { this.campoArrastrado.set(id); }
  onDragOver(id: string, event: DragEvent): void {
    event.preventDefault();
    this.campoSobre.set(id);
  }
  onDragLeave(): void { this.campoSobre.set(null); }

  onDrop(idDestino: string): void {
    const idOrigen = this.campoArrastrado();
    if (!idOrigen || idOrigen === idDestino) {
      this.campoArrastrado.set(null);
      this.campoSobre.set(null);
      return;
    }
    this.guardarEnHistorial();
    const arr = [...this.campos()];
    const idxOrigen = arr.findIndex(c => c.id === idOrigen);
    const idxDestino = arr.findIndex(c => c.id === idDestino);
    if (idxOrigen < 0 || idxDestino < 0) return;
    const [movido] = arr.splice(idxOrigen, 1);
    arr.splice(idxDestino, 0, movido);
    this.campos.set(arr);
    this.campoArrastrado.set(null);
    this.campoSobre.set(null);
    this.emitir();
  }

  onDragEnd(): void {
    this.campoArrastrado.set(null);
    this.campoSobre.set(null);
  }

  agregarOpcion(campoId: string): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo) return;
    const lista = campo.opcionesList ?? [];
    const siguiente = lista.length + 1;
    const nueva: OpcionCampo = {
      id: this.generarId('opt'),
      etiqueta: `Opción ${siguiente}`,
      valor: `opcion_${siguiente}`
    };
    this.actualizarCampo(campoId, { opcionesList: [...lista, nueva] });
  }

  actualizarOpcion(campoId: string, opcionId: string, cambios: Partial<OpcionCampo>): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo?.opcionesList) return;
    this.actualizarCampo(campoId, {
      opcionesList: campo.opcionesList.map(o => o.id === opcionId ? { ...o, ...cambios } : o)
    });
  }

  eliminarOpcion(campoId: string, opcionId: string): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo?.opcionesList) return;
    this.actualizarCampo(campoId, {
      opcionesList: campo.opcionesList.filter(o => o.id !== opcionId)
    });
  }

  agregarColumna(campoId: string): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo) return;
    const lista = campo.columnasTabla ?? [];
    const nueva: ColumnaTabla = {
      id: this.generarId('col'),
      etiqueta: `Columna ${lista.length + 1}`,
      tipo: 'texto'
    };
    this.actualizarCampo(campoId, { columnasTabla: [...lista, nueva] });
  }

  actualizarColumna(campoId: string, colId: string, cambios: Partial<ColumnaTabla>): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo?.columnasTabla) return;
    this.actualizarCampo(campoId, {
      columnasTabla: campo.columnasTabla.map(c => c.id === colId ? { ...c, ...cambios } : c)
    });
  }

  eliminarColumna(campoId: string, colId: string): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo?.columnasTabla || campo.columnasTabla.length <= 1) return;
    this.actualizarCampo(campoId, {
      columnasTabla: campo.columnasTabla.filter(c => c.id !== colId)
    });
  }

  agregarOpcionColumna(campoId: string, colId: string): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo?.columnasTabla) return;
    this.actualizarCampo(campoId, {
      columnasTabla: campo.columnasTabla.map(col => {
        if (col.id !== colId) return col;
        const opciones = col.opciones ?? [];
        return { ...col, opciones: [...opciones, { id: this.generarId('opt'), etiqueta: '', valor: this.generarId('val') }] };
      })
    });
  }

  actualizarOpcionColumna(campoId: string, colId: string, optId: string, etiqueta: string): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo?.columnasTabla) return;
    this.actualizarCampo(campoId, {
      columnasTabla: campo.columnasTabla.map(col => {
        if (col.id !== colId) return col;
        return { ...col, opciones: (col.opciones ?? []).map(o => o.id === optId ? { ...o, etiqueta, valor: etiqueta } : o) };
      })
    });
  }

  eliminarOpcionColumna(campoId: string, colId: string, optId: string): void {
    const campo = this.campos().find(c => c.id === campoId);
    if (!campo?.columnasTabla) return;
    this.actualizarCampo(campoId, {
      columnasTabla: campo.columnasTabla.map(col => {
        if (col.id !== colId) return col;
        return { ...col, opciones: (col.opciones ?? []).filter(o => o.id !== optId) };
      })
    });
  }

  private guardarEnHistorial(): void {
    this.historialUndo.push(JSON.parse(JSON.stringify(this.campos())));
    if (this.historialUndo.length > 50) this.historialUndo.shift();
    this.historialRedo = [];
    this.canUndoCampos.set(this.historialUndo.length > 0);
    this.canRedoCampos.set(false);
  }

  undoCampos(): void {
    if (!this.historialUndo.length) return;
    this.historialRedo.push(JSON.parse(JSON.stringify(this.campos())));
    this.campos.set(this.historialUndo.pop()!);
    this.campoSeleccionadoId.set(null);
    this.canUndoCampos.set(this.historialUndo.length > 0);
    this.canRedoCampos.set(true);
    this.emitir();
  }

  redoCampos(): void {
    if (!this.historialRedo.length) return;
    this.historialUndo.push(JSON.parse(JSON.stringify(this.campos())));
    this.campos.set(this.historialRedo.pop()!);
    this.campoSeleccionadoId.set(null);
    this.canUndoCampos.set(true);
    this.canRedoCampos.set(this.historialRedo.length > 0);
    this.emitir();
  }

  abrirTemaDropdown(): void {
    const rect = this.temaBtnRef.nativeElement.getBoundingClientRect();
    this.temaDropdownPos.set({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    this.temaDropdownAbierto.update(v => !v);
  }

  cambiarTema(t: TemaFormulario): void {
    this.temaActual.set(t);
    this.temaCambiado.emit(t);
  }

  toggleVistaPrevia(): void {
    this.modoVistaPrevia.update(v => !v);
    this.deseleccionar();
  }

  exportarJSON(): void {
    const json = JSON.stringify(this.campos(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'formulario.json'; a.click();
    URL.revokeObjectURL(url);
  }

  importarJSON(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const datos = JSON.parse(e.target?.result as string);
        if (Array.isArray(datos)) {
          this.campos.set(this.normalizarCampos(datos));
          this.emitir();
        }
      } catch (err) { console.error('JSON inválido:', err); }
    };
    reader.readAsText(file);
    input.value = '';
  }

  limpiarTodo(): void {
    this.guardarEnHistorial();
    this.campos.set([]);
    this.deseleccionar();
    this.emitir();
  }

  tipoDef(tipo: TipoCampo): DefinicionTipo | undefined {
    return this.tiposDisponibles.find(t => t.tipo === tipo);
  }

  esDecorativo(tipo: TipoCampo): boolean {
    return tipo === 'titulo' || tipo === 'subtitulo' || tipo === 'parrafo' || tipo === 'separador';
  }

  tieneOpciones(tipo: TipoCampo): boolean {
    return tipo === 'seleccion' || tipo === 'radio' || tipo === 'checkbox';
  }

  estrellasArray(max?: number): number[] {
    return Array.from({ length: max ?? 5 }, (_, i) => i + 1);
  }

  // 👇 NUEVOS métodos para el panel de visibilidad

  esCampoVisible(campoId: string): boolean {
    return this.camposVisibles().includes(campoId);
  }

  toggleCampoVisible(campoId: string): void {
    const actuales = this.camposVisibles();
    const nuevo = actuales.includes(campoId)
      ? actuales.filter(id => id !== campoId)
      : [...actuales, campoId];
    this.camposVisibles.set(nuevo);
    this.camposVisiblesCambiados.emit(nuevo);
  }

  marcarTodosVisibles(): void {
    const ids = this.camposGlobales().map(c => c.id);
    this.camposVisibles.set(ids);
    this.camposVisiblesCambiados.emit(ids);
  }

  desmarcarTodos(): void {
    this.camposVisibles.set([]);
    this.camposVisiblesCambiados.emit([]);
  }

  marcarGrupo(origen: string): void {
    const idsGrupo = this.camposGlobales()
      .filter(c => c.origen === origen)
      .map(c => c.id);
    const todosMarcados = idsGrupo.every(id => this.camposVisibles().includes(id));

    let nuevo: string[];
    if (todosMarcados) {
      nuevo = this.camposVisibles().filter(id => !idsGrupo.includes(id));
    } else {
      nuevo = Array.from(new Set([...this.camposVisibles(), ...idsGrupo]));
    }
    this.camposVisibles.set(nuevo);
    this.camposVisiblesCambiados.emit(nuevo);
  }

  iconoTipoGlobal(tipo: string): string {
    const mapa: Record<string, string> = {
      texto: '📝', textarea: '📝', numero: '🔢', email: '📧', telefono: '📞',
      fecha: '📅', hora: '🕐', fecha_hora: '📆',
      seleccion: '▼', radio: '⚪', checkbox: '☑️', si_no: '🔘',
      archivo: '📄', imagen: '🖼️', firma: '✍️', ubicacion: '📍',
      calificacion: '⭐', tabla: '📊'
    };
    return mapa[tipo] || '•';
  }

  private emitir(): void {
    const sanitized = this.campos().map(c => {
      const copia: CampoFormulario = { ...c };
      if (c.opcionesList && c.opcionesList.length > 0) {
        copia.opciones = c.opcionesList.map(o => o.etiqueta).join(', ');
      }
      return copia;
    });
    this.cambio.emit(sanitized);
  }
}