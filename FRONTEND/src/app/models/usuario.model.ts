export interface AuthResponse {
    token: string;
    username: string;
    rol: string;
    departamentoId?: string;
}

export interface Usuario {
    id?: string;
    username: string;
    password?: string;
    nombreCompleto?: string;
    email?: string;
    rol: 'ADMIN' | 'FUNCIONARIO' | 'CLIENTE';
    departamentoId?: string;
    estadoDisponibilidad?: 'DISPONIBLE' | 'AUSENTE' | 'VACACIONES';
    ultimaConexion?: string;
    fechaCreacion?: string;
}