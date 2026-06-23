FROM dart:stable

WORKDIR /app

COPY pubspec.yaml pubspec.yaml
RUN dart pub get

COPY . .

CMD ["dart", "run", "bin/admin_server.dart"]
