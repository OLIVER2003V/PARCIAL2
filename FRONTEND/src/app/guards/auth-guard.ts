import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Si hay un token guardado, el policía abre la puerta
  if (authService.getToken()) {
    return true;
  } else {
    // Si no hay token, te patea de vuelta al login
    router.navigate(['/login']);
    return false;
  }
};