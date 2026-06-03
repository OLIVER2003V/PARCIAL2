import { HttpInterceptorFn } from '@angular/common/http';

/**
 * Interceptor funcional: agrega Bearer token automáticamente
 * a cualquier petición saliente si hay token en localStorage.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('token');
  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }
  return next(req);
};