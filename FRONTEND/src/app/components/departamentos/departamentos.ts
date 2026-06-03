import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DepartamentoService } from '../../services/departamento';
import { Departamento, DepartamentoStats } from '../../models/departamento.model';

type VistaDepartamentos = 'tarjetas' | 'lista';
type ColumnaOrdenDepto = 'nombre' | 'estado' | 'funcionarios' | 'tramites';
type DireccionOrden = 'asc' | 'desc';

@Component({
  selector: 'app-departamentos',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './departamentos.html'
})
export class DepartamentosComponent implements OnInit {
  private departamentoService = inject(DepartamentoService);
  private fb = inject(FormBuilder);

  // === Signals de datos ===
  listaDepartamentos = signal<Departamento[]>([]);
  statsPorDepto = signal<Record<string, DepartamentoStats>>({});
  isLoading = signal(true);
  isSaving = signal(false);

  // === Signals de búsqueda y filtros ===
  terminoBusqueda = signal('');
  filtroEstado = signal<'TODOS' | 'ACTIVOS' | 'INACTIVOS'>('TODOS');

  // === Signals de modales ===
  mostrarModal = signal(false);
  deptoEditando = signal<Departamento | null>(null);
  confirmarEliminacion = signal<Departamento | null>(null);
  confirmarToggle = signal<Departamento | null>(null);

  // === Mensajes / notificaciones ===
  mensaje = signal<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // === Signals de vista (tarjetas / lista) ===
  vistaActual = signal<VistaDepartamentos>(this.cargarVistaPreferida());
  columnaOrden = signal<ColumnaOrdenDepto>('nombre');
  direccionOrden = signal<DireccionOrden>('asc');

  // === Signals de paginación ===
  paginaActual = signal(1);
  itemsPorPagina = signal<number>(20);

  // === Formulario reactivo ===
  deptoForm = this.fb.group({
    nombre: ['', [Validators.required, Validators.minLength(3)]],
    descripcion: ['', [Validators.required, Validators.maxLength(200)]]
  });

  constructor() {
    // Effect: resetea a página 1 cuando cambian filtros o búsqueda
    effect(() => {
      this.terminoBusqueda();
      this.filtroEstado();
      this.paginaActual.set(1);
    });

    // Effect: persiste la vista elegida en localStorage
    effect(() => {
      localStorage.setItem('departamentos_vista', this.vistaActual());
    });
  }

  // === Computed: departamentos filtrados y ordenados ===
  departamentosFiltrados = computed(() => {
    const termino = this.terminoBusqueda().toLowerCase().trim();
    const estado = this.filtroEstado();
    const columna = this.columnaOrden();
    const direccion = this.direccionOrden();

    const filtrados = this.listaDepartamentos().filter(d => {
      const matchEstado =
        estado === 'TODOS' ||
        (estado === 'ACTIVOS' && d.activo !== false) ||
        (estado === 'INACTIVOS' && d.activo === false);

      const matchBusqueda = !termino ||
        d.nombre.toLowerCase().includes(termino) ||
        d.descripcion?.toLowerCase().includes(termino);

      return matchEstado && matchBusqueda;
    });

    // Ordenamiento
    return [...filtrados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';
      const statsA = this.getStats(a.id);
      const statsB = this.getStats(b.id);

      switch (columna) {
        case 'nombre':
          valA = a.nombre?.toLowerCase() || '';
          valB = b.nombre?.toLowerCase() || '';
          break;
        case 'estado':
          valA = a.activo !== false ? 1 : 0;
          valB = b.activo !== false ? 1 : 0;
          break;
        case 'funcionarios':
          valA = statsA.funcionarios;
          valB = statsB.funcionarios;
          break;
        case 'tramites':
          valA = statsA.tramitesActivos;
          valB = statsB.tramitesActivos;
          break;
      }

      if (valA < valB) return direccion === 'asc' ? -1 : 1;
      if (valA > valB) return direccion === 'asc' ? 1 : -1;
      return 0;
    });
  });

  // === Computed: departamentos de la página actual ===
  departamentosPaginados = computed(() => {
    const lista = this.departamentosFiltrados();
    const inicio = (this.paginaActual() - 1) * this.itemsPorPagina();
    const fin = inicio + this.itemsPorPagina();
    return lista.slice(inicio, fin);
  });

  // === Computed: total de páginas ===
  totalPaginas = computed(() => {
    const total = this.departamentosFiltrados().length;
    return Math.max(1, Math.ceil(total / this.itemsPorPagina()));
  });

  // === Computed: información de paginación ===
  infoPaginacion = computed(() => {
    const total = this.departamentosFiltrados().length;
    if (total === 0) return { desde: 0, hasta: 0, total: 0 };
    const desde = (this.paginaActual() - 1) * this.itemsPorPagina() + 1;
    const hasta = Math.min(desde + this.itemsPorPagina() - 1, total);
    return { desde, hasta, total };
  });

  // === Computed: totales ===
  totales = computed(() => {
    const todos = this.listaDepartamentos();
    return {
      total: todos.length,
      activos: todos.filter(d => d.activo !== false).length,
      inactivos: todos.filter(d => d.activo === false).length
    };
  });

  // === Computed: detecta filtros activos ===
  hayFiltrosActivos = computed(() => {
    return this.terminoBusqueda().trim() !== '' || this.filtroEstado() !== 'TODOS';
  });

  ngOnInit(): void {
    this.cargarTodo();
  }

  /**
   * Listener global para cerrar modales con la tecla Escape.
   */
  @HostListener('document:keydown.escape')
  cerrarConEsc(): void {
    if (this.confirmarEliminacion()) {
      this.confirmarEliminacion.set(null);
    } else if (this.confirmarToggle()) {
      this.confirmarToggle.set(null);
    } else if (this.mostrarModal()) {
      this.cerrarModal();
    }
  }

  /**
   * Carga la preferencia de vista guardada en localStorage.
   */
  private cargarVistaPreferida(): VistaDepartamentos {
    const guardada = localStorage.getItem('departamentos_vista');
    return guardada === 'lista' ? 'lista' : 'tarjetas';
  }

  /**
   * Cambia la vista entre tarjetas y lista.
   */
  cambiarVista(vista: VistaDepartamentos): void {
    this.vistaActual.set(vista);
  }

  /**
   * Alterna el ordenamiento por columna.
   */
  ordenarPor(columna: ColumnaOrdenDepto): void {
    if (this.columnaOrden() === columna) {
      this.direccionOrden.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.columnaOrden.set(columna);
      this.direccionOrden.set('asc');
    }
  }

  /**
   * Cambia a una página específica de la paginación.
   */
  irAPagina(pagina: number): void {
    if (pagina < 1 || pagina > this.totalPaginas()) return;
    this.paginaActual.set(pagina);
  }

  /**
   * Cambia la cantidad de items por página.
   */
  cambiarItemsPorPagina(cantidad: number): void {
    this.itemsPorPagina.set(cantidad);
    this.paginaActual.set(1);
  }

  cargarTodo(): void {
    this.isLoading.set(true);
    this.departamentoService.getDepartamentos().subscribe({
      next: (datos) => {
        this.listaDepartamentos.set(datos);
        this.isLoading.set(false);

        // Cargar stats en paralelo (silencioso si falla)
        this.departamentoService.obtenerStats().subscribe({
          next: (s) => this.statsPorDepto.set(s),
          error: () => {}
        });
      },
      error: (err) => {
        console.error('Error al cargar departamentos', err);
        this.isLoading.set(false);
        this.mostrarMensaje('error', 'No se pudieron cargar los departamentos');
      }
    });
  }

  abrirModalCrear(): void {
    this.deptoEditando.set(null);
    this.deptoForm.reset({ nombre: '', descripcion: '' });
    this.mostrarModal.set(true);
  }

  abrirModalEditar(depto: Departamento): void {
    this.deptoEditando.set(depto);
    this.deptoForm.patchValue({
      nombre: depto.nombre,
      descripcion: depto.descripcion
    });
    this.mostrarModal.set(true);
  }

  cerrarModal(): void {
    this.mostrarModal.set(false);
    this.deptoEditando.set(null);
  }

  guardar(): void {
    if (this.deptoForm.invalid) {
      this.deptoForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const datos = this.deptoForm.value as Departamento;
    const editando = this.deptoEditando();

    const obs = editando
      ? this.departamentoService.actualizarDepartamento(editando.id!, datos)
      : this.departamentoService.crearDepartamento(datos);

    obs.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.cargarTodo();
        this.cerrarModal();
        this.mostrarMensaje('ok', editando ? 'Departamento actualizado correctamente' : 'Departamento creado correctamente');
      },
      error: (err) => {
        this.isSaving.set(false);
        const msg = typeof err.error === 'string' ? err.error : 'Error al guardar el departamento';
        this.mostrarMensaje('error', msg);
      }
    });
  }

  /**
   * Solicita confirmación para activar/desactivar un departamento.
   */
  solicitarToggle(depto: Departamento): void {
    const stats = this.getStats(depto.id);
    if (depto.activo !== false && stats.funcionarios > 0) {
      this.confirmarToggle.set(depto);
    } else {
      this.ejecutarToggle(depto);
    }
  }

  /**
   * Confirma y ejecuta el toggle desde el modal de confirmación.
   */
  confirmarYToggle(): void {
    const depto = this.confirmarToggle();
    if (!depto) return;
    this.ejecutarToggle(depto);
    this.confirmarToggle.set(null);
  }

  /**
   * Ejecuta el cambio de estado activo/inactivo.
   */
  private ejecutarToggle(depto: Departamento): void {
    this.departamentoService.toggleActivo(depto.id!).subscribe({
      next: (actualizado) => {
        this.cargarTodo();
        this.mostrarMensaje('ok', actualizado.activo ? 'Departamento activado' : 'Departamento desactivado');
      },
      error: () => this.mostrarMensaje('error', 'Error al cambiar el estado')
    });
  }

  /**
   * Solicita confirmación para eliminar un departamento abriendo el modal custom.
   */
  solicitarEliminar(depto: Departamento): void {
    this.confirmarEliminacion.set(depto);
  }

  /**
   * Ejecuta la eliminación definitiva tras la confirmación.
   */
  confirmarYEliminar(): void {
    const depto = this.confirmarEliminacion();
    if (!depto) return;

    this.departamentoService.eliminarDepartamento(depto.id!).subscribe({
      next: () => {
        this.cargarTodo();
        this.mostrarMensaje('ok', `Departamento "${depto.nombre}" eliminado`);
        this.confirmarEliminacion.set(null);
      },
      error: (err) => {
        const msg = typeof err.error === 'string' ? err.error : 'Error al eliminar el departamento';
        this.mostrarMensaje('error', msg);
        this.confirmarEliminacion.set(null);
      }
    });
  }

  /**
   * Limpia el campo de búsqueda.
   */
  limpiarBusqueda(): void {
    this.terminoBusqueda.set('');
  }

  /**
   * Restablece todos los filtros aplicados.
   */
  limpiarFiltros(): void {
    this.terminoBusqueda.set('');
    this.filtroEstado.set('TODOS');
  }

  // === Helpers ===
  private mostrarMensaje(tipo: 'ok' | 'error', texto: string): void {
    this.mensaje.set({ tipo, texto });
    setTimeout(() => this.mensaje.set(null), 4000);
  }

  aplicarFiltroEstado(valor: string): void {
    if (valor === 'TODOS' || valor === 'ACTIVOS' || valor === 'INACTIVOS') {
      this.filtroEstado.set(valor);
    }
  }

  getStats(id?: string): DepartamentoStats {
    if (!id) return { funcionarios: 0, tramitesActivos: 0 };
    return this.statsPorDepto()[id] || { funcionarios: 0, tramitesActivos: 0 };
  }
}