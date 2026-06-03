import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
// 👇 Importamos la interfaz del CU14 que pusiste en proceso.model.ts
import { AnalisisCuellosBotella } from '../models/proceso.model';
import { ApiConfigService } from '../core/api-config.service';   // 👈 NUEVO

// 👇 NUEVO CU13: Service para reportes gerenciales

export interface FiltrosReporte {
  fechaInicio: string;         // 'YYYY-MM-DD'
  fechaFin: string;
  departamentoId?: string | null;
  procesoDefinicionId?: string | null;
}

export interface ResumenEjecutivo {
  totalTramites: number;
  tramitesCompletados: number;
  tramitesEnCurso: number;
  tramitesAprobados: number;
  tramitesRechazados: number;
  tasaFinalizacion: number;
  tasaAprobacion: number;
  tasaRechazo: number;
  tasaRetrabajo: number;
  leadTimePromedioHoras: number;
  leadTimeMedianaHoras: number;
  leadTimeMaximoHoras: number;
  throughputDiarioPromedio: number;
  diasDelRango: number;
}

export interface DepartamentoDesempenio {
  departamentoId: string;
  departamentoNombre: string;
  tramitesProcesados: number;
  cargaActivaActual: number;
  tiempoPromedioPermanenciaHoras: number;
  tiempoMaximoPermanenciaHoras: number;
  accionesRegistradas: number;
  topFuncionarioUsername?: string;
  topFuncionarioAcciones: number;
}

export interface PoliticaDesempenio {
  procesoDefinicionId: string;
  codigoPolitica?: string;
  nombrePolitica: string;
  version?: number;
  totalTramites: number;
  completados: number;
  enCurso: number;
  tasaFinalizacion: number;
  leadTimePromedioHoras: number;
  distribucionDecisiones: Record<string, number>;
}

export interface PuntoSerieTiempo {
  fecha: string; // 'YYYY-MM-DD'
  iniciados: number;
  completados: number;
}

export interface TendenciaTemporal {
  seriePorDia: PuntoSerieTiempo[];
  totalPeriodoActual: number;
  totalPeriodoAnterior: number;
  variacionPorcentual: number;
  diaPicoFecha?: string;
  diaPicoCantidad: number;
}

export interface FiltrosAplicados {
  fechaInicio: string;
  fechaFin: string;
  departamentoId?: string;
  departamentoNombre?: string;
  procesoDefinicionId?: string;
  procesoNombre?: string;
}

export interface ReporteGerencial {
  fechaGeneracion: string;
  generadoPor: string;
  filtros: FiltrosAplicados;
  resumenEjecutivo?: ResumenEjecutivo;
  desempenioDepartamentos: DepartamentoDesempenio[];
  desempenioPoliticas: PoliticaDesempenio[];
  tendenciaTemporal?: TendenciaTemporal;
  sinDatos: boolean;
  mensajeSinDatos?: string;
}

@Injectable({ providedIn: 'root' })
export class ReporteService {
  private http = inject(HttpClient);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  // ==========================================
  // METODOS DEL CU13 (REPORTE GERENCIAL)
  // ==========================================
  /** POST /preview — devuelve el JSON completo para pintar en UI */
  generarPreview(filtros: FiltrosReporte): Observable<ReporteGerencial> {
    return this.http.post<ReporteGerencial>(this.api.reportes.preview, filtros);
  }

  /** POST /pdf — descarga binario */
  descargarPdf(filtros: FiltrosReporte): Observable<Blob> {
    return this.http.post(this.api.reportes.pdf, filtros, { responseType: 'blob' });
  }

  /** POST /excel — descarga binario */
  descargarExcel(filtros: FiltrosReporte): Observable<Blob> {
    return this.http.post(this.api.reportes.excel, filtros, { responseType: 'blob' });
  }

  // ==========================================
  // 👇 NUEVO METODO DEL CU14 (MINERÍA DE PROCESOS)
  // ==========================================
  /** GET /mineria/{id} — devuelve las métricas para el Heatmap */
  getMineriaProcesos(procesoId: string): Observable<AnalisisCuellosBotella> {
    return this.http.get<AnalisisCuellosBotella>(this.api.reportes.mineriaPorProceso(procesoId));
  }
}