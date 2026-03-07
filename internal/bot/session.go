package bot

import (
	"context"
	"fmt"
	"log"
	"strings"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	"github.com/zhangjihua0327/bookeeper/config"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	"github.com/zhangjihua0327/bookeeper/internal/repository"
	"github.com/zhangjihua0327/bookeeper/internal/service"
)

// SessionManager 会话管理与流程编排
type SessionManager struct {
	parsingSvc     *service.ParsingService
	pumpTruckRepo  repository.PumpTruckRepository
	mixerTruckRepo repository.MixerTruckRepository
	fieldOptionMgr repository.FieldOptionManager
	larkClient     *lark.Client
	bitableCfg     config.BitableConfig
}

// NewSessionManager 创建会话管理器
func NewSessionManager(
	parsingSvc *service.ParsingService,
	pumpTruckRepo repository.PumpTruckRepository,
	mixerTruckRepo repository.MixerTruckRepository,
	fieldOptionMgr repository.FieldOptionManager,
	larkClient *lark.Client,
	bitableCfg config.BitableConfig,
) *SessionManager {
	return &SessionManager{
		parsingSvc:     parsingSvc,
		pumpTruckRepo:  pumpTruckRepo,
		mixerTruckRepo: mixerTruckRepo,
		fieldOptionMgr: fieldOptionMgr,
		larkClient:     larkClient,
		bitableCfg:     bitableCfg,
	}
}

// HandlePumpTruck 处理泵车记录：解析 → 构建确认卡片 → 回复
func (s *SessionManager) HandlePumpTruck(ctx context.Context, chatId, messageId, text, imageURL string) error {
	result, err := s.parsingSvc.ParsePumpTruck(ctx, service.ParseInput{
		Text:     text,
		ImageURL: imageURL,
	})
	if err != nil {
		log.Printf("解析泵车记录失败: %v", err)
		s.ReplyText(ctx, messageId, fmt.Sprintf("解析失败: %v", err))
		return nil
	}

	// 有缺失必填字段 → 提示用户补充
	if result.HasMissingFields() {
		msg := fmt.Sprintf("以下必填字段缺失，请补充后重新发送：\n- %s", strings.Join(result.MissingFields, "\n- "))
		s.ReplyText(ctx, messageId, msg)
		return nil
	}

	// 构建确认卡片
	cardJSON, err := buildPumpTruckConfirmCard(result.Record, result.UnknownOptions)
	if err != nil {
		log.Printf("构建卡片失败: %v", err)
		s.ReplyText(ctx, messageId, "内部错误，请重试")
		return nil
	}

	s.ReplyCard(ctx, messageId, cardJSON)
	return nil
}

// HandleMixerTruck 处理搅拌车记录：解析 → 构建确认卡片 → 回复
func (s *SessionManager) HandleMixerTruck(ctx context.Context, chatId, messageId, text, imageURL string) error {
	result, err := s.parsingSvc.ParseMixerTruck(ctx, service.ParseInput{
		Text:     text,
		ImageURL: imageURL,
	})
	if err != nil {
		log.Printf("解析搅拌车记录失败: %v", err)
		s.ReplyText(ctx, messageId, fmt.Sprintf("解析失败: %v", err))
		return nil
	}

	if result.HasMissingFields() {
		msg := fmt.Sprintf("以下必填字段缺失，请补充后重新发送：\n- %s", strings.Join(result.MissingFields, "\n- "))
		s.ReplyText(ctx, messageId, msg)
		return nil
	}

	cardJSON, err := buildMixerTruckConfirmCard(result.Record, result.UnknownOptions)
	if err != nil {
		log.Printf("构建卡片失败: %v", err)
		s.ReplyText(ctx, messageId, "内部错误，请重试")
		return nil
	}

	s.ReplyCard(ctx, messageId, cardJSON)
	return nil
}

// ConfirmPumpTruck 确认提交泵车记录到多维表格
func (s *SessionManager) ConfirmPumpTruck(ctx context.Context, record *domain.PumpTruckRecord, unknownOpts []service.UnknownOption) (string, error) {
	// 先添加未知选项
	for _, opt := range unknownOpts {
		if err := s.fieldOptionMgr.AddFieldOption(ctx, s.bitableCfg.PumpTruckTableID, opt.FieldName, opt.Value); err != nil {
			return "", fmt.Errorf("添加选项 %s=%s 失败: %w", opt.FieldName, opt.Value, err)
		}
	}

	// 创建记录
	recordID, err := s.pumpTruckRepo.Create(ctx, record)
	if err != nil {
		return "", fmt.Errorf("创建泵车记录失败: %w", err)
	}

	return recordID, nil
}

// ConfirmMixerTruck 确认提交搅拌车记录到多维表格
func (s *SessionManager) ConfirmMixerTruck(ctx context.Context, record *domain.MixerTruckRecord, unknownOpts []service.UnknownOption) (string, error) {
	for _, opt := range unknownOpts {
		if err := s.fieldOptionMgr.AddFieldOption(ctx, s.bitableCfg.MixerTruckTableID, opt.FieldName, opt.Value); err != nil {
			return "", fmt.Errorf("添加选项 %s=%s 失败: %w", opt.FieldName, opt.Value, err)
		}
	}

	recordID, err := s.mixerTruckRepo.Create(ctx, record)
	if err != nil {
		return "", fmt.Errorf("创建搅拌车记录失败: %w", err)
	}

	return recordID, nil
}

// ReplyText 回复纯文本消息
func (s *SessionManager) ReplyText(ctx context.Context, messageId, text string) {
	content := larkim.NewTextMsgBuilder().Text(text).Build()

	req := larkim.NewReplyMessageReqBuilder().
		MessageId(messageId).
		Body(larkim.NewReplyMessageReqBodyBuilder().
			MsgType(larkim.MsgTypeText).
			Content(content).
			Build()).
		Build()

	resp, err := s.larkClient.Im.Message.Reply(ctx, req)
	if err != nil {
		log.Printf("回复文本消息失败: %v", err)
		return
	}
	if !resp.Success() {
		log.Printf("回复文本消息失败: code=%d, msg=%s", resp.Code, resp.Msg)
	}
}

// ReplyCard 回复交互卡片消息
func (s *SessionManager) ReplyCard(ctx context.Context, messageId, cardJSON string) {
	req := larkim.NewReplyMessageReqBuilder().
		MessageId(messageId).
		Body(larkim.NewReplyMessageReqBodyBuilder().
			MsgType(larkim.MsgTypeInteractive).
			Content(cardJSON).
			Build()).
		Build()

	resp, err := s.larkClient.Im.Message.Reply(ctx, req)
	if err != nil {
		log.Printf("回复卡片消息失败: %v", err)
		return
	}
	if !resp.Success() {
		log.Printf("回复卡片消息失败: code=%d, msg=%s", resp.Code, resp.Msg)
	}
}
