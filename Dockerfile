# syntax=docker/dockerfile:1
FROM node:20-alpine

# Install system dependencies for native modules and curl
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    apk add --no-cache curl

WORKDIR /app

# Copy dependency metadata first
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Clean up build dependencies
RUN apk del .build-deps

# Set the default port
ENV PORT=80
EXPOSE 80

# Start the app
CMD ["npm", "start"]
