import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';
import { TramiteService } from '../../services/tramite';
import { LayoutService } from '../../services/layout.service';

interface MenuItem {
  label: string;
  icon: string;
  route: string;
  badgeKey?: 'bandeja';
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sidebar.html'
})
export class SidebarComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private tramiteService = inject(TramiteService);
  private layoutService = inject(LayoutService);

  rolUsuario = signal<string | null>(null);
  username = signal<string | null>(null);
  menuItems = signal<MenuItem[]>([]);
  bandejaCount = signal<number>(0);
  colapsado = this.layoutService.sidebarColapsado;

  private intervalId: any = null;

  ngOnInit() {
    const rol = this.authService.getRol();
    this.rolUsuario.set(rol);
    this.username.set(this.authService.getUsername());
    this.generarMenu(rol);

    if (rol === 'FUNCIONARIO') {
      this.refrescarBandejaCount();
      this.intervalId = setInterval(() => this.refrescarBandejaCount(), 30000);
    }
  }

  ngOnDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  toggleColapso(): void {
    this.layoutService.toggleSidebar();
  }

  private refrescarBandejaCount() {
    const deptoId = this.authService.getDepartamentoId();
    if (!deptoId) return;
    this.tramiteService.obtenerBandeja(deptoId).subscribe({
      next: (t) => this.bandejaCount.set(t.length),
      error: () => { }
    });
  }

  generarMenu(rol: string | null) {
    const items: MenuItem[] = [
      { label: 'Inicio', icon: '🏠', route: '/dashboard' }
    ];

    if (rol === 'ADMIN') {
      items.push(
        { label: 'Organización', icon: '👥', route: '/organizacion' },
        { label: 'Motor de Procesos', icon: '🛤️', route: '/admin-procesos' },
        { label: 'Análisis de Rendimiento', icon: '🔥', route: '/admin/mineria' },
        { label: 'Reportes', icon: '📊', route: '/reportes' },
        { label: 'Log de Auditoría', icon: '🛡️', route: '/auditoria' },
        { label: 'Predicciones IA',   icon: '🧠', route: '/ia-monitor' }
      );
    } else if (rol === 'FUNCIONARIO') {
      items.push(
        { label: 'Mi Bandeja', icon: '📥', route: '/bandeja', badgeKey: 'bandeja' }
      );
    } else if (rol === 'CLIENTE') {
      items.push(
        { label: 'Nuevo Trámite', icon: '📝', route: '/nuevo-tramite' },
        { label: 'Mis Trámites', icon: '📁', route: '/rastrear' }
      );
    }

    this.menuItems.set(items);
  }

  logout() {
    this.authService.logout();
  }
}
