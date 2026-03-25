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
	log.Printf("[Session] 开始处理泵车记录 messageId=%s text=%q hasImage=%v", messageId, text, imageURL != "")
	result, err := s.parsingSvc.ParsePumpTruck(ctx, service.ParseInput{
		Text:     text,
		ImageURL: imageURL,
	})
	if err != nil {
		log.Printf("[Session] 解析泵车记录失败: messageId=%s err=%v", messageId, err)
		s.ReplyText(ctx, messageId, fmt.Sprintf("解析失败: %v", err))
		return nil
	}

	log.Printf("[Session] 泵车解析完成 messageId=%s missingFields=%v unknownOptions=%d", messageId, result.MissingFields, len(result.UnknownOptions))

	// 有缺失必填字段 → 提示用户补充
	if result.HasMissingFields() {
		log.Printf("[Session] 泵车记录缺失必填字段 messageId=%s fields=%v", messageId, result.MissingFields)
		msg := fmt.Sprintf("以下必填字段缺失，请补充后重新发送：\n- %s", strings.Join(result.MissingFields, "\n- "))
		s.ReplyText(ctx, messageId, msg)
		return nil
	}

	// 构建确认卡片
	cardJSON, err := buildPumpTruckConfirmCard(result.Record, result.UnknownOptions)
	if err != nil {
		log.Printf("[Session] 构建泵车卡片失败: messageId=%s err=%v", messageId, err)
		s.ReplyText(ctx, messageId, "内部错误，请重试")
		return nil
	}

	log.Printf("[Session] 发送泵车确认卡片 messageId=%s", messageId)
	s.ReplyCard(ctx, messageId, cardJSON)
	return nil
}

// HandleMixerTruck 处理搅拌车记录：解析 → 构建确认卡片 → 回复
func (s *SessionManager) HandleMixerTruck(ctx context.Context, chatId, messageId, text, imageURL string) error {
	log.Printf("[Session] 开始处理搅拌车记录 messageId=%s text=%q hasImage=%v", messageId, text, imageURL != "")
	result, err := s.parsingSvc.ParseMixerTruck(ctx, service.ParseInput{
		Text:     text,
		ImageURL: imageURL,
	})
	if err != nil {
		log.Printf("[Session] 解析搅拌车记录失败: messageId=%s err=%v", messageId, err)
		s.ReplyText(ctx, messageId, fmt.Sprintf("解析失败: %v", err))
		return nil
	}

	log.Printf("[Session] 搅拌车解析完成 messageId=%s missingFields=%v unknownOptions=%d", messageId, result.MissingFields, len(result.UnknownOptions))

	if result.HasMissingFields() {
		log.Printf("[Session] 搅拌车记录缺失必填字段 messageId=%s fields=%v", messageId, result.MissingFields)
		msg := fmt.Sprintf("以下必填字段缺失，请补充后重新发送：\n- %s", strings.Join(result.MissingFields, "\n- "))
		s.ReplyText(ctx, messageId, msg)
		return nil
	}

	cardJSON, err := buildMixerTruckConfirmCard(result.Record, result.UnknownOptions)
	if err != nil {
		log.Printf("[Session] 构建搅拌车卡片失败: messageId=%s err=%v", messageId, err)
		s.ReplyText(ctx, messageId, "内部错误，请重试")
		return nil
	}

	log.Printf("[Session] 发送搅拌车确认卡片 messageId=%s", messageId)
	s.ReplyCard(ctx, messageId, cardJSON)
	return nil
}

// ConfirmPumpTruck 确认提交泵车记录到多维表格，并回读写入的数据
func (s *SessionManager) ConfirmPumpTruck(ctx context.Context, record *domain.PumpTruckRecord, unknownOpts []service.UnknownOption) (*domain.PumpTruckRecord, error) {
	log.Printf("[Session] 开始确认提交泵车记录 customer=%s volume=%.1f unknownOpts=%d", record.CustomerName, record.Volume, len(unknownOpts))
	// 先添加未知选项
	for _, opt := range unknownOpts {
		log.Printf("[Session] 添加泵车未知选项 field=%s value=%s", opt.FieldName, opt.Value)
		if err := s.fieldOptionMgr.AddFieldOption(ctx, s.bitableCfg.PumpTruckTableID, opt.FieldName, opt.Value); err != nil {
			log.Printf("[Session] 添加泵车选项失败 field=%s value=%s err=%v", opt.FieldName, opt.Value, err)
			return nil, fmt.Errorf("添加选项 %s=%s 失败: %w", opt.FieldName, opt.Value, err)
		}
	}

	// 创建记录
	recordID, err := s.pumpTruckRepo.Create(ctx, record)
	if err != nil {
		log.Printf("[Session] 创建泵车记录失败: err=%v", err)
		return nil, fmt.Errorf("创建泵车记录失败: %w", err)
	}

	log.Printf("[Session] 泵车记录创建成功 recordId=%s，开始回读", recordID)

	// 回读写入的数据
	written, err := s.pumpTruckRepo.GetByID(ctx, recordID)
	if err != nil {
		log.Printf("[Session] 回读泵车记录失败: recordId=%s err=%v", recordID, err)
		// 回读失败不影响提交结果，返回原始记录
		record.RecordID = recordID
		return record, nil
	}

	return written, nil
}

// ConfirmMixerTruck 确认提交搅拌车记录到多维表格，并回读写入的数据
func (s *SessionManager) ConfirmMixerTruck(ctx context.Context, record *domain.MixerTruckRecord, unknownOpts []service.UnknownOption) (*domain.MixerTruckRecord, error) {
	log.Printf("[Session] 开始确认提交搅拌车记录 customer=%s drivers=%v volume=%.1f unknownOpts=%d", record.CustomerName, record.Drivers, record.Volume, len(unknownOpts))
	for _, opt := range unknownOpts {
		log.Printf("[Session] 添加搅拌车未知选项 field=%s value=%s", opt.FieldName, opt.Value)
		if err := s.fieldOptionMgr.AddFieldOption(ctx, s.bitableCfg.MixerTruckTableID, opt.FieldName, opt.Value); err != nil {
			log.Printf("[Session] 添加搅拌车选项失败 field=%s value=%s err=%v", opt.FieldName, opt.Value, err)
			return nil, fmt.Errorf("添加选项 %s=%s 失败: %w", opt.FieldName, opt.Value, err)
		}
	}

	recordID, err := s.mixerTruckRepo.Create(ctx, record)
	if err != nil {
		log.Printf("[Session] 创建搅拌车记录失败: err=%v", err)
		return nil, fmt.Errorf("创建搅拌车记录失败: %w", err)
	}

	log.Printf("[Session] 搅拌车记录创建成功 recordId=%s，开始回读", recordID)

	written, err := s.mixerTruckRepo.GetByID(ctx, recordID)
	if err != nil {
		log.Printf("[Session] 回读搅拌车记录失败: recordId=%s err=%v", recordID, err)
		record.RecordID = recordID
		return record, nil
	}

	return written, nil
}

// HandleAutoClassify 通过 AI 自动分类并处理记录
func (s *SessionManager) HandleAutoClassify(ctx context.Context, chatId, messageId, text, imageURL string) error {
	log.Printf("[Session] 开始AI自动分类 messageId=%s text=%q", messageId, text)

	recordType, err := s.parsingSvc.ClassifyRecordType(ctx, service.ParseInput{
		Text:     text,
		ImageURL: imageURL,
	})
	if err != nil {
		log.Printf("[Session] AI分类失败: messageId=%s err=%v", messageId, err)
		s.ReplyText(ctx, messageId, fmt.Sprintf("分类失败: %v", err))
		return nil
	}

	log.Printf("[Session] AI分类结果: messageId=%s type=%s", messageId, recordType)

	switch recordType {
	case "pump_truck":
		return s.HandlePumpTruck(ctx, chatId, messageId, text, imageURL)
	case "mixer_truck":
		return s.HandleMixerTruck(ctx, chatId, messageId, text, imageURL)
	default:
		log.Printf("[Session] 无法识别记录类型 messageId=%s", messageId)
		s.ReplyText(ctx, messageId, "无法识别记录类型，请描述泵车或搅拌车的施工记录。\n\n示例：\n- 泵车：红泵车 恒大 XX工地 15方\n- 搅拌车：恒大 张三8+7+6 李四5+5")
		return nil
	}
}

// ReplyText 回复纯文本消息
func (s *SessionManager) ReplyText(ctx context.Context, messageId, text string) {
	log.Printf("[Session] 回复文本消息 messageId=%s text=%q", messageId, text)
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
		log.Printf("[Session] 回复文本消息失败: messageId=%s err=%v", messageId, err)
		return
	}
	if !resp.Success() {
		log.Printf("[Session] 回复文本消息失败: messageId=%s code=%d msg=%s", messageId, resp.Code, resp.Msg)
	}
}

// ReplyCard 回复交互卡片消息
func (s *SessionManager) ReplyCard(ctx context.Context, messageId, cardJSON string) {
	log.Printf("[Session] 回复卡片消息 messageId=%s cardLen=%d", messageId, len(cardJSON))
	req := larkim.NewReplyMessageReqBuilder().
		MessageId(messageId).
		Body(larkim.NewReplyMessageReqBodyBuilder().
			MsgType(larkim.MsgTypeInteractive).
			Content(cardJSON).
			Build()).
		Build()

	resp, err := s.larkClient.Im.Message.Reply(ctx, req)
	if err != nil {
		log.Printf("[Session] 回复卡片消息失败: messageId=%s err=%v", messageId, err)
		return
	}
	if !resp.Success() {
		log.Printf("[Session] 回复卡片消息失败: messageId=%s code=%d msg=%s", messageId, resp.Code, resp.Msg)
	}
}
