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
		log.Printf("[Handler] 收到无效消息事件（消息体或消息ID为空），跳过")
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

	log.Printf("[Handler] 收到消息 messageId=%s chatId=%s type=%s", messageId, chatId, msgType)

	switch msgType {
	case "text":
		return h.handleText(ctx, chatId, messageId, content)
	case "image":
		return h.handleImage(ctx, chatId, messageId, content)
	default:
		log.Printf("[Handler] 不支持的消息类型: %s, messageId=%s", msgType, messageId)
		return nil
	}
}

// handleText 处理文本消息
func (h *MessageHandler) handleText(ctx context.Context, chatId, messageId, rawContent string) error {
	var tc textContent
	if err := json.Unmarshal([]byte(rawContent), &tc); err != nil {
		log.Printf("[Handler] 解析文本消息JSON失败: messageId=%s err=%v", messageId, err)
		return nil
	}

	text := strings.TrimSpace(tc.Text)
	if text == "" {
		log.Printf("[Handler] 文本内容为空，跳过 messageId=%s", messageId)
		return nil
	}

	log.Printf("[Handler] 处理文本消息 messageId=%s text=%q", messageId, text)

	// 通过 AI 自动分类并处理
	return h.session.HandleAutoClassify(ctx, chatId, messageId, text, "")
}

// handleImage 处理图片消息
func (h *MessageHandler) handleImage(ctx context.Context, chatId, messageId, rawContent string) error {
	var ic imageContent
	if err := json.Unmarshal([]byte(rawContent), &ic); err != nil {
		log.Printf("[Handler] 解析图片消息JSON失败: messageId=%s err=%v", messageId, err)
		return nil
	}

	if ic.ImageKey == "" {
		log.Printf("[Handler] 图片消息缺少 image_key，跳过 messageId=%s", messageId)
		return nil
	}

	log.Printf("[Handler] 处理图片消息 messageId=%s imageKey=%s", messageId, ic.ImageKey)

	// 下载图片
	imageBase64, err := h.downloadImage(ctx, messageId, ic.ImageKey)
	if err != nil {
		log.Printf("[Handler] 下载图片失败: messageId=%s imageKey=%s err=%v", messageId, ic.ImageKey, err)
		h.session.ReplyText(ctx, messageId, "图片下载失败，请重试")
		return nil
	}

	log.Printf("[Handler] 图片下载成功 messageId=%s imageKey=%s dataLen=%d", messageId, ic.ImageKey, len(imageBase64))

	// 图片消息无法确定类型，提示用户
	h.session.ReplyText(ctx, messageId, "收到图片，请同时发送文本指定类型，格式：\n- 泵:（图片描述）\n- 搅:（图片描述）\n\n或直接回复此消息并附上类型前缀")
	_ = imageBase64 // TODO: 后续可结合文本+图片一起处理
	return nil
}

// downloadImage 下载飞书消息中的图片并转为 base64
func (h *MessageHandler) downloadImage(ctx context.Context, messageId, imageKey string) (string, error) {
	log.Printf("[Handler] 开始下载图片 messageId=%s imageKey=%s", messageId, imageKey)
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
