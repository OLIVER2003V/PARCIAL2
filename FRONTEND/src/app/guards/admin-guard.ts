import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

/**
 * 👇 NUEVO CU16: Guard de rol ADMIN.
 *
 * Bloquea el acceso a rutas restringidas a administradores.
 * - Si no hay sesión → redirige a /login
 * - Si hay sesión pero el rol no es ADMIN → redirige a /dashboard
 * - Si es ADMIN → permite el acceso
 *
 * Uso: canActivate: [authGuard, adminGuard]
 */
export const adminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const rol = authService.getRol();

  if (!rol) {
    // Sin sesión → al login (authGuard ya debería haberlo manejado, pero por defensa)
    router.navigate(['/login']);
    return false;
  }

  if (rol !== 'ADMIN') {
    // Logueado pero sin permisos → al dashboard
    router.navigate(['/dashboard']);
    return false;
  }

  return true;
};