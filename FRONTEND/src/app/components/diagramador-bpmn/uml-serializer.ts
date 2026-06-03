import { type Cell, type Graph } from '@maxgraph/core';

export interface UmlCellValue {
  umlType: string;
  name?: string;
  guard?: string;
}

/** Formato XML que se persiste en MongoDB y se envía al backend Java. */
export const UML_XML_NS = 'http://www.omg.org/spec/UML/20131001';

export class UmlActivitySerializer {

  // ─────────────────────────────────────────────────────────────────────────────
  //  SERIALIZAR: Graph → UML XML string
  // ─────────────────────────────────────────────────────────────────────────────

  serialize(graph: Graph): string {
    const parent = graph.getDefaultParent();
    const children = parent.children ?? [];

    const partitions: Cell[] = [];
    const nodes: Cell[] = [];
    const edges: Cell[] = [];

    for (const cell of children) {
      if (cell.isEdge()) {
        edges.push(cell);
      } else if (cell.isVertex()) {
        const val = cell.getValue() as UmlCellValue | undefined;
        if (val?.umlType === 'ActivityPartition') {
          partitions.push(cell);
          for (const child of cell.children ?? []) {
            if (child.isVertex()) nodes.push(child);
            // Aristas dentro del mismo carril (ej: InitialNode→Tarea, Tarea→FinalNode)
            else if (child.isEdge()) edges.push(child);
          }
        }
      }
    }

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<umlActivity xmlns:uml="${UML_XML_NS}" id="Activity_1" name="Política de Negocio">`);

    // Particiones
    lines.push('  <partitions>');
    for (const p of partitions) {
      const geo = p.getGeometry()!;
      const val = p.getValue() as UmlCellValue;
      lines.push(`    <partition id="${p.getId()}" name="${this.esc(val.name ?? '')}" x="${Math.round(geo.x)}" y="${Math.round(geo.y)}" width="${Math.round(geo.width)}" height="${Math.round(geo.height)}"/>`);
    }
    lines.push('  </partitions>');

    // Nodos (con coords absolutas = parent.geo + child.geo)
    lines.push('  <nodes>');
    for (const n of nodes) {
      const geo = n.getGeometry()!;
      const parentGeo = (n.parent as Cell).getGeometry()!;
      const absX = Math.round(parentGeo.x + geo.x);
      const absY = Math.round(parentGeo.y + geo.y);
      const val = n.getValue() as UmlCellValue;
      const partId = (n.parent as Cell).getId();
      const nameAttr = val.name ? ` name="${this.esc(val.name)}"` : '';
      lines.push(`    <node id="${n.getId()}" type="${val.umlType}"${nameAttr} partition="${partId}" x="${absX}" y="${absY}" width="${Math.round(geo.width)}" height="${Math.round(geo.height)}"/>`);
    }
    lines.push('  </nodes>');

    // Aristas
    lines.push('  <edges>');
    for (const e of edges) {
      const val = (e.getValue() as UmlCellValue | string | null);
      const uv       = (typeof val === 'object' && val) ? val as UmlCellValue : null;
      const guard    = uv?.guard    ? ` guard="${this.esc(uv.guard)}"`    : '';
      const nameEdge = uv?.name     ? ` name="${this.esc(uv.name)}"`      : '';
      const srcId = e.source?.getId() ?? '';
      const tgtId = e.target?.getId() ?? '';
      if (!srcId || !tgtId) continue;
      const wps = e.getGeometry()?.points ?? [];
      const wpsAttr = wps.length
        ? ` waypoints="${wps.map((p: any) => `${Math.round(p.x)},${Math.round(p.y)}`).join(' ')}"`
        : '';
      lines.push(`    <edge id="${e.getId()}" type="ControlFlow" source="${srcId}" target="${tgtId}"${nameEdge}${guard}${wpsAttr}/>`);
    }
    lines.push('  </edges>');
    lines.push('</umlActivity>');

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  DESERIALIZAR: UML XML string → pobla el Graph
  // ─────────────────────────────────────────────────────────────────────────────

  deserialize(xml: string, graph: Graph, estilosUml: Record<string, any>): void {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const root = doc.documentElement;

    if (root.nodeName !== 'umlActivity') {
      throw new Error('XML no es un umlActivity válido');
    }

    const parent = graph.getDefaultParent();
    const cellById = new Map<string, Cell>();

    graph.batchUpdate(() => {
      // 1. Particiones → swimlanes
      const partEls = Array.from(root.querySelectorAll('partitions > partition'));
      for (const el of partEls) {
        const id = el.getAttribute('id')!;
        const name = el.getAttribute('name') ?? '';
        const x = Number(el.getAttribute('x') ?? 160);
        const y = Number(el.getAttribute('y') ?? 80);
        const w = Number(el.getAttribute('width') ?? 260);
        const h = Number(el.getAttribute('height') ?? 600);
        const val: UmlCellValue = { umlType: 'ActivityPartition', name };
        const cell = graph.insertVertex(parent, id, val, x, y, w, h, estilosUml['ActivityPartition']);
        cellById.set(id, cell);
      }

      // 2. Nodos → vertices hijos de su partición
      const nodeEls = Array.from(root.querySelectorAll('nodes > node'));
      for (const el of nodeEls) {
        const id = el.getAttribute('id')!;
        const type = el.getAttribute('type')!;
        const name = el.getAttribute('name') ?? undefined;
        const partId = el.getAttribute('partition')!;
        const absX = Number(el.getAttribute('x') ?? 0);
        const absY = Number(el.getAttribute('y') ?? 0);
        const w = Number(el.getAttribute('width') ?? 140);
        const h = Number(el.getAttribute('height') ?? 60);

        const partCell = cellById.get(partId);
        if (!partCell) continue;

        const partGeo = partCell.getGeometry()!;
        const relX = absX - partGeo.x;
        const relY = absY - partGeo.y;

        const val: UmlCellValue = { umlType: type, name };
        const style = estilosUml[type] ?? estilosUml['OpaqueAction'];
        const cell = graph.insertVertex(partCell, id, val, relX, relY, w, h, style);
        cellById.set(id, cell);
      }

      // 3. Aristas → edges entre nodos
      const edgeEls = Array.from(root.querySelectorAll('edges > edge'));
      for (const el of edgeEls) {
        const id = el.getAttribute('id')!;
        const guard    = el.getAttribute('guard') ?? undefined;
        const nameEdge = el.getAttribute('name')  ?? undefined;
        const srcId    = el.getAttribute('source')!;
        const tgtId    = el.getAttribute('target')!;
        const wpsRaw   = el.getAttribute('waypoints');

        const src = cellById.get(srcId);
        const tgt = cellById.get(tgtId);
        if (!src || !tgt) continue;

        // name tiene prioridad; si no existe, usar guard como label de visualización
        const val: UmlCellValue = { umlType: 'ControlFlow', name: nameEdge || guard, guard };
        const edge = graph.insertEdge(parent, id, val, src, tgt, estilosUml['ControlFlow']);

        if (wpsRaw) {
          const pts = wpsRaw.trim().split(' ').map(s => {
            const [x, y] = s.split(',').map(Number);
            return { x, y };
          });
          const geo = edge.getGeometry()!.clone();
          geo.points = pts as any;
          graph.getDataModel().setGeometry(edge, geo);
        }
        cellById.set(id, edge);
      }
    });
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
