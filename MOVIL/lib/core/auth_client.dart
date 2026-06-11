import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

// Clave global para navegar desde fuera del árbol de widgets.
// Debe registrarse en MaterialApp.navigatorKey.
final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

/// Cliente HTTP que añade el JWT en cada petición y redirige al login si expira.
class AuthClient {
  static Future<Map<String, String>> _headers() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token') ?? '';
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  static Future<void> _handle401() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    appNavigatorKey.currentState?.pushNamedAndRemoveUntil('/login', (_) => false);
  }

  static Future<http.Response> get(
    String url, {
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final headers = await _headers();
    final response = await http
        .get(Uri.parse(url), headers: headers)
        .timeout(timeout);
    if (response.statusCode == 401) _handle401();
    return response;
  }

  static Future<http.Response> post(
    String url, {
    Object? body,
    Duration timeout = const Duration(seconds: 15),
  }) async {
    final headers = await _headers();
    final response = await http
        .post(Uri.parse(url), headers: headers,
            body: body is Map ? jsonEncode(body) : body)
        .timeout(timeout);
    if (response.statusCode == 401) _handle401();
    return response;
  }

  static Future<http.Response> put(
    String url, {
    Object? body,
    Duration timeout = const Duration(seconds: 15),
  }) async {
    final headers = await _headers();
    final response = await http
        .put(Uri.parse(url), headers: headers,
            body: body is Map ? jsonEncode(body) : body)
        .timeout(timeout);
    if (response.statusCode == 401) _handle401();
    return response;
  }
}
