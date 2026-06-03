package com.bpms.core.repositories;

import com.bpms.core.models.AuditLog;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface AuditLogRepository extends MongoRepository<AuditLog, String> {

    // Histórico de un trámite específico (lo usa FlujoService para hoja de ruta)
    List<AuditLog> findByTramiteIdOrderByFechaTimestampAsc(String tramiteId);

    // CU20: todos los eventos vinculados a una entidad (proceso, trámite, usuario…)
    List<AuditLog> findByEntidadIdOrderByFechaTimestampDesc(String entidadId);
}