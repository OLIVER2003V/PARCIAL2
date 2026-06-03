export interface Departamento {
  id?: string;
  nombre: string;
  descripcion: string;
  activo?: boolean;
  fechaCreacion?: string;
}

export interface DepartamentoStats {
  funcionarios: number;
  tramitesActivos: number;
}