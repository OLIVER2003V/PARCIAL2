import { Component, HostListener, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { UsuarioService } from '../../services/usuario';
import { DepartamentoService } from '../../services/departamento';
import { Usuario } from '../../models/usuario.model';
import { Departamento } from '../../models/departamento.model';

type VistaUsuarios = 'tarjetas' | 'lista';
type ColumnaOrden = 'username' | 'rol' | 'ultimaConexion' | 'email';
type DireccionOrden = 'asc' | 'desc';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterModule],
  templateUrl: './usuarios.html'
})
export class UsuariosComponent implements OnInit {
  // Inputs para modo embebido (dentro de OrganizacionComponent)
  embebido = input(false);
  tourId   = input<string | null>(null);

  private usuarioService = inject(UsuarioService);
  private departamentoService = inject(DepartamentoService);
  private fb = inject(FormBuilder);

  // === Signals de datos ===
  listaUsuarios = signal<Usuario[]>([]);
  listaDepartamentos = signal<Departamento[]>([]);
  isLoading = signal(true);
  isSaving = signal(false);

  // === Signals para filtros/búsqueda ===
  terminoBusqueda = signal('');
  filtroRol = signal<'TODOS' | 'ADMIN' | 'FUNCIONARIO' | 'CLIENTE'>('TODOS');

  // === Signals de modales ===
  mostrarModal = signal(false);
  usuarioEditando = signal<Usuario | null>(null);
  confirmarEliminacion = signal<Usuario | null>(null);

  // === Mensajes / notificaciones ===
  mensaje = signal<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // === Signals de vista (tarjetas / lista) ===
  vistaActual = signal<VistaUsuarios>(this.cargarVistaPreferida());
  columnaOrden = signal<ColumnaOrden>('username');
  direccionOrden = signal<DireccionOrden>('asc');

  // === Signals de paginación ===
  paginaActual = signal(1);
  itemsPorPagina = signal<number>(20);

  // === Formulario reactivo ===
  formUsuario = this.fb.group({
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', []],
    nombreCompleto: [''],
    email: ['', [Validators.email]],
    rol: ['FUNCIONARIO' as 'ADMIN' | 'FUNCIONARIO' | 'CLIENTE', [Validators.required]],
    departamentoId: ['']
  });

  constructor() {
    // Effect: resetea a página 1 cuando cambian filtros o búsqueda
    effect(() => {
      this.terminoBusqueda();
      this.filtroRol();
      this.paginaActual.set(1);
    });

    // Effect: persiste la vista elegida en localStorage
    effect(() => {
      localStorage.setItem('usuarios_vista', this.vistaActual());
    });
  }

  // === Computed: usuarios filtrados y ordenados ===
  usuariosFiltrados = computed(() => {
    const termino = this.terminoBusqueda().toLowerCase().trim();
    const rol = this.filtroRol();
    const columna = this.columnaOrden();
    const direccion = this.direccionOrden();

    const filtrados = this.listaUsuarios().filter(u => {
      const matchRol = rol === 'TODOS' || u.rol === rol;
      const matchBusqueda = !termino ||
        u.username.toLowerCase().includes(termino) ||
        u.email?.toLowerCase().includes(termino) ||
        u.nombreCompleto?.toLowerCase().includes(termino);
      return matchRol && matchBusqueda;
    });

    // Ordenamiento
    return [...filtrados].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      switch (columna) {
        case 'username':
          valA = a.username?.toLowerCase() || '';
          valB = b.username?.toLowerCase() || '';
          break;
        case 'email':
          valA = a.email?.toLowerCase() || '';
          valB = b.email?.toLowerCase() || '';
          break;
        case 'rol':
          valA = a.rol || '';
          valB = b.rol || '';
          break;
        case 'ultimaConexion':
          valA = a.ultimaConexion ? new Date(a.ultimaConexion).getTime() : 0;
          valB = b.ultimaConexion ? new Date(b.ultimaConexion).getTime() : 0;
          break;
      }

      if (valA < valB) return direccion === 'asc' ? -1 : 1;
      if (valA > valB) return direccion === 'asc' ? 1 : -1;
      return 0;
    });
  });

  // === Computed: usuarios de la página actual ===
  usuariosPaginados = computed(() => {
    const lista = this.usuariosFiltrados();
    const inicio = (this.paginaActual() - 1) * this.itemsPorPagina();
    const fin = inicio + this.itemsPorPagina();
    return lista.slice(inicio, fin);
  });

  // === Computed: total de páginas ===
  totalPaginas = computed(() => {
    const total = this.usuariosFiltrados().length;
    return Math.max(1, Math.ceil(total / this.itemsPorPagina()));
  });

  // === Computed: información de paginación (ej. "Mostrando 1-20 de 530") ===
  infoPaginacion = computed(() => {
    const total = this.usuariosFiltrados().length;
    if (total === 0) return { desde: 0, hasta: 0, total: 0 };
    const desde = (this.paginaActual() - 1) * this.itemsPorPagina() + 1;
    const hasta = Math.min(desde + this.itemsPorPagina() - 1, total);
    return { desde, hasta, total };
  });

  // === Computed: contadores por rol ===
  totalesPorRol = computed(() => {
    const todos = this.listaUsuarios();
    return {
      total: todos.length,
      admins: todos.filter(u => u.rol === 'ADMIN').length,
      funcionarios: todos.filter(u => u.rol === 'FUNCIONARIO').length,
      clientes: todos.filter(u => u.rol === 'CLIENTE').length
    };
  });

  // === Computed: detecta filtros activos ===
  hayFiltrosActivos = computed(() => {
    return this.terminoBusqueda().trim() !== '' || this.filtroRol() !== 'TODOS';
  });

  ngOnInit(): void {
    this.cargarUsuarios();
    this.cargarDepartamentos();
  }

  @HostListener('document:keydown.escape')
  cerrarConEsc(): void {
    if (this.confirmarEliminacion()) {
      this.confirmarEliminacion.set(null);
    } else if (this.mostrarModal()) {
      this.cerrarModal();
    }
  }

  /**
   * Carga la preferencia de vista guardada en localStorage.
   */
  private cargarVistaPreferida(): VistaUsuarios {
    const guardada = localStorage.getItem('usuarios_vista');
    return guardada === 'lista' ? 'lista' : 'tarjetas';
  }

  /**
   * Cambia la vista entre tarjetas y lista.
   */
  cambiarVista(vista: VistaUsuarios): void {
    this.vistaActual.set(vista);
  }

  /**
   * Alterna el ordenamiento por columna. Si es la misma columna,
   * invierte la dirección; si es otra, arranca en ascendente.
   */
  ordenarPor(columna: ColumnaOrden): void {
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

  cargarUsuarios(): void {
    this.isLoading.set(true);
    this.usuarioService.getUsuarios().subscribe({
      next: (datos) => {
        this.listaUsuarios.set(datos);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error cargando usuarios', err);
        this.isLoading.set(false);
        this.mostrarMensaje('error', 'No se pudieron cargar los usuarios');
      }
    });
  }

  cargarDepartamentos(): void {
    this.departamentoService.getDepartamentos().subscribe(datos =>
      this.listaDepartamentos.set(datos)
    );
  }

  abrirModalCrear(): void {
    this.usuarioEditando.set(null);
    this.formUsuario.reset({
      username: '',
      password: '',
      nombreCompleto: '',
      email: '',
      rol: 'FUNCIONARIO',
      departamentoId: ''
    });
    this.formUsuario.get('password')?.setValidators([Validators.required, Validators.minLength(6)]);
    this.formUsuario.get('password')?.updateValueAndValidity();
    this.mostrarModal.set(true);
  }

  abrirModalEditar(usuario: Usuario): void {
    this.usuarioEditando.set(usuario);
    this.formUsuario.patchValue({
      username: usuario.username,
      password: '',
      nombreCompleto: usuario.nombreCompleto || '',
      email: usuario.email || '',
      rol: usuario.rol,
      departamentoId: usuario.departamentoId || ''
    });
    this.formUsuario.get('password')?.setValidators([Validators.minLength(6)]);
    this.formUsuario.get('password')?.updateValueAndValidity();
    this.mostrarModal.set(true);
  }

  cerrarModal(): void {
    this.mostrarModal.set(false);
    this.usuarioEditando.set(null);
  }

  guardar(): void {
    if (this.formUsuario.invalid) {
      this.formUsuario.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const datos = this.formUsuario.value as Usuario;
    const editando = this.usuarioEditando();

    const payload: any = { ...datos };
    if (editando && (!payload.password || payload.password.trim() === '')) {
      delete payload.password;
    }

    if (payload.rol !== 'FUNCIONARIO') {
      payload.departamentoId = null;
    }

    const obs = editando
      ? this.usuarioService.actualizarUsuario(editando.id!, payload)
      : this.usuarioService.crearUsuario(payload);

    obs.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.cargarUsuarios();
        this.cerrarModal();
        this.mostrarMensaje('ok', editando ? 'Usuario actualizado correctamente' : 'Usuario creado correctamente');
      },
      error: (err) => {
        this.isSaving.set(false);
        const msg = typeof err.error === 'string' ? err.error : 'Error al guardar el usuario';
        this.mostrarMensaje('error', msg);
      }
    });
  }

  cambiarEstado(usuario: Usuario, nuevoEstado: string): void {
    this.usuarioService.actualizarEstado(usuario.id!, nuevoEstado).subscribe({
      next: () => {
        this.cargarUsuarios();
        this.mostrarMensaje('ok', `Estado actualizado a ${nuevoEstado}`);
      },
      error: () => this.mostrarMensaje('error', 'Error al cambiar el estado')
    });
  }

  solicitarEliminar(usuario: Usuario): void {
    this.confirmarEliminacion.set(usuario);
  }

  confirmarYEliminar(): void {
    const usuario = this.confirmarEliminacion();
    if (!usuario) return;

    this.usuarioService.eliminarUsuario(usuario.id!).subscribe({
      next: () => {
        this.cargarUsuarios();
        this.mostrarMensaje('ok', `Usuario "${usuario.username}" eliminado`);
        this.confirmarEliminacion.set(null);
      },
      error: () => {
        this.mostrarMensaje('error', 'Error al eliminar el usuario');
        this.confirmarEliminacion.set(null);
      }
    });
  }

  limpiarBusqueda(): void {
    this.terminoBusqueda.set('');
  }

  limpiarFiltros(): void {
    this.terminoBusqueda.set('');
    this.filtroRol.set('TODOS');
  }

  private mostrarMensaje(tipo: 'ok' | 'error', texto: string): void {
    this.mensaje.set({ tipo, texto });
    setTimeout(() => this.mensaje.set(null), 3500);
  }

  seleccionarRol(rol: string): void {
    if (rol === 'ADMIN' || rol === 'FUNCIONARIO' || rol === 'CLIENTE') {
      this.formUsuario.patchValue({ rol });
    }
  }

  aplicarFiltroRol(valor: string): void {
    if (valor === 'TODOS' || valor === 'ADMIN' || valor === 'FUNCIONARIO' || valor === 'CLIENTE') {
      this.filtroRol.set(valor);
    }
  }

  nombreDepartamento(id?: string): string {
    if (!id) return 'Sin asignar';
    const d = this.listaDepartamentos().find(x => x.id === id);
    return d?.nombre || 'Desconocido';
  }

  tiempoRelativo(fecha?: string): string {
    if (!fecha) return 'Nunca';
    const ahora = new Date().getTime();
    const entonces = new Date(fecha).getTime();
    const diff = Math.floor((ahora - entonces) / 1000);

    if (diff < 60) return 'hace unos segundos';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    if (diff < 604800) return `hace ${Math.floor(diff / 86400)} días`;
    return new Date(fecha).toLocaleDateString();
  }

  configEstado(estado?: string) {
    switch (estado) {
      case 'DISPONIBLE': return { color: 'emerald', label: 'Disponible', dot: '🟢' };
      case 'AUSENTE': return { color: 'amber', label: 'Ausente', dot: '🟡' };
      case 'VACACIONES': return { color: 'blue', label: 'Vacaciones', dot: '🔵' };
      default: return { color: 'slate', label: 'Sin estado', dot: '⚪' };
    }
  }

  configRol(rol: string) {
    switch (rol) {
      case 'ADMIN': return {
        clase: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
        avatarGradient: 'from-purple-500 to-purple-700',
        dotColor: 'bg-purple-400',
        label: 'Admin',
        descripcion: 'Control total del sistema'
      };
      case 'FUNCIONARIO': return {
        clase: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
        avatarGradient: 'from-emerald-500 to-emerald-700',
        dotColor: 'bg-emerald-400',
        label: 'Funcionario',
        descripcion: 'Gestiona procesos y tareas'
      };
      case 'CLIENTE': return {
        clase: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
        avatarGradient: 'from-blue-500 to-blue-700',
        dotColor: 'bg-blue-400',
        label: 'Cliente',
        descripcion: 'Acceso a sus propias solicitudes'
      };
      default: return {
        clase: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
        avatarGradient: 'from-slate-500 to-slate-700',
        dotColor: 'bg-slate-400',
        label: rol,
        descripcion: ''
      };
    }
  }
}