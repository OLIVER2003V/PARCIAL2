import { Component, HostListener, OnInit, ViewChild, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DiagramadorBpmnComponent } from '../../components/diagramador-bpmn/diagramador-bpmn';
import { ReporteService } from '../../services/reporte.service';
import { ProcesoService } from '../../services/proceso';
import { AnalisisCuellosBotella, PasoMetrica, ProcesoDefinicion } from '../../models/proceso.model';

@Component({
  selector: 'app-mineria-procesos',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DiagramadorBpmnComponent],
  templateUrl: './mineria-procesos.html',
  styleUrl: './mineria-procesos.css'
})
export class MineriaProcesosComponent implements OnInit {
  private route          = inject(ActivatedRoute);
  private router         = inject(Router);
  private reporteService = inject(ReporteService);
  private procesoService = inject(ProcesoService);

  @ViewChild(DiagramadorBpmnComponent) diagramador?: DiagramadorBpmnComponent;

  // ── Estado principal ──────────────────────────────────────────────────────
  procesoId   = signal<string>('');
  proceso     = signal<ProcesoDefinicion | null>(null);
  analisis    = signal<AnalisisCuellosBotella | null>(null);
  isLoading   = signal(true);
  error       = signal<string | null>(null);
  listaProcesos = signal<ProcesoDefinicion[]>([]);

  // ── Interacción diagrama ↔ panel ──────────────────────────────────────────
  pasoResaltado = signal<string | null>(null);

  // ── Filtro de período ─────────────────────────────────────────────────────
  fechaInicio = signal<string>(this.fechaHaceMeses(3));
  fechaFin    = signal<string>(this.hoy());

  // ── Computed: resumen ejecutivo ───────────────────────────────────────────
  resumen = computed(() => {
    const m = this.analisis()?.metricasPorPaso ?? [];
    return {
      cuellos:    m.filter(p => p.colorSemaforo === 'ROJO').length,
      precaucion: m.filter(p => p.colorSemaforo === 'AMARILLO').length,
      optimos:    m.filter(p => p.colorSemaforo === 'VERDE').length,
    };
  });

  // ── Computed: salud global ────────────────────────────────────────────────
  saludGlobal = computed((): 'critica' | 'riesgo' | 'buena' => {
    const r = this.resumen();
    if (r.cuellos > 0)    return 'critica';
    if (r.precaucion > 0) return 'riesgo';
    return 'buena';
  });

  ngOnInit() {
    this.procesoService.obtenerProcesos().subscribe(procesos => {
      this.listaProcesos.set(procesos.filter(p => p.estado !== 'BORRADOR'));
      const idEnUrl = this.route.snapshot.paramMap.get('id');
      if (idEnUrl) {
        this.procesoId.set(idEnUrl);
        this.cargarDatos();
      } else {
        this.isLoading.set(false);
      }
    });
  }

  onSeleccionarProceso(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    this.procesoId.set(id);
    this.pasoResaltado.set(null);
    if (id) this.cargarDatos();
    else { this.proceso.set(null); this.analisis.set(null); }
  }

  seleccionarDesdeCard(p: ProcesoDefinicion) {
    if (!p.id) return;
    this.procesoId.set(p.id);
    this.pasoResaltado.set(null);
    this.cargarDatos();
  }

  aplicarFiltroFecha() {
    if (this.procesoId()) this.cargarDatos();
  }

  cargarDatos() {
    this.isLoading.set(true);
    this.error.set(null);
    this.procesoService.obtenerPorId(this.procesoId()).subscribe({
      next: (proc) => {
        this.proceso.set(proc);
        this.reporteService.getMineriaProcesos(
          this.procesoId(), this.fechaInicio(), this.fechaFin()
        ).subscribe({
          next: (data) => {
            this.analisis.set(data);
            this.isLoading.set(false);
            setTimeout(() => {
              if (this.diagramador) {
                this.diagramador.aplicarHeatmap(data.metricasPorPaso);
              }
            }, 800);
          },
          error: () => {
            this.error.set('Error al cargar métricas de minería.');
            this.isLoading.set(false);
          }
        });
      },
      error: () => {
        this.error.set('Proceso no encontrado.');
        this.isLoading.set(false);
      }
    });
  }

  resaltarPaso(metrica: PasoMetrica) {
    this.pasoResaltado.set(metrica.pasoId);
    this.diagramador?.centrarEnNodo(metrica.pasoId);
  }

  volver() {
    this.router.navigate(['/admin-procesos']);
  }

  // ── Helpers de presentación ───────────────────────────────────────────────

  getEtiquetaSemaforo(color: string): string {
    const map: Record<string, string> = {
      'VERDE':    'Óptimo',
      'AMARILLO': 'En riesgo',
      'ROJO':     'Cuello de botella'
    };
    return map[color] ?? color;
  }

  getBadgeClass(color: string): string {
    switch (color) {
      case 'VERDE':    return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'AMARILLO': return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'ROJO':     return 'bg-red-100 text-red-800 border border-red-200 font-bold';
      default:         return 'bg-slate-100 text-slate-800';
    }
  }

  getRecomendacion(m: PasoMetrica): string | null {
    if (m.colorSemaforo === 'ROJO') {
      if (m.slaObjetivoHoras > 0) {
        const veces = (m.tiempoPromedioHoras / m.slaObjetivoHoras).toFixed(1);
        return `Este paso tarda ${veces}× el SLA objetivo (+${m.desviacionHoras}h). Revisar la carga del departamento responsable o simplificar el flujo.`;
      }
      return `Tiempo real supera el SLA por ${m.desviacionHoras}h. Considerar reasignar recursos.`;
    }
    if (m.colorSemaforo === 'AMARILLO') {
      return `Aproximándose al límite del SLA (+${m.desviacionHoras}h). Monitorear de cerca.`;
    }
    return null;
  }

  // ── Tour ─────────────────────────────────────────────────────────────────
  tourActive = signal(false);
  tourStep   = signal(0);
  tourRect   = signal<DOMRect | null>(null);

  readonly tourPasos = [
    {
      id: 'tour-min-header',
      icono: '🔥',
      titulo: 'Selector de política',
      desc: 'Elige la política de negocio que quieres analizar. Solo aparecen las políticas activas u obsoletas que ya tienen trámites ejecutados — los borradores sin datos no se incluyen.'
    },
    {
      id: 'tour-min-grid',
      icono: '🗂️',
      titulo: 'Cards de políticas disponibles',
      desc: 'Si aún no has seleccionado una política, aparece este grid con todas las disponibles. Haz clic directo en una tarjeta para lanzar el análisis sin usar el menú desplegable.'
    },
    {
      id: 'tour-min-period',
      icono: '📅',
      titulo: 'Filtro de período',
      desc: 'Acota el análisis a un rango de fechas específico. Por defecto muestra los últimos 3 meses. Útil para comparar "¿fue peor este mes que el anterior?" sin recargar todo el historial.'
    },
    {
      id: 'tour-min-summary',
      icono: '📊',
      titulo: 'Resumen ejecutivo',
      desc: 'Diagnóstico de un vistazo: cuántos pasos son cuellos de botella (rojo), cuántos están en riesgo (amarillo) y cuántos funcionan dentro del SLA (verde). El fondo cambia de color según la salud global del proceso.'
    },
    {
      id: 'tour-min-diagram',
      icono: '🗺️',
      titulo: 'Mapa de calor BPMN',
      desc: 'El diagrama original del proceso coloreado en tiempo real. Cada nodo adopta el color de su semáforo: verde (óptimo), amarillo (precaución) o rojo (cuello de botella). Refleja los datos reales de trámites.'
    },
    {
      id: 'tour-min-legend',
      icono: '🎨',
      titulo: 'Leyenda de colores',
      desc: 'Referencia visual rápida del significado de cada color del mapa de calor. Siempre visible para que cualquier administrador entienda el diagrama sin necesitar formación previa.'
    },
    {
      id: 'tour-min-panel',
      icono: '📋',
      titulo: 'Panel de métricas por paso',
      desc: 'Cada tarjeta muestra: tiempo promedio real, SLA objetivo, mediana y desviación. Los pasos rojos y amarillos incluyen una recomendación accionable. Haz clic en una tarjeta para centrar ese nodo en el diagrama.'
    }
  ];

  get tourPasoActual()  { return this.tourPasos[this.tourStep()]; }
  get esUltimoPasoTour(){ return this.tourStep() === this.tourPasos.length - 1; }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.tourActive()) this.cerrarTour(); }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onTourLayout(): void { if (this.tourActive()) this.actualizarRectTour(); }

  iniciarTour(): void {
    this.tourActive.set(true);
    this.tourStep.set(0);
    setTimeout(() => this.irAlPasoTour(0), 100);
  }

  siguientePasoTour(): void {
    if (this.esUltimoPasoTour) { this.cerrarTour(); return; }
    const next = this.tourStep() + 1;
    this.tourStep.set(next);
    setTimeout(() => this.irAlPasoTour(next), 150);
  }

  anteriorPasoTour(): void {
    if (this.tourStep() === 0) return;
    const prev = this.tourStep() - 1;
    this.tourStep.set(prev);
    setTimeout(() => this.irAlPasoTour(prev), 150);
  }

  cerrarTour(): void {
    this.tourActive.set(false);
    this.tourRect.set(null);
  }

  private irAlPasoTour(paso: number): void {
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
  // ─────────────────────────────────────────────────────────────────────────

  private hoy(): string {
    return new Date().toISOString().split('T')[0];
  }

  private fechaHaceMeses(meses: number): string {
    const d = new Date();
    d.setMonth(d.getMonth() - meses);
    return d.toISOString().split('T')[0];
  }
}
