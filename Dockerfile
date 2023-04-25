# Build stage: compile Typescript to Javascript
FROM --platform=linux/x86_64 node:18.16-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

# Final stage: copy compiled Javascript from previous stage and install production dependencies
FROM --platform=linux/x86_64 node:18.16-alpine
ENV NODE_ENV=production
ENV TARGET_MODE=0
# Uncomment the following line to enable agent logging
LABEL "network.forta.settings.agent-logs.enable"="true"
WORKDIR /app
COPY --from=builder /app/dist ./src
COPY bot-config.json ./
COPY package*.json ./
RUN npm ci --production
CMD [ "npm", "run", "start:prod" ]
