import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '../core/api-config.service';

export interface SerieNlp {
  nombre: string;
  valores: number[];
  color: string | null;
  colorFondo: string | null;
  colores: string[] | null;
  coloresFondo: string[] | null;
}

export interface ResultadoReporteNlp {
  titulo: string;
  subtitulo?: string;
  interpretacion?: string;
  tipoVisualizacion: 'bar' | 'line' | 'pie' | 'doughnut' | 'tabla' | 'mixed';
  etiquetas: string[];
  series: SerieNlp[];
  columnas: string[];
  filas: any[][];
  totalRegistros: number;
  exportable: boolean;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class ReporteNlpService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  consultar(consulta: string): Observable<ResultadoReporteNlp> {
    return this.http.post<ResultadoReporteNlp>(this.api.reportes.nlp, { consulta });
  }

  exportarPdf(consulta: string): Observable<Blob> {
    return this.http.post(this.api.reportes.nlpPdf, { consulta }, { responseType: 'blob' });
  }

  exportarExcel(consulta: string): Observable<Blob> {
    return this.http.post(this.api.reportes.nlpExcel, { consulta }, { responseType: 'blob' });
  }

  descargarBlob(blob: Blob, nombre: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(url);
  }
}
