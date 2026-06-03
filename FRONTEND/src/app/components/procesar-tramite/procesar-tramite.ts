import { Component, OnInit, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TramiteService } from '../../services/tramite';
import { DepartamentoService } from '../../services/departamento';
import { ProcesoService } from '../../services/proceso';
import { Tramite } from '../../models/tramite.model';
import { Departamento } from '../../models/departamento.model';
import { CampoFormulario, Paso, ProcesoDefinicion } from '../../models/proceso.model';
import { CampoGridPipe } from '../../shared/pipes/campo-grid.pipe';
import { ArchivoService } from '../../services/archivo';
import { HttpClient } from '@angular/common/http';
import { VozReconocimientoService } from '../../services/voz-reconocimiento.service';
import { VozNlpService } from '../../services/voz-nlp.service';
import { VozFormularioComponent } from '../voz-formulario/voz-formulario';
import { ApiConfigService } from '../../core/api-config.service';
import { EditorTextoColaborativoComponent } from '../editor-texto-colaborativo/editor-texto-colaborativo';
import { HojaCalculoColaborativaComponent } from '../hoja-calculo-colaborativa/hoja-calculo-colaborativa';
import { DocumentacionTramiteComponent } from '../documentacion-tramite/documentacion-tramite';

@Component({
  selector: 'app-procesar-tramite',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterModule, CampoGridPipe,
            EditorTextoColaborativoComponent, HojaCalculoColaborativaComponent,
            VozFormularioComponent, DocumentacionTramiteComponent],
  templateUrl: './procesar-tramite.html'
})
export class ProcesarTramiteComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private tramiteService = inject(TramiteService);
  private http = inject(HttpClient);
  private api = inject(ApiConfigService);
  private departamentoService = inject(DepartamentoService);
  private procesoService = inject(ProcesoService);
  private archivoService = inject(ArchivoService);
  vozService      = inject(VozReconocimientoService);
  vozNlpService   = inject(VozNlpService);

  modalVozAbierto = signal(false);

  // FIX #6: ocultar el botón si no hay campos que la IA pueda rellenar
  readonly tieneCamposRellenables = computed(() => {
    const EXCLUIDOS = new Set([
      'titulo','subtitulo','parrafo','separador',
      'firma','archivo','imagen','ubicacion',
      'documento-texto','documento-hoja'
    ]);
    return this.camposPasoActual().some(c => !EXCLUIDOS.has(c.tipo));
  });

  iaLoading = signal<string | null>(null);
  campoEscuchando = signal<string | null>(null);
  tramiteActual = signal<Tramite | null>(null);
  historialAuditoria = signal<any[]>([]);
  listaDepartamentos = signal<Departamento[]>([]);
  procesoDefinicion = signal<ProcesoDefinicion | null>(null);

  isLoading = signal(true);
  isSaving = signal(false);
  mensajeExito = signal(false);
  errorMsg = signal<string | null>(null);

  camposPasoActual = signal<CampoFormulario[]>([]);
  valoresFormulario = signal<Record<string, any>>({});
  nombrePasoActual = signal<string>('');
  subiendoArchivo = signal<string | null>(null);

  resolutionForm = this.fb.group({ nuevoEstado: ['', [Validators.required]] });
  formValido = signal(false);

  tabExpediente = signal<'datos' | 'dictamenes'>('datos');
  expedienteColapsado = signal(false);

  camposRequeridosCompletos = computed(() => {
    const campos = this.camposPasoActual();
    const valores = this.valoresFormulario();
    return campos.every(c => {
      if (!c.requerido) return true;
      if (['titulo', 'subtitulo', 'parrafo', 'separador'].includes(c.tipo)) return true;
      
      const v = valores[c.id];
      if (v === undefined || v === null || v === '') return false;
      if (Array.isArray(v) && v.length === 0) return false;
      // FIX: Asegurar que la validación cubra firmas y tablas correctamente
      if ((c.tipo === 'archivo' || c.tipo === 'imagen' || c.tipo === 'firma') && !v?.url) return false;
      if (c.tipo === 'tabla' && Array.isArray(v) && v.length < (c.filasMinimas || 1)) return false;
      
      return true;
    });
  });

  camposFaltantes = computed(() => {
    const campos = this.camposPasoActual();
    const valores = this.valoresFormulario();
    return campos
      .filter(c => c.requerido && !['titulo', 'subtitulo', 'parrafo', 'separador'].includes(c.tipo))
      .filter(c => {
        const v = valores[c.id];
        if (v === undefined || v === null || v === '') return true;
        if (Array.isArray(v) && v.length === 0) return true;
        if ((c.tipo === 'archivo' || c.tipo === 'imagen' || c.tipo === 'firma') && !v?.url) return true;
        if (c.tipo === 'tabla' && Array.isArray(v) && v.length < (c.filasMinimas || 1)) return true;
        return false;
      })
      .map(c => c.etiqueta);
  });

  puedeGuardar = computed(() => this.formValido() && this.camposRequeridosCompletos());

  pasoActualDef = computed(() => {
    const def = this.procesoDefinicion();
    const tramite = this.tramiteActual();
    if (!def || !tramite) return null;
    return def.pasos?.find(p => p.id === tramite.pasoActualId) || null;
  });

  accionesDisponibles = computed<Array<{ accion: string; label: string; color: string; icono: string; tipo: 'gateway' | 'continuar' | 'finalizar' }>>(() => {
    const paso = this.pasoActualDef();
    const def = this.procesoDefinicion();
    if (!paso || !def?.pasos) return this.accionGenerica('continuar');

    const pasos = def.pasos;
    if (!paso.transiciones || paso.transiciones.length === 0) return this.accionGenerica('finalizar');

    const destinos = paso.transiciones
      .map(t => pasos.find(p => p.id === t.pasoDestinoId))
      .filter((p): p is Paso => p != null);

    if (destinos.length === 1 && (destinos[0].tipo === 'TAREA' || !destinos[0].tipo)) return this.accionGenerica('continuar');
    if (destinos.some(d => d.tipo === 'NODO_FINAL' || d.tipo === 'NODO_TERMINACION')) return this.accionGenerica('finalizar');

    const gateway = destinos.find(d => d.tipo === 'GATEWAY_EXCLUSIVO');
    if (gateway) {
      const salidasGateway = (gateway.transiciones || [])
        .map(t => ({ nombre: t.nombreAccion || t.estadoCondicion || 'SIN_NOMBRE', destinoId: t.pasoDestinoId }))
        .filter(s => s.nombre !== 'SIN_NOMBRE');

      if (salidasGateway.length > 0) {
        return salidasGateway.map(s => this.configurarBotonGateway(s.nombre));
      }
    }

    if (destinos.some(d => d.tipo === 'GATEWAY_PARALELO_SPLIT' || d.tipo === 'GATEWAY_INCLUSIVO')) return this.accionGenerica('continuar');
    return this.accionGenerica('continuar');
  });

  textoBotonConfirmar = computed(() => {
    const accionSel = this.resolutionForm.get('nuevoEstado')?.value;
    const acciones = this.accionesDisponibles();

    if (!accionSel) {
      if (acciones.length === 1) return acciones[0].tipo === 'finalizar' ? '✅ Confirmar y finalizar trámite' : '➡️ Confirmar y continuar';
      return '👆 Selecciona una opción primero';
    }
    const acc = acciones.find(a => a.accion === accionSel);
    return `${acc?.icono || '✅'} Confirmar: ${acc?.label || accionSel}`;
  });

  botonConfirmarClase = computed(() => {
    const accionSel = this.resolutionForm.get('nuevoEstado')?.value;
    const acc = this.accionesDisponibles().find(a => a.accion === accionSel);
    const color = acc?.color || 'emerald';

    const mapa: Record<string, string> = {
      emerald: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20',
      red: 'bg-red-600 hover:bg-red-500 shadow-red-900/20',
      amber: 'bg-amber-600 hover:bg-amber-500 shadow-amber-900/20',
      orange: 'bg-orange-600 hover:bg-orange-500 shadow-orange-900/20',
      blue: 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/20'
    };
    return mapa[color] || mapa['emerald'];
  });

  constructor() {
    effect(() => {
      const acciones = this.accionesDisponibles();
      const actual = this.resolutionForm.get('nuevoEstado')?.value;
      if (acciones.length === 1 && !actual) {
        this.resolutionForm.patchValue({ nuevoEstado: acciones[0].accion });
        this.formValido.set(this.resolutionForm.valid);
      }
    });

    effect(() => {
      const dictado = this.vozService.textoReconocido();
      const campo = this.campoEscuchando();
      if (this.vozService.isListening() && campo) {
        this.actualizarCampo(campo, dictado);
      } else if (!this.vozService.isListening() && campo) {
        this.campoEscuchando.set(null);
      }
    }, { allowSignalWrites: true });
  }

  toggleDictadoCampo(campoId: string): void {
    if (this.vozService.isListening() && this.campoEscuchando() === campoId) {
      this.vozService.stop();
      this.campoEscuchando.set(null);
    } else {
      if (this.vozService.isListening()) this.vozService.stop();
      this.campoEscuchando.set(campoId);
      const valorActual = this.getValorCampo(campoId) || '';
      this.vozService.start(valorActual);
    }
  }

  private accionGenerica(tipo: 'continuar' | 'finalizar') {
    if (tipo === 'finalizar') {
      return [{ accion: 'APROBADO', label: 'Completar trámite', color: 'emerald', icono: '✅', tipo: 'finalizar' as const }];
    }
    return [{ accion: 'APROBADO', label: 'Enviar y continuar', color: 'emerald', icono: '➡️', tipo: 'continuar' as const }];
  }

  private configurarBotonGateway(nombreAccion: string) {
    const upper = nombreAccion.toUpperCase().trim();
    const palabrasPositivas = ['APROBADO', 'APROBAR', 'SI', 'ACEPTADO', 'ACEPTAR', 'BUENO', 'CORRECTO', 'VALIDO', 'APTO', 'OK', 'CONTINUAR'];
    const palabrasNegativas = ['RECHAZADO', 'RECHAZAR', 'NO', 'DENEGADO', 'DENEGAR', 'MALO', 'INCORRECTO', 'INVALIDO', 'NO_APTO', 'CANCELAR'];
    const palabrasReintento = ['REQUIERE_CORRECCION', 'CORREGIR', 'SUBSANAR', 'DEVOLVER', 'REVISION', 'EN_REVISION', 'PENDIENTE', 'REINTENTAR'];

    let color = 'blue'; let icono = '▶️';
    if (palabrasPositivas.includes(upper)) { color = 'emerald'; icono = '✅'; } 
    else if (palabrasNegativas.includes(upper)) { color = 'red'; icono = '❌'; } 
    else if (palabrasReintento.includes(upper)) { color = 'amber'; icono = '⏳'; } 
    else {
      if (upper.startsWith('SI') || upper.startsWith('APROB')) { color = 'emerald'; icono = '✅'; }
      else if (upper.startsWith('NO') || upper.startsWith('RECH')) { color = 'red'; icono = '❌'; }
    }
    return { accion: nombreAccion, label: this.capitalize(nombreAccion), color, icono, tipo: 'gateway' as const };
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, ' ');
  }

  camposVisiblesConfigurados = computed<string[]>(() => this.pasoActualDef()?.camposVisibles ?? []);
  tieneRestriccionesVisibilidad = computed(() => this.camposVisiblesConfigurados().length > 0);
  private esCampoVisible(campoId: string): boolean {
    const configurados = this.camposVisiblesConfigurados();
    return configurados.length === 0 ? true : configurados.includes(campoId);
  }

  pasoInicioCliente = computed<Paso | null>(() => {
    const def = this.procesoDefinicion();
    if (!def) return null;
    const pasoInicial = def.pasos?.find(p => p.id === def.pasoInicialId);
    return pasoInicial?.tipoResponsable === 'INICIO_CLIENTE' ? pasoInicial : null;
  });

  datosCliente = computed(() => this.tramiteActual()?.datosFormularioInicial || {});
  tieneDatosCliente = computed(() => this.entradasCliente().length > 0);
  dictamenesPrevios = computed(() => this.historialAuditoria().filter(log => log.accion !== 'INICIADO'));

  buscarPasoPorLog(log: any): Paso | null {
    const def = this.procesoDefinicion();
    if (!def?.pasos) return null;
    if (log.pasoId) {
      const porId = def.pasos.find(p => p.id === log.pasoId);
      if (porId) return porId;
    }
    const idsEnLog = Object.keys(log.datosFormulario || {});
    if (idsEnLog.length > 0) {
      const porCampos = def.pasos.find(p => {
        const idsDelPaso = (p.campos || []).map(c => c.id);
        return idsEnLog.every(id => idsDelPaso.includes(id));
      });
      if (porCampos) return porCampos;
    }
    const porDepto = def.pasos.filter(p => p.departamentoAsignadoId === log.departamentoId);
    if (porDepto.length === 0) return null;
    return porDepto.sort((a, b) => (b.campos?.length ?? 0) - (a.campos?.length ?? 0))[0];
  }

  ngOnInit() {
    this.resolutionForm.statusChanges.subscribe(() => this.formValido.set(this.resolutionForm.valid));
    this.formValido.set(this.resolutionForm.valid);

    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.cargarDatos(id);
    else this.router.navigate(['/bandeja']);
  }

  private cargarDatos(id: string) {
    this.departamentoService.getDepartamentos().subscribe(d => this.listaDepartamentos.set(d));
    this.tramiteService.obtenerTramitePorId(id).subscribe({
      next: (datos) => {
        this.tramiteActual.set(datos);
        this.isLoading.set(false);
        this.cargarCamposDelPaso(datos);
      },
      error: () => this.router.navigate(['/bandeja'])
    });
    this.tramiteService.getHistorial(id).subscribe({
      next: (historial) => this.historialAuditoria.set(historial),
      error: (err) => console.error('Error cargando el historial', err)
    });
  }

  private cargarCamposDelPaso(tramite: any) {
    if (!tramite?.procesoDefinicionId || !tramite?.pasoActualId) return;
    this.procesoService.obtenerPorId(tramite.procesoDefinicionId).subscribe(proc => {
      this.procesoDefinicion.set(proc);
      const paso = proc.pasos?.find(p => p.id === tramite.pasoActualId);
      const campos = paso?.campos ?? [];
      this.camposPasoActual.set(campos);
      this.nombrePasoActual.set(paso?.nombre ?? '');

      const init: Record<string, any> = {};
      campos.forEach(c => {
        // FIX: Evitar que las tablas y checkboxes se corrompan con strings vacíos
        if (c.tipo === 'tabla') {
          const filas = [];
          const min = c.filasMinimas || 1;
          for(let i = 0; i < min; i++) {
            const fila: any = {};
            c.columnasTabla?.forEach(col => fila[col.id] = '');
            filas.push(fila);
          }
          init[c.id] = filas;
        } else if (c.tipo === 'checkbox') {
          init[c.id] = [];
        } else {
          init[c.id] = '';
        }
      });
      this.valoresFormulario.set(init);

      campos.filter(c => c.tipo === 'firma').forEach(c => this.inicializarCanvasFirma(c.id));
    });
  }

  actualizarCampo(campoId: string, valor: any) {
    this.valoresFormulario.update(v => ({ ...v, [campoId]: valor }));
  }

  getValorCampo(campoId: string): any {
    return this.valoresFormulario()[campoId];
  }

  subirArchivo(campoId: string, event: Event) {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!archivo) return;

    this.subiendoArchivo.set(campoId);
    const tramiteId = this.tramiteActual()?.id?.toString();

    this.archivoService.subirArchivo(archivo, tramiteId).subscribe({
      next: (resp) => {
        this.actualizarCampo(campoId, { nombreOriginal: resp.nombreOriginal, url: resp.url, tamano: resp.tamano });
        this.subiendoArchivo.set(null);
      },
      error: () => {
        this.errorMsg.set('Error al subir archivo');
        this.subiendoArchivo.set(null);
      }
    });
  }

  // FIX: Helper para validar nativamente extensiones
  getAceptaArchivos(campo: CampoFormulario): string {
    if (!campo.tiposArchivoPermitidos || campo.tiposArchivoPermitidos.length === 0) return '*/*';
    return campo.tiposArchivoPermitidos.map(ext => `.${ext.replace('.','')}`).join(', ');
  }

  toggleCheckbox(campoId: string, valor: string) {
    const actual = this.getValorCampo(campoId) || [];
    const arr = Array.isArray(actual) ? [...actual] : [];
    const idx = arr.indexOf(valor);
    if (idx >= 0) arr.splice(idx, 1);
    else arr.push(valor);
    this.actualizarCampo(campoId, arr);
  }

  estaMarcado(campoId: string, valor: string): boolean {
    const actual = this.getValorCampo(campoId);
    return Array.isArray(actual) && actual.includes(valor);
  }

  agregarFilaTabla(campoId: string, columnas: any[]) {
    const actual = this.getValorCampo(campoId) || [];
    const nuevaFila: any = {};
    columnas.forEach(col => nuevaFila[col.id] = '');
    this.actualizarCampo(campoId, [...actual, nuevaFila]);
  }

  eliminarFilaTabla(campoId: string, idx: number, minFilas: number = 1) {
    const actual = this.getValorCampo(campoId) || [];
    if (actual.length <= minFilas) return;
    const nueva = [...actual];
    nueva.splice(idx, 1);
    this.actualizarCampo(campoId, nueva);
  }

  actualizarCeldaTabla(campoId: string, filaIdx: number, colId: string, valor: any) {
    const actual = this.getValorCampo(campoId) || [];
    const nueva = [...actual];
    nueva[filaIdx] = { ...nueva[filaIdx], [colId]: valor };
    this.actualizarCampo(campoId, nueva);
  }

  setCalificacion(campoId: string, valor: number) {
    this.actualizarCampo(campoId, valor);
  }

  // FIX: Nueva función para capturar Geolocalización nativa
  capturarUbicacion(campoId: string) {
    if (!navigator.geolocation) {
      this.errorMsg.set('Geolocalización no soportada por el navegador.');
      return;
    }
    this.actualizarCampo(campoId, 'Obteniendo...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.actualizarCampo(campoId, `${pos.coords.latitude}, ${pos.coords.longitude}`);
      },
      (err) => {
        this.errorMsg.set('Error al obtener ubicación. Revisa los permisos.');
        this.actualizarCampo(campoId, '');
        setTimeout(() => this.errorMsg.set(null), 5000);
      }
    );
  }

  /* --- FIRMA DIGITAL --- */
  private firmaDibujando = new Map<string, boolean>();
  private firmaUltimoPunto = new Map<string, { x: number; y: number }>();
  firmaConTrazos = signal<Record<string, boolean>>({});

  iniciarFirma(campoId: string, evento: MouseEvent | TouchEvent): void {
    evento.preventDefault();
    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;
    const punto = this.coordenadasCanvas(canvas, evento);
    this.firmaDibujando.set(campoId, true);
    this.firmaUltimoPunto.set(campoId, punto);
  }

  dibujarFirma(campoId: string, evento: MouseEvent | TouchEvent): void {
    if (!this.firmaDibujando.get(campoId)) return;
    evento.preventDefault();
    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ultimoPunto = this.firmaUltimoPunto.get(campoId);
    const punto = this.coordenadasCanvas(canvas, evento);
    if (ultimoPunto) {
      ctx.beginPath();
      ctx.moveTo(ultimoPunto.x, ultimoPunto.y);
      ctx.lineTo(punto.x, punto.y);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    this.firmaUltimoPunto.set(campoId, punto);
    this.firmaConTrazos.update(v => ({ ...v, [campoId]: true }));
  }

  terminarFirma(campoId: string): void {
    this.firmaDibujando.set(campoId, false);
    this.firmaUltimoPunto.delete(campoId);
  }

  limpiarFirma(campoId: string): void {
    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.firmaConTrazos.update(v => ({ ...v, [campoId]: false }));
  }

  confirmarFirma(campoId: string): void {
    const canvas = this.obtenerCanvasFirma(campoId);
    if (!canvas) return;
    this.subiendoArchivo.set(campoId);
    canvas.toBlob((blob) => {
      if (!blob) {
        this.errorMsg.set('No se pudo capturar la firma. Inténtalo de nuevo.');
        this.subiendoArchivo.set(null); return;
      }
      const archivo = new File([blob], `firma-${Date.now()}.png`, { type: 'image/png' });
      const tramiteId = this.tramiteActual()?.id?.toString();
      this.archivoService.subirArchivo(archivo, tramiteId).subscribe({
        next: (resp) => {
          this.actualizarCampo(campoId, { nombreOriginal: resp.nombreOriginal, url: resp.url, tamano: resp.tamano });
          this.firmaConTrazos.update(v => ({ ...v, [campoId]: false }));
          this.subiendoArchivo.set(null);
        },
        error: () => {
          this.errorMsg.set('Error al subir la firma');
          this.subiendoArchivo.set(null);
        }
      });
    }, 'image/png');
  }

  private obtenerCanvasFirma(campoId: string): HTMLCanvasElement | null {
    return document.getElementById(`firma-${campoId}`) as HTMLCanvasElement | null;
  }

  private coordenadasCanvas(canvas: HTMLCanvasElement, evento: MouseEvent | TouchEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if (evento instanceof TouchEvent) {
      const touch = evento.touches[0] || evento.changedTouches[0];
      clientX = touch.clientX; clientY = touch.clientY;
    } else {
      clientX = evento.clientX; clientY = evento.clientY;
    }
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  inicializarCanvasFirma(campoId: string): void {
    setTimeout(() => {
      const canvas = this.obtenerCanvasFirma(campoId);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, 50);
  }

  urlArchivoCompleta(urlRelativa: string): string {
    return this.archivoService.urlArchivo(urlRelativa);
  }

  etiquetaCampoCliente(campoId: string): string {
    const paso = this.pasoInicioCliente();
    const campo = paso?.campos?.find(c => c.id === campoId);
    return campo?.etiqueta || campoId;
  }

  tipoCampoCliente(campoId: string): string {
    const paso = this.pasoInicioCliente();
    const campo = paso?.campos?.find(c => c.id === campoId);
    return campo?.tipo || 'texto';
  }

  entradasCliente = computed(() => {
    const datos = this.datosCliente();
    const paso = this.pasoInicioCliente();
    if (!paso) return [];
    return Object.entries(datos)
      .filter(([id]) => {
        const campo = paso.campos?.find(c => c.id === id);
        if (!campo) return false;
        if (['titulo', 'subtitulo', 'parrafo', 'separador'].includes(campo.tipo)) return false;
        return this.esCampoVisible(id);
      })
      // FIX: Agregamos la propiedad columnas
      .map(([id, valor]) => {
        const campo = paso.campos?.find(c => c.id === id);
        return { 
          id, 
          etiqueta: this.etiquetaCampoCliente(id), 
          tipo: this.tipoCampoCliente(id), 
          valor,
          columnas: campo?.columnasTabla || [] 
        };
      });
  });

 formatearValor(valor: any, tipo: string): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    
    if (tipo === 'si_no') return valor === 'SI' ? '✅ Sí' : '❌ No';
    if (tipo === 'tabla' && Array.isArray(valor)) return `${valor.length} fila(s) registradas`; 
    
    // Si es un arreglo (ej: checkboxes múltiples)
    if (Array.isArray(valor)) {
      if (valor.length === 0) return '—';
      return valor.join(', ');
    }
    
    // Si es un objeto de archivo (tiene URL)
    if (typeof valor === 'object' && valor.url) {
      return valor.nombreOriginal || 'Archivo adjunto';
    }

    // FIX: Si sigue siendo un objeto (como el caso de tu imagen)
    // Extraemos sus valores para mostrarlos de forma legible en vez de [object Object]
    if (typeof valor === 'object') {
      try {
        // Intenta mostrar los valores del objeto separados por coma
        const valores = Object.values(valor).filter(v => v !== '' && v !== null);
        if (valores.length > 0) return valores.join(', ');
        return 'Sin datos';
      } catch (e) {
        return JSON.stringify(valor);
      }
    }
    
    return String(valor);
  }

  entradasDictamen(log: any): Array<{ id: string; etiqueta: string; tipo: string; valor: any; columnas?: any[] }> {
    const datos = log.datosFormulario || {};
    if (Object.keys(datos).length === 0) return [];
    const paso = this.buscarPasoPorLog(log);
    const def = this.procesoDefinicion();
    const todosLosCampos: Record<string, CampoFormulario> = {};
    def?.pasos?.forEach(p => { (p.campos || []).forEach(c => { todosLosCampos[c.id] = c; }); });

    return Object.entries(datos)
      .filter(([id]) => {
        const campo = todosLosCampos[id];
        if (!campo) return true; 
        if (['titulo', 'subtitulo', 'parrafo', 'separador'].includes(campo.tipo)) return false;
        return this.esCampoVisible(id);
      })
      // FIX: Agregamos la propiedad columnas
      .map(([id, valor]) => {
        const campo = todosLosCampos[id];
        return { 
          id, 
          etiqueta: campo?.etiqueta || id, 
          tipo: campo?.tipo || 'texto', 
          valor,
          columnas: campo?.columnasTabla || []
        };
      });
  }

  colorAccion(accion: string): string {
    switch (accion) {
      case 'APROBADO': return 'emerald';
      case 'RECHAZADO': return 'red';
      case 'EN_REVISION': return 'amber';
      case 'INICIADO': return 'purple';
      default: return 'slate';
    }
  }

  nombreDepartamento(id: string | undefined | null): string {
    if (!id) return 'Sin asignar';
    if (id === 'PORTAL_WEB') return 'Portal del cliente';
    if (id === 'SISTEMA') return 'Sistema';
    if (id === 'ARCHIVADO') return 'Archivado';
    const d = this.listaDepartamentos().find(x => x.id === id);
    return d?.nombre || id;
  }

  guardarResolucion() {
    if (!this.puedeGuardar() || !this.tramiteActual()) return;
    this.isSaving.set(true); this.errorMsg.set(null);

    const formVal = this.resolutionForm.value;
    const actual = this.tramiteActual()!;
    const valoresForm = this.valoresFormulario();

    const textoFormulario = this.camposPasoActual()
      .filter(c => !['titulo', 'subtitulo', 'parrafo', 'separador'].includes(c.tipo))
      .map(c => {
        const valor = valoresForm[c.id];
        if (valor === undefined || valor === null || valor === '') return null;
        const valorStr = typeof valor === 'object' ? (valor.nombreOriginal || JSON.stringify(valor)) : String(valor);
        return `${c.etiqueta}: ${valorStr}`;
      }).filter(x => x !== null).join(' | ');

    const detalleResolucion = textoFormulario ? `Paso "${this.nombrePasoActual()}" — ${textoFormulario}` : `Resolución emitida en paso "${this.nombrePasoActual()}"`;
    const accionElegida = formVal.nuevoEstado!;

    const actualizacion: any = {
      ...actual,
      estadoSemaforo: this.mapearAccionAEstadoSemaforo(accionElegida),
      accionActor: accionElegida,
      departamentoActualId: actual.departamentoActualId,
      descripcion: actual.descripcion + '\n\n' + detalleResolucion,
      datosFormulario: valoresForm
    };

    this.tramiteService.actualizarTramite(actual.id.toString(), actualizacion).subscribe({
      next: () => {
        this.mensajeExito.set(true);
        setTimeout(() => this.router.navigate(['/bandeja']), 2000);
      },
      error: (err) => {
        console.error(err);
        const msg = typeof err.error === 'string' ? err.error : (err.error?.message || err.message);
        this.errorMsg.set(msg || 'Error al guardar la resolución.');
        this.isSaving.set(false);
      }
    });
  }

  seleccionarEstado(estado: string) {
    this.resolutionForm.patchValue({ nuevoEstado: estado });
    this.resolutionForm.get('nuevoEstado')?.markAsTouched();
    this.formValido.set(this.resolutionForm.valid);
  }

  private mapearAccionAEstadoSemaforo(accion: string): string {
    const upper = (accion || '').toUpperCase();
    const positivas = ['APROBADO', 'APROBAR', 'SI', 'BUENO', 'ACEPTADO', 'CORRECTO', 'VALIDO', 'APTO', 'OK', 'CONTINUAR'];
    const negativas = ['RECHAZADO', 'RECHAZAR', 'NO', 'MALO', 'DENEGADO', 'INCORRECTO', 'INVALIDO', 'NO_APTO', 'CANCELAR'];
    if (positivas.includes(upper)) return 'APROBADO';
    if (negativas.includes(upper)) return 'RECHAZADO';
    return 'EN_REVISION';
  }

  solicitarSugerenciaIA() {
    this.iaLoading.set('formulario_completo');
    const tramite = this.tramiteActual();
    const urlsArchivos: string[] = [];

    this.entradasCliente().forEach(entrada => {
      if ((entrada.tipo === 'archivo' || entrada.tipo === 'imagen') && entrada.valor?.url) urlsArchivos.push(entrada.valor.url);
    });
    this.dictamenesPrevios().forEach(log => {
      this.entradasDictamen(log).forEach(entrada => {
        if ((entrada.tipo === 'archivo' || entrada.tipo === 'imagen') && entrada.valor?.url) urlsArchivos.push(entrada.valor.url);
      });
    });

    const blueprintFormulario = this.camposPasoActual()
      .filter(c => !['titulo', 'subtitulo', 'parrafo', 'separador'].includes(c.tipo))
      // FIX: La IA no puede firmar ni capturar geolocalización, la quitamos del prompt.
      .filter(c => !['archivo', 'imagen', 'firma', 'ubicacion'].includes(c.tipo))
      .map(c => {
        const base: any = { id: c.id, etiqueta: c.etiqueta, tipo: c.tipo, descripcion: c.descripcion || '', requerido: c.requerido || false };
        if (['seleccion', 'radio', 'checkbox'].includes(c.tipo)) base.opcionesList = (c.opcionesList || []).map(o => ({ valor: o.valor, etiqueta: o.etiqueta }));
        if (c.tipo === 'tabla') base.columnasTabla = (c.columnasTabla || []).map(col => ({ id: col.id, etiqueta: col.etiqueta, tipo: col.tipo }));
        if (c.tipo === 'calificacion') base.escalaMax = c.escalaMax || 5;
        return base;
      });

    const payload = { contexto: JSON.stringify(blueprintFormulario), descripcion: tramite?.descripcion || '', archivos: urlsArchivos };

    this.http.post<any>(this.api.ia.sugerir, payload).subscribe({
      next: (res) => {
        if (res.texto) {
          try {
            const sugerenciasJson = JSON.parse(res.texto);
            const keys = Object.keys(sugerenciasJson);
            if (keys.length === 0) {
              this.errorMsg.set('ℹ️ La IA no encontró suficiente información en el relato y los documentos para rellenar el formulario. Complétalo manualmente.');
              setTimeout(() => this.errorMsg.set(null), 6000);
              this.iaLoading.set(null); return;
            }
            this.valoresFormulario.update(valoresActuales => {
              const nuevosValores = { ...valoresActuales };
              for (const key in sugerenciasJson) { if (sugerenciasJson.hasOwnProperty(key)) nuevosValores[key] = sugerenciasJson[key]; }
              return nuevosValores;
            });
            console.log(`✨ IA rellenó ${keys.length} campo(s)`);
          } catch (e) {
            console.error("Error parseando JSON de Gemini:", res.texto);
            this.errorMsg.set('⚠️ La IA no devolvió un formato válido. Intenta de nuevo.');
            setTimeout(() => this.errorMsg.set(null), 5000);
          }
        } else if (res.error) {
          this.errorMsg.set(`⚠️ ${res.error}`);
          setTimeout(() => this.errorMsg.set(null), 6000);
        }
        this.iaLoading.set(null);
      },
      error: () => {
        this.errorMsg.set('⚠️ Asistente no disponible por timeout. Continúa manualmente.');
        setTimeout(() => this.errorMsg.set(null), 5000);
        this.iaLoading.set(null);
      }
    });
  }

  // ── CU21: Modal de dictado / texto ──────────────────────────────────────
  abrirModalVoz() { this.modalVozAbierto.set(true); }
  cerrarModalVoz() { this.modalVozAbierto.set(false); }

  aplicarCamposVoz(camposLlenados: Record<string, any>) {
    Object.entries(camposLlenados).forEach(([id, valor]) => {
      this.actualizarCampo(id, valor);
    });
    this.cerrarModalVoz();
  }
}