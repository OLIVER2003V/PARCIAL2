import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'screens/login_screen.dart';
import 'services/notificacion_store.dart';

Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  await NotificacionStore.agregar(AppNotificacion(
    id:     message.messageId ?? DateTime.now().toString(),
    titulo: message.notification?.title ?? 'Notificación',
    cuerpo: message.notification?.body  ?? '',
    fecha:  DateTime.now(),
  ));
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
  runApp(const BpmsApp());
}

class BpmsApp extends StatefulWidget {
  const BpmsApp({super.key});

  @override
  State<BpmsApp> createState() => _BpmsAppState();
}

class _BpmsAppState extends State<BpmsApp> {
  @override
  void initState() {
    super.initState();
    _configurarPush();
  }

  void _configurarPush() async {
    final messaging = FirebaseMessaging.instance;
    final settings  = await messaging.requestPermission(
      alert: true, badge: true, sound: true,
    );
    if (settings.authorizationStatus != AuthorizationStatus.authorized) return;

    // Primer plano: guardar en store + mostrar snackbar
    FirebaseMessaging.onMessage.listen((RemoteMessage msg) async {
      await NotificacionStore.agregar(AppNotificacion(
        id:     msg.messageId ?? DateTime.now().toString(),
        titulo: msg.notification?.title ?? 'Notificación',
        cuerpo: msg.notification?.body  ?? '',
        fecha:  DateTime.now(),
      ));

      if (msg.notification != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(children: [
              const Icon(Icons.notifications_active, color: Colors.white),
              const SizedBox(width: 12),
              Expanded(child: Text(
                '${msg.notification!.title}\n${msg.notification!.body}',
              )),
            ]),
            backgroundColor: const Color(0xFF9333EA),
            behavior: SnackBarBehavior.floating,
            duration: const Duration(seconds: 5),
          ),
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BPMS Core',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF9333EA)),
        useMaterial3: true,
      ),
      home: const LoginScreen(),
    );
  }
}
