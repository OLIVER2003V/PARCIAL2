import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class VozReconocimientoService {
  private platformId = inject(PLATFORM_ID);
  private recognition: any;
  
  // Signals para el estado reactivo
  isListening = signal<boolean>(false);
  textoReconocido = signal<string>('');
  
  private textoPrevio = ''; // Guarda lo que ya estaba escrito antes de dictar

  constructor() {
    this.inicializar();
  }

  private inicializar(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Soporte para navegadores basados en WebKit (Chrome/Edge) y estándar
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true; // Sigue escuchando hasta que lo pares
      this.recognition.interimResults = true; // Muestra resultados parciales mientras hablas
      this.recognition.lang = 'es-BO'; // Español de Bolivia (puedes usar 'es-ES' si prefieres)

      this.recognition.onstart = () => {
        this.isListening.set(true);
      };

      this.recognition.onresult = (event: any) => {
        let transcriptActual = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcriptActual += event.results[i][0].transcript;
        }
        // Combinamos el texto que ya existía con lo que estamos dictando
        this.textoReconocido.set(this.textoPrevio + (this.textoPrevio ? ' ' : '') + transcriptActual);
      };

      this.recognition.onerror = (event: any) => {
        console.error('Error en reconocimiento de voz:', event.error);
        this.stop();
      };

      this.recognition.onend = () => {
        this.isListening.set(false);
      };
    } else {
      console.warn('La Web Speech API no está soportada en este navegador.');
    }
  }

  /**
   * Inicia la escucha. 
   * @param textoActual Recibe el texto que ya está en el textarea para no borrarlo.
   */
  start(textoActual: string = ''): void {
    if (!this.recognition) return;
    
    this.textoPrevio = textoActual.trim();
    this.textoReconocido.set(this.textoPrevio);
    
    if (!this.isListening()) {
      try {
        this.recognition.start();
      } catch (e) {
        console.error('El reconocimiento ya estaba iniciado', e);
      }
    }
  }

  stop(): void {
    if (this.recognition && this.isListening()) {
      this.recognition.stop();
    }
  }

  toggle(textoActual: string = ''): void {
    if (this.isListening()) {
      this.stop();
    } else {
      this.start(textoActual);
    }
  }
  
  estaSoportado(): boolean {
    return !!this.recognition;
  }
}