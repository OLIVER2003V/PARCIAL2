import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ProcesoDefinicion } from '../models/proceso.model';
import { ApiConfigService } from '../core/api-config.service';   // 👈 NUEVO

@Injectable({
  providedIn: 'root'
})
export class ProcesoService {
  private http = inject(HttpClient);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  obtenerProcesos(): Observable<ProcesoDefinicion[]> {
    return this.http.get<ProcesoDefinicion[]>(this.api.procesos.base);
  }

  obtenerPorId(id: string): Observable<ProcesoDefinicion> {
    return this.http.get<ProcesoDefinicion>(this.api.procesos.porId(id));
  }

  crearProceso(proceso: ProcesoDefinicion): Observable<ProcesoDefinicion> {
    return this.http.post<ProcesoDefinicion>(this.api.procesos.base, proceso);
  }

  actualizarProceso(id: string, proceso: ProcesoDefinicion): Observable<ProcesoDefinicion> {
    return this.http.put<ProcesoDefinicion>(this.api.procesos.porId(id), proceso);
  }

  obtenerProcesosPublicos(): Observable<ProcesoDefinicion[]> {
    return this.http.get<ProcesoDefinicion[]>(this.api.procesos.publicos);
  }

  publicar(id: string): Observable<ProcesoDefinicion> {
    return this.http.post<ProcesoDefinicion>(this.api.procesos.publicar(id), {});
  }

  validar(id: string): Observable<{ valido: boolean; errores: string[] }> {
    return this.http.post<{ valido: boolean; errores: string[] }>(
      this.api.procesos.validar(id), {}
    );
  }

  crearNuevaVersion(id: string): Observable<ProcesoDefinicion> {
    return this.http.post<ProcesoDefinicion>(this.api.procesos.nuevaVersion(id), {});
  }

  publicarForzar(id: string): Observable<ProcesoDefinicion> {
    return this.http.post<ProcesoDefinicion>(this.api.procesos.publicarForzar(id), {});
  }

  toggleActivo(id: string): Observable<ProcesoDefinicion> {
    return this.http.patch<ProcesoDefinicion>(this.api.procesos.toggleActivo(id), {});
  }

  restaurarVersion(id: string): Observable<ProcesoDefinicion> {
    return this.http.post<ProcesoDefinicion>(this.api.procesos.restaurar(id), {});
  }

  obtenerVersiones(codigoBase: string): Observable<ProcesoDefinicion[]> {
    return this.http.get<ProcesoDefinicion[]>(this.api.procesos.versiones(codigoBase));
  }

  // 👇 NUEVO Colaboración: cargar borrador colaborativo del proceso
  obtenerBorrador(id: string): Observable<{
    procesoId: string;
    bpmnXml: string | null;
    borradorXml: string | null;
    borradorPor: string | null;
    fechaUltimoBorrador: string | null;
    hayBorradorReciente: boolean;
  }> {
    return this.http.get<any>(this.api.procesos.borrador(id));
  }

  // 👇 NUEVO Colaboración: limpiar borrador (al guardar política definitivamente)
  limpiarBorrador(id: string): Observable<any> {
    return this.http.delete(this.api.procesos.borrador(id));
  }
  
}