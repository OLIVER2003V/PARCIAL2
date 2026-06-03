import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { AuthResponse } from '../models/usuario.model';
import { ApiConfigService } from '../core/api-config.service';   // 👈 NUEVO

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private api = inject(ApiConfigService);   // 👈 NUEVO

  login(credentials: any): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(this.api.auth.login, credentials).pipe(
      tap(res => {
        localStorage.setItem('token', res.token);
        localStorage.setItem('username', res.username);
        localStorage.setItem('rol', res.rol);
        if ((res as any).departamentoId) {
          localStorage.setItem('departamentoId', (res as any).departamentoId);
        }
      })
    );
  }

  registro(usuario: any): Observable<any> {
    return this.http.post<any>(this.api.auth.registro, usuario);
  }

  logout(): void {
    localStorage.clear();
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getRol(): string | null {
    return localStorage.getItem('rol');
  }

  getUsername(): string | null {
    return localStorage.getItem('username');
  }

  getDepartamentoId(): string | null {
    return localStorage.getItem('departamentoId');
  }

  esAdmin(): boolean {
    return this.getRol() === 'ADMIN';
  }

  esFuncionario(): boolean {
    return this.getRol() === 'FUNCIONARIO';
  }

  esCliente(): boolean {
    return this.getRol() === 'CLIENTE';
  }
}