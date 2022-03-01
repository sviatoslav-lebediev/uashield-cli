FROM node:16.9.1-slim AS builder

WORKDIR /app

COPY package*.json yarn.lock tsconfig*.json ./
RUN npm install

COPY src-worker ./src-worker
RUN npm run build:cli


FROM node:16-alpine

WORKDIR /app

COPY package*.json yarn.lock ./
COPY --from=builder /app/dist-cli/ .

CMD [ "node", "--enable-source-maps", "index.js" ]
