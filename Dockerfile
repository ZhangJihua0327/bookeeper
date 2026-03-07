# ---- 构建阶段 ----
FROM golang:1.24.13-alpine3.22 AS builder

RUN apk add --no-cache git ca-certificates tzdata

ENV GOPROXY=https://mirrors.aliyun.com/goproxy/,direct

WORKDIR /src

# 先复制依赖文件，利用 Docker 缓存
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/bookeeper ./cmd/bookeeper/

# ---- 运行阶段 ----
FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata

# 设置时区为上海
ENV TZ=Asia/Shanghai

WORKDIR /app

COPY --from=builder /app/bookeeper .

EXPOSE 9999

ENTRYPOINT ["./bookeeper"]
