# ── Etapa 1: Compilar Angular ────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

# Copiar package.json primero para cachear la instalación de dependencias
COPY package*.json ./
RUN npm ci

# Copiar el resto del código y construir en modo producción
COPY . .
RUN npm run build

# ── Etapa 2: Servir con Nginx (imagen muy liviana ~25MB) ─────────────────────
FROM nginx:alpine

# Copiar los archivos compilados de Angular al directorio de Nginx
COPY --from=build /app/dist/FRONTEND/browser /usr/share/nginx/html

# Nginx como reverse proxy: sirve Angular y redirige /api/ y /ws-colaboracion al backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
