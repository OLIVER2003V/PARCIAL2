import {
  Component, ElementRef, OnDestroy, ViewChild,
  inject, signal, computed, AfterViewChecked, effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import Chart from 'chart.js/auto';
import { ReporteNlpService, ResultadoReporteNlp } from '../../services/reporte-nlp.service';
import { VozReconocimientoService } from '../../services/voz-reconocimiento.service';

interface EntradaHistorial {
  id: string;
  consulta: string;
  resultado: ResultadoReporteNlp | null;
  cargando: boolean;
  timestamp: Date;
}

@Component({
  selector: 'app-reportes-nlp',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './reportes-nlp.html',
})
export class ReportesNlpComponent implements OnDestroy, AfterViewChecked {
  private readonly nlpService = inject(ReporteNlpService);
  readonly vozService = inject(VozReconocimientoService);

  @ViewChild('chartCanvas') chartCanvasRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('inputRef') inputRef?: ElementRef<HTMLTextAreaElement>;

  consulta = signal('');
  historial = signal<EntradaHistorial[]>([]);
  entradaActiva = signal<EntradaHistorial | null>(null);
  private chart?: Chart;
  private debeRedibujar = false;

  constructor() {
    effect(() => {
      const texto = this.vozService.textoReconocido();
      if (texto) this.consulta.set(texto);
    });
  }

  exportandoPdf  = signal(false);
  exportandoExcel = signal(false);

  toggleVoz() {
    this.vozService.toggle(this.consulta());
  }

  exportarPdf() {
    const consulta = this.entradaActiva()?.consulta;
    if (!consulta || this.exportandoPdf()) return;
    this.exportandoPdf.set(true);
    this.nlpService.exportarPdf(consulta).subscribe({
      next: (blob) => {
        this.nlpService.descargarBlob(blob, `reporte-nlp_${this.hoyIso()}.pdf`);
        this.exportandoPdf.set(false);
      },
      error: () => this.exportandoPdf.set(false),
    });
  }

  exportarExcel() {
    const consulta = this.entradaActiva()?.consulta;
    if (!consulta || this.exportandoExcel()) return;
    this.exportandoExcel.set(true);
    this.nlpService.exportarExcel(consulta).subscribe({
      next: (blob) => {
        this.nlpService.descargarBlob(blob, `reporte-nlp_${this.hoyIso()}.xlsx`);
        this.exportandoExcel.set(false);
      },
      error: () => this.exportandoExcel.set(false),
    });
  }

  private hoyIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  readonly procesando = computed(() =>
    this.historial().some(e => e.cargando)
  );

  readonly resultado = computed(() => this.entradaActiva()?.resultado ?? null);

  readonly sugerencias = [
    'Trámites aprobados este mes por departamento',
    'Distribución de trámites por estado',
    'Evolución mensual de solicitudes en 2026',
    'Procesos con más trámites en revisión',
    'Trámites rechazados en el último trimestre',
  ];

  ngOnDestroy() {
    this.chart?.destroy();
  }

  ngAfterViewChecked() {
    if (this.debeRedibujar && this.chartCanvasRef) {
      this.renderizarChart();
      this.debeRedibujar = false;
    }
  }

  enviar() {
    const texto = this.consulta().trim();
    if (!texto || this.procesando()) return;

    const entrada: EntradaHistorial = {
      id: Date.now().toString(36),
      consulta: texto,
      resultado: null,
      cargando: true,
      timestamp: new Date(),
    };

    this.historial.update(h => [entrada, ...h]);
    this.entradaActiva.set(entrada);
    this.consulta.set('');

    this.nlpService.consultar(texto).subscribe({
      next: (res) => {
        this.historial.update(h =>
          h.map(e => e.id === entrada.id ? { ...e, resultado: res, cargando: false } : e)
        );
        const actualizada = this.historial().find(e => e.id === entrada.id)!;
        this.entradaActiva.set(actualizada);
        this.debeRedibujar = true;
      },
      error: () => {
        const errorRes: ResultadoReporteNlp = {
          titulo: 'Error', tipoVisualizacion: 'tabla',
          etiquetas: [], series: [], columnas: [], filas: [],
          totalRegistros: 0, exportable: false,
          error: 'No se pudo conectar con el servicio. Verifica la conexión.',
        };
        this.historial.update(h =>
          h.map(e => e.id === entrada.id ? { ...e, resultado: errorRes, cargando: false } : e)
        );
        const actualizada = this.historial().find(e => e.id === entrada.id)!;
        this.entradaActiva.set(actualizada);
      },
    });
  }

  seleccionar(entrada: EntradaHistorial) {
    this.entradaActiva.set(entrada);
    if (entrada.resultado && !entrada.cargando) {
      this.debeRedibujar = true;
    }
  }

  usarSugerencia(s: string) {
    this.consulta.set(s);
    this.inputRef?.nativeElement.focus();
  }

  onEnter(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.enviar();
    }
  }

  // ─── Chart rendering ──────────────────────────────────────────────────────

  private renderizarChart() {
    const res = this.resultado();
    if (!res || res.error || !this.chartCanvasRef) return;

    const tipo = res.tipoVisualizacion;
    if (tipo === 'tabla') { this.chart?.destroy(); this.chart = undefined; return; }

    const chartType = (tipo === 'mixed' ? 'bar' : tipo) as any;

    this.chart?.destroy();

    const serie = res.series?.[0];
    if (!serie) return;

    const esCircular = tipo === 'pie' || tipo === 'doughnut';
    let backgroundColors: string | string[];
    let borderColors: string | string[];

    if (esCircular) {
      borderColors     = serie.colores      ?? ['#6366f1','#22c55e','#f59e0b','#ef4444','#8b5cf6'];
      backgroundColors = serie.coloresFondo ?? (borderColors as string[]).map(c => c + '33');
    } else {
      borderColors     = serie.color      ?? '#6366f1';
      backgroundColors = serie.colorFondo ?? '#6366f120';
    }

    this.chart = new Chart(this.chartCanvasRef.nativeElement, {
      type: chartType,
      data: {
        labels: res.etiquetas,
        datasets: [{
          label: serie.nombre,
          data:  serie.valores,
          backgroundColor: backgroundColors as any,
          borderColor:     borderColors as any,
          borderWidth: esCircular ? 2 : 2,
          borderRadius: esCircular ? 0 : 6,
          fill: tipo === 'line',
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: esCircular,
            position: 'bottom',
            labels: { font: { size: 12 }, padding: 16 },
          },
          tooltip: {
            callbacks: {
              label: (ctx: { formattedValue: string }) => ` ${ctx.formattedValue} registros`,
            },
          },
        },
        scales: esCircular ? {} : {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: { font: { size: 11 }, precision: 0 },
          },
        },
      },
    });
  }

  iconoTipo(tipo: string): string {
    const m: Record<string, string> = {
      bar: '📊', line: '📈', pie: '🥧', doughnut: '🍩', tabla: '📋', mixed: '📊'
    };
    return m[tipo] ?? '📊';
  }

  formatearHora(d: Date): string {
    return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }
}
