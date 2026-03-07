package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcard "github.com/larksuite/oapi-sdk-go/v3/card"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	"github.com/larksuite/oapi-sdk-go/v3/core/httpserverext"
	"github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"

	"github.com/zhangjihua0327/bookeeper/config"
	"github.com/zhangjihua0327/bookeeper/internal/ai"
	"github.com/zhangjihua0327/bookeeper/internal/bot"
	"github.com/zhangjihua0327/bookeeper/internal/repository/bitable"
	"github.com/zhangjihua0327/bookeeper/internal/service"
)

func main() {
	// 1. 加载配置
	cfg, err := config.Load("config.yaml")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	// 2. 初始化飞书 API 客户端
	larkClient := lark.NewClient(cfg.Feishu.AppID, cfg.Feishu.AppSecret,
		lark.WithLogLevel(larkcore.LogLevelInfo),
	)

	// 3. 初始化各层依赖
	fieldOptionMgr := bitable.NewFieldOptionManager(larkClient, cfg.Bitable.AppToken)
	pumpTruckRepo := bitable.NewPumpTruckRepository(larkClient, cfg.Bitable.AppToken, cfg.Bitable.PumpTruckTableID)
	mixerTruckRepo := bitable.NewMixerTruckRepository(larkClient, cfg.Bitable.AppToken, cfg.Bitable.MixerTruckTableID)
	aiClient := ai.NewDashScopeClient(cfg.Aliyun.APIKey)
	parsingSvc := service.NewParsingService(aiClient, fieldOptionMgr, cfg.Bitable, cfg.Aliyun.Model)

	// 4. 创建会话管理器
	sessionMgr := bot.NewSessionManager(
		parsingSvc,
		pumpTruckRepo,
		mixerTruckRepo,
		fieldOptionMgr,
		larkClient,
		cfg.Bitable,
	)

	// 5. 创建消息处理器
	msgHandler := bot.NewMessageHandler(larkClient, sessionMgr)

	// 6. 创建事件分发器（WebSocket 模式参数为空字符串）
	eventHandler := dispatcher.NewEventDispatcher("", "").
		OnP2MessageReceiveV1(func(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
			return msgHandler.Handle(ctx, event)
		})

	// 7. 创建卡片回调处理器
	cardCallbackHandler := bot.NewCardCallbackHandler(sessionMgr)
	cardHandler := larkcard.NewCardActionHandler("", "", cardCallbackHandler.Handle)

	// 8. 启动 HTTP 服务器（卡片回调端点）
	port := cfg.Bot.CardCallbackPort
	if port == 0 {
		port = 9999
	}
	http.HandleFunc("/webhook/card", httpserverext.NewCardActionHandlerFunc(cardHandler))
	go func() {
		addr := fmt.Sprintf(":%d", port)
		log.Printf("卡片回调 HTTP 服务器启动在 %s", addr)
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("HTTP 服务器启动失败: %v", err)
		}
	}()

	// 9. 启动 WebSocket 长连接（阻塞主线程）
	log.Println("正在启动 WebSocket 长连接...")
	wsClient := larkws.NewClient(cfg.Feishu.AppID, cfg.Feishu.AppSecret,
		larkws.WithEventHandler(eventHandler),
		larkws.WithLogLevel(larkcore.LogLevelInfo),
	)
	if err := wsClient.Start(context.Background()); err != nil {
		log.Fatalf("WebSocket 连接失败: %v", err)
	}
}
