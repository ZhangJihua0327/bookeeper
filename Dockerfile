FROM node:lts-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig*.json ./
COPY src ./src
COPY db ./db
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:lts-alpine

WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Shanghai

COPY package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

EXPOSE 3000

USER node

CMD ["node", "dist/src/server/index.js"]
