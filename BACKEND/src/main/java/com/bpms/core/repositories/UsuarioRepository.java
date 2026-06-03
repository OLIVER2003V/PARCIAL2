package com.bpms.core.repositories;

import com.bpms.core.models.Usuario;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface UsuarioRepository extends MongoRepository<Usuario, String> {
    // Spring Boot es tan inteligente que solo con nombrar este método,
    // él ya sabe cómo buscar un usuario por su username en Mongo.
    Optional<Usuario> findByUsername(String username);
    
}