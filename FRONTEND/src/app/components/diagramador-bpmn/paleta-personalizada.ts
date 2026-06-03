import type { CellStyle } from '@maxgraph/core';

/** Tipos de nodos UML 2.5 Activity Diagram soportados. */
export const UML_TIPOS_NODO = new Set([
  'InitialNode',
  'OpaqueAction',
  'DecisionNode',
  'MergeNode',
  'ForkNode',
  'JoinNode',
  'ActivityFinalNode',
  'FlowFinalNode',
  'AcceptEventAction',
  'Note',
]);

/** Tipos cuyos labels se renderizan FUERA del shape (debajo). */
export const UML_TIPOS_LABEL_EXTERNO = new Set([
  'InitialNode',
  'ActivityFinalNode',
  'FlowFinalNode',
  'DecisionNode',
  'MergeNode',
  'ForkNode',
  'JoinNode',
]);

/** Tamaños por defecto de cada tipo de nodo UML. */
export const UML_TAMANOS: Record<string, { w: number; h: number }> = {
  InitialNode:         { w: 30,  h: 30  },
  OpaqueAction:        { w: 140, h: 60  },
  DecisionNode:        { w: 44,  h: 44  },
  MergeNode:           { w: 44,  h: 44  },
  ForkNode:            { w: 120, h: 14  },
  JoinNode:            { w: 120, h: 14  },
  ActivityFinalNode:   { w: 30,  h: 30  },
  FlowFinalNode:       { w: 30,  h: 30  },
  AcceptEventAction:   { w: 140, h: 60  },
  Note:                { w: 120, h: 60  },
};

/** Estilos visuales para cada tipo UML, usados al insertar celdas en maxGraph. */
export const UML_ESTILOS: Record<string, CellStyle> = {

  ActivityPartition: {
    shape:         'swimlane',
    startSize:     30,
    fillColor:     '#f8fafc',
    strokeColor:   '#94a3b8',
    fontColor:     '#1e293b',
    fontSize:      12,
    fontStyle:     1,
    swimlaneLine:  true,
    horizontal:    true,
  } as any,

  InitialNode: {
    shape:       'ellipse',
    fillColor:   '#000000',
    strokeColor: '#000000',
    aspect:      'fixed',
    perimeter:   'ellipsePerimeter',
    noLabel:     true,
  } as any,

  OpaqueAction: {
    rounded:     true,
    fillColor:   '#dbeafe',
    strokeColor: '#3b82f6',
    fontColor:   '#1e40af',
    fontStyle:   1,
    fontSize:    12,
    perimeter:   'rectanglePerimeter',
  } as any,

  DecisionNode: {
    shape:                  'rhombus',
    fillColor:              '#fef9c3',
    strokeColor:            '#ca8a04',
    fontColor:              '#713f12',
    perimeter:              'rhombusPerimeter',
    fontSize:               11,
    verticalLabelPosition:  'bottom',
    verticalAlign:          'top',
    labelBackgroundColor:   'none',
    labelPosition:          'center',
    align:                  'center',
  } as any,

  MergeNode: {
    shape:                  'rhombus',
    fillColor:              '#fef9c3',
    strokeColor:            '#ca8a04',
    fontColor:              '#713f12',
    perimeter:              'rhombusPerimeter',
    fontSize:               11,
    verticalLabelPosition:  'bottom',
    verticalAlign:          'top',
    labelBackgroundColor:   'none',
    labelPosition:          'center',
    align:                  'center',
  } as any,

  ForkNode: {
    shape:       'uml.ForkBar',
    fillColor:   '#000000',
    strokeColor: '#000000',
    perimeter:   'rectanglePerimeter',
    noLabel:     true,
  } as any,

  JoinNode: {
    shape:       'uml.ForkBar',
    fillColor:   '#000000',
    strokeColor: '#000000',
    perimeter:   'rectanglePerimeter',
    noLabel:     true,
  } as any,

  ActivityFinalNode: {
    shape:       'uml.ActivityFinalNode',
    fillColor:   '#ffffff',
    strokeColor: '#000000',
    aspect:      'fixed',
    perimeter:   'ellipsePerimeter',
    noLabel:     true,
  } as any,

  FlowFinalNode: {
    shape:       'uml.FlowFinalNode',
    fillColor:   '#ffffff',
    strokeColor: '#000000',
    aspect:      'fixed',
    perimeter:   'ellipsePerimeter',
    noLabel:     true,
  } as any,

  AcceptEventAction: {
    shape:       'uml.AcceptEventAction',
    fillColor:   '#dcfce7',
    strokeColor: '#16a34a',
    fontColor:   '#14532d',
    fontStyle:   1,
    fontSize:    12,
    perimeter:   'rectanglePerimeter',
  } as any,

  Note: {
    shape:       'note',
    fillColor:   '#fef9c3',
    strokeColor: '#a16207',
    fontColor:   '#78350f',
    fontSize:    11,
    size:        10,
    perimeter:   'rectanglePerimeter',
  } as any,

  ControlFlow: {
    edgeStyle:            'orthogonalEdgeStyle',
    rounded:              false,
    strokeColor:          '#64748b',
    fontSize:             10,
    fontStyle:            1,
    fontColor:            '#1e40af',
    endArrow:             'block',
    endFill:              true,
    labelBackgroundColor: '#eff6ff',
    labelBorderColor:     'none',
  } as any,
};

/** Entradas de la paleta visual: lo que se muestra al usuario. */
export interface EntradaPaleta {
  tipo: string;
  titulo: string;
  descripcion: string;
  grupo: 'nodos' | 'control' | 'terminadores' | 'especiales';
}

export const ENTRADAS_PALETA: EntradaPaleta[] = [
  { tipo: 'InitialNode',       titulo: 'Nodo Inicial',     descripcion: 'Inicio del flujo de actividad',                   grupo: 'nodos'       },
  { tipo: 'OpaqueAction',      titulo: 'Acción',           descripcion: 'Actividad o tarea realizada por un rol',          grupo: 'nodos'       },
  { tipo: 'AcceptEventAction', titulo: 'Aceptar Evento',   descripcion: 'Acción que espera o recibe un evento/señal',      grupo: 'especiales'  },
  { tipo: 'Note',              titulo: 'Nota',             descripcion: 'Comentario informativo (no afecta el flujo)',      grupo: 'especiales'  },
  { tipo: 'DecisionNode',      titulo: 'Decisión',         descripcion: 'Bifurcación condicional: un solo camino activo',  grupo: 'control'     },
  { tipo: 'MergeNode',         titulo: 'Convergencia',     descripcion: 'Une ramas condicionales alternativas',            grupo: 'control'     },
  { tipo: 'ForkNode',          titulo: 'Fork Paralelo',    descripcion: 'Divide en flujos paralelos simultáneos',          grupo: 'control'     },
  { tipo: 'JoinNode',          titulo: 'Join Paralelo',    descripcion: 'Sincroniza y une flujos paralelos',               grupo: 'control'     },
  { tipo: 'ActivityFinalNode', titulo: 'Fin de Actividad', descripcion: 'Termina TODA la actividad',                       grupo: 'terminadores'},
  { tipo: 'FlowFinalNode',     titulo: 'Fin de Flujo',     descripcion: 'Termina solo este camino (otros continúan)',      grupo: 'terminadores'},
];
