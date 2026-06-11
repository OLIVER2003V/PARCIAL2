import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TramiteService } from '../../services/tramite';
import { Tramite } from '../../models/tramite.model';
import { TimelineProcesoComponent } from '../timeline-proceso/timeline-proceso';
import { DocumentacionTramiteComponent } from '../documentacion-tramite/documentacion-tramite';

@Component({
  selector: 'app-rastrear-tramite',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, TimelineProcesoComponent, DocumentacionTramiteComponent],
  templateUrl: './rastrear-tramite.html',
  styleUrl: './rastrear-tramite.css'
})
export class RastrearTramiteComponent implements OnInit {
  private readonly tramiteService = inject(TramiteService);

  tramiteEncontrado = signal<Tramite | null>(null);
  misTramites = signal<Tramite[]>([]);
  historial = signal<any[]>([]);
  cargandoMisTramites = signal(false);
  errorMisTramites = signal<string | null>(null);

  textoFiltro = signal('');
  filtroEstado = signal('TODOS');

  totalTramites = computed(() => this.misTramites().length);
  tramitesActivos = computed(() =>
    this.misTramites().filter(t => t.estadoSemaforo !== 'APROBADO' && t.estadoSemaforo !== 'RECHAZADO').length
  );

  readonly contadorPorEstado = computed(() => {
    const t = this.misTramites();
    return {
      TODOS: t.length,
      EN_REVISION: t.filter(x => x.estadoSemaforo !== 'APROBADO' && x.estadoSemaforo !== 'RECHAZADO').length,
      APROBADO: t.filter(x => x.estadoSemaforo === 'APROBADO').length,
      RECHAZADO: t.filter(x => x.estadoSemaforo === 'RECHAZADO').length,
    };
  });

  readonly tramitesFiltrados = computed(() => {
    let lista = this.misTramites();

    if (this.filtroEstado() !== 'TODOS') {
      lista = lista.filter(t => {
        if (this.filtroEstado() === 'EN_REVISION') {
          return t.estadoSemaforo !== 'APROBADO' && t.estadoSemaforo !== 'RECHAZADO';
        }
        return t.estadoSemaforo === this.filtroEstado();
      });
    }

    const q = this.textoFiltro().trim().toLowerCase();
    if (q) {
      lista = lista.filter(t =>
        (t.codigoSeguimiento ?? '').toLowerCase().includes(q) ||
        (t.nombreProceso ?? '').toLowerCase().includes(q) ||
        (t.descripcion ?? '').toLowerCase().includes(q) ||
        (t.pasoActualId ?? '').toLowerCase().includes(q)
      );
    }

    return lista;
  });

  ngOnInit(): void {
    this.cargarMisTramites();
  }

  cargarMisTramites(): void {
    this.cargandoMisTramites.set(true);
    this.errorMisTramites.set(null);

    this.tramiteService.misTramites().subscribe({
      next: (tramites) => {
        this.misTramites.set(tramites ?? []);
        this.cargandoMisTramites.set(false);
        if (!this.tramiteEncontrado() && tramites?.length) {
          this.seleccionarTramite(tramites[0]);
        }
      },
      error: () => {
        this.errorMisTramites.set('No se pudo cargar tu historial de tramites.');
        this.cargandoMisTramites.set(false);
      }
    });
  }

  seleccionarTramite(tramite: Tramite): void {
    this.tramiteEncontrado.set(tramite);
    this.cargarHistorial(tramite);
  }

  private cargarHistorial(tramite: Tramite | null): void {
    if (!tramite?.id) {
      this.historial.set([]);
      return;
    }

    this.tramiteService.getHistorial(tramite.id.toString()).subscribe({
      next: (h) => this.historial.set(h),
      error: () => this.historial.set([])
    });
  }

  estadoTexto(estado: string | undefined): string {
    if (estado === 'APROBADO') return 'Aprobado';
    if (estado === 'RECHAZADO') return 'Rechazado';
    return 'En revision';
  }

  estadoClases(estado: string | undefined): string {
    if (estado === 'APROBADO') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (estado === 'RECHAZADO') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }

  estadoIcono(estado: string | undefined): string {
    if (estado === 'APROBADO') return '✓';
    if (estado === 'RECHAZADO') return '×';
    return '•';
  }

  // ── Tour ─────────────────────────────────────────────────────────────────
  tourActive = signal(false);
  tourStep   = signal(0);
  tourRect   = signal<DOMRect | null>(null);

  readonly tourPasos = [
    { id: 'tour-rt-header',   icono: '📂', titulo: 'Mis Trámites',              desc: 'Aquí puedes consultar el estado de todas las solicitudes que iniciaste. Los contadores muestran el total de trámites y cuántos siguen activos (aún en revisión). La lista se actualiza con el botón de recarga.' },
    { id: 'tour-rt-sidebar',  icono: '📋', titulo: 'Lista de solicitudes',       desc: 'Cada fila muestra el nombre del proceso, el código de seguimiento, la fecha y el estado actual. Haz clic en cualquiera para ver su detalle completo en el panel derecho.' },
    { id: 'tour-rt-filtros',  icono: '🔍', titulo: 'Buscar y filtrar',           desc: 'Busca por código o nombre de proceso. Los chips de estado (Todos / En revisión / Aprobados / Rechazados) filtran la lista instantáneamente.' },
    { id: 'tour-rt-ficha',    icono: '🪪', titulo: 'Detalle del trámite',         desc: 'Muestra el código, el nombre del proceso, el estado actual y las fechas de apertura y último movimiento del expediente seleccionado.' },
    { id: 'tour-rt-mapa',     icono: '🗺️', titulo: 'Mapa del proceso',           desc: 'Visualización del flujo BPMN con el paso actual resaltado. Te permite ver exactamente en qué etapa está tu solicitud y cuántos pasos quedan hasta la resolución final.' }
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
}
