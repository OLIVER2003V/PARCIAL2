import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Departamento, DepartamentoStats } from '../models/departamento.model';
import { ApiConfigService } from '../core/api-config.service';   // 👈 NUEVO

@Injectable({
  providedIn: 'root'
})
export class DepartamentoService {
  private http = inject(HttpClient);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  getDepartamentos(): Observable<Departamento[]> {
    return this.http.get<Departamento[]>(this.api.departamentos.base);
  }

  obtenerPorId(id: string): Observable<Departamento> {
    return this.http.get<Departamento>(this.api.departamentos.porId(id));
  }

  obtenerStats(): Observable<Record<string, DepartamentoStats>> {
    return this.http.get<Record<string, DepartamentoStats>>(this.api.departamentos.stats);
  }

  crearDepartamento(departamento: Departamento): Observable<Departamento> {
    return this.http.post<Departamento>(this.api.departamentos.base, departamento);
  }

  actualizarDepartamento(id: string, departamento: Partial<Departamento>): Observable<Departamento> {
    return this.http.put<Departamento>(this.api.departamentos.porId(id), departamento);
  }

  toggleActivo(id: string): Observable<Departamento> {
    return this.http.put<Departamento>(this.api.departamentos.toggleActivo(id), {});
  }

  eliminarDepartamento(id: string): Observable<any> {
    return this.http.delete<any>(this.api.departamentos.porId(id));
  }
}