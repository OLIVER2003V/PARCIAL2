import { Injectable, signal } from '@angular/core';

/**
 * 👇 NUEVO UX: Servicio para coordinar estado de UI global entre componentes.
 * - Sidebar colapsado (estado compartido entre sidebar y editor de procesos)
 * - Persistencia en localStorage
 */
@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly sidebarColapsado = signal<boolean>(this.cargarEstado());

  toggleSidebar(): void {
    this.sidebarColapsado.update(v => !v);
    this.persistir();
  }

  colapsarSidebar(): void {
    this.sidebarColapsado.set(true);
    this.persistir();
  }

  expandirSidebar(): void {
    this.sidebarColapsado.set(false);
    this.persistir();
  }

  private cargarEstado(): boolean {
    return localStorage.getItem('ui_sidebar_colapsado') === 'true';
  }

  private persistir(): void {
    localStorage.setItem('ui_sidebar_colapsado', this.sidebarColapsado() ? 'true' : 'false');
  }
}