import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '../core/api-config.service';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ArchivoSubido {
  nombreOriginal:   string;
  nombreAlmacenado: string;
  url:              string;
  tamano:           number;
  fechaSubida:      string;
  registroId?:      string;
  version?:         number;
  almacenamiento?:  's3' | 'local';
}

/** Versión individual de un documento (historial) */
export interface VersionArchivo {
  numero:           number;
  url:              string;
  nombreAlmacenado: string;
  tamano:           number;
  subidoPor:        string;
  fechaSubida:      string;
  comentario?:      string;
  paso?:            string;
  rol?:             string;
}

/** Registro de archivo con su historial de versiones (CU22) */
export interface RegistroArchivo {
  id:             string;
  tramiteId?:     string;
  procesoId?:     string;
  nombreOriginal: string;
  tipoMime:       string;
  urlActual:      string;
  versiones:      VersionArchivo[];
  creadoEn:       string;
}

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class ArchivoService {
  private readonly http = inject(HttpClient);
  private readonly api  = inject(ApiConfigService);

  /**
   * Sube un archivo asociado al campo de un formulario.
   * Usado internamente por los componentes de formulario (campo tipo archivo/imagen).
   */
  subirArchivo(archivo: File, tramiteId?: string): Observable<ArchivoSubido> {
    const formData = new FormData();
    formData.append('archivo', archivo);
    if (tramiteId) formData.append('tramiteId', tramiteId);
    return this.http.post<ArchivoSubido>(this.api.archivos.subir, formData);
  }

  /**
   * CU22 — Sube un documento al expediente del trámite, con etiqueta de paso.
   * Usa el mismo endpoint pero pasa el paso del proceso para trazabilidad.
   */
  subirDocumentacion(archivo: File, tramiteId: string, paso?: string): Observable<ArchivoSubido> {
    const formData = new FormData();
    formData.append('archivo', archivo);
    formData.append('tramiteId', tramiteId);
    if (paso) formData.append('paso', paso);
    return this.http.post<ArchivoSubido>(this.api.archivos.subir, formData);
  }

  /**
   * CU22 — Lista todos los documentos del expediente de un trámite.
   */
  listarPorTramite(tramiteId: string): Observable<RegistroArchivo[]> {
    return this.http.get<RegistroArchivo[]>(this.api.archivos.porTramite(tramiteId));
  }

  /**
   * CU22 — Elimina un documento por su URL (S3 o local).
   */
  eliminarArchivo(url: string): Observable<any> {
    return this.http.delete(this.api.archivos.eliminar, { params: { url } });
  }

  /**
   * Detecta si la URL ya es absoluta (S3) o relativa (legacy filesystem).
   * Las URLs nuevas son absolutas: https://bpms-...s3.amazonaws.com/...
   * Las viejas son relativas: /api/archivos/ver/...
   */
  urlArchivo(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return this.api.archivos.urlVer(url);
  }
}
