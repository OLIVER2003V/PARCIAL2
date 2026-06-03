import {
  Component, ElementRef, OnInit, ViewChild,
  computed, inject, signal, effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import Chart from 'chart.js/auto';

import { ReporteService, ReporteGerencial, FiltrosReporte } from '../../services/reporte.service';
import { DepartamentoService } from '../../services/departamento';
import { ProcesoService } from '../../services/proceso';
import { Departamento } from '../../models/departamento.model';
import { ProcesoDefinicion } from '../../models/proceso.model';

@Component({
  selector: 'app-reportes-gerenciales',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reportes-gerenciales.html'
})
export class ReportesGerencialesComponent implements OnInit {
  private reporteService = inject(ReporteService);
  private departamentoService = inject(DepartamentoService);
  private procesoService = inject(ProcesoService);

  // === Filtros ===
  fechaInicio = signal<string>(this.fechaHaceMeses(3));
  fechaFin = signal<string>(this.hoy());
  departamentoId = signal<string>('');      // '' = todos
  procesoDefinicionId = signal<string>(''); // '' = todas

  // === Catálogos para dropdowns ===
  departamentos = signal<Departamento[]>([]);
  politicas = signal<ProcesoDefinicion[]>([]);

  // === Estado del reporte ===
  reporte = signal<ReporteGerencial | null>(null);
  isLoading = signal(false);
  isDescargando = signal<'pdf' | 'excel' | null>(null);
  mensaje = signal<{ tipo: 'ok' | 'error' | 'warning'; texto: string } | null>(null);

  // === Charts ===
  @ViewChild('chartEstados') chartEstadosRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartTendencia') chartTendenciaRef?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartDepartamentos') chartDepartamentosRef?: ElementRef<HTMLCanvasElement>;
  private chartEstados?: Chart;
  private chartTendencia?: Chart;
  private chartDepartamentos?: Chart;

  // === Computed: hay datos válidos que mostrar ===
  hayReporte = computed(() => !!this.reporte() && !this.reporte()!.sinDatos);
  sinDatos = computed(() => !!this.reporte() && this.reporte()!.sinDatos);

  constructor() {
    // Re-render charts cuando cambia el reporte
    effect(() => {
      const r = this.reporte();
      if (r && !r.sinDatos) {
        queueMicrotask(() => this.renderizarCharts());
      }
    });
  }

  ngOnInit() {
    this.cargarCatalogos();
  }

  private cargarCatalogos() {
    this.departamentoService.getDepartamentos().subscribe({
      next: (d) => this.departamentos.set(d),
      error: () => this.mostrarMensaje('error', 'No se pudieron cargar los departamentos')
    });

    this.procesoService.obtenerProcesos().subscribe({
      next: (p) => this.politicas.set(p),
      error: () => this.mostrarMensaje('error', 'No se pudieron cargar las políticas')
    });
  }

  // ============================================================
  // GENERAR PREVIEW
  // ============================================================
  generarReporte() {
    if (!this.validarFiltros()) return;

    this.isLoading.set(true);
    this.reporte.set(null);
    this.destruirCharts();

    const filtros = this.construirFiltros();

    this.reporteService.generarPreview(filtros).subscribe({
      next: (r) => {
        this.reporte.set(r);
        this.isLoading.set(false);
        if (r.sinDatos) {
          this.mostrarMensaje('warning', r.mensajeSinDatos || 'No hay registros para el período seleccionado');
        } else {
          this.mostrarMensaje('ok', 'Reporte generado correctamente');
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        const msg = err.error?.error || err.error?.message || 'Error al generar el reporte';
        this.mostrarMensaje('error', msg);
      }
    });
  }

  // ============================================================
  // DESCARGAR PDF
  // ============================================================
  descargarPdf() {
    if (!this.validarFiltros()) return;
    if (!this.hayReporte()) {
      this.mostrarMensaje('warning', 'Primero genera el preview para asegurarte de que hay datos');
      return;
    }

    this.isDescargando.set('pdf');
    this.reporteService.descargarPdf(this.construirFiltros()).subscribe({
      next: (blob) => {
        this.guardarArchivo(blob, `reporte-gerencial_${this.fechaInicio()}_${this.fechaFin()}.pdf`);
        this.mostrarMensaje('ok', 'PDF descargado correctamente');
        this.isDescargando.set(null);
      },
      error: async (err) => {
        const msg = await this.parsearErrorBlob(err);
        this.mostrarMensaje('error', msg);
        this.isDescargando.set(null);
      }
    });
  }

  // ============================================================
  // DESCARGAR EXCEL
  // ============================================================
  descargarExcel() {
    if (!this.validarFiltros()) return;
    if (!this.hayReporte()) {
      this.mostrarMensaje('warning', 'Primero genera el preview para asegurarte de que hay datos');
      return;
    }

    this.isDescargando.set('excel');
    this.reporteService.descargarExcel(this.construirFiltros()).subscribe({
      next: (blob) => {
        this.guardarArchivo(blob, `reporte-gerencial_${this.fechaInicio()}_${this.fechaFin()}.xlsx`);
        this.mostrarMensaje('ok', 'Excel descargado correctamente');
        this.isDescargando.set(null);
      },
      error: async (err) => {
        const msg = await this.parsearErrorBlob(err);
        this.mostrarMensaje('error', msg);
        this.isDescargando.set(null);
      }
    });
  }

  // ============================================================
  // GRÁFICOS (Chart.js) - ACTUALIZADO PARA LIGHT THEME
  // ============================================================
  private renderizarCharts() {
    const r = this.reporte();
    if (!r || r.sinDatos) return;

    // --- 1. Dona: distribución de estados
    if (this.chartEstadosRef?.nativeElement && r.resumenEjecutivo) {
      this.chartEstados?.destroy();
      const re = r.resumenEjecutivo;
      this.chartEstados = new Chart(this.chartEstadosRef.nativeElement, {
        type: 'doughnut',
        data: {
          labels: ['Aprobados', 'Rechazados', 'En curso'],
          datasets: [{
            data: [re.tramitesAprobados, re.tramitesRechazados, re.tramitesEnCurso],
            backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: '#475569', font: { family: "'Inter', sans-serif" } } } },
          cutout: '70%'
        }
      });
    }

    // --- 2. Línea: tendencia temporal (iniciados vs completados)
    if (this.chartTendenciaRef?.nativeElement && r.tendenciaTemporal) {
      this.chartTendencia?.destroy();
      const serie = r.tendenciaTemporal.seriePorDia;
      this.chartTendencia = new Chart(this.chartTendenciaRef.nativeElement, {
        type: 'line',
        data: {
          labels: serie.map(p => p.fecha),
          datasets: [
            {
              label: 'Iniciados',
              data: serie.map(p => p.iniciados),
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              tension: 0.3,
              fill: true
            },
            {
              label: 'Completados',
              data: serie.map(p => p.completados),
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              tension: 0.3,
              fill: true
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { color: '#475569', font: { family: "'Inter', sans-serif" } } } },
          scales: {
            x: { ticks: { color: '#64748B', maxRotation: 0, autoSkipPadding: 20 }, grid: { color: '#E2E8F0' } },
            y: { ticks: { color: '#64748B' }, grid: { color: '#E2E8F0' }, beginAtZero: true }
          }
        }
      });
    }

    // --- 3. Barras horizontales: trámites por departamento
    if (this.chartDepartamentosRef?.nativeElement && r.desempenioDepartamentos.length) {
      this.chartDepartamentos?.destroy();
      const top = [...r.desempenioDepartamentos]
        .sort((a, b) => b.tramitesProcesados - a.tramitesProcesados)
        .slice(0, 10);
      this.chartDepartamentos = new Chart(this.chartDepartamentosRef.nativeElement, {
        type: 'bar',
        data: {
          labels: top.map(d => d.departamentoNombre),
          datasets: [{
            label: 'Trámites procesados',
            data: top.map(d => d.tramitesProcesados),
            backgroundColor: '#6366F1', // indigo-500
            borderRadius: 6
          }]
        },
        // ... (resto de las opciones del chart)
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { color: '#64748B' }, grid: { color: '#E2E8F0' }, beginAtZero: true },
            // 👇 Aquí está la corrección: cambiamos '600' por 'bold'
            y: { ticks: { color: '#475569', font: { weight: 'bold' } }, grid: { display: false } }
          }
        }
      });
    }
  }

  private destruirCharts() {
    this.chartEstados?.destroy();
    this.chartTendencia?.destroy();
    this.chartDepartamentos?.destroy();
    this.chartEstados = undefined;
    this.chartTendencia = undefined;
    this.chartDepartamentos = undefined;
  }

  // ============================================================
  // HELPERS
  // ============================================================
  private validarFiltros(): boolean {
    if (!this.fechaInicio() || !this.fechaFin()) {
      this.mostrarMensaje('error', 'Selecciona un rango de fechas válido');
      return false;
    }
    if (this.fechaInicio() > this.fechaFin()) {
      this.mostrarMensaje('error', 'La fecha de inicio no puede ser posterior a la fecha de fin');
      return false;
    }
    return true;
  }

  private construirFiltros(): FiltrosReporte {
    return {
      fechaInicio: this.fechaInicio(),
      fechaFin: this.fechaFin(),
      departamentoId: this.departamentoId() || null,
      procesoDefinicionId: this.procesoDefinicionId() || null
    };
  }

  private guardarArchivo(blob: Blob, nombre: string) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  private async parsearErrorBlob(err: any): Promise<string> {
    try {
      if (err.error instanceof Blob) {
        const txt = await err.error.text();
        const parsed = JSON.parse(txt);
        return parsed.error || parsed.message || 'Error al descargar el archivo';
      }
      return err.error?.error || err.message || 'Error al descargar el archivo';
    } catch {
      return 'Error al descargar el archivo';
    }
  }

  private mostrarMensaje(tipo: 'ok' | 'error' | 'warning', texto: string) {
    this.mensaje.set({ tipo, texto });
    setTimeout(() => this.mensaje.set(null), 4000);
  }

  private hoy(): string {
    return new Date().toISOString().substring(0, 10);
  }

  private fechaHaceMeses(meses: number): string {
    const d = new Date();
    d.setMonth(d.getMonth() - meses);
    return d.toISOString().substring(0, 10);
  }

  // ============================================================
  // UTILIDADES PARA EL TEMPLATE
  // ============================================================
  formatearDistribucion(dist: Record<string, number>): Array<{ accion: string; cantidad: number; pct: number }> {
    const total = Object.values(dist).reduce((s, n) => s + n, 0);
    if (total === 0) return [];
    return Object.entries(dist)
      .map(([accion, cantidad]) => ({
        accion,
        cantidad,
        pct: Math.round((cantidad / total) * 100)
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }

  colorPorAccion(accion: string): string {
    const up = accion.toUpperCase();
    if (up.includes('APROB') || up === 'SI' || up === 'BUENO') return 'bg-emerald-500';
    if (up.includes('RECHAZ') || up === 'NO' || up === 'MALO') return 'bg-red-500';
    if (up.includes('REVIS')) return 'bg-amber-500';
    return 'bg-blue-500';
  }

  limpiarFiltros() {
    this.fechaInicio.set(this.fechaHaceMeses(3));
    this.fechaFin.set(this.hoy());
    this.departamentoId.set('');
    this.procesoDefinicionId.set('');
    this.reporte.set(null);
    this.destruirCharts();
  }
}