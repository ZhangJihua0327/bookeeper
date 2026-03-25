package service

import (
	"github.com/zhangjihua0327/bookeeper/internal/domain"
)

// ParseInput 解析服务的输入
type ParseInput struct {
	Text     string // 用户文本输入（可选，与 ImageURL 至少提供一个）
	ImageURL string // 图片 URL 或 base64 数据（可选）
}

// PumpTruckParseResult 泵车解析结果
type PumpTruckParseResult struct {
	Record         *domain.PumpTruckRecord
	MissingFields  []string        // 缺失的必填字段名（中文）
	UnknownOptions []UnknownOption // 不在选项列表中的字段值
}

// HasMissingFields 是否存在缺失的必填字段
func (r *PumpTruckParseResult) HasMissingFields() bool {
	return len(r.MissingFields) > 0
}

// HasUnknownOptions 是否存在未知选项
func (r *PumpTruckParseResult) HasUnknownOptions() bool {
	return len(r.UnknownOptions) > 0
}

// IsComplete 解析结果是否完整（无缺失字段且无未知选项）
func (r *PumpTruckParseResult) IsComplete() bool {
	return !r.HasMissingFields() && !r.HasUnknownOptions()
}

// MixerTruckParseResult 搅拌车解析结果
type MixerTruckParseResult struct {
	Record         *domain.MixerTruckRecord
	MissingFields  []string        // 缺失的必填字段名（中文）
	UnknownOptions []UnknownOption // 不在选项列表中的字段值
}

// HasMissingFields 是否存在缺失的必填字段
func (r *MixerTruckParseResult) HasMissingFields() bool {
	return len(r.MissingFields) > 0
}

// HasUnknownOptions 是否存在未知选项
func (r *MixerTruckParseResult) HasUnknownOptions() bool {
	return len(r.UnknownOptions) > 0
}

// IsComplete 解析结果是否完整（无缺失字段且无未知选项）
func (r *MixerTruckParseResult) IsComplete() bool {
	return !r.HasMissingFields() && !r.HasUnknownOptions()
}

// UnknownOption 不在当前多维表格选项中的字段值
type UnknownOption struct {
	FieldName string // 字段中文名，如 "车型"、"客户名称"
	Value     string // AI 解析出的值
}

// pumpTruckJSON AI 返回的泵车 JSON 中间结构体
type pumpTruckJSON struct {
	Date         *string  `json:"date"`
	TruckModel   *string  `json:"truck_model"`
	CustomerName *string  `json:"customer_name"`
	Volume       *float64 `json:"volume"`
	Location     *string  `json:"location"`
}

// mixerTruckJSON AI 返回的搅拌车 JSON 中间结构体
type mixerTruckJSON struct {
	Date         *string  `json:"date"`
	CustomerName *string  `json:"customer_name"`
	Volume       *float64 `json:"volume"`
	Remark       *string  `json:"remark"`
	Drivers      []string `json:"drivers"`
}
