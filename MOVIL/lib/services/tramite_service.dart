import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_config.dart';

class TramiteService {

  static const double _maxMB = 10.0;
  static const List<String> _extensionesPermitidas = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif',
  ];

  Future<Map<String, String>> _getHeaders() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token') ?? '';
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  // ── Subir archivo ─────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> subirArchivo(File archivo) async {
    final sizeInMb = archivo.lengthSync() / (1024 * 1024);
    if (sizeInMb > _maxMB) {
      return {
        'exito': false,
        'error': 'El archivo excede el límite de ${_maxMB.toInt()} MB '
            '(${sizeInMb.toStringAsFixed(1)} MB)',
      };
    }

    final nombre = archivo.path.split(Platform.pathSeparator).last.toLowerCase();
    final extension = nombre.contains('.')
        ? '.${nombre.split('.').last}'
        : '';
    if (!_extensionesPermitidas.contains(extension)) {
      return {
        'exito': false,
        'error': 'Formato no permitido. Usa PDF, Word, Excel, JPG, PNG o WebP.',
      };
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token') ?? '';

      final request = http.MultipartRequest(
        'POST',
        Uri.parse(ApiConfig.archivosSubir),
      );
      request.headers['Authorization'] = 'Bearer $token';
      request.files.add(await http.MultipartFile.fromPath('archivo', archivo.path));

      final response = await request.send()
          .timeout(const Duration(seconds: 30));

      if (response.statusCode == 200) {
        final body = await response.stream.bytesToString();
        final data = jsonDecode(body) as Map<String, dynamic>;
        return {'exito': true, ...data};
      }
      return {'exito': false, 'error': 'Error del servidor (${response.statusCode})'};
    } catch (e) {
      return {'exito': false, 'error': 'Error de conexión: $e'};
    }
  }

  // ── Iniciar trámite ───────────────────────────────────────────────────────
  Future<bool> iniciarTramite(Map<String, dynamic> requestData) async {
    try {
      final headers  = await _getHeaders();
      final response = await http.post(
        Uri.parse(ApiConfig.tramitesIniciar),
        headers: headers,
        body: jsonEncode(requestData),
      ).timeout(const Duration(seconds: 15));
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  // ── Rastrear trámite por código ───────────────────────────────────────────
  Future<Map<String, dynamic>?> rastrearTramite(String codigo) async {
    try {
      final headers = await _getHeaders();

      final respTramite = await http.get(
        Uri.parse(ApiConfig.tramiteRastrear(codigo)),
        headers: headers,
      ).timeout(const Duration(seconds: 10));

      if (respTramite.statusCode != 200) return null;

      final tramite    = jsonDecode(utf8.decode(respTramite.bodyBytes));
      final tramiteId  = tramite['id'] as String;

      final respHistorial = await http.get(
        Uri.parse(ApiConfig.tramiteHistorial(tramiteId)),
        headers: headers,
      ).timeout(const Duration(seconds: 10));

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
      final headers = await _getHeaders();

      final futures = await Future.wait([
        http.get(Uri.parse(ApiConfig.tramiteDetalle(id)),   headers: headers)
            .timeout(const Duration(seconds: 10)),
        http.get(Uri.parse(ApiConfig.tramiteHistorial(id)), headers: headers)
            .timeout(const Duration(seconds: 10)),
        http.get(Uri.parse(ApiConfig.archivosTramite(id)),  headers: headers)
            .timeout(const Duration(seconds: 10)),
      ]);

      if (futures[0].statusCode != 200) return null;

      final tramite = jsonDecode(utf8.decode(futures[0].bodyBytes))
          as Map<String, dynamic>;

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
      final headers  = await _getHeaders();

      final response = await http.get(
        Uri.parse(ApiConfig.tramitesDelCliente(username)),
        headers: headers,
      ).timeout(const Duration(seconds: 10));

      return response.statusCode == 200
          ? jsonDecode(utf8.decode(response.bodyBytes)) as List
          : [];
    } catch (e) {
      return [];
    }
  }
}
