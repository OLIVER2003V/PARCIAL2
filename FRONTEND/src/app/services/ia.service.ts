import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiConfigService } from '../core/api-config.service';

/**
 * 👇 NUEVO CU17 + Chatbot: Service para llamadas a la IA (Gemini).
 */
@Injectable({ providedIn: 'root' })
export class IaService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiConfigService);

  /** Genera un flujo BPMN a partir de descripción en lenguaje natural */
  generarFlujo(prompt: string, departamentosDisponibles: string): Observable<any> {
    return this.http.post<any>(this.api.ia.generarFlujo, {
      prompt,
      departamentosDisponibles
    });
  }

  /** Edita un diagrama existente aplicando una instrucción en lenguaje natural.
   *  Devuelve una lista de operaciones delta que el diagramador aplica sobre el grafo. */
  editarFlujo(instruccion: string, contexto: string, departamentosDisponibles: string): Observable<any> {
    return this.http.post<any>(this.api.ia.editarFlujo, {
      instruccion,
      contexto,
      departamentosDisponibles
    });
  }
}