# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Business Process Management System (BPMS)** — a monorepo with three independent applications:

- **BACKEND** — Spring Boot 4.0.5 REST API + WebSocket server (Java 17, Maven)
- **FRONTEND** — Angular 21 web app for admins and operators (TypeScript 5.9, Tailwind CSS 4.x)
- **MOVIL** — Flutter mobile app for citizens/clients (Dart 3.9)

## Commands

### Backend (Spring Boot / Maven)
```bash
cd BACKEND
./mvnw spring-boot:run                        # Start dev server on port 8080
./mvnw clean package                          # Build fat JAR
./mvnw test                                   # Run all tests
./mvnw test -Dtest=AuthServiceTest            # Run a single test class
./mvnw spring-boot:build-image               # Build Docker image
```

### Frontend (Angular)
```bash
cd FRONTEND
npm install
npm start                                     # ng serve — dev server on port 4200
npm run build                                 # Production build to dist/
npm test                                      # Vitest unit tests (jsdom)
npx vitest run src/app/components/login       # Run a single component's tests
npm run watch                                 # Incremental dev build
```

### Mobile (Flutter)
```bash
cd MOVIL
flutter pub get      # Install dependencies
flutter run          # Run on connected device/emulator
flutter build apk    # Build Android APK
flutter build ios    # Build iOS
flutter test         # Run widget/unit tests
```

## Architecture

### Backend Layer

**Entry point:** `BACKEND/src/main/java/com/bpms/core/CoreApplication.java`

The backend is organized into standard Spring Boot layers: `controllers/` → `services/` → `models/` (MongoDB documents). Key subsystems:

- **Auth:** `AuthController` + `AuthService` issue JWT tokens (HS256). `JwtChannelInterceptor` authenticates WebSocket connections.
- **Process definitions:** `ProcesoController` / `ProcesoService` manage BPMN process templates stored as XML in MongoDB. `BpmnParserService` extracts steps, transitions, and fields from BPMN XML using Camunda's model library.
- **Trámite execution:** `TramiteController` / `TramiteService` handle individual workflow instances that follow a `ProcesoDefinicion` template. State machine: `CREADO → EN_PROCESO → COMPLETADO → ARCHIVADO`. `FlujoService` contains the state transition logic.
- **Drafts:** `BorradorService` persists unsaved BPMN editor state before the user publishes a process definition.
- **Real-time collaboration:** `SesionColaborativaService` brokers WebSocket (STOMP) co-editing sessions for the BPMN designer, tracking cursor positions and XML diffs. `InvitacionService` manages collaboration invitations.
- **AI generation:** `GeminiAiService` calls the Google Gemini API to produce BPMN XML from natural language via `AiController.generarFlujo()`.
- **Reporting:** `ReporteGerencialService`, `ExcelReporteService`, `PdfReporteService` generate dashboards and downloadable reports using Apache POI and OpenPDF. `MineriaProcesosService` provides process mining analytics.
- **Audit:** `AuditService` logs every create/update/delete action to the `audit_logs` MongoDB collection.
- **Files:** `ArchivoService` uploads/retrieves documents via AWS S3.
- **Notifications:** Firebase Admin SDK pushes real-time notifications using FCM tokens stored on `Usuario` documents.

**Database:** MongoDB Atlas (`bpms_db`). Main collections: `usuarios`, `procesos_definicion`, `tramites`, `departamentos`, `audit_logs`, `sesiones_colaborativas`.

**Configuration:** Secrets (Mongo URI, JWT secret, AWS keys, Gemini key) are loaded from `BACKEND/.env`. Firebase credentials are in `BACKEND/src/main/resources/firebase-service-account.json`. App properties live in `src/main/resources/application.properties`.

### Frontend Layer

**Single source of truth for endpoints:** `FRONTEND/src/app/core/api-config.service.ts` — all 50+ REST routes are defined here. Always add new endpoints here rather than inline in services.

**Routing & guards:** `FRONTEND/src/app/app.routes.ts` — routes are guarded by `authGuard` (login check) and `adminGuard` (role check). Three roles: `ADMIN`, `FUNCIONARIO`, `CLIENTE`.

**Key feature areas:**

| Route | Roles | Purpose |
|---|---|---|
| `diagramador-bpmn` | ADMIN | Interactive BPMN editor powered by bpmn-js + JSPlumb |
| `admin-procesos` | ADMIN | Process template CRUD |
| `bandeja-entrada` | FUNCIONARIO | Assigned task queue |
| `procesar-tramite` | FUNCIONARIO | Review and advance workflow step |
| `nuevo-tramite` | ALL | Submit a new form/request |
| `rastrear-tramite` | CLIENTE | Track submitted request status |
| `reportes-gerenciales` | ADMIN | Excel/PDF dashboards + Chart.js analytics |
| `auditoria` | ADMIN | Audit log viewer |

**Notable services:** `colaboracion.ts` manages STOMP/WebSocket sessions; `voz-reconocimiento.service.ts` wraps the Web Speech API for voice input in forms; `ia.service.ts` calls the AI BPMN generation endpoint.

**Styling:** Tailwind CSS 4.x utility classes. Do not add custom CSS when a Tailwind utility exists.

**Environment config:** `FRONTEND/src/environments/environment.ts` sets `apiUrl` (HTTP) and `wsUrl` (WebSocket) — change these when switching between local and production.

**Component style:** Angular 21 standalone components with signals. All new components should follow this pattern.

### Mobile Layer

**Environment switch:** `MOVIL/lib/core/api_config.dart` contains a `kUsarProduccion` boolean that toggles between the local dev IP (`192.168.100.148:8080`) and the production AWS EC2 host (`13.59.124.116:8080`). Set this before building for a target environment.

**Screen → service mapping** follows the same domain split as the backend: `catalogo_screen` lists published processes, `formulario_tramite_screen` submits forms, `mis_tramites_screen` / `rastreo_screen` track state, `chatbot_screen` wraps the AI endpoint.

Firebase Messaging token is captured at login and sent to `AuthController.guardarTokenPush()` so the backend can send targeted push notifications.

## Cross-Cutting Concerns

- **Roles** are enforced at both the Spring Security layer (`@PreAuthorize`) and on the frontend via route guards. When adding a new feature, apply access control in both places.
- **Audit logging** should be added to any new service that mutates data, following the pattern in existing services (`auditService.registrar(...)`).
- **WebSocket collaboration** uses STOMP over `/ws-colaboracion`. New real-time features should route through the existing `SesionColaborativaService` rather than opening separate connections.
- **No CI/CD pipelines** are configured. Builds and deployments are manual.
