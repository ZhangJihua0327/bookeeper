package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	biterrors "github.com/zhangjihua0327/bookeeper/internal/errors"
)

const defaultBaseURL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

// AIClient AI 模型调用接口
type AIClient interface {
	// ChatCompletion 发送聊天请求，返回模型的文本响应内容
	ChatCompletion(ctx context.Context, req ChatRequest) (string, error)
}

// ChatRequest 聊天请求
type ChatRequest struct {
	Model       string
	Messages    []Message
	Temperature *float64
}

// Message 消息
type Message struct {
	Role         string        // "system" / "user" / "assistant"
	TextContent  string        // 纯文本时使用
	MultiContent []ContentPart // 多模态时使用 (text + image)
}

// ContentPart 多模态消息的内容片段
type ContentPart struct {
	Type     string    // "text" 或 "image_url"
	Text     string    // type 为 "text" 时使用
	ImageURL *ImageURL // type 为 "image_url" 时使用
}

// ImageURL 图片 URL
type ImageURL struct {
	URL string
}

// MarshalJSON 自定义 Message 的 JSON 序列化
// 纯文本时 content 为 string，多模态时 content 为数组
func (m Message) MarshalJSON() ([]byte, error) {
	if len(m.MultiContent) > 0 {
		parts := make([]map[string]interface{}, 0, len(m.MultiContent))
		for _, p := range m.MultiContent {
			part := map[string]interface{}{"type": p.Type}
			switch p.Type {
			case "text":
				part["text"] = p.Text
			case "image_url":
				if p.ImageURL != nil {
					part["image_url"] = map[string]string{"url": p.ImageURL.URL}
				}
			}
			parts = append(parts, part)
		}
		return json.Marshal(map[string]interface{}{
			"role":    m.Role,
			"content": parts,
		})
	}
	return json.Marshal(map[string]interface{}{
		"role":    m.Role,
		"content": m.TextContent,
	})
}

// dashScopeClient DashScope API 客户端
type dashScopeClient struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

// NewDashScopeClient 创建 DashScope AI 客户端
func NewDashScopeClient(apiKey string) AIClient {
	return &dashScopeClient{
		apiKey:     apiKey,
		baseURL:    defaultBaseURL,
		httpClient: &http.Client{},
	}
}

// chatCompletionRequest OpenAI 兼容的请求格式
type chatCompletionRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature *float64  `json:"temperature,omitempty"`
}

// chatCompletionResponse OpenAI 兼容的响应格式
type chatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

func (c *dashScopeClient) ChatCompletion(ctx context.Context, req ChatRequest) (string, error) {
	body := chatCompletionRequest{
		Model:       req.Model,
		Messages:    req.Messages,
		Temperature: req.Temperature,
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("序列化请求失败: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("创建 HTTP 请求失败: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return "", &biterrors.ErrAIRequestFailure{
			StatusCode: 0,
			Message:    fmt.Sprintf("HTTP 请求失败: %v", err),
		}
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", &biterrors.ErrAIRequestFailure{
			StatusCode: resp.StatusCode,
			Message:    string(respBody),
		}
	}

	var result chatCompletionResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", &biterrors.ErrAIParsingFailure{
			Reason:      "无法解析 API 响应 JSON",
			RawResponse: string(respBody),
		}
	}

	if result.Error != nil {
		return "", &biterrors.ErrAIRequestFailure{
			StatusCode: resp.StatusCode,
			Message:    result.Error.Message,
		}
	}

	if len(result.Choices) == 0 {
		return "", &biterrors.ErrAIParsingFailure{
			Reason:      "API 响应中没有 choices",
			RawResponse: string(respBody),
		}
	}

	return result.Choices[0].Message.Content, nil
}
