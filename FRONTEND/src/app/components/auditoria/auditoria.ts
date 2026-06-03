import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuditoriaService } from '../../services/auditoria';
import { AuditLog, AuditoriaFiltro, AuditoriaOpciones } from '../../models/audit-log.model';

@Component({
  selector: 'app-auditoria',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auditoria.html'
})
export class AuditoriaComponent implements OnInit {
  private auditoriaService = inject(AuditoriaService);

  // === Datos ===
  logs = signal<AuditLog[]>([]);
  total = signal(0);
  totalPaginas = signal(0);
  opcionesFiltro = signal<AuditoriaOpciones>({ usuarios: [], acciones: [], categorias: [] });
  categoriasPredefinidas = signal<string[]>([]);

  // === Estado ===
  isLoading = signal(true);
  mensaje = signal<{ tipo: 'ok' | 'error' | 'info'; texto: string } | null>(null);

  // === Filtros (signals para reactividad) ===
  filtroUsuario = signal<string>('');
  filtroCategoria = signal<string>('');
  filtroAccion = signal<string>('');
  filtroIp = signal<string>('');
  filtroDesde = signal<string>('');     // YYYY-MM-DD
  filtroHasta = signal<string>('');     // YYYY-MM-DD
  filtroTexto    = signal<string>('');
  filtroEntidad  = signal<string>('');  // CU20: por ID de entidad vinculada

  // === Paginación ===
  paginaActual = signal(0);             // 0-indexed
  itemsPorPagina = signal(20);

  // === Modal de detalle (payload completo) ===
  logSeleccionado = signal<AuditLog | null>(null);

  // === Computed: hay filtros activos? ===
  hayFiltrosActivos = computed(() =>
    this.filtroUsuario()   !== '' ||
    this.filtroCategoria() !== '' ||
    this.filtroAccion()    !== '' ||
    this.filtroIp()        !== '' ||
    this.filtroDesde()     !== '' ||
    this.filtroHasta()     !== '' ||
    this.filtroTexto()     !== '' ||
    this.filtroEntidad()   !== ''
  );

  // === Computed: contadores rápidos por categoría visibles ===
  contadoresPorCategoria = computed(() => {
    const lista = this.logs();
    const conteo: Record<string, number> = {};
    for (const log of lista) {
      const cat = log.categoria || 'SIN_CATEGORIA';
      conteo[cat] = (conteo[cat] || 0) + 1;
    }
    return conteo;
  });

  // === Computed: info paginación ===
  infoPaginacion = computed(() => {
    if (this.total() === 0) return { desde: 0, hasta: 0, total: 0 };
    const desde = this.paginaActual() * this.itemsPorPagina() + 1;
    const hasta = Math.min(desde + this.itemsPorPagina() - 1, this.total());
    return { desde, hasta, total: this.total() };
  });

  ngOnInit(): void {
    this.cargarOpciones();
    this.cargarCategorias();
    this.cargar();
  }

  @HostListener('document:keydown.escape')
  cerrarConEsc(): void {
    if (this.logSeleccionado()) {
      this.logSeleccionado.set(null);
    }
  }

  // ==========================================================================
  // CARGA DE DATOS
  // ==========================================================================

  cargar(): void {
    this.isLoading.set(true);
    const filtros: AuditoriaFiltro = this.construirFiltros();

    this.auditoriaService.consultar(filtros).subscribe({
      next: (resp) => {
        this.logs.set(resp.items);
        this.total.set(resp.total);
        this.totalPaginas.set(resp.totalPaginas);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error consultando auditoría', err);
        this.isLoading.set(false);
        this.mostrarMensaje('error', 'No se pudo cargar el log de auditoría');
      }
    });
  }

  cargarOpciones(): void {
    this.auditoriaService.obtenerOpcionesFiltro().subscribe({
      next: (op) => this.opcionesFiltro.set(op),
      error: () => { } // silencioso, no es crítico
    });
  }

  cargarCategorias(): void {
    this.auditoriaService.obtenerCategorias().subscribe({
      next: (cats) => this.categoriasPredefinidas.set(cats),
      error: () => { }
    });
  }

  private construirFiltros(): AuditoriaFiltro {
    const filtros: AuditoriaFiltro = {
      pagina: this.paginaActual(),
      tamano: this.itemsPorPagina()
    };

    if (this.filtroUsuario()) filtros.usuarioId = this.filtroUsuario();
    if (this.filtroCategoria()) filtros.categoria = this.filtroCategoria();
    if (this.filtroAccion()) filtros.accion = this.filtroAccion();
    if (this.filtroIp()) filtros.ipOrigen = this.filtroIp();
    if (this.filtroTexto())   filtros.textoLibre = this.filtroTexto();
    if (this.filtroEntidad()) filtros.entidadId  = this.filtroEntidad();

    // Convertir YYYY-MM-DD a ISO LocalDateTime
    if (this.filtroDesde()) {
      filtros.desde = this.filtroDesde() + 'T00:00:00';
    }
    if (this.filtroHasta()) {
      filtros.hasta = this.filtroHasta() + 'T23:59:59';
    }

    return filtros;
  }

  // ==========================================================================
  // ACCIONES DEL USUARIO
  // ==========================================================================

  aplicarFiltros(): void {
    this.paginaActual.set(0); 
    this.cargar();
  }

  limpiarFiltros(): void {
    this.filtroUsuario.set('');
    this.filtroCategoria.set('');
    this.filtroAccion.set('');
    this.filtroIp.set('');
    this.filtroDesde.set('');
    this.filtroHasta.set('');
    this.filtroTexto.set('');
    this.filtroEntidad.set('');
    this.paginaActual.set(0);
    this.cargar();
  }

  exportarCsv(): void {
    const filtros = this.construirFiltros();
    delete filtros.pagina;
    delete filtros.tamano;
    this.auditoriaService.exportarCsv(filtros).subscribe({
      next: (blob) => {
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.mostrarMensaje('error', 'No se pudo generar el CSV')
    });
  }

  irAPagina(pagina: number): void {
    if (pagina < 0 || pagina >= this.totalPaginas()) return;
    this.paginaActual.set(pagina);
    this.cargar();
  }

  cambiarItemsPorPagina(cantidad: number): void {
    this.itemsPorPagina.set(cantidad);
    this.paginaActual.set(0);
    this.cargar();
  }

  verDetalle(log: AuditLog): void {
    this.logSeleccionado.set(log);
  }

  cerrarDetalle(): void {
    this.logSeleccionado.set(null);
  }

  filtrarPorCategoria(cat: string): void {
    this.filtroCategoria.set(this.filtroCategoria() === cat ? '' : cat);
    this.aplicarFiltros();
  }

  // ==========================================================================
  // HELPERS DE PRESENTACIÓN
  // ==========================================================================

  formatearFecha(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('es-BO', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
  }

  formatearFechaCorta(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-BO', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  formatearHora(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  }

  ipDisplay(ip?: string | null): string {
    if (!ip) return '—';
    if (ip === '0:0:0:0:0:0:0:1' || ip === '127.0.0.1') return 'localhost';
    return ip;
  }

  /**
   * 👇 ACTUALIZADO PARA LIGHT THEME
   */
  configCategoria(cat?: string | null) {
    switch (cat) {
      case 'AUTH':         return { clase: 'bg-blue-50 text-blue-700 border-blue-200', icon: '🔐', label: 'Auth' };
      case 'POLITICA':     return { clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '📋', label: 'Política' };
      case 'USUARIO':      return { clase: 'bg-purple-50 text-purple-700 border-purple-200', icon: '👤', label: 'Usuario' };
      case 'DEPARTAMENTO': return { clase: 'bg-amber-50 text-amber-700 border-amber-200', icon: '🏢', label: 'Depto.' };
      case 'TRAMITE':      return { clase: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: '📄', label: 'Trámite' };
      case 'SISTEMA':      return { clase: 'bg-slate-100 text-slate-700 border-slate-200', icon: '⚙️', label: 'Sistema' };
      default:             return { clase: 'bg-slate-50 text-slate-500 border-slate-200', icon: '❓', label: 'Sin cat.' };
    }
  }

  /**
   * 👇 ACTUALIZADO PARA LIGHT THEME
   */
  configAccion(accion?: string) {
    if (!accion) return { clase: 'bg-slate-50 text-slate-600 border border-slate-200', icon: '•' };

    const a = accion.toUpperCase();

    if (a.includes('LOGIN_OK') || a.includes('APROBADO') || a.includes('CREAD'))
      return { clase: 'bg-emerald-50 text-emerald-700 border border-emerald-200', icon: '✓' };

    if (a.includes('LOGIN_FALLIDO') || a.includes('RECHAZ') || a.includes('ELIMIN') || a.includes('OBSOLETA'))
      return { clase: 'bg-red-50 text-red-700 border border-red-200', icon: '✕' };

    if (a.includes('PUBLIC') || a.includes('VERSION'))
      return { clase: 'bg-blue-50 text-blue-700 border border-blue-200', icon: '↑' };

    if (a.includes('ACTUALIZ') || a.includes('CAMBIO') || a.includes('TOGGLE'))
      return { clase: 'bg-amber-50 text-amber-700 border border-amber-200', icon: '↻' };

    if (a.includes('INICIADO'))
      return { clase: 'bg-purple-50 text-purple-700 border border-purple-200', icon: '▶' };

    return { clase: 'bg-slate-50 text-slate-600 border border-slate-200', icon: '•' };
  }

  payloadComoTexto(payload?: { [key: string]: any } | null): string {
    if (!payload) return 'Sin payload registrado.';
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  }

  private mostrarMensaje(tipo: 'ok' | 'error' | 'info', texto: string): void {
    this.mensaje.set({ tipo, texto });
    setTimeout(() => this.mensaje.set(null), 3500);
  }
}