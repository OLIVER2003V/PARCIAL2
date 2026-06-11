import { Component, HostListener, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { UsuariosComponent } from '../usuarios/usuarios';
import { DepartamentosComponent } from '../departamentos/departamentos';

type TabOrg = 'usuarios' | 'departamentos';

interface TourPaso {
  id: string;
  icono: string;
  titulo: string;
  desc: string;
  tab: TabOrg | null;
}

@Component({
  selector: 'app-organizacion',
  standalone: true,
  imports: [CommonModule, RouterModule, UsuariosComponent, DepartamentosComponent],
  templateUrl: './organizacion.html',
  styleUrl: './organizacion.css'
})
export class OrganizacionComponent {

  tabActiva = signal<TabOrg>('usuarios');

  // ── Tour ──────────────────────────────────────────────────────────────────
  tourActive  = signal(false);
  tourStep    = signal(0);
  tourRect    = signal<DOMRect | null>(null);

  readonly tourPasos: TourPaso[] = [
    {
      id: 'tour-org-tabs',
      icono: '🗂️',
      titulo: 'Pestañas de sección',
      desc: 'Cambia entre Usuarios y Departamentos con estas pestañas. Al cambiar no se pierden filtros ni búsquedas: todo sigue en memoria.',
      tab: null
    },
    {
      id: 'tour-u-stats',
      icono: '📊',
      titulo: 'Contadores por Rol',
      desc: 'Resumen inmediato de cuentas en el sistema desglosado por tipo: Administradores, Funcionarios y Clientes. Se actualiza en tiempo real.',
      tab: 'usuarios'
    },
    {
      id: 'tour-u-busqueda',
      icono: '🔍',
      titulo: 'Buscar y Filtrar Usuarios',
      desc: 'Escribe nombre, correo o usuario para buscar. Los botones de rol filtran por tipo. Puedes combinar búsqueda y filtro al mismo tiempo.',
      tab: 'usuarios'
    },
    {
      id: 'tour-u-crear',
      icono: '➕',
      titulo: 'Crear Nuevo Usuario',
      desc: 'Agrega una cuenta nueva con rol (Admin, Funcionario o Cliente), nombre completo, correo y departamento asignado.',
      tab: 'usuarios'
    },
    {
      id: 'tour-d-stats',
      icono: '🏢',
      titulo: 'Estado de Departamentos',
      desc: 'Total de áreas y cuántas están activas o inactivas. Un departamento inactivo deja de recibir trámites automáticamente.',
      tab: 'departamentos'
    },
    {
      id: 'tour-d-busqueda',
      icono: '🔍',
      titulo: 'Buscar Departamentos',
      desc: 'Filtra por nombre o descripción. El botón de estado permite ver solo activos o inactivos para gestionar más rápido.',
      tab: 'departamentos'
    },
    {
      id: 'tour-d-crear',
      icono: '➕',
      titulo: 'Crear Departamento',
      desc: 'Crea una nueva área con nombre y descripción. Una vez creada, asígnale funcionarios desde la pestaña de Usuarios.',
      tab: 'departamentos'
    }
  ];

  get tourPasoActual(): TourPaso { return this.tourPasos[this.tourStep()]; }
  get esUltimoPaso(): boolean    { return this.tourStep() === this.tourPasos.length - 1; }

  // ID del elemento activo del tour para pasarlo a los hijos
  tourElementId = computed<string | null>(() =>
    this.tourActive() ? (this.tourPasoActual?.id ?? null) : null
  );

  @HostListener('document:keydown.escape')
  onEsc(): void { if (this.tourActive()) this.cerrarTour(); }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  onLayoutChange(): void {
    if (this.tourActive()) this.actualizarRect();
  }

  iniciarTour(): void {
    this.tourActive.set(true);
    this.tourStep.set(0);
    setTimeout(() => this.irAlPaso(0), 100);
  }

  siguientePaso(): void {
    if (this.esUltimoPaso) {
      this.cerrarTour();
    } else {
      const next = this.tourStep() + 1;
      this.tourStep.set(next);
      const paso = this.tourPasos[next];
      if (paso.tab) this.tabActiva.set(paso.tab);
      setTimeout(() => this.irAlPaso(next), 200);
    }
  }

  anteriorPaso(): void {
    if (this.tourStep() > 0) {
      const prev = this.tourStep() - 1;
      this.tourStep.set(prev);
      const paso = this.tourPasos[prev];
      if (paso.tab) this.tabActiva.set(paso.tab);
      setTimeout(() => this.irAlPaso(prev), 200);
    }
  }

  cerrarTour(): void {
    this.tourActive.set(false);
    this.tourRect.set(null);
  }

  cambiarTab(tab: TabOrg): void { this.tabActiva.set(tab); }

  private irAlPaso(paso: number): void {
    const el = document.getElementById(this.tourPasos[paso].id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Espera a que termine el scroll para leer la posición real
      setTimeout(() => this.actualizarRect(), 450);
    } else {
      this.tourRect.set(null);
    }
  }

  private actualizarRect(): void {
    if (!this.tourActive()) return;
    const el = document.getElementById(this.tourPasoActual.id);
    if (el) {
      this.tourRect.set(el.getBoundingClientRect());
    }
  }
}
