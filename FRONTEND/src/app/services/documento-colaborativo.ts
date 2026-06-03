import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '../core/api-config.service';

export interface DocumentoColaborativo {
  id: string;
  tramiteId?: string;
  procesoId?: string;
  nombre: string;
  tipo: 'texto' | 'hoja';
  contenido: string;
  estadoYjs?: string;
  creadoPor: string;
  creadoEn: string;
  actualizadoEn?: string;
  ultimoEditor?: string;
  versiones: VersionContenido[];
}

export interface VersionContenido {
  editor: string;
  fecha: string;
  contenido: string;
  estadoYjs?: string;
}

export interface RegistroArchivo {
  id: string;
  tramiteId?: string;
  procesoId?: string;
  nombreOriginal: string;
  tipoMime: string;
  urlActual: string;
  versiones: VersionArchivo[];
  creadoEn: string;
}

export interface VersionArchivo {
  numero: number;
  url: string;
  nombreAlmacenado: string;
  tamano: number;
  subidoPor: string;
  fechaSubida: string;
  comentario?: string;
}

@Injectable({ providedIn: 'root' })
export class DocumentoColaborativoService {
  private http = inject(HttpClient);
  private api  = inject(ApiConfigService);

  crear(nombre: string, tipo: 'texto' | 'hoja',
        tramiteId?: string, procesoId?: string): Observable<DocumentoColaborativo> {
    return this.http.post<DocumentoColaborativo>(this.api.documentos.crear,
      { nombre, tipo, tramiteId, procesoId });
  }

  listarPorTramite(tramiteId: string): Observable<DocumentoColaborativo[]> {
    return this.http.get<DocumentoColaborativo[]>(this.api.documentos.porTramite(tramiteId));
  }

  listarPorProceso(procesoId: string): Observable<DocumentoColaborativo[]> {
    return this.http.get<DocumentoColaborativo[]>(this.api.documentos.porProceso(procesoId));
  }

  obtener(id: string): Observable<DocumentoColaborativo> {
    return this.http.get<DocumentoColaborativo>(this.api.documentos.obtener(id));
  }

  estadoYjs(id: string): Observable<{ documentoId: string; estadoYjs: string }> {
    return this.http.get<{ documentoId: string; estadoYjs: string }>(
      this.api.documentos.estadoYjs(id));
  }

  eliminar(id: string): Observable<void> {
    return this.http.delete<void>(this.api.documentos.eliminar(id));
  }

  archivosPorTramite(tramiteId: string): Observable<RegistroArchivo[]> {
    return this.http.get<RegistroArchivo[]>(this.api.documentos.archivosPorTramite(tramiteId));
  }

  archivosPorProceso(procesoId: string): Observable<RegistroArchivo[]> {
    return this.http.get<RegistroArchivo[]>(this.api.documentos.archivosPorProceso(procesoId));
  }
}
