import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/proceso.dart';
import '../core/api_config.dart'; // 👇 NUEVO

class ProcesoService {
  // 👇 NUEVO Centralizado vía ApiConfig (lib/core/api_config.dart)

  Future<List<ProcesoDefinicion>> obtenerCatalogoPublico() async {
    try {
      // 👇 NUEVO Endpoint público vía ApiConfig
      final response = await http.get(Uri.parse(ApiConfig.procesosPublicos));
      
      if (response.statusCode == 200) {
        // utf8.decode evita problemas con las tildes (á, é, í)
        final List<dynamic> data = jsonDecode(utf8.decode(response.bodyBytes));
        return data.map((json) => ProcesoDefinicion.fromJson(json)).toList();
      }
      return [];
    } catch (e) {
      print('Error al obtener catálogo: $e');
      return [];
    }
  }
}