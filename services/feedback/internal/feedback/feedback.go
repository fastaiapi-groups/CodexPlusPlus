// Package feedback 保存反馈与通知发件箱；机器人凭据只存在于服务端。
package feedback

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type Screenshot struct {
	Name string `json:"name"`
	Data string `json:"data"`
}
type Input struct {
	RequestID   string       `json:"request_id"`
	Category    string       `json:"category"`
	Title       string       `json:"title"`
	Content     string       `json:"content"`
	Contact     string       `json:"contact"`
	Screenshots []Screenshot `json:"screenshots"`
}
type Service struct {
	Webhook, Secret string
	Client          *http.Client
}

var idPattern = regexp.MustCompile(`^[a-zA-Z0-9-]{16,64}$`)
var ErrRateLimit = errors.New("反馈过于频繁，请稍后重试")

func Validate(v *Input) error {
	v.Title = strings.TrimSpace(v.Title)
	v.Content = strings.TrimSpace(v.Content)
	v.Contact = strings.TrimSpace(v.Contact)
	if !idPattern.MatchString(v.RequestID) {
		return errors.New("反馈编号无效")
	}
	allowed := map[string]bool{"使用问题": true, "登录与账号": true, "模型与 API": true, "充值与余额": true, "图片与视频": true, "功能建议": true, "其他": true}
	if !allowed[v.Category] || v.Title == "" || utf8.RuneCountInString(v.Title) > 100 || v.Content == "" || utf8.RuneCountInString(v.Content) > 5000 || v.Contact == "" || utf8.RuneCountInString(v.Contact) > 200 {
		return errors.New("请检查问题类型、标题、内容和联系方式")
	}
	if len(v.Screenshots) > 3 {
		return errors.New("最多上传 3 张截图")
	}
	for _, image := range v.Screenshots {
		if len(image.Name) > 255 {
			return errors.New("截图文件名过长")
		}
		parts := strings.SplitN(image.Data, ",", 2)
		if len(parts) != 2 {
			return errors.New("截图格式无效")
		}
		raw, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil || len(raw) == 0 || len(raw) > 1024*1024 {
			return errors.New("截图不可超过 1 MB")
		}
		mime := http.DetectContentType(raw)
		if (mime != "image/png" && mime != "image/jpeg" && mime != "image/webp") || parts[0] != "data:"+mime+";base64" {
			return errors.New("只支持 PNG、JPG、WebP 截图")
		}
	}
	return nil
}
func (s *Service) Notify(ctx context.Context, uid int64, v Input) error {
	text := fmt.Sprintf("FastAiApi 用户反馈\n编号：%s\n用户：%d\n类型：%s\n标题：%s\n联系方式：%s\n内容：\n%s\n截图：%d 张（已保存到后台）", v.RequestID, uid, v.Category, v.Title, v.Contact, v.Content, len(v.Screenshots))
	payload := map[string]any{"msg_type": "text", "content": map[string]string{"text": text}}
	if s.Secret != "" {
		stamp := fmt.Sprint(time.Now().Unix())
		mac := hmac.New(sha256.New, []byte(stamp+"\n"+s.Secret))
		payload["timestamp"] = stamp
		payload["sign"] = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	}
	raw, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", s.Webhook, bytes.NewReader(raw))
	if err != nil {
		return errors.New("通知配置错误")
	}
	req.Header.Set("Content-Type", "application/json")
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("通知发送失败")
	}
	defer resp.Body.Close()
	var result struct {
		Code       *int `json:"code"`
		StatusCode *int `json:"StatusCode"`
	}
	if resp.StatusCode != 200 {
		return errors.New("通知发送失败")
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&result) != nil || (result.Code == nil && result.StatusCode == nil) || (result.Code != nil && *result.Code != 0) || (result.StatusCode != nil && *result.StatusCode != 0) {
		return errors.New("Lark 未接受通知")
	}
	return nil
}
