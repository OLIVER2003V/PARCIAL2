import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AdminDisponible } from '../models/colaboracion.model';
import { ApiConfigService } from '../core/api-config.service';   // 👈 NUEVO

// 👇 NUEVO Colaboración: cliente REST para invitaciones
@Injectable({ providedIn: 'root' })
export class InvitacionColaboracionService {
  private http = inject(HttpClient);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  generarLink(procesoId: string): Observable<{ token: string; expiraEn: string }> {
    return this.http.post<{ token: string; expiraEn: string }>(
      this.api.colaboracion.generarLink,
      { procesoId }
    );
  }

  listarAdmins(): Observable<AdminDisponible[]> {
    return this.http.get<AdminDisponible[]>(this.api.colaboracion.adminsDisponibles);
  }

  invitar(procesoId: string, usernames: string[], mensaje?: string): Observable<any> {
    return this.http.post(this.api.colaboracion.invitar, {
      procesoId,
      usernamesInvitados: usernames,
      mensajeOpcional: mensaje ?? ''
    });
  }

  validarToken(token: string): Observable<{
    valido: boolean;
    invitador?: string;
    procesoId?: string;
    expiraEn?: number;
    error?: string;
  }> {
    return this.http.get<any>(this.api.colaboracion.validarToken(token));
  }

  /**
   * Construye la URL completa para compartir, dado un token.
   */
  construirUrlInvitacion(token: string): string {
    const base = window.location.origin; // ej: http://localhost:4200
    return `${base}/colaborar/${token}`;
  }
}