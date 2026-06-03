import { Component, OnInit, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { DiagramadorBpmnComponent } from '../../components/diagramador-bpmn/diagramador-bpmn';
import { ReporteService } from '../../services/reporte.service';
import { ProcesoService } from '../../services/proceso';
import { AnalisisCuellosBotella, ProcesoDefinicion } from '../../models/proceso.model';

@Component({
  selector: 'app-mineria-procesos',
  standalone: true,
  imports: [CommonModule, RouterModule, DiagramadorBpmnComponent],
  templateUrl: './mineria-procesos.html'
})
export class MineriaProcesosComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private reporteService = inject(ReporteService);
  private procesoService = inject(ProcesoService);

  @ViewChild(DiagramadorBpmnComponent) diagramador?: DiagramadorBpmnComponent;

  procesoId = signal<string>('');
  proceso = signal<ProcesoDefinicion | null>(null);
  analisis = signal<AnalisisCuellosBotella | null>(null);
  
  isLoading = signal(true);
  error = signal<string | null>(null);
  listaProcesos = signal<ProcesoDefinicion[]>([]);

  ngOnInit() {
    // 1. Cargamos todos los procesos para el selector
    this.procesoService.obtenerProcesos().subscribe(procesos => {
      // Filtramos solo los activos u obsoletos (los borradores no tienen trámites)
      this.listaProcesos.set(procesos.filter(p => p.estado !== 'BORRADOR'));
      
      // Si la URL trajo un ID (por si luego lo usas), lo cargamos
      const idEnUrl = this.route.snapshot.paramMap.get('id');
      if (idEnUrl) {
        this.procesoId.set(idEnUrl);
        this.cargarDatos();
      } else {
        this.isLoading.set(false); // No cargamos nada hasta que seleccione uno
      }
    });
  }
  // 👇 NUEVO: Se ejecuta cuando el admin elige un proceso en el desplegable
  onSeleccionarProceso(event: Event) {
    const selectElement = event.target as HTMLSelectElement;
    const idSeleccionado = selectElement.value;
    
    if (idSeleccionado) {
      this.procesoId.set(idSeleccionado);
      this.cargarDatos();
    } else {
      // Si selecciona "Elige una política", limpiamos la pantalla
      this.proceso.set(null);
      this.analisis.set(null);
    }
  }

  cargarDatos() {
    this.isLoading.set(true);
    
    // 1. Primero traemos el Proceso para obtener el BPMN XML
    this.procesoService.obtenerPorId(this.procesoId()).subscribe({
      next: (proc) => {
        this.proceso.set(proc);
        
        // 2. Luego traemos la matemática de la Minería de Procesos
        this.reporteService.getMineriaProcesos(this.procesoId()).subscribe({
          next: (data) => {
            this.analisis.set(data);
            this.isLoading.set(false);
            
            // 3. Le damos 800ms al Diagramador para que renderice el XML 
            // antes de mandarle a inyectar el CSS del mapa de calor
            setTimeout(() => {
              if (this.diagramador) {
                this.diagramador.aplicarHeatmap(data.metricasPorPaso);
              }
            }, 800);
          },
          error: (err) => {
            this.error.set('Error al cargar métricas de minería.');
            this.isLoading.set(false);
          }
        });
      },
      error: () => {
        this.error.set('Proceso no encontrado.');
        this.isLoading.set(false);
      }
    });
  }

  volver() {
    this.router.navigate(['/admin/procesos']);
  }

  // Utilidad visual para los badges de estado
  getBadgeClass(color: string): string {
    switch(color) {
      case 'VERDE': return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
      case 'AMARILLO': return 'bg-amber-100 text-amber-800 border border-amber-200';
      case 'ROJO': return 'bg-red-100 text-red-800 border border-red-200 font-bold';
      default: return 'bg-slate-100 text-slate-800';
    }
  }
}