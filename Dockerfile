# syntax=docker/dockerfile:1
FROM node:20-alpine

# Install system dependencies needed for native modules and curl
RUN apk update && \
    apk add --no-cache python3 make g++ curl

WORKDIR /app

# Copy dependency metadata first
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

# Set the default port and expose it
ENV PORT=80
EXPOSE 80

# Start the app
CMD ["npm", "start"]
