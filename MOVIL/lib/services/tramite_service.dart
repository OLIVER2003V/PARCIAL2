import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../core/api_config.dart';
import '../core/auth_client.dart';

class TramiteService {

  static const double _maxMB = 10.0;
  static const List<String> _extensionesPermitidas = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif',
  ];

  // ── Subir archivo ─────────────────────────────────────────────────────────
  Future<Map<String, dynamic>?> subirArchivo(File archivo) async {
    final sizeInMb = archivo.lengthSync() / (1024 * 1024);
    if (sizeInMb > _maxMB) return null;

    final nombre = archivo.path.split(Platform.pathSeparator).last.toLowerCase();
    final extension = nombre.contains('.') ? '.${nombre.split('.').last}' : '';
    if (!_extensionesPermitidas.contains(extension)) return null;

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token') ?? '';

      final request = http.MultipartRequest(
        'POST', Uri.parse(ApiConfig.archivosSubir));
      request.headers['Authorization'] = 'Bearer $token';
      request.files.add(
          await http.MultipartFile.fromPath('archivo', archivo.path));

      final streamed = await request.send().timeout(const Duration(seconds: 30));
      if (streamed.statusCode == 401) {
        appNavigatorKey.currentState
            ?.pushNamedAndRemoveUntil('/login', (_) => false);
        return null;
      }
      if (streamed.statusCode == 200) {
        final body = await streamed.stream.bytesToString();
        return jsonDecode(body) as Map<String, dynamic>;
      }
      return null;
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
