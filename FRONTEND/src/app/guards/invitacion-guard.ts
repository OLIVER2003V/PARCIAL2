import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { InvitacionColaboracionService } from '../services/invitacion-colaboracion';
import { AuthService } from '../services/auth';
import { firstValueFrom } from 'rxjs';

// 👇 NUEVO Colaboración: guard que valida el token y redirige al editor
export const invitacionGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const invitacionService = inject(InvitacionColaboracionService);
  const authService = inject(AuthService);

  // Si no está logueado, mandarlo a login con returnUrl
  if (!authService.getToken()) {
    const fullUrl = router.url;
    return router.parseUrl('/login?returnUrl=' + encodeURIComponent(fullUrl));
  }

  // Solo admins pueden colaborar
  if (authService.getRol() !== 'ADMIN') {
    return router.parseUrl('/dashboard');
  }

  const token = route.paramMap.get('token');
  if (!token) return router.parseUrl('/admin-procesos');

  try {
    const resp = await firstValueFrom(invitacionService.validarToken(token));
    if (!resp.valido || !resp.procesoId) {
      return router.parseUrl('/admin-procesos?invitacionExpirada=1');
    }
    // Redirigir al editor con query param para que admin-procesos detecte y entre
    return router.parseUrl('/admin-procesos?procesoColaborativo=' + resp.procesoId);
  } catch (e) {
    return router.parseUrl('/admin-procesos?invitacionExpirada=1');
  }
};