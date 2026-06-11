import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_config.dart';
import '../core/auth_client.dart';

class TramiteService {

  static const double _maxMB = 10.0;

  // Mapa MIME explícito — no depende de auto-detección del paquete http
  static const Map<String, String> _mimeTypes = {
    '.pdf':  'application/pdf',
    '.doc':  'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls':  'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.webp': 'image/webp',
    '.gif':  'image/gif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };

  // ── Subir archivo ─────────────────────────────────────────────────────────
  // Retorna: null = error de red/timeout
  //          Map con clave 'error' = backend rechazó el archivo (con mensaje)
  //          Map con clave 'url'   = éxito con metadatos completos
  Future<Map<String, dynamic>?> subirArchivo(File archivo) async {
    final sizeInMb = archivo.lengthSync() / (1024 * 1024);
    if (sizeInMb > _maxMB) {
      return {'error': 'El archivo supera el límite de 10 MB'};
    }

    final nombre = archivo.path.split('/').last.toLowerCase();
    final extension = nombre.contains('.') ? '.${nombre.split('.').last}' : '';
    final mimeType = _mimeTypes[extension];
    if (mimeType == null) {
      return {'error': 'Formato no permitido. Usa PDF, Word, Excel, JPG, PNG o WebP.'};
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token') ?? '';

      final request = http.MultipartRequest(
        'POST', Uri.parse(ApiConfig.archivosSubir));
      request.headers['Authorization'] = 'Bearer $token';

      // Content-Type explícito: evita que el servidor reciba application/octet-stream
      request.files.add(await http.MultipartFile.fromPath(
        'archivo',
        archivo.path,
        filename: nombre,
        contentType: MediaType.parse(mimeType),
      ));

      final streamed = await request.send().timeout(const Duration(seconds: 60));

      final body = await streamed.stream.bytesToString();

      if (streamed.statusCode == 401) {
        appNavigatorKey.currentState
            ?.pushNamedAndRemoveUntil('/login', (_) => false);
        return null;
      }
      if (streamed.statusCode == 200) {
        return jsonDecode(body) as Map<String, dynamic>;
      }
      // Intenta extraer el mensaje de error del backend
      try {
        final err = jsonDecode(body) as Map<String, dynamic>;
        final msg = err['error'] ?? err['message'] ?? 'Error del servidor (${streamed.statusCode})';
        return {'error': msg.toString()};
      } catch (_) {
        return {'error': 'Error del servidor (${streamed.statusCode})'};
      }
    } catch (e) {
      return null;
    }
  }

  // ── Iniciar trámite ───────────────────────────────────────────────────────
  Future<bool> iniciarTramite(Map<String, dynamic> requestData) async {
    try {
      final response = await AuthClient.post(
        ApiConfig.tramitesIniciar, body: requestData);
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  // ── Rastrear trámite por código ───────────────────────────────────────────
  Future<Map<String, dynamic>?> rastrearTramite(String codigo) async {
    try {
      final respTramite = await AuthClient.get(ApiConfig.tramiteRastrear(codigo));
      if (respTramite.statusCode != 200) return null;

      final tramite   = jsonDecode(utf8.decode(respTramite.bodyBytes));
      final tramiteId = tramite['id'] as String;

      final respHistorial =
          await AuthClient.get(ApiConfig.tramiteHistorial(tramiteId));
      tramite['historial'] = respHistorial.statusCode == 200
          ? jsonDecode(utf8.decode(respHistorial.bodyBytes))
          : [];
      return tramite;
    } catch (e) {
      return null;
    }
  }

  // ── Detalle completo de un trámite por ID ─────────────────────────────────
  Future<Map<String, dynamic>?> obtenerDetalleTramite(String id) async {
    try {
      final futures = await Future.wait([
        AuthClient.get(ApiConfig.tramiteDetalle(id)),
        AuthClient.get(ApiConfig.tramiteHistorial(id)),
        AuthClient.get(ApiConfig.archivosTramite(id)),
      ]);

      if (futures[0].statusCode != 200) return null;

      final tramite =
          jsonDecode(utf8.decode(futures[0].bodyBytes)) as Map<String, dynamic>;

      tramite['historial'] = futures[1].statusCode == 200
          ? jsonDecode(utf8.decode(futures[1].bodyBytes))
          : [];
      tramite['archivos'] = futures[2].statusCode == 200
          ? jsonDecode(utf8.decode(futures[2].bodyBytes))
          : [];

      return tramite;
    } catch (e) {
      return null;
    }
  }

  // ── Mis trámites ──────────────────────────────────────────────────────────
  Future<List<dynamic>> obtenerMisTramites() async {
    try {
      final prefs    = await SharedPreferences.getInstance();
      final username = prefs.getString('username') ?? '';

      final response =
          await AuthClient.get(ApiConfig.tramitesDelCliente(username));
      return response.statusCode == 200
          ? jsonDecode(utf8.decode(response.bodyBytes)) as List
          : [];
    } catch (e) {
      return [];
    }
  }
}
