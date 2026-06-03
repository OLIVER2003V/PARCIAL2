import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvitacionColaboracionService } from '../../services/invitacion-colaboracion';
import { AdminDisponible } from '../../models/colaboracion.model';

type Tab = 'link' | 'admins';

// 👇 NUEVO Colaboración: modal con dos tabs (Link compartible / Lista interna)
@Component({
  selector: 'app-invitar-colaboradores',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './invitar-colaboradores.html'
})
export class InvitarColaboradoresComponent implements OnInit {
  private invitacionService = inject(InvitacionColaboracionService);

  @Input({ required: true }) procesoId!: string;
  @Input({ required: true }) nombreProceso!: string;
  @Output() cerrar = new EventEmitter<void>();
  @Output() toast = new EventEmitter<{ tipo: 'ok' | 'error' | 'info'; titulo: string; texto?: string }>();

  // Estado del modal
  tabActiva = signal<Tab>('link');

  // Tab Link
  linkGenerado = signal<string | null>(null);
  generandoLink = signal(false);
  copiado = signal(false);

  // Tab Admins
  admins = signal<AdminDisponible[]>([]);
  cargandoAdmins = signal(false);
  seleccionados = signal<Set<string>>(new Set());
  mensajeOpcional = signal('');
  enviando = signal(false);

  totalSeleccionados = computed(() => this.seleccionados().size);
  hayAdminSeleccionado = computed(() => this.totalSeleccionados() > 0);

  ngOnInit(): void {
    // Pre-generar el link inmediatamente al abrir, así el admin lo tiene a un click
    this.generarLink();
  }

  cambiarTab(t: Tab): void {
    this.tabActiva.set(t);
    if (t === 'admins' && this.admins().length === 0) {
      this.cargarAdmins();
    }
  }

  generarLink(): void {
    this.generandoLink.set(true);
    this.invitacionService.generarLink(this.procesoId).subscribe({
      next: (resp) => {
        const url = this.invitacionService.construirUrlInvitacion(resp.token);
        this.linkGenerado.set(url);
        this.generandoLink.set(false);
      },
      error: (err) => {
        this.generandoLink.set(false);
        const msg = err?.error?.error || 'No se pudo generar el link';
        this.toast.emit({ tipo: 'error', titulo: 'Error', texto: msg });
      }
    });
  }

  async copiarLink(): Promise<void> {
    const url = this.linkGenerado();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2500);
    } catch {
      this.toast.emit({ tipo: 'error', titulo: 'No se pudo copiar', texto: 'Copia el link manualmente' });
    }
  }

  cargarAdmins(): void {
    this.cargandoAdmins.set(true);
    this.invitacionService.listarAdmins().subscribe({
      next: (lista) => {
        this.admins.set(lista);
        this.cargandoAdmins.set(false);
      },
      error: () => {
        this.cargandoAdmins.set(false);
        this.toast.emit({ tipo: 'error', titulo: 'Error', texto: 'No se pudieron cargar los admins' });
      }
    });
  }

  toggleAdmin(username: string): void {
    this.seleccionados.update(set => {
      const nuevo = new Set(set);
      if (nuevo.has(username)) nuevo.delete(username);
      else nuevo.add(username);
      return nuevo;
    });
  }

  estaSeleccionado(username: string): boolean {
    return this.seleccionados().has(username);
  }

  enviarInvitaciones(): void {
    const usernames = Array.from(this.seleccionados());
    if (usernames.length === 0) return;

    this.enviando.set(true);
    this.invitacionService.invitar(this.procesoId, usernames, this.mensajeOpcional()).subscribe({
      next: (resp: any) => {
        this.enviando.set(false);
        this.toast.emit({
          tipo: 'ok',
          titulo: 'Invitaciones enviadas',
          texto: `Se notificó a ${resp.enviadas} de ${resp.totalSolicitadas} admin(s).`
        });
        this.cerrar.emit();
      },
      error: (err) => {
        this.enviando.set(false);
        const msg = err?.error?.error || 'No se pudieron enviar las invitaciones';
        this.toast.emit({ tipo: 'error', titulo: 'Error', texto: msg });
      }
    });
  }

  cerrarModal(): void {
    this.cerrar.emit();
  }
}