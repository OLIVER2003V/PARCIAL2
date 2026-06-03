import {
  Component, Input, Output, EventEmitter, OnInit, OnDestroy,
  inject, signal, ViewChild, ElementRef, HostListener, NgZone,
  ViewEncapsulation,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ApiConfigService } from '../../core/api-config.service';
import { ColaboracionService } from '../../services/colaboracion';
import { AuthService } from '../../services/auth';

import { Editor, Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Color from '@tiptap/extension-color';
import TextStyle from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';

import * as Y from 'yjs';

// ── Minimal awareness compatible con y-protocols Awareness API ───────────────
// cursor-plugin.js (y-prosemirror) usa: .states, .clientID, .doc,
// getLocalState(), setLocalState(), setLocalStateField(), on(), off()
class TiptapAwareness {
  readonly clientID: number;
  readonly doc: Y.Doc;
  private _states = new Map<number, Record<string, unknown>>();
  private _handlers: Array<(c: unknown) => void> = [];
  onLocalChange?: (state: Record<string, unknown>) => void;

  constructor(doc: Y.Doc) {
    this.doc = doc;
    this.clientID = doc.clientID;
    this._states.set(this.clientID, {});
  }

  /** Propiedad directa requerida por awarenessStatesToArray */
  get states() { return this._states; }
  getStates()  { return this._states; }

  /** Devuelve el estado local completo (requerido por cursor-plugin) */
  getLocalState(): Record<string, unknown> | null {
    return this._states.get(this.clientID) ?? null;
  }

  /** Reemplaza el estado local completo */
  setLocalState(state: Record<string, unknown> | null): void {
    if (state === null) {
      this._states.delete(this.clientID);
    } else {
      this._states.set(this.clientID, state);
      this.onLocalChange?.(state);
    }
    this._emit();
  }

  /** Actualiza un campo del estado local */
  setLocalStateField(field: string, value: unknown): void {
    const next = { ...(this._states.get(this.clientID) ?? {}), [field]: value };
    this._states.set(this.clientID, next);
    this.onLocalChange?.(next);
    this._emit();
  }

  /** Aplica un estado remoto recibido por STOMP */
  applyRemote(clientID: number, state: Record<string, unknown> | null): void {
    state === null ? this._states.delete(clientID) : this._states.set(clientID, state);
    this._emit();
  }

  on(_: string, cb: (c: unknown) => void)  { this._handlers.push(cb); }
  off(_: string, cb: (c: unknown) => void) { this._handlers = this._handlers.filter(h => h !== cb); }
  destroy() { this._handlers = []; this._states.clear(); }

  private _emit() {
    this._handlers.forEach(h => h({ added: [], updated: [this.clientID], removed: [] }));
  }
}

// ── Deterministic color from username ────────────────────────────────────────
function colorPorUsuario(nombre: string): string {
  const P = ['#1a73e8','#ea4335','#0f9d58','#f4b400','#7c4dff',
             '#00acc1','#e67c1b','#c0392b','#2980b9','#8e44ad'];
  let h = 0;
  for (let i = 0; i < nombre.length; i++) { h = ((h << 5) - h) + nombre.charCodeAt(i); h |= 0; }
  return P[Math.abs(h) % P.length];
}

interface TiptapDocResponse { id: string; nombre: string; contenido: string; estadoYjs: string; }
export interface PresenciaEditando { usuario: string; color: string; }

// ── Shared base extensions (readonly + editable) ─────────────────────────────
const BASE_EXTENSIONS: Extensions = [
  Underline, TextStyle, Color,
  Highlight.configure({ multicolor: true }),
  Subscript, Superscript,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Link.configure({ openOnClick: false }),
  Image,
  Table.configure({ resizable: true }),
  TableRow, TableHeader, TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  CharacterCount,
];

@Component({
  selector: 'app-editor-texto-colaborativo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './editor-texto-colaborativo.html',
  styleUrls: ['./editor-texto-colaborativo.css'],
  encapsulation: ViewEncapsulation.None,
})
export class EditorTextoColaborativoComponent implements OnInit, OnDestroy {
  @Input() documentoId!: string;
  @Input() soloLectura = false;
  @Input() contenidoInicial = '';
  @Input() estadoYjsInicial = '';

  @Output() cambio = new EventEmitter<{ id: string; contenido: string }>();

  @ViewChild('editorHost') set editorHostRef(el: ElementRef<HTMLDivElement> | undefined) {
    if (el && !this.editor) {
      this._editorHost = el;
      // Defer until Angular has flushed the DOM so ProseMirror can attach
      // its keyboard/mouse event listeners to the real document.
      setTimeout(() => this._initEditor(), 0);
    }
  }

  // ── Signals ──────────────────────────────────────────────────────────────
  cargando       = signal(true);
  error          = signal<string | null>(null);
  nombre         = signal('Documento');
  mongoId        = signal<string | null>(null);
  colapsado      = signal(false);
  modalAbierto   = signal(false);
  guardando      = signal(false);
  editoresActivos= signal<PresenciaEditando[]>([]);
  activeTab      = signal<'inicio' | 'insertar'>('inicio');

  // ── Toolbar state signals ─────────────────────────────────────────────────
  isBold         = signal(false);
  isItalic       = signal(false);
  isUnderline    = signal(false);
  isStrike       = signal(false);
  isCode         = signal(false);
  isSubscript    = signal(false);
  isSuperscript  = signal(false);
  isAlignLeft    = signal(false);
  isAlignCenter  = signal(false);
  isAlignRight   = signal(false);
  isAlignJustify = signal(false);
  isBulletList   = signal(false);
  isOrderedList  = signal(false);
  isTaskList     = signal(false);
  isBlockquote   = signal(false);
  currentHeading = signal('normal');
  charCount      = signal(0);
  wordCount      = signal(0);
  currentColor   = signal('#000000');
  currentHighlight = signal('#FFFF00');

  // ── Private ──────────────────────────────────────────────────────────────
  private http     = inject(HttpClient);
  private api      = inject(ApiConfigService);
  private colabSvc = inject(ColaboracionService);
  private authSvc  = inject(AuthService);
  private zone     = inject(NgZone);

  private ydoc!:    Y.Doc;
  private awareness!: TiptapAwareness;
  private editor:   Editor | null = null;
  private _editorHost!: ElementRef<HTMLDivElement>;
  private _serverContent = '';
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private username = '';
  private userColor = '';

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.username  = this.authSvc.getUsername() ?? 'Usuario';
    this.userColor = colorPorUsuario(this.username);

    this.http.post<TiptapDocResponse>(this.api.documentos.tiptap, {
      claveCampo: this.documentoId,
      nombre:     'Documento de texto',
    }).subscribe({
      next: (doc) => {
        this.mongoId.set(doc.id);
        this.nombre.set(doc.nombre ?? 'Documento');
        this._serverContent = doc.contenido ?? '';

        if (!this.soloLectura) {
          this._bootstrapYjs(doc.estadoYjs);
          // Connect STOMP for real-time collaboration (non-blocking)
          this.colabSvc.conectar()
            .then(() => this.colabSvc.suscribirDocumento(
              doc.id,
              (ev) => this._onRemoteUpdate(ev),
              () => {},
            ))
            .catch(() => { /* collaboration unavailable — editor works locally */ });
        }

        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar el documento. Verifica la conexión.');
        this.cargando.set(false);
      },
    });
  }

  ngOnDestroy(): void {
    this._destroyEditor();
    this.awareness?.destroy();
    this.ydoc?.destroy();
  }

  // ── History API ───────────────────────────────────────────────────────────

  @HostListener('window:popstate')
  onPopState(): void { if (this.modalAbierto()) this.modalAbierto.set(false); }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.modalAbierto()) return;
    this.modalAbierto.set(false);
    history.back();
  }

  abrirModal(): void {
    this.modalAbierto.set(true);
    history.pushState({ modal: 'editor-texto' }, '');
  }

  cerrarModal(): void {
    this.modalAbierto.set(false);
    history.back();
  }

  toggleColapsado(): void { this.colapsado.set(!this.colapsado()); }

  setTab(tab: 'inicio' | 'insertar'): void { this.activeTab.set(tab); }

  // ── Toolbar actions ────────────────────────────────────────────────────────

  tb(action: string): void {
    const e = this.editor?.chain().focus();
    if (!e) return;
    const map: Record<string, () => void> = {
      bold:         () => e.toggleBold().run(),
      italic:       () => e.toggleItalic().run(),
      underline:    () => e.toggleUnderline().run(),
      strike:       () => e.toggleStrike().run(),
      code:         () => e.toggleCode().run(),
      subscript:    () => e.toggleSubscript().run(),
      superscript:  () => e.toggleSuperscript().run(),
      bulletList:   () => e.toggleBulletList().run(),
      orderedList:  () => e.toggleOrderedList().run(),
      taskList:     () => e.toggleTaskList().run(),
      blockquote:   () => e.toggleBlockquote().run(),
      codeBlock:    () => e.toggleCodeBlock().run(),
      alignLeft:    () => e.setTextAlign('left').run(),
      alignCenter:  () => e.setTextAlign('center').run(),
      alignRight:   () => e.setTextAlign('right').run(),
      alignJustify: () => e.setTextAlign('justify').run(),
      undo:         () => e.undo().run(),
      redo:         () => e.redo().run(),
      clearFormat:  () => e.unsetAllMarks().clearNodes().run(),
      hr:           () => e.setHorizontalRule().run(),
      insertTable:  () => e.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      addColAfter:  () => e.addColumnAfter().run(),
      addRowAfter:  () => e.addRowAfter().run(),
      deleteTable:  () => e.deleteTable().run(),
      insertImage: () => {
        const url = window.prompt('URL de la imagen:');
        if (url) e.setImage({ src: url }).run();
      },
      insertLink: () => {
        const prev = this.editor?.getAttributes('link')['href'] ?? '';
        const url = window.prompt('URL del vínculo:', prev);
        if (url === null) return;
        if (url === '') { e.unsetLink().run(); return; }
        e.setLink({ href: url, target: '_blank' }).run();
      },
    };
    map[action]?.();
  }

  applyHeading(level: string): void {
    const e = this.editor?.chain().focus();
    if (!e) return;
    level === 'normal' ? e.setParagraph().run()
                       : e.setHeading({ level: parseInt(level) as 1|2|3|4 }).run();
  }

  setHeading(event: Event): void {
    this.applyHeading((event.target as HTMLSelectElement).value);
  }

  setTextColor(event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.currentColor.set(color);
    this.editor?.chain().focus().setColor(color).run();
  }

  setHighlightColor(event: Event): void {
    const color = (event.target as HTMLInputElement).value;
    this.currentHighlight.set(color);
    this.editor?.chain().focus().setHighlight({ color }).run();
  }

  // ── Export ────────────────────────────────────────────────────────────────

  descargar(formato: 'docx' | 'pdf'): void {
    if (formato === 'pdf') { window.print(); return; }
    const html   = this.editor?.getHTML() ?? this._serverContent;
    const titulo = this.nombre();
    const blob = new Blob([`<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word'
      xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${titulo}</title>
      <style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;margin:2cm 2.5cm;}</style>
      </head><body>${html}</body></html>`],
      { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${titulo}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  focusEditor(event: Event): void {
    // Only focus when clicking directly on the page background (not inside the editor)
    if ((event.target as HTMLElement).closest('.ProseMirror')) return;
    this.editor?.commands.focus('end');
  }

  initials(nombre: string): string {
    return nombre.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _bootstrapYjs(estadoYjsB64: string): void {
    this.ydoc      = new Y.Doc();
    this.awareness = new TiptapAwareness(this.ydoc);

    if (estadoYjsB64) {
      try {
        const bin = Uint8Array.from(atob(estadoYjsB64), c => c.charCodeAt(0));
        Y.applyUpdate(this.ydoc, bin);
      } catch { /* corrupt state — start fresh */ }
    }

    this.awareness.setLocalStateField('user', { name: this.username, color: this.userColor });

    this.awareness.onLocalChange = (state) => {
      const id = this.mongoId();
      if (!id) return;
      const json = JSON.stringify({ tipo: 'awareness', clientID: this.awareness.clientID, state });
      this.colabSvc.emitirYjsUpdate(id, btoa(unescape(encodeURIComponent(json))));
    };

    // Relay Yjs binary updates outbound via STOMP
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      const id = this.mongoId();
      if (!id) return;
      const b64 = btoa(String.fromCharCode(...Array.from(update)));
      this.colabSvc.emitirYjsUpdate(id, b64);
    });
  }

  private _onRemoteUpdate(ev: { payload: string }): void {
    if (!ev?.payload) return;
    this.zone.run(() => {
      try {
        const raw = decodeURIComponent(escape(atob(ev.payload)));
        if (raw.startsWith('{') && raw.includes('"tipo":"awareness"')) {
          const p = JSON.parse(raw) as { tipo: string; clientID: number; state: Record<string, unknown> | null };
          this.awareness?.applyRemote(p.clientID, p.state);
          this._refreshPresencia();
          return;
        }
      } catch { /* not awareness JSON, try as Yjs binary */ }
      try {
        const bin = Uint8Array.from(atob(ev.payload), c => c.charCodeAt(0));
        Y.applyUpdate(this.ydoc, bin, 'remote');
      } catch { /* ignore bad updates */ }
    });
  }

  private _refreshPresencia(): void {
    const list: PresenciaEditando[] = [];
    this.awareness.getStates().forEach((state, cid) => {
      if (cid === this.awareness.clientID) return;
      const u = state['user'] as { name: string; color: string } | undefined;
      if (u?.name) list.push({ usuario: u.name, color: u.color ?? '#1a73e8' });
    });
    this.editoresActivos.set(list);
  }

  private _initEditor(): void {
    if (!this._editorHost) return;

    const readonly = this.soloLectura;

    const extensions: Extensions = [
      ...(readonly
        ? [StarterKit]
        : [
            StarterKit.configure({ history: false }),
            Collaboration.configure({ document: this.ydoc }),
            CollaborationCursor.configure({
              provider: { awareness: this.awareness } as any,
              user: { name: this.username, color: this.userColor },
              render: (user: { name: string; color: string }) => {
                const cursor = document.createElement('span');
                cursor.classList.add('collab-cursor');

                const caret = document.createElement('span');
                caret.classList.add('collab-cursor__caret');
                caret.style.borderColor = user.color;

                const label = document.createElement('span');
                label.classList.add('collab-cursor__label');
                label.style.backgroundColor = user.color;

                // Avatar circle + name
                const avatar = document.createElement('span');
                avatar.classList.add('collab-cursor__avatar');
                avatar.style.backgroundColor = user.color;
                avatar.textContent = (user.name || '?').split(' ').map((p: string) => p[0]).join('').toUpperCase().slice(0, 2);

                const nameEl = document.createElement('span');
                nameEl.textContent = user.name;

                label.appendChild(avatar);
                label.appendChild(nameEl);
                cursor.appendChild(caret);
                cursor.appendChild(label);
                return cursor;
              },
            }),
            Placeholder.configure({ placeholder: 'Empieza a escribir aquí...' }),
          ]
      ),
      ...BASE_EXTENSIONS,
    ];

    this.editor = new Editor({
      element: this._editorHost.nativeElement,
      editable: !readonly,
      extensions,
      onUpdate: ({ editor }) => {
        this.zone.run(() => this._syncToolbarState(editor));
        if (!readonly) this.cambio.emit({ id: this.mongoId() ?? '', contenido: editor.getHTML() });
      },
      onSelectionUpdate: ({ editor }) => {
        this.zone.run(() => this._syncToolbarState(editor));
      },
    });

    // Seed content
    if (readonly) {
      if (this._serverContent) this.editor.commands.setContent(this._serverContent, false);
    } else {
      // Yjs fragment is empty → restore from last saved HTML
      const frag = this.ydoc.getXmlFragment('default');
      if (frag.length === 0 && this._serverContent) {
        this.editor.commands.setContent(this._serverContent, false);
      }
    }

    if (!readonly) {
      this.autoSaveTimer = setInterval(() => this._autoSave(), 3000);
    }

    this._syncToolbarState(this.editor);
  }

  private _syncToolbarState(editor: Editor): void {
    this.isBold.set(editor.isActive('bold'));
    this.isItalic.set(editor.isActive('italic'));
    this.isUnderline.set(editor.isActive('underline'));
    this.isStrike.set(editor.isActive('strike'));
    this.isCode.set(editor.isActive('code'));
    this.isSubscript.set(editor.isActive('subscript'));
    this.isSuperscript.set(editor.isActive('superscript'));
    this.isAlignLeft.set(editor.isActive({ textAlign: 'left' }));
    this.isAlignCenter.set(editor.isActive({ textAlign: 'center' }));
    this.isAlignRight.set(editor.isActive({ textAlign: 'right' }));
    this.isAlignJustify.set(editor.isActive({ textAlign: 'justify' }));
    this.isBulletList.set(editor.isActive('bulletList'));
    this.isOrderedList.set(editor.isActive('orderedList'));
    this.isTaskList.set(editor.isActive('taskList'));
    this.isBlockquote.set(editor.isActive('blockquote'));

    if      (editor.isActive('heading', { level: 1 })) this.currentHeading.set('1');
    else if (editor.isActive('heading', { level: 2 })) this.currentHeading.set('2');
    else if (editor.isActive('heading', { level: 3 })) this.currentHeading.set('3');
    else if (editor.isActive('heading', { level: 4 })) this.currentHeading.set('4');
    else this.currentHeading.set('normal');

    const storage = (editor as any).storage;
    if (storage?.characterCount) {
      this.charCount.set(storage.characterCount.characters?.() ?? 0);
      this.wordCount.set(storage.characterCount.words?.() ?? 0);
    }
  }

  private _autoSave(): void {
    const id = this.mongoId();
    if (!id || !this.editor) return;
    const html = this.editor.getHTML();
    const bin  = Y.encodeStateAsUpdate(this.ydoc);
    const b64  = btoa(String.fromCharCode(...Array.from(bin)));
    this.guardando.set(true);
    this.colabSvc.guardarDocumento(id, html, b64);
    setTimeout(() => this.guardando.set(false), 800);
  }

  private _destroyEditor(): void {
    if (this.autoSaveTimer) { clearInterval(this.autoSaveTimer); this.autoSaveTimer = null; }
    this._autoSave();
    this.editor?.destroy();
    this.editor = null;
  }
}
