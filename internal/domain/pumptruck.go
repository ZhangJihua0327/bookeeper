package domain

import "time"

// PumpTruckRecord 泵车记录
type PumpTruckRecord struct {
	RecordID     string    // 飞书记录 ID
	Date         time.Time // 日期
	TruckModel   string    // 车型（单选）
	CustomerName string    // 客户名称（单选）
	Volume       float64   // 方量
	Location     string    // 施工地点
	Remark       string    // 备注
	Driver       string    // 驾驶员（单选）
}
