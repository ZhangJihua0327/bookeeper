FROM node:lts-alpine

WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Shanghai

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --chown=node:node src ./src
COPY --chown=node:node db ./db
COPY --chown=node:node scripts ./scripts

EXPOSE 3000

USER node

CMD ["node", "src/server/index.js"]
