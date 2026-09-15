FROM node:20-alpine
RUN addgroup -S runner && adduser -S -G runner runner
USER runner
WORKDIR /home/runner
