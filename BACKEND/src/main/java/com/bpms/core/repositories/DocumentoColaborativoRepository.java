package com.bpms.core.repositories;

import com.bpms.core.models.DocumentoColaborativo;
import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.Optional;

public interface DocumentoColaborativoRepository extends MongoRepository<DocumentoColaborativo, String> {
    List<DocumentoColaborativo> findByTramiteId(String tramiteId);
    List<DocumentoColaborativo> findByProcesoId(String procesoId);
    Optional<DocumentoColaborativo> findByClaveCampo(String claveCampo);
}
