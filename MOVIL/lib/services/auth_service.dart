import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../models/usuario.dart';
import '../core/api_config.dart';

class AuthService {

  // ── Login ─────────────────────────────────────────────────────────────────
  Future<Usuario?> login(String username, String password) async {
    try {
      final response = await http.post(
        Uri.parse(ApiConfig.authLogin),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'username': username, 'password': password}),
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final data    = jsonDecode(response.body);
        final usuario = Usuario.fromJson(data);

        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('token',    usuario.token);
        await prefs.setString('username', usuario.username);
        await prefs.setString('rol',      usuario.rol);

        _actualizarTokenFCM(usuario.username);
        return usuario;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // ── Registro ──────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>> registrar(Map<String, dynamic> datos) async {
    try {
      final response = await http.post(
        Uri.parse(ApiConfig.authRegistro),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(datos),
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200 || response.statusCode == 201) {
        return {'exito': true};
      }
      final body = jsonDecode(utf8.decode(response.bodyBytes));
      return {'exito': false, 'mensaje': body['message'] ?? 'Error al registrar'};
    } catch (e) {
      return {'exito': false, 'mensaje': 'Sin conexión con el servidor'};
    }
  }

  // ── Perfil ────────────────────────────────────────────────────────────────
  Future<Map<String, dynamic>?> obtenerPerfil() async {
    try {
      final prefs    = await SharedPreferences.getInstance();
      final token    = prefs.getString('token') ?? '';
      final username = prefs.getString('username') ?? '';

      final response = await http.get(
        Uri.parse('${ApiConfig.authPerfil}/$username'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        return jsonDecode(utf8.decode(response.bodyBytes));
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  Future<bool> actualizarPerfil(Map<String, dynamic> datos) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token') ?? '';

      final response = await http.put(
        Uri.parse(ApiConfig.authPerfil),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(datos),
      ).timeout(const Duration(seconds: 8));

      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }

  Future<Map<String, dynamic>> cambiarPassword(
      String passwordActual, String passwordNueva) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token') ?? '';

      final response = await http.post(
        Uri.parse(ApiConfig.authCambiarPassword),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'passwordActual': passwordActual,
          'passwordNueva':  passwordNueva,
        }),
      ).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) return {'exito': true};
      final body = jsonDecode(utf8.decode(response.bodyBytes));
      return {'exito': false, 'mensaje': body['message'] ?? 'Error al cambiar contraseña'};
    } catch (e) {
      return {'exito': false, 'mensaje': 'Sin conexión con el servidor'};
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  void _actualizarTokenFCM(String username) async {
    try {
      final fcmToken = await FirebaseMessaging.instance.getToken();
      if (fcmToken != null) {
        await http.post(
          Uri.parse(ApiConfig.authGuardarFcmToken),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'username': username, 'fcmToken': fcmToken}),
        );
      }
    } catch (_) {}
  }

  Future<bool> isLogueado() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.containsKey('token');
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
  }
}
