FROM node:lts-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
ENV PORT=80

COPY package.json ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build

EXPOSE 80

CMD ["node", "dist/server/index.js"]
