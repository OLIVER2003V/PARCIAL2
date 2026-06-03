import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DiagramadorBpmnComponent } from '../diagramador-bpmn/diagramador-bpmn';
import { ProcesoService } from '../../services/proceso';
import { ProcesoDefinicion } from '../../models/proceso.model';

/**
 * Componente reutilizable que muestra el diagrama BPMN de una política
 * con resaltado del paso actual y los pasos completados.
 *
 * Uso:
 * <app-visor-proceso
 * [procesoId]="tramite.procesoDefinicionId"
 * [pasoActualId]="tramite.pasoActualId"
 * [pasosCompletados]="['paso1','paso2']">
 * </app-visor-proceso>
 */
@Component({
  selector: 'app-visor-proceso',
  standalone: true,
  imports: [CommonModule, DiagramadorBpmnComponent],
  template: `
    @if (cargando()) {
      <div class="flex items-center justify-center h-72 bg-slate-50 rounded-3xl border border-slate-200 shadow-sm">
        <div class="flex flex-col items-center gap-4">
          <div class="w-10 h-10 border-4 border-slate-200 border-t-brand-primary rounded-full animate-spin"></div>
          <p class="text-xs font-bold text-slate-500 uppercase tracking-widest animate-pulse">Cargando mapa...</p>
        </div>
      </div>
    } @else if (error()) {
      <div class="p-6 bg-red-50 border border-red-200 rounded-3xl text-red-700 text-sm text-center font-medium shadow-sm flex items-center justify-center gap-3">
        <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        {{ error() }}
      </div>
    } @else if (proceso(); as p) {
      <div class="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-md flex flex-col">
        
        <div class="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/80">
          <div>
            <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-0.5">Flujo del proceso</p>
            <p class="text-sm text-slate-900 font-black tracking-tight">{{ p.nombre }}</p>
          </div>
          
          <div class="flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-wider bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
            <span class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-100 border border-emerald-500"></span>
              <span class="text-slate-600">Completado</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-500 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]"></span>
              <span class="text-slate-900">Aquí estás</span>
            </span>
            <span class="flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full bg-slate-100 border border-slate-300"></span>
              <span class="text-slate-500">Pendiente</span>
            </span>
          </div>
        </div>

        <div class="bg-white w-full relative" style="height: 420px;">
          <div class="absolute inset-0 pointer-events-none" style="background-image: radial-gradient(#e2e8f0 1px, transparent 1px); background-size: 24px 24px;"></div>
          
          <app-diagramador-bpmn
            class="absolute inset-0 w-full h-full"
            [xmlInicial]="p.bpmnXml ?? null"
            [soloLectura]="true"
            [pasoActualId]="pasoActualId"
            [pasosCompletados]="pasosCompletados">
          </app-diagramador-bpmn>
        </div>

        @if (nombrePasoActual()) {
          <div class="px-6 py-4 bg-amber-50 border-t border-amber-100 flex items-center gap-4 shadow-inner">
            <div class="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-amber-200 shrink-0">
              <span class="text-xl">📍</span>
            </div>
            <div>
              <p class="text-[10px] text-amber-700/80 font-black uppercase tracking-widest mb-0.5">Etapa actual de la carpeta</p>
              <p class="text-sm text-amber-900 font-bold">{{ nombrePasoActual() }}</p>
            </div>
          </div>
        }
      </div>
    }
  `
})
export class VisorProcesoComponent implements OnChanges {
  @Input() procesoId: string | null = null;
  @Input() pasoActualId: string | null = null;
  @Input() pasosCompletados: string[] = [];

  private procesoService = inject(ProcesoService);

  proceso = signal<ProcesoDefinicion | null>(null);
  cargando = signal(false);
  error = signal<string | null>(null);

  nombrePasoActual = computed(() => {
    const p = this.proceso();
    if (!p || !this.pasoActualId) return null;
    if (this.pasoActualId === 'FIN') return 'Proceso finalizado';
    const paso = p.pasos?.find(x => x.id === this.pasoActualId);
    return paso?.nombre ?? null;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['procesoId']) {
      this.cargarProceso();
    }
  }

  private cargarProceso() {
    if (!this.procesoId) {
      this.proceso.set(null);
      return;
    }
    this.cargando.set(true);
    this.error.set(null);
    this.procesoService.obtenerPorId(this.procesoId).subscribe({
      next: (p) => {
        this.proceso.set(p);
        this.cargando.set(false);
      },
      error: (err) => {
        console.error(err);
        this.error.set('No se pudo cargar el mapa del proceso.');
        this.cargando.set(false);
      }
    });
  }
}