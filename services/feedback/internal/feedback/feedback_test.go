package feedback

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func validInput() Input {
	return Input{RequestID: "12345678-1234-1234-1234-123456789012", Category: "使用问题", Title: "测试反馈", Content: "测试内容", Contact: "测试联系方式"}
}
func TestValidation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*Input)
	}{
		{"empty title", func(v *Input) { v.Title = "  " }}, {"unknown category", func(v *Input) { v.Category = "bad" }},
		{"oversized content", func(v *Input) { v.Content = strings.Repeat("字", 5001) }},
		{"invalid id", func(v *Input) { v.RequestID = "../bad" }},
		{"fake screenshot", func(v *Input) {
			v.Screenshots = []Screenshot{{Name: "fake.png", Data: "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not an image"))}}
		}},
		{"too many screenshots", func(v *Input) { v.Screenshots = make([]Screenshot, 4) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := validInput()
			tc.change(&v)
			if Validate(&v) == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
	v := validInput()
	if err := Validate(&v); err != nil {
		t.Fatal(err)
	}
}
func TestNotification(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Fatal("invalid notification")
		}
		if body["msg_type"] != "text" || body["sign"] == nil {
			t.Error("missing type/sign")
		}
		json.NewEncoder(w).Encode(map[string]int{"code": 0})
	}))
	defer server.Close()
	s := Service{Webhook: server.URL, Secret: "test-only"}
	if err := s.Notify(context.Background(), 123, validInput()); err != nil {
		t.Fatal(err)
	}
}
func TestNotificationRejectsErrors(t *testing.T) {
	for _, body := range []string{`{"code":19024}`, `{"StatusCode":1}`, `{}`, `not json`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) }))
		s := Service{Webhook: server.URL}
		if s.Notify(context.Background(), 123, validInput()) == nil {
			t.Errorf("accepted failure %s", body)
		}
		server.Close()
	}
}
