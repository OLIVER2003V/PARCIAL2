# ── Etapa 1: Compilar el JAR con Maven ──────────────────────────────────────
# "AS build" nombra esta etapa para referenciarla luego
FROM maven:3.9-eclipse-temurin-17 AS build

WORKDIR /app

# Copiar pom.xml primero y descargar dependencias (se cachea si pom.xml no cambia)
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copiar el código fuente y compilar (sin ejecutar tests)
COPY src ./src
RUN mvn clean package -DskipTests

# ── Etapa 2: Imagen final solo con el JRE (más liviana) ─────────────────────
FROM eclipse-temurin:17-jre-alpine

WORKDIR /app

# Traer solo el JAR generado en la etapa anterior
COPY --from=build /app/target/*.jar app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
