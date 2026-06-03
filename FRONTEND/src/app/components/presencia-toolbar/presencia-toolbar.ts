import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ColaboracionService } from '../../services/colaboracion';
import { AuthService } from '../../services/auth';

// 👇 NUEVO Colaboración: barra de presencia con avatares de conectados
@Component({
  selector: 'app-presencia-toolbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './presencia-toolbar.html'
})
export class PresenciaToolbarComponent {
  private colaboracionService = inject(ColaboracionService);
  private authService = inject(AuthService);

  /** Si es false, el componente no se renderiza (útil cuando no hay sala activa) */
  @Input() visible = true;

  /** Callback opcional cuando el usuario clickea "Invitar" */
  @Input() onInvitarClick: (() => void) | null = null;

  // Estado reactivo del servicio de colaboración
  conectados = this.colaboracionService.conectados;
  totalConectados = this.colaboracionService.totalConectados;
  estoySolo = this.colaboracionService.estoySolo;
  modo = this.colaboracionService.MODO_COLABORACION;

  // Mostrar tooltip (qué username corresponde a qué avatar)
  avatarHover = signal<string | null>(null);

  // Computed: separar mi propio avatar de los demás
  miUsername = computed(() => this.authService.getUsername() ?? '');

  miPresencia = computed(() => {
    const yo = this.miUsername();
    return this.conectados().find(c => c.username === yo) ?? null;
  });

  otrosConectados = computed(() => {
    const yo = this.miUsername();
    return this.conectados().filter(c => c.username !== yo);
  });

  invitar(): void {
    if (this.onInvitarClick) this.onInvitarClick();
  }
}