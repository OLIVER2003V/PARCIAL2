import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AuditLog,
  AuditoriaFiltro,
  AuditoriaResultado,
  AuditoriaOpciones
} from '../models/audit-log.model';
import { ApiConfigService } from '../core/api-config.service';

/**
 * 👇 NUEVO CU16: Service para consultar el log de auditoría.
 *
 * Solo expone operaciones de LECTURA. El backend no permite update/delete
 * sobre /api/auditoria/** (devuelve 403 → garantiza inmutabilidad del registro).
 */
@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private readonly http = inject(HttpClient);
  private readonly api  = inject(ApiConfigService);

  consultar(filtros: AuditoriaFiltro): Observable<AuditoriaResultado> {
    return this.http.post<AuditoriaResultado>(this.api.auditoria.consultar, filtros);
  }

  obtenerOpcionesFiltro(): Observable<AuditoriaOpciones> {
    return this.http.get<AuditoriaOpciones>(this.api.auditoria.opcionesFiltro);
  }

  obtenerCategorias(): Observable<string[]> {
    return this.http.get<string[]>(this.api.auditoria.categorias);
  }

  /** CU20 — todos los eventos de una entidad específica (proceso, trámite…). */
  porEntidad(entidadId: string): Observable<AuditLog[]> {
    return this.http.get<AuditLog[]>(this.api.auditoria.porEntidad(entidadId));
  }

  /** CU20 — descarga un CSV con los registros que coincidan con los filtros (máx. 5 000). */
  exportarCsv(filtros: AuditoriaFiltro): Observable<Blob> {
    return this.http.post(this.api.auditoria.exportar, filtros, { responseType: 'blob' });
  }
}