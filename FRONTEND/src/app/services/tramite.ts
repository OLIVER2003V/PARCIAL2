import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '../core/api-config.service';   // 👈 NUEVO

@Injectable({
  providedIn: 'root'
})
export class TramiteService {
  private http = inject(HttpClient);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  crearTramite(tramite: any): Observable<any> {
    return this.http.post<any>(this.api.tramites.base, tramite);
  }

  obtenerBandeja(departamentoId: string): Observable<any[]> {
    return this.http.get<any[]>(this.api.tramites.bandeja(departamentoId));
  }

  obtenerTramitePorId(id: string): Observable<any> {
    return this.http.get<any>(this.api.tramites.porId(id));
  }

  actualizarTramite(id: string, datosActualizados: any): Observable<any> {
    return this.http.put<any>(this.api.tramites.porId(id), datosActualizados);
  }

  rastrearTramite(codigo: string): Observable<any> {
    return this.http.get<any>(this.api.tramites.rastrear(codigo));
  }

  misTramites(): Observable<any[]> {
    return this.http.get<any[]>(this.api.tramites.misTramites);
  }

  getHistorial(id: string): Observable<any[]> {
    return this.http.get<any[]>(this.api.tramites.historial(id));
  }

  iniciarTramite(datos: any): Observable<any> {
    return this.http.post<any>(this.api.tramites.iniciar, datos);
  }

  // 👇 Estadísticas con fechas opcionales
  obtenerEstadisticas(fechaInicio?: string, fechaFin?: string): Observable<any> {
    let url = this.api.tramites.dashboardStats;
    if (fechaInicio && fechaFin) {
      url += `?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`;
    }
    return this.http.get<any>(url);
  }

  obtenerStatsPorPolitica(
    fechaInicio?: string,
    fechaFin?: string
  ): Observable<Record<string, Record<string, number>>> {
    let url = this.api.tramites.dashboardPolitica;
    if (fechaInicio && fechaFin) {
      url += `?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`;
    }
    return this.http.get<Record<string, Record<string, number>>>(url);
  }
}
