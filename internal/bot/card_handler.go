package bot

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	larkcard "github.com/larksuite/oapi-sdk-go/v3/card"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	"github.com/zhangjihua0327/bookeeper/internal/service"
)

// CardCallbackHandler 卡片按钮回调处理器
type CardCallbackHandler struct {
	session *SessionManager
}

// NewCardCallbackHandler 创建卡片回调处理器
func NewCardCallbackHandler(session *SessionManager) *CardCallbackHandler {
	return &CardCallbackHandler{session: session}
}

// Handle 处理卡片按钮点击回调
// 返回值为更新后的卡片 JSON（SDK 会用返回值替换原卡片）
func (h *CardCallbackHandler) Handle(ctx context.Context, cardAction *larkcard.CardAction) (interface{}, error) {
	if cardAction.Action == nil || cardAction.Action.Value == nil {
		log.Printf("[CardHandler] 收到无效卡片回调（action或value为空）")
		return nil, nil
	}

	actionStr, _ := cardAction.Action.Value["action"].(string)
	log.Printf("[CardHandler] 收到卡片回调 action=%s", actionStr)

	switch actionStr {
	case "confirm":
		return h.handleConfirm(ctx, cardAction.Action.Value)
	case "cancel":
		log.Printf("[CardHandler] 用户取消操作")
		return h.handleCancel()
	default:
		log.Printf("[CardHandler] 未知的卡片 action: %s", actionStr)
		return nil, nil
	}
}

// handleConfirm 处理确认操作
func (h *CardCallbackHandler) handleConfirm(ctx context.Context, value map[string]interface{}) (interface{}, error) {
	typeStr, _ := value["type"].(string)
	recordJSON, _ := value["record_json"].(string)
	unknownOptsJSON, _ := value["unknown_options_json"].(string)

	log.Printf("[CardHandler] 确认提交 type=%s recordLen=%d unknownOptsLen=%d", typeStr, len(recordJSON), len(unknownOptsJSON))

	var unknownOpts []service.UnknownOption
	if unknownOptsJSON != "" {
		if err := json.Unmarshal([]byte(unknownOptsJSON), &unknownOpts); err != nil {
			log.Printf("[CardHandler] 反序列化未知选项失败: err=%v", err)
		}
	}

	switch typeStr {
	case string(recordTypePumpTruck):
		return h.confirmPumpTruck(ctx, recordJSON, unknownOpts)
	case string(recordTypeMixerTruck):
		return h.confirmMixerTruck(ctx, recordJSON, unknownOpts)
	default:
		return buildResultCard("错误", "未知的记录类型", false)
	}
}

// confirmPumpTruck 确认泵车记录
func (h *CardCallbackHandler) confirmPumpTruck(ctx context.Context, recordJSON string, unknownOpts []service.UnknownOption) (interface{}, error) {
	var record domain.PumpTruckRecord
	if err := json.Unmarshal([]byte(recordJSON), &record); err != nil {
		log.Printf("[CardHandler] 反序列化泵车记录失败: err=%v", err)
		return buildResultCard("提交失败", fmt.Sprintf("数据解析错误: %v", err), false)
	}

	log.Printf("[CardHandler] 提交泵车记录 customer=%s driver=%s volume=%.1f", record.CustomerName, record.Driver, record.Volume)
	recordID, err := h.session.ConfirmPumpTruck(ctx, &record, unknownOpts)
	if err != nil {
		log.Printf("[CardHandler] 提交泵车记录失败: err=%v", err)
		return buildResultCard("提交失败", fmt.Sprintf("写入多维表格失败: %v", err), false)
	}

	log.Printf("[CardHandler] 泵车记录提交成功 recordId=%s", recordID)
	content := fmt.Sprintf("泵车记录已成功写入多维表格\n\n**记录 ID：** %s", recordID)
	return buildResultCard("提交成功", content, true)
}

// confirmMixerTruck 确认搅拌车记录
func (h *CardCallbackHandler) confirmMixerTruck(ctx context.Context, recordJSON string, unknownOpts []service.UnknownOption) (interface{}, error) {
	var record domain.MixerTruckRecord
	if err := json.Unmarshal([]byte(recordJSON), &record); err != nil {
		log.Printf("[CardHandler] 反序列化搅拌车记录失败: err=%v", err)
		return buildResultCard("提交失败", fmt.Sprintf("数据解析错误: %v", err), false)
	}

	log.Printf("[CardHandler] 提交搅拌车记录 customer=%s drivers=%v volume=%.1f", record.CustomerName, record.Drivers, record.Volume)
	recordID, err := h.session.ConfirmMixerTruck(ctx, &record, unknownOpts)
	if err != nil {
		log.Printf("[CardHandler] 提交搅拌车记录失败: err=%v", err)
		return buildResultCard("提交失败", fmt.Sprintf("写入多维表格失败: %v", err), false)
	}

	log.Printf("[CardHandler] 搅拌车记录提交成功 recordId=%s", recordID)
	content := fmt.Sprintf("搅拌车记录已成功写入多维表格\n\n**记录 ID：** %s", recordID)
	return buildResultCard("提交成功", content, true)
}

// handleCancel 处理取消操作
func (h *CardCallbackHandler) handleCancel() (interface{}, error) {
	return buildResultCard("已取消", "本次记录已取消", false)
}
