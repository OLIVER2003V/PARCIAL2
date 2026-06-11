import {
  Component, HostListener, OnInit, OnDestroy, AfterViewChecked,
  ElementRef, ViewChild, inject, signal, computed
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import Chart from 'chart.js/auto';
import {
  IaMonitorService,
  EstadoIa, DistribucionRiesgo, AnomaliaItem, DeptRiesgo
} from '../../services/ia-monitor.service';

@Component({
  selector: 'app-ia-monitor',
  standalone: true,
  imports: [CommonModule, RouterModule, DatePipe],
  templateUrl: './ia-monitor.html',
  styleUrl: './ia-monitor.css'
})
export class IaMonitorComponent implements OnInit, OnDestroy, AfterViewChecked {
  private readonly service = inject(IaMonitorService);

  @ViewChild('distCanvas') distCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('deptCanvas') deptCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('lossCanvas') lossCanvasRef?: ElementRef<HTMLCanvasElement>;

  estado          = signal<EstadoIa | null>(null);
  distribucion    = signal<DistribucionRiesgo | null>(null);
  anomalias       = signal<AnomaliaItem[]>([]);
  criticos        = signal<AnomaliaItem[]>([]);
  porDep          = signal<DeptRiesgo[]>([]);
  isLoading       = signal(true);
  errorMsg        = signal<string | null>(null);
  entrenando      = signal(false);
  msgEntrenar     = signal<string | null>(null);
  modeloExpandido = signal(false);

  /** Críticos + anomalías fusionados y deduplicados, máximo 10. */
  alertas = computed(() => {
    const seen = new Set<string>();
    return [...this.criticos(), ...this.anomalias()]
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .slice(0, 10);
  });

  private chartDist: Chart | null = null;
  private chartDept: Chart | null = null;
  private chartLoss: Chart | null = null;
  private autoRefreshId?: ReturnType<typeof setInterval>;
  private peticionEnVuelo = false;

  // Flags independientes: uno por canvas que puede aparecer tardíamente en el DOM.
  private debeDibujar     = false; // distCanvas + deptCanvas (siempre visibles tras cargar)
  private debeDibujarLoss = false; // lossCanvas (solo existe cuando modeloExpandido = true)

  ngOnInit() {
    this.cargar();
    this.autoRefreshId = setInterval(() => this.cargar(), 60_000);
  }

  ngAfterViewChecked() {
    // Gráficos principales: se pintan justo después de que los datos llegan
    if (this.debeDibujar && this.distCanvasRef) {
      this.debeDibujar = false;
      this.renderDistribucion();
      this.renderDept();
      // Si la sección ya está expandida al refrescar, renderiza las curvas también
      this.renderLoss();
    }

    // Curvas de entrenamiento: se pintan cuando el usuario abre la sección colapsable
    if (this.debeDibujarLoss && this.lossCanvasRef) {
      this.debeDibujarLoss = false;
      this.renderLoss();
    }
  }

  ngOnDestroy() {
    if (this.autoRefreshId) clearInterval(this.autoRefreshId);
    this.chartDist?.destroy();
    this.chartDept?.destroy();
    this.chartLoss?.destroy();
  }

  cargar() {
    if (this.peticionEnVuelo) return;
    this.peticionEnVuelo = true;
    this.isLoading.set(true);
    this.errorMsg.set(null);
    this.service.cargarTodo().subscribe({
      next: data => {
        this.peticionEnVuelo = false;
        this.estado.set(data.estado);
        this.distribucion.set(data.distribucion);
        this.anomalias.set(data.anomalias);
        this.criticos.set(data.criticos);
        this.porDep.set(data.porDep);
        this.isLoading.set(false);
        this.debeDibujar = true;
      },
      error: err => {
        this.peticionEnVuelo = false;
        console.error('[IaMonitor]', err);
        this.errorMsg.set('No se pudo conectar con el backend.');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Alterna la sección colapsable del modelo.
   * Cuando se expande, activa el flag para que ngAfterViewChecked
   * pinte las curvas de entrenamiento en cuanto el canvas aparece en el DOM.
   */
  toggleModelo() {
    const abriendo = !this.modeloExpandido();
    this.modeloExpandido.set(abriendo);
    if (abriendo) {
      this.debeDibujarLoss = true;
    }
  }

  private renderDistribucion() {
    const canvas = this.distCanvasRef?.nativeElement;
    if (!canvas) return;
    const dist = this.distribucion();
    if (!dist) return;

    this.chartDist?.destroy();
    this.chartDist = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Normal', 'Alto', 'Crítico'],
        datasets: [{
          data: [dist.normal, dist.alto, dist.critico],
          backgroundColor: ['#22c55e33', '#f59e0b33', '#ef444433'],
          borderColor:     ['#22c55e',   '#f59e0b',   '#ef4444'],
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = dist.total > 0
                  ? ((ctx.parsed / dist.total) * 100).toFixed(1)
                  : '0';
                return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  private renderDept() {
    const canvas = this.deptCanvasRef?.nativeElement;
    if (!canvas) return;
    const data = this.porDep();
    if (!data.length) return;

    this.chartDept?.destroy();
    this.chartDept = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map(d => d.departamento),
        datasets: [
          {
            label: 'Normal',
            data: data.map(d => d.normal),
            backgroundColor: '#22c55e33',
            borderColor: '#22c55e',
            borderWidth: 1.5,
          },
          {
            label: 'Alto',
            data: data.map(d => d.alto),
            backgroundColor: '#f59e0b33',
            borderColor: '#f59e0b',
            borderWidth: 1.5,
          },
          {
            label: 'Crítico',
            data: data.map(d => d.critico),
            backgroundColor: '#ef444433',
            borderColor: '#ef4444',
            borderWidth: 1.5,
          },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { stepSize: 1 } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } }
        }
      }
    });
  }

  private renderLoss() {
    const canvas = this.lossCanvasRef?.nativeElement;
    if (!canvas) return;
    const ent = this.estado()?.entrenamiento;
    if (!ent?.loss_history?.length) return;

    const labels = ent.loss_history.map((_, i) => `E${i + 1}`);

    this.chartLoss?.destroy();
    this.chartLoss = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Loss (entrenamiento)',
            data: ent.loss_history,
            borderColor: '#6366f1',
            backgroundColor: '#6366f120',
            tension: 0.3,
            pointRadius: 0,
            fill: true,
          },
          {
            label: 'Val Loss (validación)',
            data: ent.val_loss_history,
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b15',
            tension: 0.3,
            pointRadius: 0,
            fill: true,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } },
        },
        scales: {
          y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
          x: {
            grid: { display: false },
            ticks: {
              callback: (_: unknown, i: number) =>
                i === 0 || (i + 1) % 5 === 0 ? `E${i + 1}` : null
            }
          }
        }
      }
    });
  }

  entrenar() {
    if (this.entrenando()) return;
    this.entrenando.set(true);
    this.msgEntrenar.set(null);
    this.service.entrenar().subscribe({
      next: res => {
        this.msgEntrenar.set(res.mensaje);
        if (res.estado === 'iniciado') {
          setTimeout(() => {
            this.entrenando.set(false);
            this.cargar();
          }, 35000);
        } else {
          this.entrenando.set(false);
        }
      },
      error: () => {
        this.msgEntrenar.set('No se pudo conectar con el microservicio.');
        this.entrenando.set(false);
      }
    });
  }

  pct(n: number): string {
    return (n * 100).toFixed(0) + '%';
  }

  // ── Tour ─────────────────────────────────────────────────────────────────
  tourActive = signal(false);
  tourStep   = signal(0);
  tourRect   = signal<DOMRect | null>(null);

  readonly tourPasos = [
    {
      id: 'tour-ia-header',
      icono: '🧠',
      titulo: 'Monitor IA — vigilancia en tiempo real',
      desc: 'Este módulo ejecuta un modelo de red neuronal (TensorFlow) que analiza cada trámite activo y predice su probabilidad de atrasarse. El indicador muestra si el microservicio Python está en línea. El botón de recarga actualiza todos los datos al instante.'
    },
    {
      id: 'tour-ia-stats',
      icono: '📊',
      titulo: 'Contadores en tiempo real',
      desc: 'Resumen de la salud actual del sistema: total de trámites bajo vigilancia, cuántos están en nivel crítico (riesgo > 70%), cuántas anomalías detectó el modelo y cuántas alertas activas hay en este momento.'
    },
    {
      id: 'tour-ia-alertas',
      icono: '🚨',
      titulo: 'Alertas activas',
      desc: 'Trámites que el modelo marcó como críticos o de alto riesgo. Cada tarjeta muestra el proceso, el motivo de la predicción y la barra de riesgo. El botón "Revisar" te lleva directamente al trámite para actuar sobre él.'
    },
    {
      id: 'tour-ia-graficos',
      icono: '📈',
      titulo: 'Gráficos de distribución',
      desc: 'Izquierda: distribución global de riesgo (Normal / Alto / Crítico) en todos los trámites — el donut muestra proporciones de un vistazo. Derecha: desglose por departamento — identifica qué área acumula más trámites en riesgo.'
    },
    {
      id: 'tour-ia-anomalias',
      icono: '⚠️',
      titulo: 'Tabla de anomalías',
      desc: 'Trámites con patrones atípicos detectados por el modelo: riesgo > 72% y más de 5 días sin avanzar. La tabla muestra código, proceso, barra de riesgo, nivel, motivo de predicción y última actualización. Haz clic en "Revisar" para intervenir.'
    },
    {
      id: 'tour-ia-modelo',
      icono: '⚙️',
      titulo: 'Estado del modelo de IA',
      desc: 'Sección colapsable con las métricas técnicas del modelo: precisión (Val-Loss, Val-MAE), datos de entrenamiento, umbrales de decisión y arquitectura de la red neuronal. Incluye el botón para reentrenar el modelo con nuevos datos sintéticos.'
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
}
