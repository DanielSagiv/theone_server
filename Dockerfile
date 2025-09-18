# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

# Copy only package metadata first
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --omit=dev || npm install --omit=dev

# Now copy the rest of the app
COPY . .

# Set port (required by ECS)
ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
