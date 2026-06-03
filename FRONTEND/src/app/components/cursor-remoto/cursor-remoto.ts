import { Component, Input, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ColaboracionService } from '../../services/colaboracion';

/**
 * Overlay de cursores remotos para el diagramador maxGraph.
 *
 * Las coordenadas que llegan por WebSocket son coordenadas de modelo maxGraph.
 * La fórmula de emisión (en diagramador-bpmn.ts) es:
 *   modelX = (clientX - canvasLeft) / scale - tx.x
 * La inversa (modelo → pantalla dentro del canvas) es:
 *   screenX = (modelX + tx.x) * scale
 *
 * Se escuchan los eventos 'scale', 'translate' y 'scaleAndTranslate'
 * de graphView para recalcular cuando el usuario hace zoom o pan.
 */
@Component({
  selector: 'app-cursor-remoto',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cursor-remoto.html',
  styleUrls: ['./cursor-remoto.css']
})
export class CursorRemotoComponent implements OnInit, OnDestroy {
  private colaboracionService = inject(ColaboracionService);

  /** Instancia de Graph de maxGraph (pasada desde diagramador-bpmn). */
  @Input({ required: true }) modeler: any = null;

  /** Si es false, no renderiza nada. */
  @Input() visible = true;

  cursoresRemotos = this.colaboracionService.cursoresRemotos;

  private viewboxScale = signal(1);
  private viewboxOriginX = signal(0);
  private viewboxOriginY = signal(0);

  private viewboxListener: ((sender: any, evt: any) => void) | null = null;

  cursoresEnPantalla = computed(() => {
    const escala = this.viewboxScale();
    const ox = this.viewboxOriginX();
    const oy = this.viewboxOriginY();

    return this.cursoresRemotos().map(c => ({
      ...c,
      pantallaX: (c.x + ox) * escala,
      pantallaY: (c.y + oy) * escala
    }));
  });

  ngOnInit(): void {
    if (!this.modeler) return;

    try {
      const view = this.modeler.getView();

      // Estado inicial
      this.sincronizarDesdeView(view);

      // Escuchar cambios de escala y traslación
      this.viewboxListener = () => this.sincronizarDesdeView(view);
      view.addListener('scale', this.viewboxListener);
      view.addListener('translate', this.viewboxListener);
      view.addListener('scaleAndTranslate', this.viewboxListener);
    } catch (e) {
      console.error('[CursorRemoto] Error inicializando viewbox maxGraph:', e);
    }
  }

  ngOnDestroy(): void {
    if (this.modeler && this.viewboxListener) {
      try {
        const view = this.modeler.getView();
        view.removeListener(this.viewboxListener);
      } catch { }
    }
  }

  private sincronizarDesdeView(view: any): void {
    if (!view) return;
    const scale = view.getScale() ?? 1;
    const tx = view.getTranslate() ?? { x: 0, y: 0 };
    this.viewboxScale.set(scale);
    this.viewboxOriginX.set(tx.x);
    this.viewboxOriginY.set(tx.y);
  }
}