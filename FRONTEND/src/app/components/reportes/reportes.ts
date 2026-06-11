import { Component, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReportesGerencialesComponent } from '../reportes-gerenciales/reportes-gerenciales';
import { ReportesNlpComponent } from '../reportes-nlp/reportes-nlp';

type TabReportes = 'gerenciales' | 'nlp';

interface TourPaso {
  id: string;
  icono: string;
  titulo: string;
  desc: string;
  tab: TabReportes | null;
}

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [CommonModule, ReportesGerencialesComponent, ReportesNlpComponent],
  templateUrl: './reportes.html',
  styleUrl: './reportes.css'
})
export class ReportesComponent {

  tabActiva = signal<TabReportes>('gerenciales');

  // Renderizado diferido: Chart.js mide el canvas solo cuando el contenedor es visible.
  gerencialesVisible = signal(true);
  nlpVisible = signal(false);

  cambiarTab(tab: TabReportes): void {
    this.tabActiva.set(tab);
    if (tab === 'gerenciales') this.gerencialesVisible.set(true);
    if (tab === 'nlp')         this.nlpVisible.set(true);
  }

  // ── Tour ─────────────────────────────────────────────────────────────────
  tourActive = signal(false);
  tourStep   = signal(0);
  tourRect   = signal<DOMRect | null>(null);

  readonly tourPasos: TourPaso[] = [
    {
      id: 'tour-rep-tabs',
      icono: '🗂️',
      titulo: 'Dos tipos de reporte',
      desc: 'Cambia entre Reportes Gerenciales (estadísticas con filtros y exportación) y Reportes Inteligentes IA (consultas en lenguaje natural procesadas por Gemini).',
      tab: null
    },
    {
      id: 'tour-g-filtros',
      icono: '🎛️',
      titulo: 'Configurar el reporte',
      desc: 'Establece el rango de fechas, filtra por departamento y por política de negocio. Puedes combinar todos los filtros para obtener un análisis muy específico.',
      tab: 'gerenciales'
    },
    {
      id: 'tour-g-acciones',
      icono: '▶️',
      titulo: 'Generar y exportar',
      desc: '"Analizar Datos" calcula el reporte en el servidor. Una vez generado, puedes descargarlo como PDF ejecutivo o como Excel para trabajarlo en hojas de cálculo.',
      tab: 'gerenciales'
    },
    {
      id: 'tour-n-input',
      icono: '💬',
      titulo: 'Consulta con lenguaje natural',
      desc: 'Escribe tu pregunta tal como la dirías en voz alta. Por ejemplo: "¿Cuántos trámites se aprobaron en mayo?". También puedes usar el micrófono para dictar.',
      tab: 'nlp'
    },
    {
      id: 'tour-n-sugerencias',
      icono: '💡',
      titulo: 'Sugerencias de consulta',
      desc: 'Ejemplos listos para usar. Haz clic en cualquiera para cargarlo en el campo de consulta y ver cómo funciona la IA antes de escribir la tuya.',
      tab: 'nlp'
    },
    {
      id: 'tour-n-historial',
      icono: '📋',
      titulo: 'Historial y resultados',
      desc: 'Cada consulta queda guardada en esta sesión. Puedes ver el resultado de consultas anteriores haciendo clic en ellas. Los gráficos generados aparecen al lado derecho.',
      tab: 'nlp'
    }
  ];

  get tourPasoActual(): TourPaso { return this.tourPasos[this.tourStep()]; }
  get esUltimoPaso(): boolean    { return this.tourStep() === this.tourPasos.length - 1; }

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.tourActive()) this.cerrarTour(); }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onLayoutChange(): void { if (this.tourActive()) this.actualizarRect(); }

  iniciarTour(): void {
    this.tourActive.set(true);
    this.tourStep.set(0);
    setTimeout(() => this.irAlPaso(0), 100);
  }

  siguientePaso(): void {
    if (this.esUltimoPaso) { this.cerrarTour(); return; }
    const next = this.tourStep() + 1;
    this.tourStep.set(next);
    const paso = this.tourPasos[next];
    if (paso.tab) this.cambiarTab(paso.tab);
    // Espera a que el tab y el DOM se estabilicen antes de leer posición
    setTimeout(() => this.irAlPaso(next), 220);
  }

  anteriorPaso(): void {
    if (this.tourStep() === 0) return;
    const prev = this.tourStep() - 1;
    this.tourStep.set(prev);
    const paso = this.tourPasos[prev];
    if (paso.tab) this.cambiarTab(paso.tab);
    setTimeout(() => this.irAlPaso(prev), 220);
  }

  cerrarTour(): void {
    this.tourActive.set(false);
    this.tourRect.set(null);
  }

  private irAlPaso(paso: number): void {
    const el = document.getElementById(this.tourPasos[paso].id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => this.actualizarRect(), 450);
    } else {
      this.tourRect.set(null);
    }
  }

  private actualizarRect(): void {
    if (!this.tourActive()) return;
    const el = document.getElementById(this.tourPasoActual.id);
    this.tourRect.set(el ? el.getBoundingClientRect() : null);
  }
}
