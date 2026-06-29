# syntax=docker/dockerfile:1
FROM node:20-alpine

# Native modules, health checks, and headless Chromium for scrap-events / Tao import (puppeteer-core)
RUN apk update && \
    apk add --no-cache \
      python3 make g++ curl \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont

WORKDIR /app

# Copy dependency metadata first
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

# Set the default port and expose it
ENV PORT=80
# puppeteer-core has no bundled browser; Alpine chromium package (see venueScraperBrowser.js)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
EXPOSE 80

# Start the app
CMD ["npm", "start"]
