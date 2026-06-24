import 'dart:convert';
import 'dart:io';
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

    // Retrieve Resend API key from Environment Variables
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
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <div style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); overflow: hidden;">
    
    <!-- Edge-to-edge Black Banner with White Scattered Logos (CSS pattern) -->
    <div style="width: 100%; height: 120px; background-color: #000000; background-image: url('https://raw.githubusercontent.com/jeremiahsanya-bit/vowce-mail-server-pure/main/vowce_icon.svg'); background-size: 60px 60px; background-repeat: repeat; background-position: 10px 10px; opacity: 0.6;">
    </div>
    
    <div style="padding: 40px;">
      <!-- Main Heading -->
      <h2 style="color: #222222; font-size: 22px; margin-bottom: 16px; text-align: center;">Welcome back to Vowce! 👋</h2>
      
      <!-- Body Text -->
      <p style="color: #555555; font-size: 16px; line-height: 1.6; margin-bottom: 24px; text-align: center;">
        You're one click away from accessing your account. Click the button below to log in securely:
      </p>
      
      <!-- Magic Button -->
      <div style="text-align: center; margin: 30px 0;">
        <a href="https://your-app.com/magic-login?email=$email" 
           style="background-color: #7B61FF; color: #ffffff; padding: 14px 36px; 
                  border-radius: 8px; text-decoration: none; font-weight: 600; 
                  font-size: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(123, 97, 255, 0.3);">
          🔐 Log in to Vowce
        </a>
      </div>
      
      <!-- Footer / Info -->
      <p style="color: #888888; font-size: 13px; line-height: 1.5; margin-top: 20px; text-align: center;">
        This link is secure and will expire after one use.<br>
        If you didn’t request this email, you can safely ignore it.
      </p>
      
      <!-- Footer Line -->
      <div style="border-top: 1px solid #eeeeee; margin-top: 30px; padding-top: 20px; text-align: center; color: #aaaaaa; font-size: 12px;">
        &copy; 2026 Vowce Network &bull; Built with ❤️
      </div>
    </div>
  </div>
</body>
</html>
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
