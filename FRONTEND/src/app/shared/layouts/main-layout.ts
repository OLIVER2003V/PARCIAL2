import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../../components/sidebar/sidebar';
import { ChatbotClienteComponent } from '../../components/chatbot-cliente/chatbot-cliente';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarComponent, ChatbotClienteComponent],
  template: `
    <div class="flex min-h-screen bg-brand-bg font-sans">
      <app-sidebar></app-sidebar>

      <main class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div class="flex-1 overflow-y-auto p-6 lg:p-10">
          <router-outlet></router-outlet>
        </div>
      </main>

      <!-- Chatbot IA con voz integrada (visible solo para CLIENTE) -->
      <app-chatbot-cliente></app-chatbot-cliente>
    </div>
  `
})
export class MainLayoutComponent {}
