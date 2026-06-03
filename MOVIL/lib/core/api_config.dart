class ApiConfig {
  static const bool kUsarProduccion = true;

  static const String _hostLocal = 'http://192.168.100.148:8080';
  static const String _hostProd  = 'http://13.59.124.116:8080';

  static String get apiHost => kUsarProduccion ? _hostProd : _hostLocal;
  static String get apiUrl  => '$apiHost/api';

  // ── Auth ──────────────────────────────────────────────────────────────────
  static String get authLogin           => '$apiUrl/auth/login';
  static String get authRegistro        => '$apiUrl/auth/registro';
  static String get authGuardarFcmToken => '$apiUrl/auth/guardar-token-push';
  static String get authPerfil          => '$apiUrl/auth/perfil';
  static String get authCambiarPassword => '$apiUrl/auth/cambiar-password';

  // ── Procesos ──────────────────────────────────────────────────────────────
  static String get procesosPublicos => '$apiUrl/admin/procesos/publicos';

  // ── Trámites ──────────────────────────────────────────────────────────────
  static String get tramitesIniciar              => '$apiUrl/tramites/iniciar';
  static String tramiteRastrear(String codigo)   => '$apiUrl/tramites/rastrear/$codigo';
  static String tramiteHistorial(String id)      => '$apiUrl/tramites/$id/historial';
  static String tramiteDetalle(String id)        => '$apiUrl/tramites/$id';
  static String tramitesDelCliente(String id)    => '$apiUrl/tramites/cliente/$id';

  // ── Archivos ──────────────────────────────────────────────────────────────
  static String get archivosSubir                    => '$apiUrl/archivos/subir';
  static String archivosTramite(String tramiteId)    => '$apiUrl/archivos/tramite/$tramiteId';
  static String archivoVer(String nombre)            => '$apiHost/api/archivos/ver/$nombre';
}
