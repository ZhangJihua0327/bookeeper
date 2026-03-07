package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config 应用配置
type Config struct {
	Feishu  FeishuConfig  `yaml:"feishu"`
	Bitable BitableConfig `yaml:"bitable"`
}

// FeishuConfig 飞书应用配置
type FeishuConfig struct {
	AppID     string `yaml:"app_id"`
	AppSecret string `yaml:"app_secret"`
}

// BitableConfig 多维表格配置
type BitableConfig struct {
	AppToken          string `yaml:"app_token"`
	PumpTruckTableID  string `yaml:"pump_truck_table_id"`
	MixerTruckTableID string `yaml:"mixer_truck_table_id"`
}

// Load 从指定路径的 YAML 文件加载配置
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败: %w", err)
	}

	cfg := &Config{}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("解析配置文件失败: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) validate() error {
	required := map[string]string{
		"feishu.app_id":                c.Feishu.AppID,
		"feishu.app_secret":            c.Feishu.AppSecret,
		"bitable.app_token":            c.Bitable.AppToken,
		"bitable.pump_truck_table_id":  c.Bitable.PumpTruckTableID,
		"bitable.mixer_truck_table_id": c.Bitable.MixerTruckTableID,
	}

	for name, value := range required {
		if value == "" {
			return fmt.Errorf("缺少必要的配置项: %s", name)
		}
	}

	return nil
}
