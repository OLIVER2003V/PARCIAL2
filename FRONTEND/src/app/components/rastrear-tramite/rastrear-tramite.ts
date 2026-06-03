import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
  templateUrl: './rastrear-tramite.html'
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
}
