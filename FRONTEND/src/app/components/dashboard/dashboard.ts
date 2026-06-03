import { Component, OnInit, computed, inject, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TramiteService } from '../../services/tramite';
import { AuthService } from '../../services/auth';
import { ProcesoService } from '../../services/proceso';
import { ProcesoDefinicion } from '../../models/proceso.model';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dashboard.html'
})
export class DashboardComponent implements OnInit {
  private tramiteService = inject(TramiteService);
  private authService = inject(AuthService);
  private procesoService = inject(ProcesoService);

  rolUsuario = signal<string | null>(null);
  nombreUsuario = signal<string | null>(null);
  isLoading = signal(true);

  fechaInicio = signal<string>('');
  fechaFin = signal<string>('');

  stats = signal({ total: 0, aprobados: 0, rechazados: 0, enProceso: 0 });
  statsPorPolitica = signal<Array<{
    proceso: ProcesoDefinicion; total: number; aprobados: number;
    rechazados: number; enProceso: number;
  }>>([]);

  esAdmin = computed(() => this.rolUsuario() === 'ADMIN');
  esFuncionario = computed(() => this.rolUsuario() === 'FUNCIONARIO');
  esCliente = computed(() => this.rolUsuario() === 'CLIENTE');

  @ViewChild('statsChart') statsChart!: ElementRef;
  chartInstance: any;

  ngOnInit() {
    this.rolUsuario.set(this.authService.getRol());
    this.nombreUsuario.set(this.authService.getUsername());

    if (this.esAdmin()) {
      this.cargarDatosDashboard();
    } else {
      this.isLoading.set(false);
    }
  }

  cargarDatosDashboard() {
    this.isLoading.set(true);
    const start = this.fechaInicio();
    const end = this.fechaFin();

    Promise.all([
      new Promise<any>(res => this.tramiteService.obtenerEstadisticas(start, end).subscribe({ next: res, error: () => res(null) })),
      new Promise<ProcesoDefinicion[]>(res => this.procesoService.obtenerProcesos().subscribe({ next: res, error: () => res([]) })),
      new Promise<any>(res => this.tramiteService.obtenerStatsPorPolitica(start, end).subscribe({ next: res, error: () => res({}) }))
    ]).then(([globalStats, procesos, statsMap]) => {
      
      if (globalStats) {
        this.stats.set({
           total: globalStats.total || 0,
           aprobados: globalStats.aprobados || 0,
           rechazados: globalStats.rechazados || 0,
           enProceso: globalStats.enProceso || 0
        });
      }

      const combinado = procesos.map(proc => {
        const s = statsMap[proc.id!] ?? {};
        return {
          proceso: proc,
          total: s.total ?? 0,
          aprobados: s.APROBADO ?? 0,
          rechazados: s.RECHAZADO ?? 0,
          enProceso: (s.EN_REVISION ?? 0) + (s.EN_TIEMPO ?? 0) + (s.EN_PROCESO ?? 0)
        };
      }).filter(item => item.total > 0);

      this.statsPorPolitica.set(combinado);
      this.isLoading.set(false);

      setTimeout(() => this.renderizarGrafico(), 0);
    });
  }

  renderizarGrafico() {
    if (this.stats().total === 0) return;

    if (this.chartInstance) {
      this.chartInstance.destroy();
    }

    if (this.statsChart?.nativeElement) {
      
      // Plugin personalizado para dibujar el texto exactamente en el centro
      const centerTextPlugin = {
        id: 'centerText',
        beforeDraw: (chart: any) => {
          const { ctx, chartArea: { top, bottom, left, right } } = chart;
          ctx.save();
          
          // Calcular el centro exacto del área del gráfico (ignorando la leyenda)
          const centerX = left + (right - left) / 2;
          const centerY = top + (bottom - top) / 2;

          // Dibujar el número (Ej: 7)
          ctx.font = '900 48px Inter, sans-serif'; // text-5xl font-black
          ctx.fillStyle = '#0f172a'; // slate-900
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(this.stats().total.toString(), centerX, centerY - 10);

          // Dibujar la etiqueta "TOTAL"
          ctx.font = '700 10px Inter, sans-serif'; // font-bold text-[10px]
          ctx.fillStyle = '#64748b'; // slate-500
          ctx.fillText('TOTAL', centerX, centerY + 20);

          ctx.restore();
        }
      };

      this.chartInstance = new Chart(this.statsChart.nativeElement, {
        type: 'doughnut',
        data: {
          labels: ['En Revisión', 'Aprobados', 'Rechazados'],
          datasets: [{
            data: [this.stats().enProceso, this.stats().aprobados, this.stats().rechazados],
            backgroundColor: ['#3b82f6', '#10b981', '#ef4444'], // Colores que combinan con tu imagen
            borderWidth: 3,
            borderColor: '#ffffff', // Borde blanco para la separación
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { 
              position: 'bottom', 
              labels: { 
                color: '#475569', // slate-600
                font: { family: "'Inter', 'Montserrat', sans-serif", size: 12 },
                padding: 20
              } 
            }
          },
          cutout: '75%' // Grosor del anillo
        },
        plugins: [centerTextPlugin] // Inyectamos el plugin aquí
      });
    }
  }

  getPorcentaje(valor: number): number {
    const total = this.stats().total;
    if (total === 0) return 0;
    return Math.round((valor / total) * 100);
  }
}