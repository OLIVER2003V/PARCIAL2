import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy,
  Input, Output, EventEmitter, inject, PLATFORM_ID, signal
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Graph, Cell, type CellStyle } from '@maxgraph/core';
import { registrarFormasUML } from '../diagramador-bpmn/uml-shapes';
import { UmlActivitySerializer, type UmlCellValue } from '../diagramador-bpmn/uml-serializer';
import { UML_ESTILOS } from '../diagramador-bpmn/paleta-personalizada';

// Subclase mínima de Graph para renderizar etiquetas UML correctamente.
class GraphThumbnail extends Graph {
  override convertValueToString(cell: Cell): string {
    const v = cell.getValue();
    if (v && typeof v === 'object') {
      const uv = v as UmlCellValue;
      return uv.name || uv.guard || '';
    }
    return v != null ? String(v) : '';
  }
}

/**
 * Componente ligero para mostrar un thumbnail del diagrama BPMN/UML a partir
 * de su XML. Usa IntersectionObserver para renderizar solo cuando entra en
 * el viewport, captura el SVG resultante, destruye el grafo y emite el SVG
 * al padre para que lo persista en local state.
 */
@Component({
  selector: 'app-bpmn-thumbnail',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full h-full relative">
      @if (svgCapturado()) {
        <div [innerHTML]="svgSeguro()"
             class="w-full h-full flex items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:w-auto [&_svg]:h-auto opacity-80 group-hover:opacity-100 transition-opacity duration-300">
        </div>
      } @else {
        <div #canvas class="w-full h-full"></div>
        @if (cargando()) {
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div class="w-5 h-5 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin"></div>
          </div>
        }
      }
    </div>
  `
})
export class BpmnThumbnailComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) xml = '';
  @Output() svgReady = new EventEmitter<string>();

  @ViewChild('canvas') canvasRef?: ElementRef<HTMLDivElement>;

  cargando    = signal(false);
  svgCapturado = signal('');

  private graph:      Graph | null             = null;
  private observer:   IntersectionObserver | null = null;
  private serializer  = new UmlActivitySerializer();
  private sanitizer   = inject(DomSanitizer);
  private platformId  = inject(PLATFORM_ID);
  private hostEl      = inject(ElementRef);

  svgSeguro(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(this.svgCapturado());
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId) || !this.xml?.trim()) return;

    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !this.cargando() && !this.svgCapturado()) {
          this.observer!.disconnect();
          this.iniciarRenderizado();
        }
      },
      { threshold: 0.1 }
    );
    this.observer.observe(this.hostEl.nativeElement);
  }

  private iniciarRenderizado(): void {
    if (!this.xml?.includes('<umlActivity') || !this.canvasRef) return;

    this.cargando.set(true);
    registrarFormasUML();

    const container = this.canvasRef.nativeElement;
    const graph = new GraphThumbnail(container);
    this.graph = graph;

    // Solo lectura, sin interacción
    graph.setEnabled(false);
    graph.setPanning(false);
    graph.setTooltips(false);

    // Aplicar los mismos estilos que el diagramador principal
    const ss = graph.getStylesheet();
    ss.putDefaultEdgeStyle({
      edgeStyle:   'orthogonalEdgeStyle',
      rounded:     false,
      strokeColor: '#64748b',
      fontSize:    10,
      fontColor:   '#475569',
      endArrow:    'block',
      endFill:     true,
    } as any);
    ss.putDefaultVertexStyle({
      fillColor:   '#ffffff',
      strokeColor: '#64748b',
      fontColor:   '#1e293b',
      fontSize:    12,
      fontStyle:   0,
      perimeter:   'rectanglePerimeter',
    } as any);
    for (const [tipo, estilo] of Object.entries(UML_ESTILOS)) {
      ss.putCellStyle(tipo, estilo as CellStyle);
    }

    // Deserializar el XML
    try {
      this.serializer.deserialize(this.xml, graph, UML_ESTILOS);
    } catch {
      this.cargando.set(false);
      graph.destroy();
      this.graph = null;
      return;
    }

    // Fit y captura de SVG tras el render
    setTimeout(() => {
      if (!this.graph) return;

      graph.fit();
      const view = (graph as any).view;
      if (view?.getScale) {
        // Pequeño margen visual alrededor del diagrama
        view.setScale(view.getScale() * 0.88);
      }

      const svgEl = container.querySelector('svg');
      if (svgEl) {
        // Fijar dimensiones para que el SVG escale correctamente en la tarjeta
        svgEl.setAttribute('width',  '100%');
        svgEl.setAttribute('height', '100%');
        const svg = new XMLSerializer().serializeToString(svgEl);
        this.svgCapturado.set(svg);
        this.svgReady.emit(svg);
      }

      // El grafo ya no se necesita; liberar recursos
      graph.destroy();
      this.graph = null;
      this.cargando.set(false);
    }, 300);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.graph?.destroy();
  }
}
