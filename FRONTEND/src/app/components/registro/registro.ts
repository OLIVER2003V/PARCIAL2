import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './registro.html'
})
export class RegistroComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);

  // Signals para estado reactivo
  isLoading = signal(false);
  mensajeExito = signal(false);

  // Formulario ampliado para requerimientos de BPMS
  registroForm = this.fb.group({
    nombreCompleto: ['', [Validators.required, Validators.minLength(3)]],
    email: ['', [Validators.required, Validators.email]],
    username: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(6)]]
  });

  isInvalid(controlName: string): boolean {
    const control = this.registroForm.get(controlName);
    return !!(control && control.invalid && (control.dirty || control.touched));
  }

  private markAllAsTouched(): void {
    Object.values(this.registroForm.controls).forEach(control => {
      control.markAsTouched();
    });
  }

  registrar() {
    if (this.registroForm.invalid) {
      this.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    
    this.authService.registro(this.registroForm.value).subscribe({
      next: () => {
        this.mensajeExito.set(true);
        this.isLoading.set(false);
        // Redirección tras 2 segundos para mostrar el feedback
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        this.isLoading.set(false);
        console.error('Error al registrar', err);
        // Aquí podrías manejar un signal de errorMessage si lo deseas
      }
    });
  }
}