package repository

import (
	"context"

	"github.com/zhangjihua0327/bookeeper/internal/domain"
)

// PumpTruckRepository 泵车数据操作接口
type PumpTruckRepository interface {
	// Create 创建泵车记录，返回记录 ID
	Create(ctx context.Context, record *domain.PumpTruckRecord) (string, error)
}

// MixerTruckRepository 搅拌车数据操作接口
type MixerTruckRepository interface {
	// Create 创建搅拌车记录，返回记录 ID
	Create(ctx context.Context, record *domain.MixerTruckRecord) (string, error)
}

// FieldOptionManager 字段选项管理接口
type FieldOptionManager interface {
	// GetFieldOptions 获取单选/多选字段的可选值列表
	GetFieldOptions(ctx context.Context, tableID string, fieldName string) ([]string, error)
	// AddFieldOption 向单选/多选字段添加新选项
	AddFieldOption(ctx context.Context, tableID string, fieldName string, optionName string) error
}
