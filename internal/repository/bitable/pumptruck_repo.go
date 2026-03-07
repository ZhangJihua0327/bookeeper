package bitable

import (
	"context"
	"fmt"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkbitable "github.com/larksuite/oapi-sdk-go/v3/service/bitable/v1"
	"github.com/zhangjihua0327/bookeeper/internal/domain"
	biterrors "github.com/zhangjihua0327/bookeeper/internal/errors"
	"github.com/zhangjihua0327/bookeeper/internal/repository"
)

// 编译期接口一致性断言
var _ repository.PumpTruckRepository = (*pumpTruckRepo)(nil)

type pumpTruckRepo struct {
	client   *lark.Client
	appToken string
	tableID  string
}

// NewPumpTruckRepository 创建泵车 Repository
func NewPumpTruckRepository(client *lark.Client, appToken, tableID string) repository.PumpTruckRepository {
	return &pumpTruckRepo{
		client:   client,
		appToken: appToken,
		tableID:  tableID,
	}
}

func (r *pumpTruckRepo) Create(ctx context.Context, record *domain.PumpTruckRecord) (string, error) {
	fields := PumpTruckToFieldMap(record)

	req := larkbitable.NewCreateAppTableRecordReqBuilder().
		AppToken(r.appToken).
		TableId(r.tableID).
		AppTableRecord(larkbitable.NewAppTableRecordBuilder().
			Fields(fields).
			Build()).
		Build()

	resp, err := r.client.Bitable.AppTableRecord.Create(ctx, req)
	if err != nil {
		return "", fmt.Errorf("创建泵车记录失败: %w", err)
	}
	if !resp.Success() {
		return "", biterrors.NewAPIError(resp.Code, resp.Msg, resp.RequestId())
	}

	return *resp.Data.Record.RecordId, nil
}
