package com.bpms.core.controllers;

import com.bpms.core.services.GeminiAiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.json.JsonParserFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/tramites")
@CrossOrigin(origins = "*") // Ajusta el CORS si tienes una configuración específica
public class VozController {

    @Autowired
    private GeminiAiService geminiAiService;

    @PostMapping("/voz")
    public ResponseEntity<Map<String, Object>> iniciarTramitePorVoz(
            @RequestParam("audio") MultipartFile archivoAudio,
            @RequestParam(value = "clienteId", defaultValue = "SISTEMA") String clienteId) {

        Map<String, Object> respuesta = geminiAiService.procesarComandoVoz(archivoAudio, clienteId);
        return ResponseEntity.ok(respuesta);
    }

    @PostMapping("/voz-texto")
    public ResponseEntity<Map<String, Object>> iniciarTramitePorTexto(
            @RequestParam("texto") String texto,
            @RequestParam(value = "clienteId", defaultValue = "SISTEMA") String clienteId,
            @RequestParam(value = "historial", defaultValue = "[]") String historialJson) {

        List<Map<String, String>> historial = parseHistorial(historialJson);
        Map<String, Object> respuesta = geminiAiService.procesarComandoVozTexto(texto, clienteId, historial);
        return ResponseEntity.ok(respuesta);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, String>> parseHistorial(String json) {
        try {
            List<?> raw = JsonParserFactory.getJsonParser().parseList(json);
            List<Map<String, String>> result = new ArrayList<>();
            for (Object item : raw) {
                if (item instanceof Map) {
                    Map<Object, Object> m = (Map<Object, Object>) item;
                    String rol      = String.valueOf(m.getOrDefault("rol", "user"));
                    String contenido = String.valueOf(m.getOrDefault("contenido", ""));
                    result.add(Map.of("rol", rol, "contenido", contenido));
                }
            }
            return result;
        } catch (Exception e) {
            return new ArrayList<>();
        }
    }
}