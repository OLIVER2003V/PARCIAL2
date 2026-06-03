import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin, Observable } from 'rxjs';
import { ApiConfigService } from '../core/api-config.service';

export interface EntrenarRespuesta {
  estado:  string;
  mensaje: string;
}

export interface EstadoIa {
  servicioOnline: boolean;
  servicio?: {
    estado:          string;
    modelo_cargado:  boolean;
    entrenando:      boolean;
    version:         string;
    inicio_servicio: string;
  };
  predicciones?: {
    total: number;
    por_nivel: { NORMAL: number; ALTO: number; CRITICO: number };
    anomalias_detectadas: number;
    ultima_prediccion: string | null;
  };
  entrenamiento?: {
    fecha_entrenamiento:    string;
    muestras_total:         number;
    muestras_entrenamiento: number;
    muestras_validacion:    number;
    epochs_ejecutados:      number;
    val_loss_final:         number;
    val_mae_final:          number;
    loss_history:           number[];
    val_loss_history:       number[];
    arquitectura:           string[];
  };
}

export interface DistribucionRiesgo {
  normal:    number;
  alto:      number;
  critico:   number;
  anomalias: number;
  total:     number;
}

export interface AnomaliaItem {
  id:                       string;
  codigoSeguimiento:        string;
  clienteId:                string;
  nombreProceso:            string;
  riesgoDemora:             number;
  nivelPrioridad:           string;
  motivoPrediccion:         string;
  fechaUltimaActualizacion: string;
}

export interface DeptRiesgo {
  departamento: string;
  total:        number;
  normal:       number;
  alto:         number;
  critico:      number;
}

export interface DatosDashboardIa {
  estado:      EstadoIa;
  distribucion: DistribucionRiesgo;
  anomalias:   AnomaliaItem[];
  criticos:    AnomaliaItem[];
  porDep:      DeptRiesgo[];
}

@Injectable({ providedIn: 'root' })
export class IaMonitorService {
  private readonly http = inject(HttpClient);
  private readonly api  = inject(ApiConfigService);

  entrenar(): Observable<EntrenarRespuesta> {
    return this.http.post<EntrenarRespuesta>(this.api.ia.monitorEntrenar, null);
  }

  cargarTodo(): Observable<DatosDashboardIa> {
    return forkJoin({
      estado:       this.http.get<EstadoIa>(this.api.ia.monitorEstado),
      distribucion: this.http.get<DistribucionRiesgo>(this.api.ia.monitorDistribucion),
      anomalias:    this.http.get<AnomaliaItem[]>(this.api.ia.monitorAnomalias),
      criticos:     this.http.get<AnomaliaItem[]>(this.api.ia.monitorCriticos),
      porDep:       this.http.get<DeptRiesgo[]>(this.api.ia.monitorPorDep),
    });
  }
}
