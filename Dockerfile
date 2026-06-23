FROM dart:stable

WORKDIR /app

COPY pubspec.yaml pubspec.yaml
RUN dart pub get

COPY . .

EXPOSE 8080

CMD ["dart", "run", "bin/admin_server.dart"]
