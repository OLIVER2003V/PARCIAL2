import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProcesoService } from '../../services/proceso';
import { ProcesoDefinicion, Paso } from '../../models/proceso.model';

interface EtapaTimeline {
  id: string;
  nombre: string;
  estado: 'completado' | 'actual' | 'pendiente' | 'finalizado';
}

@Component({
  selector: 'app-timeline-proceso',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (cargando()) {
      <div class="p-8 bg-white rounded-3xl border border-slate-200 shadow-sm">
        <div class="flex flex-col items-center justify-center space-y-4">
          <div class="w-10 h-10 border-4 border-slate-200 border-t-brand-primary rounded-full animate-spin"></div>
          <p class="text-sm font-medium text-slate-500 uppercase tracking-widest animate-pulse">Cargando progreso...</p>
        </div>
      </div>
    } @else if (etapas().length > 0) {
      <div class="bg-white rounded-3xl border border-slate-200 shadow-lg p-6 md:p-10 relative overflow-hidden">
        
        <div class="absolute top-0 right-0 p-8 opacity-[0.02] pointer-events-none">
          <svg class="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10-4.477 10-10 10zm0-2a8 8 0 100-16 8 8 0 000 16zm-1-7.586V7h2v4.586l3.293 3.293-1.414 1.414L11 12.414z"/></svg>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10 relative z-10">
          <div>
            <p class="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] mb-1">Estado de tu solicitud</p>
            <p class="text-xl md:text-2xl text-slate-900 font-black tracking-tight">{{ tituloEstado() }}</p>
          </div>
          <div class="sm:text-right bg-slate-50 px-4 py-2 rounded-2xl border border-slate-100 shadow-inner inline-flex flex-col items-center sm:items-end w-max">
            <p class="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Avance Total</p>
            <p class="text-3xl text-brand-primary font-black leading-none mt-1">{{ porcentajeAvance() }}<span class="text-xl">%</span></p>
          </div>
        </div>

        <div class="w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-12 shadow-inner border border-slate-200/50 relative z-10">
          <div class="h-full bg-gradient-to-r from-brand-primary to-brand-accent transition-all duration-1000 ease-out rounded-full relative"
               [style.width.%]="porcentajeAvance()">
            <div class="absolute inset-0 bg-white/20 w-full h-full"></div>
          </div>
        </div>

        <div class="relative z-10">
          <div class="hidden md:block absolute top-5 left-8 right-8 h-1.5 bg-slate-100 rounded-full border border-slate-200/50 shadow-inner"></div>

          <div class="flex flex-col md:flex-row md:justify-between gap-8 md:gap-2 relative">
            @for (etapa of etapas(); track etapa.id) {
              <div class="flex md:flex-col items-center gap-4 md:gap-3 flex-1 relative group">
                
                @if ($index !== etapas().length - 1) {
                  <div class="block md:hidden absolute left-5 top-12 bottom-[-2rem] w-1 bg-slate-100 rounded-full border border-slate-200/50 shadow-inner z-0"></div>
                }

                <div class="relative z-10 shrink-0">
                  @switch (etapa.estado) {
                    
                    @case ('completado') {
                      <div class="w-12 h-12 bg-emerald-50 border-2 border-emerald-500 rounded-full flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                        <svg class="w-6 h-6 text-emerald-500" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                      </div>
                    }
                    
                    @case ('actual') {
                      <div class="relative">
                        <div class="absolute inset-0 bg-brand-primary/30 rounded-full animate-ping"></div>
                        <div class="relative w-12 h-12 bg-brand-primary border-4 border-white rounded-full flex items-center justify-center shadow-lg shadow-brand-primary/40">
                          <span class="w-3 h-3 bg-white rounded-full"></span>
                        </div>
                      </div>
                    }
                    
                    @case ('finalizado') {
                      <div class="w-12 h-12 bg-emerald-500 border-4 border-white rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/40 text-white text-xl">
                        🏁
                      </div>
                    }
                    
                    @default {
                      <div class="w-12 h-12 bg-white border-[3px] border-slate-200 rounded-full flex items-center justify-center text-slate-400 text-sm font-black shadow-sm group-hover:border-slate-300 transition-colors">
                        {{ $index + 1 }}
                      </div>
                    }
                  }
                </div>

                <div class="flex-1 md:flex-initial md:text-center md:max-w-[140px] md:px-2">
                  <p class="text-sm font-bold leading-tight md:mt-2"
                     [class.text-emerald-700]="etapa.estado === 'completado' || etapa.estado === 'finalizado'"
                     [class.text-brand-primary]="etapa.estado === 'actual'"
                     [class.text-slate-400]="etapa.estado === 'pendiente'">
                    {{ etapa.nombre }}
                  </p>
                  
                  @if (etapa.estado === 'actual') {
                    <p class="text-[10px] text-brand-primary font-black uppercase tracking-widest mt-1 bg-brand-primary/10 inline-block px-2 py-0.5 rounded-md animate-pulse">
                      📍 Aquí estás
                    </p>
                  }
                  @if (etapa.estado === 'completado') {
                    <p class="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mt-0.5">Completado</p>
                  }
                  @if (etapa.estado === 'pendiente') {
                    <p class="text-[10px] text-slate-400 font-medium mt-0.5">Por hacer</p>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        @if (mensajeContextual()) {
          <div class="mt-12 p-5 rounded-2xl border text-sm flex flex-col sm:flex-row items-center sm:items-start gap-4 relative z-10 shadow-sm"
               [class]="claseMensaje()">
            <div class="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-2xl shrink-0 shadow-sm">
              {{ iconoMensaje() }}
            </div>
            <p class="font-semibold leading-relaxed text-center sm:text-left mt-1 sm:mt-0">{{ mensajeContextual() }}</p>
          </div>
        }
      </div>
    }
  `
})
export class TimelineProcesoComponent implements OnChanges {
  @Input() procesoId: string | null = null;
  @Input() pasoActualId: string | null = null;
  @Input() estado: string = 'EN_REVISION'; // estadoSemaforo del trámite

  private procesoService = inject(ProcesoService);

  proceso = signal<ProcesoDefinicion | null>(null);
  cargando = signal(false);

  etapas = computed<EtapaTimeline[]>(() => {
    const p = this.proceso();
    if (!p || !p.pasos || !p.pasoInicialId) return [];

    const pasosMap = new Map(p.pasos.map(x => [x.id, x]));
    const ordenados: typeof p.pasos = [];
    const visitados = new Set<string>();

    let currentId: string | null = p.pasoInicialId;
    while (currentId && currentId !== 'FIN' && !visitados.has(currentId)) {
      visitados.add(currentId);
      const paso = pasosMap.get(currentId);
      if (!paso) break;
      ordenados.push(paso);

      const siguiente = paso.transiciones.find(t => t.estadoCondicion === 'APROBADO') ?? paso.transiciones[0];
      currentId = siguiente?.pasoDestinoId ?? null;
    }

    const esTareaReal = (pasoId: string) => !pasoId.startsWith('Gateway_');

    const pasosVisibles = ordenados.filter(paso =>
      esTareaReal(paso.id) &&
      paso.departamentoAsignadoId &&
      paso.departamentoAsignadoId !== 'SISTEMA' &&
      !paso.departamentoAsignadoId.startsWith('NO_EXISTE:')
    );

    const finalizado = this.estado === 'APROBADO' || this.estado === 'RECHAZADO';
    if (finalizado) {
      const etapas: EtapaTimeline[] = pasosVisibles.map(p => ({
        id: p.id,
        nombre: p.nombre,
        estado: 'completado' as const
      }));
      etapas.push({
        id: 'fin',
        nombre: this.estado === 'APROBADO' ? 'Aprobado' : 'Rechazado',
        estado: 'finalizado'
      });
      return etapas;
    }

    const idxActual = pasosVisibles.findIndex(p => p.id === this.pasoActualId);

    return pasosVisibles.map((paso, i) => {
      let estadoEtapa: EtapaTimeline['estado'];
      if (idxActual === -1) {
        estadoEtapa = i === 0 ? 'actual' : 'pendiente';
      } else if (i < idxActual) {
        estadoEtapa = 'completado';
      } else if (i === idxActual) {
        estadoEtapa = 'actual';
      } else {
        estadoEtapa = 'pendiente';
      }
      return { id: paso.id, nombre: paso.nombre, estado: estadoEtapa };
    });
  });

  porcentajeAvance = computed(() => {
    const e = this.etapas();
    if (e.length === 0) return 0;
    const completados = e.filter(x => x.estado === 'completado' || x.estado === 'finalizado').length;
    const actual = e.some(x => x.estado === 'actual') ? 0.5 : 0;
    return Math.round(((completados + actual) / e.length) * 100);
  });

  tituloEstado = computed(() => {
    if (this.estado === 'APROBADO') return 'Trámite Finalizado y Aprobado';
    if (this.estado === 'RECHAZADO') return 'Trámite Rechazado / Observado';
    const actual = this.etapas().find(e => e.estado === 'actual');
    return actual ? `En revisión: ${actual.nombre}` : 'En espera de revisión';
  });

  mensajeContextual = computed(() => {
    if (this.estado === 'APROBADO') {
      return 'Su trámite ha culminado el circuito con dictamen favorable. Comuníquese o acérquese para la emisión del certificado final.';
    }
    if (this.estado === 'RECHAZADO') {
      return 'Su trámite ha sido observado o denegado. Revise el historial para conocer los motivos específicos.';
    }
    const actual = this.etapas().find(e => e.estado === 'actual');
    if (actual) {
      return `Actualmente su carpeta está siendo analizada en la etapa "${actual.nombre}". Recibirá novedades al finalizar esta fase.`;
    }
    return null;
  });

  iconoMensaje = computed(() => {
    if (this.estado === 'APROBADO') return '🎉';
    if (this.estado === 'RECHAZADO') return '⚠️';
    return 'ℹ️';
  });

  /* 👇 ACTUALIZADO AL LIGHT THEME */
  claseMensaje = computed(() => {
    if (this.estado === 'APROBADO') return 'bg-emerald-50 border-emerald-200 text-emerald-800';
    if (this.estado === 'RECHAZADO') return 'bg-red-50 border-red-200 text-red-800';
    return 'bg-brand-primary/5 border-brand-primary/20 text-brand-primary';
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
    this.procesoService.obtenerPorId(this.procesoId).subscribe({
      next: (p) => {
        this.proceso.set(p);
        this.cargando.set(false);
      },
      error: () => {
        this.cargando.set(false);
      }
    });
  }
}