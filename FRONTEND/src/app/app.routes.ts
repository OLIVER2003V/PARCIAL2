import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login';
import { RegistroComponent } from './components/registro/registro';
import { MainLayoutComponent } from './shared/layouts/main-layout';
import { DashboardComponent } from './components/dashboard/dashboard';
import { DepartamentosComponent } from './components/departamentos/departamentos';
import { UsuariosComponent } from './components/usuarios/usuarios';
import { OrganizacionComponent } from './components/organizacion/organizacion';
import { NuevoTramiteComponent } from './components/nuevo-tramite/nuevo-tramite';
import { BandejaEntradaComponent } from './components/bandeja-entrada/bandeja-entrada';
import { ProcesarTramiteComponent } from './components/procesar-tramite/procesar-tramite';
import { RastrearTramiteComponent } from './components/rastrear-tramite/rastrear-tramite';
import { authGuard } from './guards/auth-guard';
import { adminGuard } from './guards/admin-guard';
import { AdminProcesosComponent } from './components/admin-procesos/admin-procesos';
// 👇 NUEVO CU13: Import
import { ReportesComponent } from './components/reportes/reportes';
import { AuditoriaComponent } from './components/auditoria/auditoria';
import { IaMonitorComponent } from './components/ia-monitor/ia-monitor';
import { invitacionGuard } from './guards/invitacion-guard';
export const routes: Routes = [
  // --- RUTAS PÚBLICAS ---
  // Estas rutas no usan el Sidebar y se ven a pantalla completa
  { path: 'login', component: LoginComponent },
  { path: 'registro', component: RegistroComponent },

  // --- RUTAS PROTEGIDAS (CON WRAPPER) ---
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard], // Protege el Layout y todos sus hijos de un solo golpe
    children: [
      { path: 'dashboard', component: DashboardComponent },

      // 👇 RUTAS ADMIN-ONLY (con adminGuard)
      { path: 'organizacion', component: OrganizacionComponent, canActivate: [adminGuard] },
      { path: 'usuarios', redirectTo: 'organizacion', pathMatch: 'full' },
      { path: 'departamentos', redirectTo: 'organizacion', pathMatch: 'full' },
      { path: 'admin-procesos', component: AdminProcesosComponent, canActivate: [adminGuard] },
      { path: 'reportes', component: ReportesComponent, canActivate: [adminGuard] },
      { path: 'reportes-nlp', redirectTo: 'reportes', pathMatch: 'full' },
      // 👇 NUEVO CU16
      { path: 'auditoria', component: AuditoriaComponent, canActivate: [adminGuard] },
      { path: 'ia-monitor', component: IaMonitorComponent, canActivate: [adminGuard] },
      {
        path: 'admin/mineria',
        canActivate: [adminGuard],
        loadComponent: () => import('./pages/mineria-procesos/mineria-procesos').then(m => m.MineriaProcesosComponent)
      },
      // 👇 NUEVO Colaboración: ruta de invitación (valida token y redirige)
{
  path: 'colaborar/:token',
  canActivate: [adminGuard, invitacionGuard],
  loadComponent: () => import('./components/admin-procesos/admin-procesos').then(m => m.AdminProcesosComponent)
},

      // RUTAS COMPARTIDAS (cualquier rol logueado)
      { path: 'nuevo-tramite', component: NuevoTramiteComponent },
      // CU17: ruta con procesoId preseleccionado por el asistente de voz
      { path: 'nuevo-tramite/:procesoId', component: NuevoTramiteComponent },
      { path: 'bandeja', component: BandejaEntradaComponent },
      { path: 'tramite/:id', component: ProcesarTramiteComponent },
      { path: 'rastrear', component: RastrearTramiteComponent },

      { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
    ]
  },

  // --- REDIRECCIÓN GLOBAL ---
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' } // Captura cualquier ruta inexistente
];