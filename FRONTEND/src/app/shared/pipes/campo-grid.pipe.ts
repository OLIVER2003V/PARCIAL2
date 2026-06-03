import { Pipe, PipeTransform } from '@angular/core';
import { CampoFormulario } from '../../models/proceso.model';

// Mapa explícito para que Tailwind incluya todas las clases en el bundle
const SPAN_MAP: Record<number, string> = {
  1: 'col-span-1', 2: 'col-span-2', 3: 'col-span-3', 4: 'col-span-4',
  5: 'col-span-5', 6: 'col-span-6', 7: 'col-span-7', 8: 'col-span-8',
  9: 'col-span-9', 10: 'col-span-10', 11: 'col-span-11', 12: 'col-span-12',
};

@Pipe({ name: 'campoGrid', standalone: true, pure: true })
export class CampoGridPipe implements PipeTransform {
  transform(campo: CampoFormulario): string {
    const clases: string[] = [];

    if (campo.columnaSalto) clases.push('col-start-1');

    if (campo.columnaSpan != null && SPAN_MAP[campo.columnaSpan]) {
      clases.push(SPAN_MAP[campo.columnaSpan]);
    } else {
      switch (campo.ancho) {
        case 'medio':  clases.push('col-span-6');  break;
        case 'tercio': clases.push('col-span-4');  break;
        default:       clases.push('col-span-12'); break;
      }
    }

    return clases.join(' ');
  }
}
