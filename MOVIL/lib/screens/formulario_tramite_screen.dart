import 'dart:io';
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/proceso.dart';
import '../services/tramite_service.dart';
import '../core/app_theme.dart'; // 👇 NUEVO

class FormularioTramiteScreen extends StatefulWidget {
  final ProcesoDefinicion proceso;
  const FormularioTramiteScreen({super.key, required this.proceso});

  @override
  State<FormularioTramiteScreen> createState() => _FormularioTramiteScreenState();
}

class _FormularioTramiteScreenState extends State<FormularioTramiteScreen> {
  final _formKey = GlobalKey<FormState>();
  final TramiteService _tramiteService = TramiteService();

  final Map<String, dynamic> _valoresFormulario = {};
  final TextEditingController _descripcionController = TextEditingController();

  bool _isSubmitting = false;
  String? _uploadingFileId;
  List<CampoFormulario> _campos = [];

  String get _draftKey => 'draft_${widget.proceso.codigo}';

  @override
  void initState() {
    super.initState();
    _extraerCamposDelPasoInicial();
    _cargarBorrador();
  }

  // ── Borrador ──────────────────────────────────────────────────────────────
  Future<void> _cargarBorrador() async {
    final prefs = await SharedPreferences.getInstance();
    final desc = prefs.getString('${_draftKey}_desc') ?? '';
    if (desc.isEmpty) return;

    if (!mounted) return;
    final continuar = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppTheme.brandSurface,
        title: const Text('Borrador guardado',
            style: TextStyle(color: Colors.white)),
        content: const Text(
            '¿Deseas continuar con el borrador guardado anteriormente?',
            style: TextStyle(color: AppTheme.brandMuted)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Descartar',
                style: TextStyle(color: AppTheme.brandMuted)),
          ),
          ElevatedButton(
            style: AppTheme.botonPrimario(),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Continuar'),
          ),
        ],
      ),
    );

    if (continuar == true) {
      setState(() => _descripcionController.text = desc);
    } else {
      await _eliminarBorrador();
    }
  }

  Future<void> _guardarBorrador() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('${_draftKey}_desc', _descripcionController.text);
  }

  Future<void> _eliminarBorrador() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('${_draftKey}_desc');
  }

  void _extraerCamposDelPasoInicial() {
    // Buscar si el primer paso es de tipo INICIO_CLIENTE y extraer sus campos
    try {
      final pasoInicial = widget.proceso.pasos.firstWhere((p) => p.id == widget.proceso.pasoInicialId);
      if (pasoInicial.tipoResponsable == 'INICIO_CLIENTE') {
        setState(() => _campos = pasoInicial.campos);
      }
    } catch (e) {
      // No hay paso inicial configurado o no se encontró
    }
  }

  static const _extImagen = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'};
  static const _extArchivo = {
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.csv', '.zip', '.rar', '.odt', '.ods',
  };

  Future<void> _seleccionarYSubirArchivo(String campoId, String tipo) async {
    FilePickerResult? result = await FilePicker.pickFiles(
      type: tipo == 'imagen' ? FileType.image : FileType.any,
    );

    if (result != null) {
      File file = File(result.files.single.path!);

      // Validación de extensión
      final nombre = result.files.single.name.toLowerCase();
      final ext = '.${nombre.split('.').last}';
      final extensionesPermitidas = tipo == 'imagen' ? _extImagen : _extArchivo;
      if (!extensionesPermitidas.contains(ext)) {
        if (!mounted) return;
        final permitidas = extensionesPermitidas.join(', ');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Formato no permitido ($ext). Usa: $permitidas'),
            backgroundColor: Colors.redAccent,
          ),
        );
        return;
      }

      // Validación de tamaño (límite 10 MB)
      final sizeInMb = file.lengthSync() / (1024 * 1024);
      if (sizeInMb > 10.0) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('El archivo excede el límite de 10 MB. Sube uno más ligero.'),
            backgroundColor: Colors.redAccent,
          ),
        );
        return;
      }

      // Si pasa la validación, lo subimos
      setState(() => _uploadingFileId = campoId);
      final metadata = await _tramiteService.subirArchivo(file);
      setState(() => _uploadingFileId = null);

      if (metadata != null) {
        setState(() {
          _valoresFormulario[campoId] = {
            'nombreOriginal': metadata['nombreOriginal'],
            'url': metadata['url'],
            'tamano': metadata['tamano']
          };
        });
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Error al subir archivo.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _enviarSolicitud() async {
    if (_formKey.currentState!.validate()) {
      _formKey.currentState!.save();
      setState(() => _isSubmitting = true);

      final prefs = await SharedPreferences.getInstance();
      final username = prefs.getString('username') ?? 'cliente';

      // Estructura idéntica al NuevoTramiteRequest.java de Spring Boot
      final payload = {
        'clienteId': username,
        'codigoProceso': widget.proceso.codigo,
        'descripcion': _descripcionController.text.trim(),
        'datosFormularioInicial': _valoresFormulario,
      };

      final exito = await _tramiteService.iniciarTramite(payload);

      setState(() => _isSubmitting = false);

      if (exito) {
        await _eliminarBorrador();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('✅ Trámite iniciado exitosamente.'), backgroundColor: Colors.green),
        );
        Navigator.pop(context);
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('❌ Error al iniciar el trámite.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // Renderizador mágico
  // 👇 NUEVO Renderizador maestro: dispatcher por tipo de campo
  Widget _construirCampo(CampoFormulario campo) {
    switch (campo.tipo) {
      // Decorativos
      case 'titulo':
      case 'subtitulo':
      case 'parrafo':
      case 'separador':
        return _campoDecorativo(campo);

      // Archivos
      case 'archivo':
      case 'imagen':
        return _campoArchivo(campo);

      // Fechas y hora
      case 'fecha':
      case 'hora':
      case 'fecha_hora':
        return _campoFechaHora(campo);

      // Sí/No
      case 'si_no':
        return _campoSiNo(campo);

      // Selección única (dropdown)
      case 'seleccion':
        return _campoSeleccion(campo);

      // Radio (selección única visual)
      case 'radio':
        return _campoRadio(campo);

      // Checkbox (selección múltiple)
      case 'checkbox':
        return _campoCheckbox(campo);

      // Calificación con estrellas
      case 'calificacion':
        return _campoCalificacion(campo);

      // Texto y variantes (default)
      default:
        return _campoTexto(campo);
    }
  }

  // ============================================================================
  //  👇 NUEVO Helper para etiquetas consistentes
  // ============================================================================
  Widget _etiqueta(CampoFormulario campo) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            campo.etiqueta + (campo.requerido ? ' *' : ''),
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 14,
            ),
          ),
          if (campo.descripcion != null && campo.descripcion!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                campo.descripcion!,
                style: const TextStyle(
                  color: AppTheme.brandMuted,
                  fontSize: 12,
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ============================================================================
  //  👇 NUEVO CAMPOS DECORATIVOS (titulo, subtitulo, parrafo, separador)
  // ============================================================================
  Widget _campoDecorativo(CampoFormulario campo) {
    final contenido = campo.contenidoTexto ?? campo.etiqueta;
    switch (campo.tipo) {
      case 'titulo':
        return Padding(
          padding: const EdgeInsets.only(top: 16, bottom: 12),
          child: Text(
            contenido,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
        );
      case 'subtitulo':
        return Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 8),
          child: Text(
            contenido,
            style: const TextStyle(
              color: AppTheme.brandPrimary,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
        );
      case 'parrafo':
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            contenido,
            style: const TextStyle(
              color: AppTheme.brandMuted,
              fontSize: 13,
              height: 1.5,
            ),
          ),
        );
      case 'separador':
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Divider(color: AppTheme.brandBorder, thickness: 1),
        );
      default:
        return const SizedBox.shrink();
    }
  }

  // ============================================================================
  //  👇 NUEVO CAMPO TEXTO (default — texto, textarea, numero, email, telefono)
  // ============================================================================
  Widget _campoTexto(CampoFormulario campo) {
    final esLargo = campo.tipo == 'textarea';
    TextInputType teclado = TextInputType.text;
    if (campo.tipo == 'numero') teclado = TextInputType.number;
    if (campo.tipo == 'email') teclado = TextInputType.emailAddress;
    if (campo.tipo == 'telefono') teclado = TextInputType.phone;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          TextFormField(
            initialValue: campo.valorPorDefecto,
            maxLines: esLargo ? 3 : 1,
            keyboardType: teclado,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: campo.placeholder,
              hintStyle: const TextStyle(color: AppTheme.brandMuted),
              filled: true,
              fillColor: AppTheme.brandSurface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppTheme.radius),
                borderSide: BorderSide.none,
              ),
            ),
            onSaved: (val) => _valoresFormulario[campo.id] = val,
            validator: (val) {
              if (campo.requerido && (val == null || val.trim().isEmpty)) {
                return campo.mensajeError ?? 'Este campo es obligatorio';
              }
              if (val != null && val.isNotEmpty) {
                if (campo.tipo == 'email') {
                  final emailRx = RegExp(r'^[\w.+-]+@[\w-]+\.[a-z]{2,}$',
                      caseSensitive: false);
                  if (!emailRx.hasMatch(val.trim())) {
                    return 'Correo electrónico inválido';
                  }
                }
                if (campo.tipo == 'telefono') {
                  final telRx = RegExp(r'^\+?[0-9]{7,15}$');
                  if (!telRx.hasMatch(val.replaceAll(RegExp(r'\s'), ''))) {
                    return 'Teléfono inválido (7-15 dígitos)';
                  }
                }
              }
              return null;
            },
          ),
        ],
      ),
    );
  }

  // ============================================================================
  //  👇 NUEVO CAMPO ARCHIVO / IMAGEN
  // ============================================================================
  Widget _campoArchivo(CampoFormulario campo) {
    final tieneArchivo = _valoresFormulario[campo.id] != null;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          InkWell(
            onTap: () => _seleccionarYSubirArchivo(campo.id, campo.tipo),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                border: Border.all(
                  color: tieneArchivo
                      ? AppTheme.estadoVerde
                      : AppTheme.brandPrimary,
                  width: 1.5,
                ),
                borderRadius: BorderRadius.circular(AppTheme.radius),
                color: AppTheme.brandSurface,
              ),
              child: Row(
                children: [
                  Icon(
                    tieneArchivo
                        ? Icons.check_circle
                        : (campo.tipo == 'imagen'
                            ? Icons.image
                            : Icons.attach_file),
                    color: tieneArchivo
                        ? AppTheme.estadoVerde
                        : AppTheme.brandPrimary,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      _uploadingFileId == campo.id
                          ? 'Subiendo...'
                          : (tieneArchivo
                              ? _valoresFormulario[campo.id]['nombreOriginal']
                              : 'Toque para adjuntar (Max 10 MB)'),
                      style: TextStyle(
                        color: tieneArchivo
                            ? AppTheme.estadoVerde
                            : AppTheme.brandMuted,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (campo.requerido && !tieneArchivo)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Requerido',
                style: TextStyle(color: Colors.redAccent, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }

  // ============================================================================
  //  👇 NUEVO CAMPO FECHA / HORA / FECHA_HORA
  // ============================================================================
  Widget _campoFechaHora(CampoFormulario campo) {
    final valor = _valoresFormulario[campo.id] as String?;
    final tieneValor = valor != null && valor.isNotEmpty;

    IconData icono;
    String hint;
    if (campo.tipo == 'fecha') {
      icono = Icons.calendar_today;
      hint = 'Seleccionar fecha';
    } else if (campo.tipo == 'hora') {
      icono = Icons.access_time;
      hint = 'Seleccionar hora';
    } else {
      icono = Icons.event;
      hint = 'Seleccionar fecha y hora';
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          InkWell(
            onTap: () => _abrirPickerFechaHora(campo),
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: AppTheme.brandSurface,
                borderRadius: BorderRadius.circular(AppTheme.radius),
              ),
              child: Row(
                children: [
                  Icon(icono, color: AppTheme.brandPrimary, size: 20),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      tieneValor ? valor : hint,
                      style: TextStyle(
                        color:
                            tieneValor ? Colors.white : AppTheme.brandMuted,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (campo.requerido && !tieneValor)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text(
                'Requerido',
                style: TextStyle(color: Colors.redAccent, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _abrirPickerFechaHora(CampoFormulario campo) async {
    final ahora = DateTime.now();

    if (campo.tipo == 'fecha' || campo.tipo == 'fecha_hora') {
      final fecha = await showDatePicker(
        context: context,
        initialDate: ahora,
        firstDate: DateTime(2000),
        lastDate: DateTime(2100),
      );
      if (fecha == null) return;

      if (campo.tipo == 'fecha') {
        setState(() {
          _valoresFormulario[campo.id] =
              '${fecha.year}-${fecha.month.toString().padLeft(2, '0')}-${fecha.day.toString().padLeft(2, '0')}';
        });
      } else {
        // fecha_hora: pedir también la hora
        if (!mounted) return;
        final hora = await showTimePicker(
          context: context,
          initialTime: TimeOfDay.now(),
        );
        if (hora == null) return;
        setState(() {
          _valoresFormulario[campo.id] =
              '${fecha.year}-${fecha.month.toString().padLeft(2, '0')}-${fecha.day.toString().padLeft(2, '0')} '
              '${hora.hour.toString().padLeft(2, '0')}:${hora.minute.toString().padLeft(2, '0')}';
        });
      }
    } else {
      // hora sola
      final hora = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.now(),
      );
      if (hora == null) return;
      setState(() {
        _valoresFormulario[campo.id] =
            '${hora.hour.toString().padLeft(2, '0')}:${hora.minute.toString().padLeft(2, '0')}';
      });
    }
  }

  // ============================================================================
  //  👇 NUEVO CAMPO SI / NO
  // ============================================================================
  Widget _campoSiNo(CampoFormulario campo) {
    final valor = _valoresFormulario[campo.id] as bool?;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          Row(
            children: [
              Expanded(
                child: _botonSiNo(
                  texto: 'Sí',
                  icono: Icons.check_circle,
                  seleccionado: valor == true,
                  color: AppTheme.estadoVerde,
                  onTap: () => setState(
                      () => _valoresFormulario[campo.id] = true),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _botonSiNo(
                  texto: 'No',
                  icono: Icons.cancel,
                  seleccionado: valor == false,
                  color: AppTheme.estadoRojo,
                  onTap: () => setState(
                      () => _valoresFormulario[campo.id] = false),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _botonSiNo({
    required String texto,
    required IconData icono,
    required bool seleccionado,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(AppTheme.radius),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: seleccionado
              ? color.withValues(alpha: 0.15)
              : AppTheme.brandSurface,
          borderRadius: BorderRadius.circular(AppTheme.radius),
          border: Border.all(
            color: seleccionado ? color : AppTheme.brandBorder,
            width: 2,
          ),
        ),
        child: Column(
          children: [
            Icon(icono,
                color: seleccionado ? color : AppTheme.brandMuted, size: 28),
            const SizedBox(height: 6),
            Text(
              texto,
              style: TextStyle(
                color: seleccionado ? color : AppTheme.brandMuted,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ============================================================================
  //  👇 NUEVO CAMPO SELECCION (dropdown)
  // ============================================================================
  Widget _campoSeleccion(CampoFormulario campo) {
    final opciones = campo.obtenerOpciones();
    final valor = _valoresFormulario[campo.id] as String?;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: AppTheme.brandSurface,
              borderRadius: BorderRadius.circular(AppTheme.radius),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                value: valor,
                hint: Text(
                  campo.placeholder ?? 'Selecciona una opción',
                  style: const TextStyle(color: AppTheme.brandMuted),
                ),
                dropdownColor: AppTheme.brandSurface,
                style: const TextStyle(color: Colors.white),
                items: opciones
                    .map((o) => DropdownMenuItem<String>(
                          value: o.valor,
                          child: Text(o.etiqueta),
                        ))
                    .toList(),
                onChanged: (v) =>
                    setState(() => _valoresFormulario[campo.id] = v),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ============================================================================
  //  👇 NUEVO CAMPO RADIO (selección única visible)
  // ============================================================================
  Widget _campoRadio(CampoFormulario campo) {
    final opciones = campo.obtenerOpciones();
    final valor = _valoresFormulario[campo.id] as String?;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          ...opciones.map((o) => InkWell(
                onTap: () => setState(
                    () => _valoresFormulario[campo.id] = o.valor),
                borderRadius: BorderRadius.circular(AppTheme.radius),
                child: Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.symmetric(
                      horizontal: 12, vertical: 10),
                  decoration: BoxDecoration(
                    color: AppTheme.brandSurface,
                    borderRadius: BorderRadius.circular(AppTheme.radius),
                    border: Border.all(
                      color: valor == o.valor
                          ? AppTheme.brandPrimary
                          : AppTheme.brandBorder,
                      width: valor == o.valor ? 2 : 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        valor == o.valor
                            ? Icons.radio_button_checked
                            : Icons.radio_button_unchecked,
                        color: valor == o.valor
                            ? AppTheme.brandPrimary
                            : AppTheme.brandMuted,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          o.etiqueta,
                          style: const TextStyle(color: Colors.white),
                        ),
                      ),
                    ],
                  ),
                ),
              )),
        ],
      ),
    );
  }

  // ============================================================================
  //  👇 NUEVO CAMPO CHECKBOX (selección múltiple)
  // ============================================================================
  Widget _campoCheckbox(CampoFormulario campo) {
    final opciones = campo.obtenerOpciones();
    final actuales = (_valoresFormulario[campo.id] as List?) ?? [];

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          ...opciones.map((o) {
            final marcado = actuales.contains(o.valor);
            return InkWell(
              onTap: () {
                setState(() {
                  final nueva = List.from(actuales);
                  if (marcado) {
                    nueva.remove(o.valor);
                  } else {
                    nueva.add(o.valor);
                  }
                  _valoresFormulario[campo.id] = nueva;
                });
              },
              borderRadius: BorderRadius.circular(AppTheme.radius),
              child: Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: AppTheme.brandSurface,
                  borderRadius: BorderRadius.circular(AppTheme.radius),
                  border: Border.all(
                    color: marcado
                        ? AppTheme.brandPrimary
                        : AppTheme.brandBorder,
                    width: marcado ? 2 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      marcado
                          ? Icons.check_box
                          : Icons.check_box_outline_blank,
                      color: marcado
                          ? AppTheme.brandPrimary
                          : AppTheme.brandMuted,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        o.etiqueta,
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  // ============================================================================
  //  👇 NUEVO CAMPO CALIFICACION (estrellas)
  // ============================================================================
  Widget _campoCalificacion(CampoFormulario campo) {
    final escala = campo.escalaMax ?? 5;
    final valor = (_valoresFormulario[campo.id] as int?) ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _etiqueta(campo),
          Row(
            children: List.generate(escala, (i) {
              final indice = i + 1;
              final activa = indice <= valor;
              return InkWell(
                onTap: () => setState(
                    () => _valoresFormulario[campo.id] = indice),
                child: Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: Icon(
                    activa ? Icons.star : Icons.star_border,
                    color: activa
                        ? const Color(0xFFFBBF24)
                        : AppTheme.brandMuted,
                    size: 36,
                  ),
                ),
              );
            }),
          ),
          if (valor > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '$valor de $escala',
                style: const TextStyle(
                    color: AppTheme.brandMuted, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        title: Text(widget.proceso.nombre, style: const TextStyle(color: Colors.white, fontSize: 16)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Relato del Trámite *', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              const SizedBox(height: 8),
              const Text('Describe brevemente tu solicitud', style: TextStyle(color: Colors.grey, fontSize: 12)),
              const SizedBox(height: 8),
              TextFormField(
                controller: _descripcionController,
                maxLines: 3,
                style: const TextStyle(color: Colors.white),
                onChanged: (_) => _guardarBorrador(),
                decoration: InputDecoration(
                  filled: true, fillColor: const Color(0xFF1E293B),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
                validator: (val) => val!.isEmpty ? 'Debes escribir un relato.' : null,
              ),
              const SizedBox(height: 24),
              
              if (_campos.isNotEmpty) ...[
                const Divider(color: Color(0xFF1E293B), thickness: 2),
                const SizedBox(height: 16),
                const Text('Formulario Específico', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                const SizedBox(height: 16),
                ..._campos.map((campo) => _construirCampo(campo)),
              ],

              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF9333EA),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: _isSubmitting ? null : _enviarSolicitud,
                  child: _isSubmitting 
                    ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white))
                    : const Text('Enviar Solicitud', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}