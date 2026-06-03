import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy,
  inject, signal, computed, HostListener, NgZone, ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApiConfigService } from '../../core/api-config.service';
import { ColaboracionService } from '../../services/colaboracion';
import { AuthService } from '../../services/auth';
import * as Y from 'yjs';

// ─── Awareness ────────────────────────────────────────────────────────────────
class YjsAwareness {
  readonly clientID: number;
  readonly doc: Y.Doc;
  private _states = new Map<number, Record<string, unknown>>();
  private _handlers: Array<(c: unknown) => void> = [];
  onLocalChange?: (state: Record<string, unknown>) => void;

  constructor(doc: Y.Doc) {
    this.doc = doc; this.clientID = doc.clientID;
    this._states.set(this.clientID, {});
  }
  get states() { return this._states; }
  getStates()  { return this._states; }
  getLocalState(): Record<string, unknown> | null { return this._states.get(this.clientID) ?? null; }
  setLocalState(s: Record<string, unknown> | null): void {
    s === null ? this._states.delete(this.clientID) : this._states.set(this.clientID, s);
    this.onLocalChange?.(s ?? {}); this._emit();
  }
  setLocalStateField(field: string, value: unknown): void {
    const next = { ...(this._states.get(this.clientID) ?? {}), [field]: value };
    this._states.set(this.clientID, next); this.onLocalChange?.(next); this._emit();
  }
  applyRemote(cid: number, s: Record<string, unknown> | null): void {
    s === null ? this._states.delete(cid) : this._states.set(cid, s); this._emit();
  }
  on(_: string, cb: (c: unknown) => void)  { this._handlers.push(cb); }
  off(_: string, cb: (c: unknown) => void) { this._handlers = this._handlers.filter(h => h !== cb); }
  destroy() { this._handlers = []; this._states.clear(); }
  private _emit() { this._handlers.forEach(h => h({ added: [], updated: [this.clientID], removed: [] })); }
}

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface CellData {
  v: string;
  b?: boolean;          // negrita
  i?: boolean;          // cursiva
  u?: boolean;          // subrayado
  s?: boolean;          // tachado
  a?: 'l' | 'c' | 'r'; // alineación
  bg?: string;          // color de fondo
  fg?: string;          // color de texto
  fs?: number;          // tamaño de fuente
  fmt?: 'general' | 'number' | 'currency' | 'percent' | 'date';
  wrap?: boolean;
  bd?: 'none' | 'all' | 'outer' | 'bottom';
}

export interface PresenciaHoja { usuario: string; color: string; }
export interface CursorRemoto  { clientID: number; row: number; col: number; nombre: string; color: string; }
interface SheetDocResponse { id: string; nombre: string; contenido: string; estadoYjs: string; }

// ─── Constantes ───────────────────────────────────────────────────────────────
export const ROWS = 50;
export const COLS = 26;

const COL_LABELS = Array.from({ length: COLS }, (_, i) => {
  let label = '', n = i + 1;
  while (n > 0) { n--; label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26); }
  return label;
});

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const PALETTE = [
  '#000000','#434343','#666666','#999999','#b7b7b7','#cccccc','#d9d9d9','#ffffff',
  '#ff0000','#ff4500','#ff8c00','#ffd700','#adff2f','#00ff00','#00fa9a','#00ffff',
  '#1e90ff','#0000ff','#8b008b','#ff00ff','#ff69b4','#ffa07a','#ffe4b5','#fffacd',
  '#90ee90','#e0f4ff','#1d6f42','#155233','#0d3d24','#0c3269','#4a0e4e','#7b1818',
];

const FN_RAPIDAS = ['SUM','AVERAGE','MIN','MAX','COUNT','IF','ROUND','CONCAT','TODAY','IFERROR','ABS','LEN'];

const FN_REGEX = /\b(SUM|AVERAGE|AVG|MIN|MAX|COUNT|COUNTA|MEDIAN|PRODUCT|IF|AND|OR|NOT|IFERROR|ABS|ROUND|ROUNDUP|ROUNDDOWN|INT|MOD|SQRT|POWER|CEILING|FLOOR|LEN|LEFT|RIGHT|MID|UPPER|LOWER|TRIM|CONCAT|CONCATENATE|PROPER|REPT|FIND|SUBSTITUTE|TEXT|TODAY|NOW|YEAR|MONTH|DAY|DATE|DAYS|WEEKDAY)\s*\(([^()]*)\)/gi;

function colorPorUsuario(n: string): string {
  const P = ['#1a73e8','#ea4335','#0f9d58','#f4b400','#7c4dff','#00acc1','#e67c1b','#c0392b','#2980b9','#8e44ad'];
  let h = 0;
  for (let i = 0; i < n.length; i++) { h = ((h << 5) - h) + n.charCodeAt(i); h |= 0; }
  return P[Math.abs(h) % P.length];
}

// ─── Componente ───────────────────────────────────────────────────────────────
@Component({
  selector: 'app-hoja-calculo-colaborativa',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './hoja-calculo-colaborativa.html',
  styleUrls: ['./hoja-calculo-colaborativa.css'],
  encapsulation: ViewEncapsulation.None,
})
export class HojaCalculoColaborativaComponent implements OnInit, OnDestroy {
  @Input() documentoId!: string;
  @Input() soloLectura  = false;
  @Input() contenidoInicial  = '';
  @Input() estadoYjsInicial  = '';
  @Output() cambio = new EventEmitter<{ id: string; contenido: string }>();

  // Constantes expuestas al template
  readonly ROWS       = ROWS;
  readonly COLS       = COLS;
  readonly colIndices = Array.from({ length: COLS }, (_, i) => i);
  readonly rowIndices = Array.from({ length: ROWS }, (_, i) => i);
  readonly colLabels  = COL_LABELS;
  readonly PALETTE    = PALETTE;
  readonly FONT_SIZES = FONT_SIZES;
  readonly FN_RAPIDAS = FN_RAPIDAS;

  // ── Signals ─────────────────────────────────────────────────────────────────
  cargando        = signal(true);
  error           = signal<string | null>(null);
  nombre          = signal('Hoja de cálculo');
  mongoId         = signal<string | null>(null);
  colapsado       = signal(false);
  modalAbierto    = signal(false);
  guardando       = signal(false);
  editoresActivos = signal<PresenciaHoja[]>([]);
  cursorRemotos   = signal<CursorRemoto[]>([]);

  // Grid
  cells        = signal<Record<string, CellData>>({});
  selectedCell = signal<{ row: number; col: number }>({ row: 0, col: 0 });
  editingCell  = signal<{ row: number; col: number } | null>(null);
  editValue    = signal('');
  colWidths    = signal<number[]>(Array.from({ length: COLS }, () => 100));

  // Ribbon
  tabActiva    = signal<'inicio' | 'insertar' | 'formulas' | 'datos'>('inicio');
  showBgPicker = signal(false);
  showFgPicker = signal(false);

  // Formato activo (computed desde la celda seleccionada)
  activeFmt = computed(() => this.getCellData(this.selectedCell().row, this.selectedCell().col));

  // ── DI ────────────────────────────────────────────────────────────────────
  private http     = inject(HttpClient);
  private api      = inject(ApiConfigService);
  private colabSvc = inject(ColaboracionService);
  private authSvc  = inject(AuthService);
  private zone     = inject(NgZone);

  private ydoc!:        Y.Doc;
  private ycells!:      Y.Map<string>;
  private awareness!:   YjsAwareness;
  private undoManager!: Y.UndoManager;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private username  = '';
  private userColor = '';

  // Column resize
  private resizingCol: number | null = null;
  private resizeStartX = 0;
  private resizeStartW = 0;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.username  = this.authSvc.getUsername() ?? 'Usuario';
    this.userColor = colorPorUsuario(this.username);

    this.http.post<SheetDocResponse>(this.api.documentos.tiptap, {
      claveCampo: this.documentoId,
      nombre:     'Hoja de cálculo',
    }).subscribe({
      next: (doc) => {
        this.mongoId.set(doc.id);
        this.nombre.set(doc.nombre ?? 'Hoja de cálculo');
        this._bootstrapYjs(doc.estadoYjs, doc.contenido);
        if (!this.soloLectura) {
          this.colabSvc.conectar()
            .then(() => this.colabSvc.suscribirDocumento(doc.id, ev => this._onRemoteUpdate(ev), () => {}))
            .catch(() => {});
        }
        this.cargando.set(false);
        this.cambio.emit({ id: doc.id, contenido: doc.contenido ?? '' });
      },
      error: () => { this.error.set('No se pudo cargar la hoja.'); this.cargando.set(false); },
    });
  }

  ngOnDestroy(): void {
    if (this.autoSaveTimer) clearInterval(this.autoSaveTimer);
    this._autoSave();
    this.awareness?.destroy();
    this.ydoc?.destroy();
  }

  // ── Yjs ───────────────────────────────────────────────────────────────────
  private _bootstrapYjs(estadoB64: string, contenidoJson: string): void {
    this.ydoc   = new Y.Doc();
    this.ycells = this.ydoc.getMap<string>('cells');

    if (estadoB64) {
      try { Y.applyUpdate(this.ydoc, Uint8Array.from(atob(estadoB64), c => c.charCodeAt(0)), 'init'); }
      catch { /* ignorar */ }
    }
    if (this.ycells.size === 0 && contenidoJson) {
      try {
        const saved: Record<string, string | CellData> = JSON.parse(contenidoJson);
        this.ydoc.transact(() => {
          Object.entries(saved).forEach(([k, v]) => {
            if (!v) return;
            const cell: CellData = typeof v === 'string' ? { v } : v;
            if (cell.v || cell.bg || cell.fg || cell.b || cell.i) this.ycells.set(k, JSON.stringify(cell));
          });
        }, 'init');
      } catch { /* ignorar */ }
    }

    const sync = () => {
      const snap: Record<string, CellData> = {};
      this.ycells.forEach((json, k) => {
        try { snap[k] = json.startsWith('{') ? JSON.parse(json) : { v: json }; } catch { snap[k] = { v: json }; }
      });
      this.zone.run(() => this.cells.set({ ...snap }));
    };
    this.ycells.observe(sync);
    sync();

    this.undoManager = new Y.UndoManager(this.ycells, { captureTimeout: 500 });

    this.awareness = new YjsAwareness(this.ydoc);
    this.awareness.setLocalStateField('user', { name: this.username, color: this.userColor });
    this.awareness.onLocalChange = (state) => {
      const id = this.mongoId(); if (!id) return;
      const json = JSON.stringify({ tipo: 'awareness', clientID: this.awareness.clientID, state });
      this.colabSvc.emitirYjsUpdate(id, btoa(unescape(encodeURIComponent(json))));
    };

    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || origin === 'init') return;
      const id = this.mongoId(); if (!id) return;
      this.colabSvc.emitirYjsUpdate(id, btoa(String.fromCharCode(...Array.from(update))));
    });

    if (!this.soloLectura) this.autoSaveTimer = setInterval(() => this._autoSave(), 3000);
  }

  private _onRemoteUpdate(ev: { payload: string }): void {
    if (!ev?.payload) return;
    this.zone.run(() => {
      try {
        const raw = decodeURIComponent(escape(atob(ev.payload)));
        if (raw.includes('"tipo":"awareness"')) {
          const p = JSON.parse(raw) as { clientID: number; state: Record<string, unknown> | null };
          this.awareness?.applyRemote(p.clientID, p.state);
          this._refreshPresencia();
          return;
        }
      } catch { /* no es awareness */ }
      try { Y.applyUpdate(this.ydoc, Uint8Array.from(atob(ev.payload), c => c.charCodeAt(0)), 'remote'); }
      catch { /* ignorar */ }
    });
  }

  private _refreshPresencia(): void {
    const editores: PresenciaHoja[] = [];
    const cursores: CursorRemoto[] = [];
    this.awareness.getStates().forEach((state, cid) => {
      if (cid === this.awareness.clientID) return;
      const u = state['user'] as { name: string; color: string } | undefined;
      if (u?.name) {
        editores.push({ usuario: u.name, color: u.color ?? '#1a73e8' });
        const cur = state['cursor'] as { row: number; col: number } | undefined;
        if (cur) cursores.push({ clientID: cid, row: cur.row, col: cur.col, nombre: u.name, color: u.color ?? '#1a73e8' });
      }
    });
    this.editoresActivos.set(editores);
    this.cursorRemotos.set(cursores);
  }

  private _autoSave(): void {
    const id = this.mongoId(); if (!id || !this.ycells) return;
    const snap: Record<string, CellData> = {};
    this.ycells.forEach((json, k) => { try { snap[k] = JSON.parse(json); } catch { snap[k] = { v: json }; } });
    const bin = Y.encodeStateAsUpdate(this.ydoc);
    this.guardando.set(true);
    this.colabSvc.guardarDocumento(id, JSON.stringify(snap), btoa(String.fromCharCode(...Array.from(bin))));
    setTimeout(() => this.guardando.set(false), 800);
  }

  // ── Helpers de celda ─────────────────────────────────────────────────────
  getCellData(row: number, col: number): CellData | null {
    return this.cells()[`${row}:${col}`] ?? null;
  }
  getCellCount(): number { return Object.keys(this.cells()).length; }
  getCellValue(row: number, col: number): string { return this.cells()[`${row}:${col}`]?.v ?? ''; }

  displayValue(row: number, col: number): string {
    const cell = this.getCellData(row, col);
    if (!cell?.v) return '';
    const raw = cell.v.startsWith('=') ? this.evalCell(row, col, new Set()) : cell.v;
    return this.applyFormat(raw, cell);
  }

  getCellStyle(row: number, col: number): Record<string, string> {
    const d = this.getCellData(row, col); if (!d) return {};
    const st: Record<string, string> = {};
    if (d.b)    st['font-weight']      = 'bold';
    if (d.i)    st['font-style']       = 'italic';
    if (d.u)    st['text-decoration']  = d.s ? 'underline line-through' : 'underline';
    else if (d.s) st['text-decoration'] = 'line-through';
    if (d.bg)   st['background-color'] = d.bg;
    if (d.fg)   st['color']            = d.fg;
    if (d.fs)   st['font-size']        = `${d.fs}px`;
    if (d.a)    st['text-align']       = d.a === 'l' ? 'left' : d.a === 'c' ? 'center' : 'right';
    if (d.wrap) st['white-space'] = 'normal';
    if (d.bd === 'all')   st['box-shadow'] = 'inset 0 0 0 1px #555';
    if (d.bd === 'outer') st['outline'] = '1px solid #555';
    if (d.bd === 'bottom') st['border-bottom'] = '2px solid #323130';
    return st;
  }

  getCellRef(row: number, col: number): string { return `${COL_LABELS[col]}${row + 1}`; }
  selectedRef(): string { const s = this.selectedCell(); return this.getCellRef(s.row, s.col); }
  formulaValue(): string { const ed = this.editingCell(); return ed ? this.editValue() : this.getCellValue(this.selectedCell().row, this.selectedCell().col); }
  isSelected(row: number, col: number): boolean { const s = this.selectedCell(); return s.row === row && s.col === col; }
  isEditing(row: number, col: number): boolean { const ed = this.editingCell(); return !!ed && ed.row === row && ed.col === col; }
  remoteCursorAt(row: number, col: number): CursorRemoto | undefined { return this.cursorRemotos().find(c => c.row === row && c.col === col); }
  initials(nombre: string): string { return nombre.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2); }

  // ── Motor de fórmulas ─────────────────────────────────────────────────────
  private evalCell(row: number, col: number, visited: Set<string>): string {
    const key = `${row}:${col}`;
    if (visited.has(key)) return '#CIRC!';
    const v = this.getCellData(row, col)?.v ?? '';
    if (!v.startsWith('=')) return v;
    visited.add(key);
    try {
      const result = this.evalExpr(v.slice(1).trim(), visited);
      if (typeof result === 'number') {
        const n = +result.toPrecision(10);
        return Number.isInteger(n) ? String(n) : String(n);
      }
      return String(result);
    } catch (e: unknown) {
      const msg = (e instanceof Error) ? e.message : '';
      return msg.startsWith('#') ? msg : '#ERROR!';
    }
  }

  private evalExpr(expr: string, visited: Set<string>): number | string {
    expr = expr.trim();
    if (!expr) return '';
    if (expr.startsWith('"') && expr.endsWith('"')) return expr.slice(1, -1);
    const n = Number(expr);
    if (expr !== '' && !isNaN(n)) return n;
    return this.evalArith(expr.toUpperCase(), visited);
  }

  private evalArith(expr: string, visited: Set<string>): number | string {
    let p = expr.trim();

    // Reemplazar concatenación & por + (antes de procesar)
    p = p.replace(/\s*&\s*/g, ' + ');

    // Reemplazar funciones (múltiples pasadas para anidadas)
    let prev = '';
    let safety = 0;
    while (prev !== p && safety++ < 20) {
      prev = p;
      p = p.replace(FN_REGEX, (_, fn, args) => {
        const r = this.evalFunction(fn.toUpperCase(), args.trim(), visited);
        if (typeof r === 'number') return String(r);
        return `"${String(r).replace(/"/g, '\\"')}"`;
      });
    }

    // Reemplazar referencias a celdas
    p = p.replace(/\b([A-Z]{1,3})(\d{1,5})\b/g, (_, col, row) => {
      const c = this.colLetterToIndex(col), r = parseInt(row) - 1;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return '""';
      const val = this.evalCell(r, c, new Set(visited));
      const num = parseFloat(val);
      return isNaN(num) ? `"${val.replace(/"/g, '\\"')}"` : String(num);
    });

    // Evaluar la expresión aritmética resultante
    if (!/[^0-9\s+\-*/^().,"eE<>=!]/.test(p)) {
      // eslint-disable-next-line no-new-func
      const evaluator = new Function(`"use strict"; return (${p.replace(/\^/g, '**')});`);
      const result = evaluator();
      if (result === Infinity || result === -Infinity) throw new Error('#DIV/0!');
      if (result === null || result === undefined) return '';
      return typeof result === 'boolean' ? (result ? 'VERDADERO' : 'FALSO') : result;
    }
    throw new Error('#ERROR!');
  }

  private evalFunction(fn: string, argsStr: string, visited: Set<string>): number | string {
    // Funciones sin argumentos
    if (fn === 'TODAY') return new Date().toISOString().split('T')[0];
    if (fn === 'NOW')   return new Date().toLocaleString('es-ES');
    if (fn === 'PI')    return Math.PI;

    const parts = this.splitTopLevel(argsStr);
    const evalPart = (i: number) => this.evalExpr(parts[i]?.trim() ?? '', visited);

    // Funciones de un argumento
    if (fn === 'ABS')     return Math.abs(Number(evalPart(0)));
    if (fn === 'SQRT')    return Math.sqrt(Number(evalPart(0)));
    if (fn === 'INT')     return Math.floor(Number(evalPart(0)));
    if (fn === 'LEN')     return String(evalPart(0)).length;
    if (fn === 'UPPER')   return String(evalPart(0)).toUpperCase();
    if (fn === 'LOWER')   return String(evalPart(0)).toLowerCase();
    if (fn === 'TRIM')    return String(evalPart(0)).trim();
    if (fn === 'PROPER')  return String(evalPart(0)).replace(/\b\w/g, c => c.toUpperCase());
    if (fn === 'YEAR')    return new Date(String(evalPart(0))).getFullYear();
    if (fn === 'MONTH')   return new Date(String(evalPart(0))).getMonth() + 1;
    if (fn === 'DAY')     return new Date(String(evalPart(0))).getDate();
    if (fn === 'WEEKDAY') return new Date(String(evalPart(0))).getDay() + 1;
    if (fn === 'NOT')     { const v = evalPart(0); return (v === 0 || v === '' || v === 'FALSO') ? 'VERDADERO' : 'FALSO'; }

    // Funciones de dos argumentos
    if (fn === 'POWER')    return Math.pow(Number(evalPart(0)), Number(evalPart(1)));
    if (fn === 'MOD')      { const d = Number(evalPart(1)); if (d === 0) throw new Error('#DIV/0!'); return Number(evalPart(0)) % d; }
    if (fn === 'ROUND')    return parseFloat(Number(evalPart(0)).toFixed(Math.max(0, Number(parts[1]?.trim() ?? '0'))));
    if (fn === 'ROUNDUP')  { const dec = Number(parts[1]?.trim() ?? '0'); const f = Math.pow(10, dec); return Math.ceil(Number(evalPart(0)) * f) / f; }
    if (fn === 'ROUNDDOWN') { const dec = Number(parts[1]?.trim() ?? '0'); const f = Math.pow(10, dec); return Math.floor(Number(evalPart(0)) * f) / f; }
    if (fn === 'CEILING')  return Math.ceil(Number(evalPart(0)) / Number(evalPart(1))) * Number(evalPart(1));
    if (fn === 'FLOOR')    return Math.floor(Number(evalPart(0)) / Number(evalPart(1))) * Number(evalPart(1));
    if (fn === 'LEFT')     return String(evalPart(0)).slice(0, Number(evalPart(1)));
    if (fn === 'RIGHT')    { const s = String(evalPart(0)); return s.slice(Math.max(0, s.length - Number(evalPart(1)))); }
    if (fn === 'REPT')     return String(evalPart(0)).repeat(Number(evalPart(1)));
    if (fn === 'FIND')     { const idx = String(evalPart(1)).indexOf(String(evalPart(0))); return idx < 0 ? '#VALOR!' : idx + 1; }
    if (fn === 'DAYS')     { const d1 = new Date(String(evalPart(0))), d2 = new Date(String(evalPart(1))); return Math.round((d1.getTime() - d2.getTime()) / 86400000); }

    // MID(text, start, length)
    if (fn === 'MID') return String(evalPart(0)).slice(Number(evalPart(1)) - 1, Number(evalPart(1)) - 1 + Number(evalPart(2)));

    // SUBSTITUTE(text, old, new, [instance])
    if (fn === 'SUBSTITUTE') {
      const text = String(evalPart(0)), oldTxt = String(evalPart(1)), newTxt = String(evalPart(2));
      return parts[3] ? text.replace(new RegExp(oldTxt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), newTxt) : text.split(oldTxt).join(newTxt);
    }

    // TEXT(value, format_text)
    if (fn === 'TEXT') {
      const n = Number(evalPart(0)); const fmt = String(evalPart(1));
      if (fmt.includes('%')) return (n * 100).toFixed(0) + '%';
      if (fmt.includes('$')) return `$${n.toFixed(2)}`;
      if (fmt.includes('0.00')) return n.toFixed(2);
      return String(evalPart(0));
    }

    // DATE(year, month, day)
    if (fn === 'DATE') return new Date(Number(evalPart(0)), Number(evalPart(1)) - 1, Number(evalPart(2))).toISOString().split('T')[0];

    // IF(condition, value_if_true, value_if_false)
    if (fn === 'IF') {
      const cond = evalPart(0);
      const isTrue = cond !== 0 && cond !== '' && cond !== 'FALSO';
      return this.evalExpr((parts[isTrue ? 1 : 2] ?? '').trim(), visited);
    }

    // IFERROR(value, value_if_error)
    if (fn === 'IFERROR') {
      try {
        const v = this.evalExpr(parts[0]?.trim() ?? '', visited);
        if (typeof v === 'string' && v.startsWith('#')) return this.evalExpr(parts[1]?.trim() ?? '', visited);
        return v;
      } catch { return this.evalExpr(parts[1]?.trim() ?? '', visited); }
    }

    // AND / OR
    if (fn === 'AND') { return parts.every(p => { const v = this.evalExpr(p.trim(), visited); return v !== 0 && v !== '' && v !== 'FALSO'; }) ? 'VERDADERO' : 'FALSO'; }
    if (fn === 'OR')  { return parts.some(p  => { const v = this.evalExpr(p.trim(), visited); return v !== 0 && v !== '' && v !== 'FALSO'; }) ? 'VERDADERO' : 'FALSO'; }

    // CONCAT / CONCATENATE
    if (fn === 'CONCAT' || fn === 'CONCATENATE') return this.expandRange(argsStr, visited).map(v => String(v)).join('');

    // Funciones de rango: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, MEDIAN, PRODUCT
    const values = this.expandRange(argsStr, visited);
    const nums = values.map(v => parseFloat(String(v))).filter(n => !isNaN(n));

    switch (fn) {
      case 'SUM':     return nums.reduce((a, b) => a + b, 0);
      case 'AVERAGE':
      case 'AVG':     return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      case 'MIN':     return nums.length ? Math.min(...nums) : 0;
      case 'MAX':     return nums.length ? Math.max(...nums) : 0;
      case 'COUNT':   return nums.length;
      case 'COUNTA':  return values.filter(v => v !== '' && v !== null).length;
      case 'MEDIAN': {
        const sorted = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }
      case 'PRODUCT': return nums.reduce((a, b) => a * b, 1);
      default:        return '#NOMBRE!';
    }
  }

  private expandRange(argsStr: string, visited: Set<string>): (number | string)[] {
    const values: (number | string)[] = [];
    for (const arg of this.splitTopLevel(argsStr)) {
      const t = arg.trim().toUpperCase();
      const m = t.match(/^([A-Z]{1,3})(\d{1,5}):([A-Z]{1,3})(\d{1,5})$/);
      if (m) {
        const c1 = this.colLetterToIndex(m[1]), r1 = parseInt(m[2]) - 1;
        const c2 = this.colLetterToIndex(m[3]), r2 = parseInt(m[4]) - 1;
        for (let r = r1; r <= r2; r++)
          for (let c = c1; c <= c2; c++)
            values.push(this.evalCell(r, c, new Set(visited)));
      } else {
        values.push(this.evalExpr(arg.trim(), visited));
      }
    }
    return values;
  }

  private splitTopLevel(str: string): string[] {
    const parts: string[] = [];
    let depth = 0, start = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') depth++;
      else if (str[i] === ')') depth--;
      else if (str[i] === ',' && depth === 0) { parts.push(str.slice(start, i)); start = i + 1; }
    }
    parts.push(str.slice(start));
    return parts;
  }

  private colLetterToIndex(col: string): number {
    let r = 0;
    for (const ch of col.toUpperCase()) r = r * 26 + (ch.charCodeAt(0) - 64);
    return r - 1;
  }

  private applyFormat(raw: string, cell: CellData): string {
    if (!raw || raw.startsWith('#') || !cell.fmt || cell.fmt === 'general') return raw;
    const n = parseFloat(raw);
    if (isNaN(n)) return raw;
    switch (cell.fmt) {
      case 'number':   return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'currency': return n.toLocaleString('es-ES', { style: 'currency', currency: 'USD' });
      case 'percent':  return (n * 100).toFixed(0) + '%';
      case 'date': {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return raw;
      }
      default: return raw;
    }
  }

  // ── Actualización de celdas ───────────────────────────────────────────────
  private updateCell(row: number, col: number, patch: Partial<CellData>): void {
    if (this.soloLectura) return;
    const key = `${row}:${col}`;
    const existing = this.getCellData(row, col);
    const updated: Record<string, unknown> = { v: '', ...existing, ...patch };
    // Limpiar campos opcionales vacíos
    ['b','i','u','s','wrap'].forEach(k => { if (!updated[k]) delete updated[k]; });
    ['bg','fg','bd','a','fmt'].forEach(k => { if (!updated[k]) delete updated[k]; });
    if (!updated['fs']) delete updated['fs'];
    const isEmpty = !updated['v'] && !Object.keys(updated).some(k => k !== 'v');
    this.ydoc.transact(() => {
      isEmpty ? this.ycells.delete(key) : this.ycells.set(key, JSON.stringify(updated));
    });
  }

  // ── Formato ───────────────────────────────────────────────────────────────
  toggleBold(): void        { const s = this.selectedCell(); this.updateCell(s.row, s.col, { b: !this.activeFmt()?.b }); }
  toggleItalic(): void      { const s = this.selectedCell(); this.updateCell(s.row, s.col, { i: !this.activeFmt()?.i }); }
  toggleUnderline(): void   { const s = this.selectedCell(); this.updateCell(s.row, s.col, { u: !this.activeFmt()?.u }); }
  toggleStrikethrough(): void { const s = this.selectedCell(); this.updateCell(s.row, s.col, { s: !this.activeFmt()?.s }); }
  toggleWrap(): void        { const s = this.selectedCell(); this.updateCell(s.row, s.col, { wrap: !this.activeFmt()?.wrap }); }

  setAlign(a: 'l' | 'c' | 'r'): void {
    const s = this.selectedCell();
    this.updateCell(s.row, s.col, { a: this.activeFmt()?.a === a ? undefined : a });
  }
  setFontSize(fs: number): void  { const s = this.selectedCell(); this.updateCell(s.row, s.col, { fs: fs || undefined }); }
  setFormat(fmt: CellData['fmt']): void { const s = this.selectedCell(); this.updateCell(s.row, s.col, { fmt }); }
  setBorder(bd: CellData['bd']): void   { const s = this.selectedCell(); this.updateCell(s.row, s.col, { bd }); }

  setBgColor(color: string): void { const s = this.selectedCell(); this.updateCell(s.row, s.col, { bg: color || undefined }); this.showBgPicker.set(false); }
  setFgColor(color: string): void { const s = this.selectedCell(); this.updateCell(s.row, s.col, { fg: color || undefined }); this.showFgPicker.set(false); }

  clearFormato(): void {
    const s = this.selectedCell();
    const cur = this.getCellData(s.row, s.col);
    if (!cur) return;
    const v = cur.v;
    this.ydoc.transact(() => {
      const key = `${s.row}:${s.col}`;
      v ? this.ycells.set(key, JSON.stringify({ v })) : this.ycells.delete(key);
    });
  }
  clearContenido(): void { this._clearCellValue(this.selectedCell().row, this.selectedCell().col); }
  clearTodo(): void {
    const s = this.selectedCell();
    this.ydoc.transact(() => this.ycells.delete(`${s.row}:${s.col}`));
  }

  // ── Operaciones de filas/columnas ─────────────────────────────────────────
  insertarFila(antes: boolean): void {
    if (this.soloLectura) return;
    const r = this.selectedCell().row + (antes ? 0 : 1);
    this.ydoc.transact(() => {
      const toAdd: [string, string][] = [], toDel: string[] = [];
      this.ycells.forEach((json, key) => {
        const [kr, kc] = key.split(':').map(Number);
        if (kr >= r && kr < ROWS - 1) { toAdd.push([`${kr + 1}:${kc}`, json]); toDel.push(key); }
        else if (kr >= ROWS - 1) toDel.push(key);
      });
      toDel.forEach(k => this.ycells.delete(k));
      toAdd.forEach(([k, v]) => this.ycells.set(k, v));
    });
  }

  eliminarFila(): void {
    if (this.soloLectura) return;
    const r = this.selectedCell().row;
    this.ydoc.transact(() => {
      const toAdd: [string, string][] = [], toDel: string[] = [];
      this.ycells.forEach((json, key) => {
        const [kr, kc] = key.split(':').map(Number);
        if (kr === r) toDel.push(key);
        else if (kr > r) { toAdd.push([`${kr - 1}:${kc}`, json]); toDel.push(key); }
      });
      toDel.forEach(k => this.ycells.delete(k)); toAdd.forEach(([k, v]) => this.ycells.set(k, v));
    });
    this.selectedCell.set({ row: Math.min(r, ROWS - 2), col: this.selectedCell().col });
  }

  insertarColumna(antes: boolean): void {
    if (this.soloLectura) return;
    const c = this.selectedCell().col + (antes ? 0 : 1);
    this.ydoc.transact(() => {
      const toAdd: [string, string][] = [], toDel: string[] = [];
      this.ycells.forEach((json, key) => {
        const [kr, kc] = key.split(':').map(Number);
        if (kc >= c && kc < COLS - 1) { toAdd.push([`${kr}:${kc + 1}`, json]); toDel.push(key); }
        else if (kc >= COLS - 1) toDel.push(key);
      });
      toDel.forEach(k => this.ycells.delete(k)); toAdd.forEach(([k, v]) => this.ycells.set(k, v));
    });
  }

  eliminarColumna(): void {
    if (this.soloLectura) return;
    const c = this.selectedCell().col;
    this.ydoc.transact(() => {
      const toAdd: [string, string][] = [], toDel: string[] = [];
      this.ycells.forEach((json, key) => {
        const [kr, kc] = key.split(':').map(Number);
        if (kc === c) toDel.push(key);
        else if (kc > c) { toAdd.push([`${kr}:${kc - 1}`, json]); toDel.push(key); }
      });
      toDel.forEach(k => this.ycells.delete(k)); toAdd.forEach(([k, v]) => this.ycells.set(k, v));
    });
    this.selectedCell.set({ row: this.selectedCell().row, col: Math.min(c, COLS - 2) });
  }

  ordenarColumna(asc: boolean): void {
    if (this.soloLectura) return;
    const col = this.selectedCell().col;
    const rowsConDatos: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      if (this.colIndices.some(c => this.getCellData(r, c)?.v)) rowsConDatos.push(r);
    }
    if (rowsConDatos.length < 2) return;

    const rowData = rowsConDatos.map(r => ({
      r, cells: this.colIndices.map(c => this.getCellData(r, c)),
      key: this.displayValue(r, col),
    }));
    rowData.sort((a, b) => {
      const an = parseFloat(a.key), bn = parseFloat(b.key);
      if (!isNaN(an) && !isNaN(bn)) return asc ? an - bn : bn - an;
      return asc ? a.key.localeCompare(b.key, 'es') : b.key.localeCompare(a.key, 'es');
    });

    this.ydoc.transact(() => {
      rowsConDatos.forEach((targetRow, i) => {
        this.colIndices.forEach((c, ci) => {
          const k = `${targetRow}:${c}`;
          const cell = rowData[i].cells[ci];
          cell?.v ? this.ycells.set(k, JSON.stringify(cell)) : this.ycells.delete(k);
        });
      });
    });
  }

  // ── AutoSuma ──────────────────────────────────────────────────────────────
  autoSuma(): void {
    if (this.soloLectura) return;
    const { row, col } = this.selectedCell();
    let r = row - 1;
    while (r >= 0 && this.displayValue(r, col) !== '') r--;
    const top = r + 1;
    if (top >= row) return;
    const formula = `=SUM(${this.getCellRef(top, col)}:${this.getCellRef(row - 1, col)})`;
    this.editingCell.set({ row, col });
    this.editValue.set(formula);
    this._commitEdit();
  }

  insertarFuncion(fn: string): void {
    if (this.soloLectura) return;
    const s = this.selectedCell();
    this.editingCell.set(s);
    this.editValue.set(`=${fn}()`);
    this._focusInput();
    setTimeout(() => {
      const inp = document.querySelector<HTMLInputElement>('.wsheet-cell-input');
      if (inp) inp.setSelectionRange(fn.length + 2, fn.length + 2);
    }, 20);
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────
  undo(): void { if (!this.soloLectura) this.undoManager?.undo(); }
  redo(): void { if (!this.soloLectura) this.undoManager?.redo(); }

  // ── Redimensionar columnas ─────────────────────────────────────────────────
  onColResizeStart(event: MouseEvent, col: number): void {
    event.preventDefault(); event.stopPropagation();
    this.resizingCol = col;
    this.resizeStartX = event.clientX;
    this.resizeStartW = this.colWidths()[col];
  }

  @HostListener('document:mousemove', ['$event'])
  onDocMouseMove(event: MouseEvent): void {
    if (this.resizingCol === null) return;
    const newW = Math.max(40, this.resizeStartW + event.clientX - this.resizeStartX);
    this.colWidths.update(ws => { const n = [...ws]; n[this.resizingCol!] = newW; return n; });
  }

  @HostListener('document:mouseup')
  onDocMouseUp(): void { this.resizingCol = null; }

  // ── Interacción con la grilla ─────────────────────────────────────────────
  selectCell(row: number, col: number, iniciarCon?: string): void {
    this._commitEdit();
    this.showBgPicker.set(false); this.showFgPicker.set(false);
    this.selectedCell.set({ row, col });
    this.awareness?.setLocalStateField('cursor', { row, col });
    if (iniciarCon !== undefined && !this.soloLectura) {
      this.editingCell.set({ row, col }); this.editValue.set(iniciarCon); this._focusInput();
    }
  }

  startEdit(row: number, col: number): void {
    if (this.soloLectura) return;
    this.selectedCell.set({ row, col }); this.editingCell.set({ row, col });
    this.editValue.set(this.getCellValue(row, col));
    this.awareness?.setLocalStateField('cursor', { row, col });
    this._focusInput(true);
  }

  onCellDivKeydown(_e: KeyboardEvent, row: number, col: number): void {
    if (!this.isSelected(row, col)) this.selectedCell.set({ row, col });
  }

  onCellKeydown(event: KeyboardEvent, row: number, col: number): void {
    if (event.key === 'Escape') { this.editingCell.set(null); event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === 'Enter') { this._commitEdit(); this.selectCell(Math.min(row + 1, ROWS - 1), col); event.preventDefault(); event.stopPropagation(); return; }
    if (event.key === 'Tab') { this._commitEdit(); event.shiftKey ? this.selectCell(row, Math.max(col - 1, 0)) : this.selectCell(row, Math.min(col + 1, COLS - 1)); event.preventDefault(); event.stopPropagation(); return; }
  }

  onFormulaFocus(): void {
    if (this.soloLectura) return;
    const s = this.selectedCell();
    if (!this.editingCell()) { this.editingCell.set(s); this.editValue.set(this.getCellValue(s.row, s.col)); }
  }
  onFormulaInput(v: string): void  { this.editValue.set(v); }
  onFormulaKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter')  { this._commitEdit(); e.preventDefault(); }
    if (e.key === 'Escape') { this.editingCell.set(null); (e.target as HTMLElement).blur(); e.preventDefault(); }
  }
  onFormulaBlur(): void { setTimeout(() => { if (this.editingCell()) this._commitEdit(); }, 100); }

  private _commitEdit(): void {
    const ed = this.editingCell(); if (!ed) return;
    const key = `${ed.row}:${ed.col}`;
    const val = this.editValue().trim();
    const existing = this.getCellData(ed.row, ed.col);
    const updated: CellData = existing ? { ...existing, v: val } : { v: val };
    this.ydoc.transact(() => {
      const hasStyle = !!(updated.b || updated.i || updated.u || updated.s || updated.bg || updated.fg || updated.fmt || updated.bd);
      if (!val && !hasStyle) this.ycells.delete(key);
      else this.ycells.set(key, JSON.stringify(updated));
    });
    this.editingCell.set(null);
  }

  private _clearCellValue(row: number, col: number): void {
    const key = `${row}:${col}`;
    const cur = this.getCellData(row, col); if (!cur) return;
    const updated = { ...cur, v: '' };
    this.ydoc.transact(() => {
      const hasStyle = !!(updated.b || updated.i || updated.u || updated.s || updated.bg || updated.fg || updated.fmt || updated.bd);
      hasStyle ? this.ycells.set(key, JSON.stringify(updated)) : this.ycells.delete(key);
    });
  }

  private _focusInput(selectAll = false): void {
    setTimeout(() => {
      const inp = document.querySelector<HTMLInputElement>('.wsheet-cell-input');
      if (!inp) return;
      inp.focus();
      if (selectAll) inp.select();
      else inp.setSelectionRange(inp.value.length, inp.value.length);
    }, 0);
  }

  // ── Teclado global ────────────────────────────────────────────────────────
  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    if (!this.modalAbierto()) return;

    // Ctrl / Meta shortcuts
    if (event.ctrlKey || event.metaKey) {
      switch (event.key.toLowerCase()) {
        case 'z': event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); return;
        case 'y': event.preventDefault(); this.redo(); return;
        case 's': event.preventDefault(); this._autoSave(); return;
        case 'b': if (!this.editingCell()) { event.preventDefault(); this.toggleBold(); } return;
        case 'i': if (!this.editingCell()) { event.preventDefault(); this.toggleItalic(); } return;
        case 'u': if (!this.editingCell()) { event.preventDefault(); this.toggleUnderline(); } return;
      }
      return;
    }

    if (event.key === 'Escape') {
      if (this.showBgPicker() || this.showFgPicker()) { this.showBgPicker.set(false); this.showFgPicker.set(false); event.preventDefault(); return; }
      if (this.editingCell()) { this.editingCell.set(null); event.preventDefault(); return; }
      this.cerrarModal(); return;
    }

    if (this.editingCell()) return;

    const s = this.selectedCell();
    switch (event.key) {
      case 'ArrowUp':    event.preventDefault(); this.selectCell(Math.max(s.row - 1, 0), s.col); break;
      case 'ArrowDown':  event.preventDefault(); this.selectCell(Math.min(s.row + 1, ROWS - 1), s.col); break;
      case 'ArrowLeft':  event.preventDefault(); this.selectCell(s.row, Math.max(s.col - 1, 0)); break;
      case 'ArrowRight': event.preventDefault(); this.selectCell(s.row, Math.min(s.col + 1, COLS - 1)); break;
      case 'Home':       event.preventDefault(); this.selectCell(s.row, 0); break;
      case 'End':        event.preventDefault(); this.selectCell(s.row, COLS - 1); break;
      case 'Enter': case 'F2': event.preventDefault(); this.startEdit(s.row, s.col); break;
      case 'Delete': case 'Backspace': event.preventDefault(); this._clearCellValue(s.row, s.col); break;
      default:
        if (event.key.length === 1 && !event.altKey) { event.preventDefault(); this.selectCell(s.row, s.col, event.key); }
    }
  }

  @HostListener('window:popstate')
  onPopState(): void { if (this.modalAbierto()) this.modalAbierto.set(false); }

  // ── Modal / misc ──────────────────────────────────────────────────────────
  abrirModal(): void {
    this.modalAbierto.set(true);
    history.pushState({ modal: 'hoja-calculo' }, '');
    setTimeout(() => this.awareness?.setLocalStateField('cursor', this.selectedCell()), 100);
  }
  cerrarModal(): void { this._commitEdit(); this.modalAbierto.set(false); history.back(); }
  toggleColapsado(): void { this.colapsado.set(!this.colapsado()); }

  descargar(): void {
    const header = this.colLabels.join(',') + '\n';
    const body = this.rowIndices.map(r =>
      this.colIndices.map(c => `"${this.displayValue(r, c).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${this.nombre()}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  }
}
