import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Usuario } from '../models/usuario.model';
import { ApiConfigService } from '../core/api-config.service';   // 👈 NUEVO

@Injectable({
  providedIn: 'root'
})
export class UsuarioService {
  private http = inject(HttpClient);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  getUsuarios(): Observable<Usuario[]> {
    return this.http.get<Usuario[]>(this.api.usuarios.base);
  }

  obtenerPorId(id: string): Observable<Usuario> {
    return this.http.get<Usuario>(this.api.usuarios.porId(id));
  }

  crearUsuario(usuario: Usuario): Observable<Usuario> {
    return this.http.post<Usuario>(this.api.usuarios.base, usuario);
  }

  actualizarUsuario(id: string, usuario: Partial<Usuario>): Observable<Usuario> {
    return this.http.put<Usuario>(this.api.usuarios.porId(id), usuario);
  }

  actualizarEstado(id: string, estado: string): Observable<Usuario> {
    return this.http.put<Usuario>(this.api.usuarios.estado(id), { estado });
  }

  eliminarUsuario(id: string): Observable<any> {
    return this.http.delete<any>(this.api.usuarios.porId(id));
  }
}