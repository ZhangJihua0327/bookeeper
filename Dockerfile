FROM node:lts-alpine

WORKDIR /app

ENV NODE_ENV=production \
    TZ=Asia/Shanghai

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 照片归档目录：命名卷首次挂载时会继承这里的属主，保证 node 用户可写
RUN mkdir -p /data/photos && chown -R node:node /data/photos

COPY --chown=node:node src ./src
COPY --chown=node:node db ./db
COPY --chown=node:node scripts ./scripts

EXPOSE 3000

USER node

CMD ["node", "src/server/index.js"]
