package bot

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// recordType 记录类型
type recordType string

const (
	recordTypePumpTruck  recordType = "pump_truck"
	recordTypeMixerTruck recordType = "mixer_truck"
)

// 前缀匹配规则
var prefixRules = []struct {
	prefix string
	typ    recordType
}{
	{"泵车:", recordTypePumpTruck},
	{"泵:", recordTypePumpTruck},
	{"搅拌车:", recordTypeMixerTruck},
	{"搅拌:", recordTypeMixerTruck},
	{"搅:", recordTypeMixerTruck},
}

// textContent 文本消息的 JSON 结构
type textContent struct {
	Text string `json:"text"`
}

// imageContent 图片消息的 JSON 结构
type imageContent struct {
	ImageKey string `json:"image_key"`
}

// MessageHandler 消息事件处理器
type MessageHandler struct {
	larkClient *lark.Client
	session    *SessionManager
}

// NewMessageHandler 创建消息处理器
func NewMessageHandler(larkClient *lark.Client, session *SessionManager) *MessageHandler {
	return &MessageHandler{
		larkClient: larkClient,
		session:    session,
	}
}

// Handle 处理消息接收事件
func (h *MessageHandler) Handle(ctx context.Context, event *larkim.P2MessageReceiveV1) error {
	msg := event.Event.Message
	if msg == nil || msg.MessageId == nil {
		return nil
	}

	messageId := *msg.MessageId
	chatId := ""
	if msg.ChatId != nil {
		chatId = *msg.ChatId
	}

	msgType := ""
	if msg.MessageType != nil {
		msgType = *msg.MessageType
	}

	content := ""
	if msg.Content != nil {
		content = *msg.Content
	}

	switch msgType {
	case "text":
		return h.handleText(ctx, chatId, messageId, content)
	case "image":
		return h.handleImage(ctx, chatId, messageId, content)
	default:
		log.Printf("不支持的消息类型: %s", msgType)
		return nil
	}
}

// handleText 处理文本消息
func (h *MessageHandler) handleText(ctx context.Context, chatId, messageId, rawContent string) error {
	var tc textContent
	if err := json.Unmarshal([]byte(rawContent), &tc); err != nil {
		log.Printf("解析文本消息失败: %v", err)
		return nil
	}

	text := strings.TrimSpace(tc.Text)
	if text == "" {
		return nil
	}

	// 前缀匹配
	for _, rule := range prefixRules {
		if strings.HasPrefix(text, rule.prefix) {
			body := strings.TrimSpace(text[len(rule.prefix):])
			if body == "" {
				h.session.ReplyText(ctx, messageId, "请在前缀后输入记录内容")
				return nil
			}
			switch rule.typ {
			case recordTypePumpTruck:
				return h.session.HandlePumpTruck(ctx, chatId, messageId, body, "")
			case recordTypeMixerTruck:
				return h.session.HandleMixerTruck(ctx, chatId, messageId, body, "")
			}
		}
	}

	// 无匹配前缀，提示用户
	h.session.ReplyText(ctx, messageId, "请使用以下前缀发送记录：\n- 泵: 或 泵车: — 泵车记录\n- 搅: 或 搅拌: 或 搅拌车: — 搅拌车记录\n\n示例：泵:今天33米去XX工地，客户恒大，15方，李师傅")
	return nil
}

// handleImage 处理图片消息
func (h *MessageHandler) handleImage(ctx context.Context, chatId, messageId, rawContent string) error {
	var ic imageContent
	if err := json.Unmarshal([]byte(rawContent), &ic); err != nil {
		log.Printf("解析图片消息失败: %v", err)
		return nil
	}

	if ic.ImageKey == "" {
		return nil
	}

	// 下载图片
	imageBase64, err := h.downloadImage(ctx, messageId, ic.ImageKey)
	if err != nil {
		log.Printf("下载图片失败: %v", err)
		h.session.ReplyText(ctx, messageId, "图片下载失败，请重试")
		return nil
	}

	// 图片消息无法确定类型，提示用户
	h.session.ReplyText(ctx, messageId, "收到图片，请同时发送文本指定类型，格式：\n- 泵:（图片描述）\n- 搅:（图片描述）\n\n或直接回复此消息并附上类型前缀")
	_ = imageBase64 // TODO: 后续可结合文本+图片一起处理
	return nil
}

// downloadImage 下载飞书消息中的图片并转为 base64
func (h *MessageHandler) downloadImage(ctx context.Context, messageId, imageKey string) (string, error) {
	req := larkim.NewGetMessageResourceReqBuilder().
		MessageId(messageId).
		FileKey(imageKey).
		Type("image").
		Build()

	resp, err := h.larkClient.Im.MessageResource.Get(ctx, req)
	if err != nil {
		return "", fmt.Errorf("请求图片资源失败: %w", err)
	}
	if !resp.Success() {
		return "", fmt.Errorf("获取图片失败: code=%d, msg=%s", resp.Code, resp.Msg)
	}

	data, err := io.ReadAll(resp.File)
	if err != nil {
		return "", fmt.Errorf("读取图片数据失败: %w", err)
	}

	base64Str := "data:image/png;base64," + base64.StdEncoding.EncodeToString(data)
	return base64Str, nil
}

// matchPrefix 检查文本是否匹配前缀，返回记录类型和去除前缀后的文本
func matchPrefix(text string) (recordType, string, bool) {
	for _, rule := range prefixRules {
		if strings.HasPrefix(text, rule.prefix) {
			body := strings.TrimSpace(text[len(rule.prefix):])
			return rule.typ, body, true
		}
	}
	return "", text, false
}
