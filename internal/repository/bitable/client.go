package bitable

import (
	lark "github.com/larksuite/oapi-sdk-go/v3"
	"github.com/zhangjihua0327/bookeeper/config"
)

// NewLarkClient 创建飞书 API 客户端
// SDK 自动管理 Tenant Access Token 的获取和刷新
func NewLarkClient(cfg *config.Config) *lark.Client {
	return lark.NewClient(cfg.Feishu.AppID, cfg.Feishu.AppSecret)
}
