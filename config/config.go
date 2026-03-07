package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

// Config 应用配置
type Config struct {
	AppID             string // 飞书应用 ID
	AppSecret         string // 飞书应用密钥
	BitableAppToken   string // 多维表格应用 token
	PumpTruckTableID  string // 泵车数据表 ID
	MixerTruckTableID string // 搅拌车数据表 ID
}

// LoadFromEnv 从环境变量加载配置，优先尝试加载 .env 文件
func LoadFromEnv() (*Config, error) {
	// 尝试加载 .env 文件，文件不存在不报错
	_ = godotenv.Load()

	cfg := &Config{
		AppID:             os.Getenv("FEISHU_APP_ID"),
		AppSecret:         os.Getenv("FEISHU_APP_SECRET"),
		BitableAppToken:   os.Getenv("BITABLE_APP_TOKEN"),
		PumpTruckTableID:  os.Getenv("PUMP_TRUCK_TABLE_ID"),
		MixerTruckTableID: os.Getenv("MIXER_TRUCK_TABLE_ID"),
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) validate() error {
	required := map[string]string{
		"FEISHU_APP_ID":        c.AppID,
		"FEISHU_APP_SECRET":    c.AppSecret,
		"BITABLE_APP_TOKEN":    c.BitableAppToken,
		"PUMP_TRUCK_TABLE_ID":  c.PumpTruckTableID,
		"MIXER_TRUCK_TABLE_ID": c.MixerTruckTableID,
	}

	for name, value := range required {
		if value == "" {
			return fmt.Errorf("缺少必要的环境变量: %s", name)
		}
	}

	return nil
}
