import { Component, OnInit, OnDestroy, computed, inject, signal, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TramiteService } from '../../services/tramite';
import { AuthService } from '../../services/auth';
import { ProcesoService } from '../../services/proceso';
import { IaMonitorService, DatosDashboardIa } from '../../services/ia-monitor.service';
import { AuditoriaService } from '../../services/auditoria';
import { AuditLog } from '../../models/audit-log.model';
import { ProcesoDefinicion } from '../../models/proceso.model';
import Chart from 'chart.js/auto';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly tramiteService   = inject(TramiteService);
  private readonly authService      = inject(AuthService);
  private readonly procesoService   = inject(ProcesoService);
  private readonly iaMonitor        = inject(IaMonitorService);
  private readonly auditoriaService = inject(AuditoriaService);

  rolUsuario    = signal<string | null>(null);
  nombreUsuario = signal<string | null>(null);
  isLoading     = signal(true);
  iaLoading     = signal(true);
  actLoading    = signal(true);

  fechaInicio = signal<string>('');
  fechaFin    = signal<string>('');
  fechaActual = new Date();

  stats = signal({ total: 0, aprobados: 0, rechazados: 0, enProceso: 0 });
  statsPorPolitica = signal<Array<{
    proceso: ProcesoDefinicion; total: number; aprobados: number;
    rechazados: number; enProceso: number;
  }>>([]);

  iaData  = signal<DatosDashboardIa | null>(null);
  actividad = signal<AuditLog[]>([]);

  esAdmin      = computed(() => this.rolUsuario() === 'ADMIN');
  esFuncionario = computed(() => this.rolUsuario() === 'FUNCIONARIO');
  esCliente    = computed(() => this.rolUsuario() === 'CLIENTE');

  iaOnline   = computed(() => this.iaData()?.estado?.servicioOnline === true);
  anomalias  = computed(() => this.iaData()?.distribucion?.anomalias ?? 0);
  criticos   = computed(() => this.iaData()?.criticos ?? []);

  @ViewChild('statsChart') statsChart!: ElementRef;
  chartInstance: any;
  private refreshTimer: any;

  // ── Tour guiado ─────────────────────────────────────────────────────────
  tourActive = signal(false);
  tourStep   = signal(0);

  readonly tourPasos = [
    {
      id: 'tour-filtro',
      icono: '📅',
      titulo: 'Filtro de Período',
      desc: 'Selecciona un rango de fechas para analizar el rendimiento en un período específico. Pulsa "Actualizar" para cargar los datos filtrados.'
    },
    {
      id: 'tour-kpis',
      icono: '📊',
      titulo: 'Indicadores Clave (KPIs)',
      desc: 'Estas 5 tarjetas muestran en tiempo real el estado del sistema: total de trámites, cuántos están en proceso, aprobados, rechazados y anomalías detectadas por la IA. Los porcentajes se calculan automáticamente.'
    },
    {
      id: 'tour-chart',
      icono: '🍩',
      titulo: 'Distribución Visual',
      desc: 'El gráfico de anillo muestra la proporción de trámites por estado. El número central es el total del período. Las tarjetas debajo detallan cada valor con su porcentaje.'
    },
    {
      id: 'tour-tabla',
      icono: '📋',
      titulo: 'Carga por Política',
      desc: 'Desglose proceso por proceso de toda la actividad. Identifica qué política acumula más trabajo, cuál tiene mayor tasa de aprobación y cuál genera más rechazos.'
    },
    {
      id: 'tour-ia',
      icono: '🤖',
      titulo: 'Inteligencia Artificial',
      desc: 'El modelo ML analiza cada trámite en tiempo real y predice riesgo de demora. Aquí ves su estado (online/offline), total de predicciones, anomalías detectadas y casos en nivel crítico.'
    },
    {
      id: 'tour-actividad',
      icono: '⚡',
      titulo: 'Actividad Reciente',
      desc: 'Feed en vivo de las últimas acciones del sistema: logins, creaciones, modificaciones y más. El color del ícono identifica el tipo de evento. Haz clic en "Ver todo" para ir al log completo de auditoría.'
    },
    {
      id: 'tour-acciones',
      icono: '🚀',
      titulo: 'Accesos Rápidos',
      desc: 'Atajos directos a las funciones más usadas: diseñar procesos BPMN, gestionar usuarios, ver reportes gerenciales y consultar la auditoría. Desde aquí puedes llegar a cualquier módulo con un solo clic.'
    }
  ];

  get tourPasoActual() { return this.tourPasos[this.tourStep()]; }
  get esUltimoPaso()   { return this.tourStep() === this.tourPasos.length - 1; }

  iniciarTour() {
    this.tourActive.set(true);
    this.tourStep.set(0);
    setTimeout(() => this.scrollAlPaso(0), 150);
  }

  siguientePaso() {
    if (this.esUltimoPaso) {
      this.cerrarTour();
    } else {
      this.tourStep.set(this.tourStep() + 1);
      this.scrollAlPaso(this.tourStep());
    }
  }

  anteriorPaso() {
    if (this.tourStep() > 0) {
      this.tourStep.set(this.tourStep() - 1);
      this.scrollAlPaso(this.tourStep());
    }
  }

  cerrarTour() { this.tourActive.set(false); }

  scrollAlPaso(paso: number) {
    const el = document.getElementById(this.tourPasos[paso].id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  esPasoActual(id: string): boolean {
    return this.tourActive() && this.tourPasoActual?.id === id;
  }

  ngOnInit() {
    this.rolUsuario.set(this.authService.getRol());
    this.nombreUsuario.set(this.authService.getUsername());

    if (this.esAdmin()) {
      this.cargarStats();
      this.cargarIa();
      this.cargarActividad();
      this.refreshTimer = setInterval(() => {
        this.cargarIa();
        this.cargarActividad();
      }, 60_000);
    } else {
      this.isLoading.set(false);
    }
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.chartInstance) this.chartInstance.destroy();
  }

  cargarStats() {
    this.isLoading.set(true);
    const s = this.fechaInicio(), e = this.fechaFin();
    Promise.all([
      new Promise<any>(r => this.tramiteService.obtenerEstadisticas(s, e).subscribe({ next: r, error: () => r(null) })),
      new Promise<ProcesoDefinicion[]>(r => this.procesoService.obtenerProcesos().subscribe({ next: r, error: () => r([]) })),
      new Promise<any>(r => this.tramiteService.obtenerStatsPorPolitica(s, e).subscribe({ next: r, error: () => r({}) }))
    ]).then(([gs, procesos, map]) => {
      if (gs) this.stats.set({ total: gs.total || 0, aprobados: gs.aprobados || 0, rechazados: gs.rechazados || 0, enProceso: gs.enProceso || 0 });
      const rows = procesos.map(p => {
        const m = map[p.id!] ?? {};
        return { proceso: p, total: m.total ?? 0, aprobados: m.APROBADO ?? 0, rechazados: m.RECHAZADO ?? 0, enProceso: (m.EN_REVISION ?? 0) + (m.EN_TIEMPO ?? 0) + (m.EN_PROCESO ?? 0) };
      }).filter(r => r.total > 0);
      this.statsPorPolitica.set(rows);
      this.isLoading.set(false);
      // Doble requestAnimationFrame: espera 2 ciclos de render para que
      // Angular procese el @else del template y el canvas exista en el DOM
      requestAnimationFrame(() => requestAnimationFrame(() => this.renderChart()));
    });
  }

  cargarIa() {
    this.iaLoading.set(true);
    this.iaMonitor.cargarTodo().subscribe({
      next: d => { this.iaData.set(d); this.iaLoading.set(false); },
      error: () => { this.iaData.set(null); this.iaLoading.set(false); }
    });
  }

  cargarActividad() {
    this.actLoading.set(true);
    this.auditoriaService.consultar({ pagina: 0, tamano: 7 }).subscribe({
      next: r => { this.actividad.set(r.items); this.actLoading.set(false); },
      error: () => { this.actLoading.set(false); }
    });
  }

  renderChart() {
    if (this.stats().total === 0) return;
    if (this.chartInstance) this.chartInstance.destroy();
    if (!this.statsChart?.nativeElement) return;

    const centerPlugin = {
      id: 'center',
      beforeDraw: (c: any) => {
        const { ctx, chartArea: { top, bottom, left, right } } = c;
        ctx.save();
        const cx = left + (right - left) / 2, cy = top + (bottom - top) / 2;
        ctx.font = '700 38px "JetBrains Mono", monospace';
        ctx.fillStyle = '#0F172A';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.stats().total.toString(), cx, cy - 8);
        ctx.font = '600 9px "Outfit", sans-serif';
        ctx.fillStyle = '#64748B';
        ctx.letterSpacing = '2px';
        ctx.fillText('TOTAL', cx, cy + 16);
        ctx.restore();
      }
    };

    this.chartInstance = new Chart(this.statsChart.nativeElement, {
      type: 'doughnut',
      data: {
        labels: ['En Proceso', 'Aprobados', 'Rechazados'],
        datasets: [{ data: [this.stats().enProceso, this.stats().aprobados, this.stats().rechazados], backgroundColor: ['#3B9EFF', '#34D399', '#FF6B87'], borderWidth: 0, hoverOffset: 5 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#64748B', font: { family: '"Outfit", sans-serif', size: 11 }, padding: 14, usePointStyle: true, pointStyleWidth: 7 } } },
        cutout: '72%'
      },
      plugins: [centerPlugin]
    });
  }

  pct(v: number) {
    const t = this.stats().total;
    return t === 0 ? 0 : Math.round((v / t) * 100);
  }

  icoAccion(a: string): string {
    const m: Record<string, string> = { CREATE: '+', UPDATE: '↻', DELETE: '✕', VIEW: '◎', EXPORT: '↓', LOGIN: '→', LOGOUT: '←', AUTH_LOGIN_EXITOSO: '→', AUTH_LOGIN_FALLIDO: '!' };
    return m[a] ?? '·';
  }

  colorAccion(a: string): string {
    if (!a) return 'm';
    if (a.includes('FALLIDO') || a === 'DELETE') return 'd';
    if (a.includes('EXITOSO') || a === 'CREATE') return 's';
    if (a === 'UPDATE') return 'w';
    return 'm';
  }

  catLabel(c: string | null | undefined): string {
    const m: Record<string, string> = { AUTH: 'Auth', TRAMITE: 'Trámite', PROCESO: 'Proceso', USUARIO: 'Usuario', DEPARTAMENTO: 'Depto', SISTEMA: 'Sistema' };
    return c ? (m[c] ?? c) : '—';
  }

  relTime(iso: string): string {
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.floor(d / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  saludo(): string {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  fechaFormateada(): string {
    return this.fechaActual.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
}
