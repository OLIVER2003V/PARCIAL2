import { Shape, CellRenderer } from '@maxgraph/core';

// ── ActivityFinalNode: "ojo de buey" (círculo con círculo interior negro) ───────
export class ActivityFinalNodeShape extends Shape {
  override paintBackground(c: any, x: number, y: number, w: number, h: number): void {
    c.ellipse(x, y, w, h);
    c.fillAndStroke();
  }

  override paintForeground(c: any, x: number, y: number, w: number, h: number): void {
    const m = Math.min(w, h) * 0.2;
    c.save();
    c.setFillColor('#000000');
    c.setStrokeColor('#000000');
    c.ellipse(x + m, y + m, w - 2 * m, h - 2 * m);
    c.fillAndStroke();
    c.restore();
  }
}

// ── FlowFinalNode: círculo con X interior ────────────────────────────────────────
export class FlowFinalNodeShape extends Shape {
  override paintBackground(c: any, x: number, y: number, w: number, h: number): void {
    c.ellipse(x, y, w, h);
    c.fillAndStroke();
  }

  override paintForeground(c: any, x: number, y: number, w: number, h: number): void {
    const m = Math.min(w, h) * 0.25;
    c.save();
    c.setStrokeColor('#000000');
    c.begin();
    c.moveTo(x + m, y + m);
    c.lineTo(x + w - m, y + h - m);
    c.moveTo(x + w - m, y + m);
    c.lineTo(x + m, y + h - m);
    c.stroke();
    c.restore();
  }
}

// ── ForkBarShape / JoinBarShape: barra horizontal negra gruesa ────────────────────
export class ForkBarShape extends Shape {
  override paintBackground(c: any, x: number, y: number, w: number, h: number): void {
    c.save();
    c.setFillColor('#000000');
    c.setStrokeColor('#000000');
    c.rect(x, y, w, h);
    c.fillAndStroke();
    c.restore();
  }
}

// ── AcceptEventActionShape: rectángulo con muesca tipo "bandera recibida" ─────────
export class AcceptEventActionShape extends Shape {
  override paintBackground(c: any, x: number, y: number, w: number, h: number): void {
    const notch = h * 0.35;
    c.begin();
    c.moveTo(x, y);
    c.lineTo(x + w, y);
    c.lineTo(x + w, y + h);
    c.lineTo(x, y + h);
    c.lineTo(x + notch, y + h / 2);
    c.lineTo(x, y);
    c.close();
    c.fillAndStroke();
  }
}

let _registradas = false;

export function registrarFormasUML(): void {
  if (_registradas) return;
  CellRenderer.registerShape('uml.ActivityFinalNode', ActivityFinalNodeShape);
  CellRenderer.registerShape('uml.FlowFinalNode', FlowFinalNodeShape);
  CellRenderer.registerShape('uml.ForkBar', ForkBarShape);
  CellRenderer.registerShape('uml.AcceptEventAction', AcceptEventActionShape);
  _registradas = true;
}
