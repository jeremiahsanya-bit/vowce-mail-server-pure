import 'dart:convert';
import 'dart:io'; // ✅ Added for Platform.environment
import 'package:shelf/shelf.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:shelf/shelf_io.dart' as io;
import 'package:shelf_cors_headers/shelf_cors_headers.dart';
import 'package:http/http.dart' as http;

Future<void> main() async {
  final router = Router();

  // Endpoint: POST /send-magic-link
  router.post('/send-magic-link', sendMagicLinkHandler);

  // Enable CORS so your mobile app can call this from a different port/device
  final handler = const Pipeline()
      .addMiddleware(corsHeaders())
      .addHandler(router);

  final server = await io.serve(handler, '0.0.0.0', 8080);
  print('✅ Admin server running at http://${server.address.host}:${server.port}');
}

Future<Response> sendMagicLinkHandler(Request request) async {
  try {
    // Parse the JSON body
    final body = await request.readAsString();
    final data = jsonDecode(body);
    final email = data['email'];

    if (email == null || email.isEmpty) {
      return Response.badRequest(body: 'Email is required');
    }

    // ✅ Retrieve Resend API key from Environment Variables (secure & pure Dart)
    final apiKey = Platform.environment['RESEND_API_KEY'];

    if (apiKey == null || apiKey.isEmpty) {
      return Response.internalServerError(body: 'Resend API key not configured in environment');
    }

    // Call Resend API
    final resendUrl = Uri.parse('https://api.resend.com/emails');
    final response = await http.post(
      resendUrl,
      headers: {
        'Authorization': 'Bearer $apiKey',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'from': 'Vowce <onboarding@resend.dev>', // Change later to your verified domain
        'to': [email],
        'subject': 'Your magic link to log in to Vowce',
        'html': '''
          <p>Click the link below to log in to Vowce:</p>
          <p><a href="https://your-app.com/magic-login?email=$email">Log in to Vowce</a></p>
          <p>If you didn't request this, ignore this email.</p>
        ''',
      }),
    );

    if (response.statusCode == 200) {
      return Response.ok('Magic link sent successfully');
    } else {
      return Response.internalServerError(body: 'Resend API error: ${response.body}');
    }
  } catch (e) {
    return Response.internalServerError(body: 'Error: $e');
  }
}
