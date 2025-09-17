# syntax=docker/dockerfile:1
FROM node:20-alpine
WORKDIR /app

# Install deps using lockfile if present
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY . .

# App must listen on port 80 for ECS and return 200 on /health
ENV PORT=80
EXPOSE 80
CMD ["npm","start"]
