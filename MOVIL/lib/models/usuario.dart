class Usuario {
  final String username;
  final String rol;
  final String token;

  Usuario({
    required this.username,
    required this.rol,
    required this.token,
  });

  factory Usuario.fromJson(Map<String, dynamic> json) {
    return Usuario(
      username: json['username'] ?? '',
      rol: json['rol'] ?? '',
      token: json['token'] ?? '',
    );
  }
}