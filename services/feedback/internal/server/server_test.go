package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fastaiapi/feedback/internal/feedback"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func input() feedback.Input {
	return feedback.Input{RequestID: "12345678-1234-1234-1234-123456789012", Category: "使用问题", Title: "测试", Content: "内容", Contact: "test@example.invalid"}
}
func request(s *Server, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(method, path, bytes.NewReader(raw))
	r.Header.Set("X-Feedback-Admin", "1")
	r.Header.Set("Authorization", "Bearer test-only")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestAdminAndFeedback(t *testing.T) {
	dir := t.TempDir()
	s, e := New(dir)
	if e != nil {
		t.Fatal(e)
	}
	s.Verify = func(context.Context, string) (int64, error) { return 230, nil }
	for _, p := range []string{"/admin/api/feedback", "/admin/api/config", "/admin/api/feedback/123"} {
		if w := request(s, "GET", p, nil, nil); w.Code != 401 {
			t.Fatalf("unauthorized %s = %d", p, w.Code)
		}
	}
	if w := request(s, "POST", "/admin/api/login", map[string]string{"username": "admin", "password": "wrong"}, nil); w.Code != 401 {
		t.Fatal("bad password accepted")
	}
	password, _ := os.ReadFile(filepath.Join(dir, "admin-password"))
	w := request(s, "POST", "/admin/api/login", map[string]string{"username": "admin", "password": string(password)}, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	cookie := w.Result().Cookies()[0]
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatal("unsafe cookie")
	}
	if w = request(s, "POST", "/fastaiapi/api/feedback", input(), nil); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w = request(s, "POST", "/fastaiapi/api/feedback", input(), nil); w.Code != 200 {
		t.Fatal("idempotency failed")
	}
	if len(s.Store.List()) != 1 {
		t.Fatal("duplicated feedback")
	}
	restored, e := OpenStore(filepath.Join(dir, "records"))
	if e != nil || len(restored.List()) != 1 {
		t.Fatal("persistence failed", e)
	}
	if w = request(s, "GET", "/admin/api/feedback", nil, cookie); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w = request(s, "GET", "/admin/api/feedback/"+input().RequestID, nil, cookie); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	r := httptest.NewRequest("POST", "/admin/api/config", bytes.NewBufferString(`{"webhook":""}`))
	r.AddCookie(cookie)
	r.Header.Set("Origin", "https://evil.example")
	r.Header.Set("X-Feedback-Admin", "1")
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("CSRF accepted")
	}
	if w = request(s, "POST", "/admin/api/config", Config{Webhook: "http://127.0.0.1/internal"}, cookie); w.Code != 400 {
		t.Fatal("SSRF config accepted")
	}
	if w = request(s, "POST", "/admin/api/logout", map[string]string{}, cookie); w.Code != 200 {
		t.Fatal("logout failed")
	}
	if w = request(s, "GET", "/admin/api/feedback", nil, cookie); w.Code != 401 {
		t.Fatal("session still valid")
	}
	s.Verify = func(context.Context, string) (int64, error) { return 0, errors.New("invalid") }
	if w = request(s, "POST", "/fastaiapi/api/feedback", input(), nil); w.Code != 401 {
		t.Fatal("invalid user accepted")
	}
}
func TestStoreLimitsAndOutbox(t *testing.T) {
	s, _ := OpenStore(t.TempDir())
	v := input()
	for i := 0; i < 10; i++ {
		v.RequestID = fmt.Sprintf("12345678-1234-1234-1234-%012d", i)
		if _, e := s.Submit(1, v); e != nil {
			t.Fatal(e)
		}
	}
	v.RequestID = "12345678-1234-1234-1234-999999999999"
	if _, e := s.Submit(1, v); !errors.Is(e, feedback.ErrRateLimit) {
		t.Fatal("missing limit")
	}
	r, ok := s.Pending()
	if !ok {
		t.Fatal("missing pending")
	}
	if e := s.Delivered(r, nil); e != nil {
		t.Fatal(e)
	}
	saved, _ := s.Get(r.ID)
	if !saved.Notified || saved.Attempts != 1 {
		t.Fatal("outbox state not saved")
	}
}
func TestConfigNeverReturned(t *testing.T) {
	s, _ := New(t.TempDir())
	s.config = Config{Webhook: "https://open.larksuite.com/open-apis/bot/v2/hook/private-value", Secret: "private-secret"}
	if e := validConfig(s.config); e != nil {
		t.Fatal(e)
	}
	for _, bad := range []string{"https://open.larksuite.com.evil/hook/x", "https://open.larksuite.com:444/open-apis/bot/v2/hook/x", "https://user@open.larksuite.com/open-apis/bot/v2/hook/x"} {
		if validConfig(Config{Webhook: bad}) == nil {
			t.Fatal("invalid config accepted")
		}
	}
}
