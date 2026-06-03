package com.bpms.core.repositories;

import com.bpms.core.models.RegistroArchivo;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface RegistroArchivoRepository extends MongoRepository<RegistroArchivo, String> {
    List<RegistroArchivo> findByTramiteId(String tramiteId);
    List<RegistroArchivo> findByProcesoId(String procesoId);
    Optional<RegistroArchivo> findByUrlActual(String urlActual);
    List<RegistroArchivo> findByVersionesUrl(String url);
}
