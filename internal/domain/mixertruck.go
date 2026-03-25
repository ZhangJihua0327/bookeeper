package domain

import "time"

// MixerTruckRecord 搅拌车记录
type MixerTruckRecord struct {
	RecordID     string    // 飞书记录 ID
	Date         time.Time // 日期
	CustomerName string    // 客户名称（单选）
	Volume       float64   // 方量
	Remark       string    // 备注（如：驾驶员A：x + x + x，驾驶员B：x + x + x）
	Drivers      []string  // 驾驶员（多选）
}
