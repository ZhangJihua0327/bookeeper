package bitable

import (
	"context"
	"fmt"
	"log"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkbitable "github.com/larksuite/oapi-sdk-go/v3/service/bitable/v1"
	biterrors "github.com/zhangjihua0327/bookeeper/internal/errors"
	"github.com/zhangjihua0327/bookeeper/internal/repository"
)

// 编译期接口一致性断言
var _ repository.FieldOptionManager = (*fieldOptionManager)(nil)

type fieldOptionManager struct {
	client   *lark.Client
	appToken string
}

// NewFieldOptionManager 创建字段选项管理器
func NewFieldOptionManager(client *lark.Client, appToken string) repository.FieldOptionManager {
	return &fieldOptionManager{
		client:   client,
		appToken: appToken,
	}
}

func (m *fieldOptionManager) GetFieldOptions(ctx context.Context, tableID string, fieldName string) ([]string, error) {
	log.Printf("[Repo] 获取字段选项 table=%s field=%s", tableID, fieldName)
	field, err := m.findField(ctx, tableID, fieldName)
	if err != nil {
		return nil, err
	}

	if field.Property == nil || field.Property.Options == nil {
		return []string{}, nil
	}

	options := make([]string, 0, len(field.Property.Options))
	for _, opt := range field.Property.Options {
		if opt.Name != nil {
			options = append(options, *opt.Name)
		}
	}

	log.Printf("[Repo] 获取字段选项成功 field=%s optionCount=%d", fieldName, len(options))
	return options, nil
}

func (m *fieldOptionManager) AddFieldOption(ctx context.Context, tableID string, fieldName string, optionName string) error {
	log.Printf("[Repo] 添加字段选项 table=%s field=%s option=%s", tableID, fieldName, optionName)
	field, err := m.findField(ctx, tableID, fieldName)
	if err != nil {
		return err
	}

	if field.FieldId == nil {
		return fmt.Errorf("字段 %q 没有 field_id", fieldName)
	}

	// 构建新的选项列表：保留所有已有选项 + 追加新选项
	existingOptions := make([]*larkbitable.AppTableFieldPropertyOption, 0)
	if field.Property != nil && field.Property.Options != nil {
		for _, opt := range field.Property.Options {
			// 检查是否已存在同名选项
			if opt.Name != nil && *opt.Name == optionName {
				log.Printf("[Repo] 字段选项已存在，无需添加 field=%s option=%s", fieldName, optionName)
				return nil // 选项已存在，无需重复添加
			}
			existingOptions = append(existingOptions, opt)
		}
	}

	// 追加新选项
	newOption := larkbitable.NewAppTableFieldPropertyOptionBuilder().
		Name(optionName).
		Build()
	existingOptions = append(existingOptions, newOption)

	// 构建更新请求（全量替换选项列表）
	property := larkbitable.NewAppTableFieldPropertyBuilder().
		Options(existingOptions).
		Build()

	appTableField := larkbitable.NewAppTableFieldBuilder().
		Property(property).
		Build()

	req := larkbitable.NewUpdateAppTableFieldReqBuilder().
		AppToken(m.appToken).
		TableId(tableID).
		FieldId(*field.FieldId).
		AppTableField(appTableField).
		Build()

	resp, err := m.client.Bitable.AppTableField.Update(ctx, req)
	if err != nil {
		return fmt.Errorf("更新字段 %q 选项失败: %w", fieldName, err)
	}
	if !resp.Success() {
		log.Printf("[Repo] 添加字段选项API失败: field=%s option=%s code=%d msg=%s", fieldName, optionName, resp.Code, resp.Msg)
		return biterrors.NewAPIError(resp.Code, resp.Msg, resp.RequestId())
	}

	log.Printf("[Repo] 添加字段选项成功 field=%s option=%s", fieldName, optionName)
	return nil
}

// findField 在表的字段列表中查找指定名称的字段
func (m *fieldOptionManager) findField(ctx context.Context, tableID string, fieldName string) (*larkbitable.AppTableFieldForList, error) {
	log.Printf("[Repo] 查找字段 table=%s field=%s", tableID, fieldName)
	var pageToken string
	for {
		builder := larkbitable.NewListAppTableFieldReqBuilder().
			AppToken(m.appToken).
			TableId(tableID).
			PageSize(100)

		if pageToken != "" {
			builder.PageToken(pageToken)
		}

		resp, err := m.client.Bitable.AppTableField.List(ctx, builder.Build())
		if err != nil {
			return nil, fmt.Errorf("查询表字段列表失败: %w", err)
		}
		if !resp.Success() {
			return nil, biterrors.NewAPIError(resp.Code, resp.Msg, resp.RequestId())
		}

		for _, field := range resp.Data.Items {
			if field.FieldName != nil && *field.FieldName == fieldName {
				return field, nil
			}
		}

		if resp.Data.HasMore == nil || !*resp.Data.HasMore {
			break
		}
		if resp.Data.PageToken != nil {
			pageToken = *resp.Data.PageToken
		}
	}

	return nil, fmt.Errorf("未找到字段: %s", fieldName)
}
