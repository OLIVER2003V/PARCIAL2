class ProcesoDefinicion {
  final String id;
  final String nombre;
  final String descripcion;
  final String codigo;
  final String? pasoInicialId;
  final List<Paso> pasos;

  ProcesoDefinicion({
    required this.id,
    required this.nombre,
    required this.descripcion,
    required this.codigo,
    this.pasoInicialId,
    this.pasos = const [],
  });

  factory ProcesoDefinicion.fromJson(Map<String, dynamic> json) {
    return ProcesoDefinicion(
      id: json['id'] ?? '',
      nombre: json['nombre'] ?? '',
      descripcion: json['descripcion'] ?? '',
      codigo: json['codigo'] ?? '',
      pasoInicialId: json['pasoInicialId'],
      pasos: json['pasos'] != null 
          ? (json['pasos'] as List).map((p) => Paso.fromJson(p)).toList() 
          : [],
    );
  }
}

class Paso {
  final String id;
  final String nombre;
  final String? tipoResponsable;
  final List<CampoFormulario> campos;

  Paso({required this.id, required this.nombre, this.tipoResponsable, this.campos = const []});

  factory Paso.fromJson(Map<String, dynamic> json) {
    return Paso(
      id: json['id'] ?? '',
      nombre: json['nombre'] ?? '',
      tipoResponsable: json['tipoResponsable'],
      campos: json['campos'] != null 
          ? (json['campos'] as List).map((c) => CampoFormulario.fromJson(c)).toList() 
          : [],
    );
  }
}

class CampoFormulario {
  final String id;
  final String etiqueta;
  final String tipo;
  final bool requerido;
  final List<dynamic>? opcionesList;

  // 👇 NUEVO Campos extendidos para alinear con el modelo del frontend web
  final String? descripcion;        // texto de ayuda bajo el campo
  final String? placeholder;
  final String? ancho;              // 'completo' | 'medio' | 'tercio'
  final String? valorPorDefecto;
  final String? opciones;           // legacy: string separado por comas (compat)

  // 👇 NUEVO Validación
  final int? minLongitud;
  final int? maxLongitud;
  final num? minValor;
  final num? maxValor;
  final String? mensajeError;

  // 👇 NUEVO Calificación
  final int? escalaMax;             // 5 o 10 (default 5 en UI si null)
  final String? iconoCalificacion;  // 'estrella' | 'corazon' | 'numero'

  // 👇 NUEVO Archivos
  final List<String>? tiposArchivoPermitidos;
  final num? tamanoMaxMB;
  final bool? permiteMultiples;

  // 👇 NUEVO Decorativos
  final String? contenidoTexto;     // para titulo/subtitulo/parrafo

  CampoFormulario({
    required this.id,
    required this.etiqueta,
    required this.tipo,
    required this.requerido,
    this.opcionesList,
    // 👇 NUEVO
    this.descripcion,
    this.placeholder,
    this.ancho,
    this.valorPorDefecto,
    this.opciones,
    this.minLongitud,
    this.maxLongitud,
    this.minValor,
    this.maxValor,
    this.mensajeError,
    this.escalaMax,
    this.iconoCalificacion,
    this.tiposArchivoPermitidos,
    this.tamanoMaxMB,
    this.permiteMultiples,
    this.contenidoTexto,
  });

  factory CampoFormulario.fromJson(Map<String, dynamic> json) {
    return CampoFormulario(
      id: json['id'] ?? '',
      etiqueta: json['etiqueta'] ?? '',
      tipo: json['tipo'] ?? 'texto',
      requerido: json['requerido'] ?? false,
      opcionesList: json['opcionesList'],
      // 👇 NUEVO mapeo de los campos extendidos
      descripcion: json['descripcion'],
      placeholder: json['placeholder'],
      ancho: json['ancho'],
      valorPorDefecto: json['valorPorDefecto'],
      opciones: json['opciones'],
      minLongitud: json['minLongitud'],
      maxLongitud: json['maxLongitud'],
      minValor: json['minValor'],
      maxValor: json['maxValor'],
      mensajeError: json['mensajeError'],
      escalaMax: json['escalaMax'],
      iconoCalificacion: json['iconoCalificacion'],
      tiposArchivoPermitidos: json['tiposArchivoPermitidos'] != null
          ? List<String>.from(json['tiposArchivoPermitidos'])
          : null,
      tamanoMaxMB: json['tamanoMaxMB'],
      permiteMultiples: json['permiteMultiples'],
      contenidoTexto: json['contenidoTexto'],
    );
  }

  // 👇 NUEVO Helper: extrae las opciones normalizadas, soportando ambos formatos
  // - Nuevo: opcionesList: [{id, etiqueta, valor}]
  // - Legacy: opciones: "Opción 1, Opción 2, Opción 3"
  List<OpcionCampo> obtenerOpciones() {
    if (opcionesList != null && opcionesList!.isNotEmpty) {
      return opcionesList!
          .map((o) => OpcionCampo.fromJson(Map<String, dynamic>.from(o)))
          .toList();
    }
    if (opciones != null && opciones!.trim().isNotEmpty) {
      return opciones!
          .split(',')
          .map((s) => s.trim())
          .where((s) => s.isNotEmpty)
          .map((s) => OpcionCampo(id: s, etiqueta: s, valor: s))
          .toList();
    }
    return [];
  }
}

// 👇 NUEVO Opción estructurada para campos de tipo seleccion / radio / checkbox
class OpcionCampo {
  final String id;
  final String etiqueta;
  final String valor;

  OpcionCampo({
    required this.id,
    required this.etiqueta,
    required this.valor,
  });

  factory OpcionCampo.fromJson(Map<String, dynamic> json) {
    return OpcionCampo(
      id: json['id'] ?? '',
      etiqueta: json['etiqueta'] ?? '',
      valor: json['valor'] ?? '',
    );
  }
}