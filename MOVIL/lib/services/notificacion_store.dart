import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class AppNotificacion {
  final String id;
  final String titulo;
  final String cuerpo;
  final DateTime fecha;
  bool leida;

  AppNotificacion({
    required this.id,
    required this.titulo,
    required this.cuerpo,
    required this.fecha,
    this.leida = false,
  });

  Map<String, dynamic> toJson() => {
        'id':     id,
        'titulo': titulo,
        'cuerpo': cuerpo,
        'fecha':  fecha.toIso8601String(),
        'leida':  leida,
      };

  factory AppNotificacion.fromJson(Map<String, dynamic> j) => AppNotificacion(
        id:     j['id'] ?? '',
        titulo: j['titulo'] ?? '',
        cuerpo: j['cuerpo'] ?? '',
        fecha:  DateTime.tryParse(j['fecha'] ?? '') ?? DateTime.now(),
        leida:  j['leida'] ?? false,
      );
}

class NotificacionStore {
  static const _key = 'app_notificaciones';

  static Future<List<AppNotificacion>> cargar() async {
    final prefs = await SharedPreferences.getInstance();
    final raw   = prefs.getString(_key);
    if (raw == null) return [];
    final lista = jsonDecode(raw) as List;
    return lista.map((e) => AppNotificacion.fromJson(e)).toList();
  }

  static Future<void> agregar(AppNotificacion n) async {
    final lista = await cargar();
    lista.insert(0, n);
    if (lista.length > 50) lista.removeLast();
    await _guardar(lista);
  }

  static Future<void> marcarTodasLeidas() async {
    final lista = await cargar();
    for (final n in lista) {
      n.leida = true;
    }
    await _guardar(lista);
  }

  static Future<int> contarNoLeidas() async {
    final lista = await cargar();
    return lista.where((n) => !n.leida).length;
  }

  static Future<void> limpiar() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }

  static Future<void> _guardar(List<AppNotificacion> lista) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(lista.map((n) => n.toJson()).toList()));
  }
}
