FROM gcc:13-alpine
RUN addgroup -S runner && adduser -S -G runner runner
USER runner
WORKDIR /home/runner
