import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TramiteService } from '../../services/tramite';
import { Tramite } from '../../models/tramite.model';

@Component({
  selector: 'app-bandeja-entrada',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './bandeja-entrada.html'
})
export class BandejaEntradaComponent implements OnInit {
  private tramiteService = inject(TramiteService);

  tramitesPendientes = signal<Tramite[]>([]);
  isLoading        = signal<boolean>(false);
  nombreFuncionario = signal<string | null>(localStorage.getItem('username'));
  departamentoId   = signal<string | null>(localStorage.getItem('departamentoId'));
  terminoBusqueda  = signal<string>('');
  filtroEstado     = signal<string>('TODOS');
  sinDepartamento  = signal(false);

  // Estados que consideramos "activos" o "en proceso"
  private estadosRevision = ['EN_REVISION', 'EN_TIEMPO'];
  private estadosFinalizados = ['APROBADO', 'RECHAZADO'];

  conteosPorEstado = computed(() => {
    const todos = this.tramitesPendientes();
    return {
      total:      todos.length,
      enRevision: todos.filter(t => this.estadosRevision.includes(t.estadoSemaforo ?? '')).length,
      aprobados:  todos.filter(t => t.estadoSemaforo === 'APROBADO').length,
      rechazados: todos.filter(t => t.estadoSemaforo === 'RECHAZADO').length,
      pendientes: todos.filter(t => !this.estadosRevision.includes(t.estadoSemaforo ?? '') &&
                                    !this.estadosFinalizados.includes(t.estadoSemaforo ?? '')).length,
      criticos:   todos.filter(t => t.nivelPrioridad === 'CRITICO').length,
      anomalias:  todos.filter(t => t.esAnomalia === true).length,
    };
  });

  tramitesFiltrados = computed(() => {
    const termino = this.terminoBusqueda().toLowerCase().trim();
    const estado  = this.filtroEstado();

    let lista = this.tramitesPendientes();

    if (estado !== 'TODOS') {
      lista = lista.filter(t => {
        const e = t.estadoSemaforo ?? '';
        if (estado === 'EN_REVISION') return this.estadosRevision.includes(e);
        if (estado === 'PENDIENTE')   return !this.estadosRevision.includes(e) && !this.estadosFinalizados.includes(e);
        if (estado === 'CRITICO')     return t.nivelPrioridad === 'CRITICO';
        return e === estado;
      });
    }

    if (termino) {
      lista = lista.filter(t =>
        (t.codigoSeguimiento ?? '').toLowerCase().includes(termino) ||
        (t.clienteId         ?? '').toLowerCase().includes(termino) ||
        (t.nombreProceso     ?? '').toLowerCase().includes(termino)
      );
    }

    // Ordenar: CRITICO primero, luego ALTO, luego NORMAL
    return [...lista].sort((a, b) => {
      const orden: Record<string, number> = { CRITICO: 0, ALTO: 1, NORMAL: 2 };
      const pa = orden[a.nivelPrioridad ?? 'NORMAL'] ?? 2;
      const pb = orden[b.nivelPrioridad ?? 'NORMAL'] ?? 2;
      return pa - pb;
    });
  });

  totalPendientes = computed(() => this.tramitesFiltrados().length);

  ngOnInit() {
    if (!this.departamentoId()) {
      this.sinDepartamento.set(true);
      return;
    }
    this.cargarBandeja();
  }

  cargarBandeja() {
    this.isLoading.set(true);
    this.tramiteService.obtenerBandeja(this.departamentoId()!).subscribe({
      next: (datos: Tramite[]) => {
        this.tramitesPendientes.set(datos);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error al cargar la bandeja', err);
        this.isLoading.set(false);
      }
    });
  }

  getPrioridadConfig(nivel: string | undefined) {
    switch (nivel) {
      case 'CRITICO':
        return { texto: 'Crítico', clase: 'bg-red-100 text-red-700 border-red-300 animate-pulse', icono: '🔴' };
      case 'ALTO':
        return { texto: 'Alto',    clase: 'bg-amber-100 text-amber-700 border-amber-300',         icono: '🟡' };
      default:
        return null; // NORMAL no muestra chip
    }
  }

  getSemaforoConfig(estado: string | undefined) {
    switch (estado) {
      case 'APROBADO':
        return { texto: 'Aprobado',    clase: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotColor: 'bg-emerald-500', borderLeft: 'border-l-emerald-500' };
      case 'RECHAZADO':
        return { texto: 'Rechazado',   clase: 'bg-red-50 text-red-700 border-red-200',             dotColor: 'bg-red-500',     borderLeft: 'border-l-red-500' };
      case 'EN_TIEMPO':
      case 'EN_REVISION':
        return { texto: 'En Revisión', clase: 'bg-blue-50 text-blue-700 border-blue-200',          dotColor: 'bg-blue-500',    borderLeft: 'border-l-blue-500' };
      default:
        return { texto: 'Pendiente',   clase: 'bg-amber-50 text-amber-700 border-amber-200',       dotColor: 'bg-amber-500',   borderLeft: 'border-l-amber-500' };
    }
  }
}