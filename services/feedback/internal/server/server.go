package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fastaiapi/feedback/internal/feedback"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed admin.html
var adminHTML []byte

//go:embed admin.js
var adminJS []byte

type Config struct {
	Webhook string `json:"webhook"`
	Secret  string `json:"secret"`
}
type Server struct {
	Store    *Store
	dir      string
	password [32]byte
	mu       sync.Mutex
	config   Config
	sessions map[string]time.Time
	failures map[string][]time.Time
	Client   *http.Client
	// 仅用于测试替换账户验证；生产固定请求官方账户接口。
	Verify func(context.Context, string) (int64, error)
}

func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func New(dir string) (*Server, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	st, err := OpenStore(filepath.Join(dir, "records"))
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "admin-password")
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		b = []byte(randomToken())
		err = os.WriteFile(path, b, 0600)
	}
	if err != nil {
		return nil, err
	}
	if len(strings.TrimSpace(string(b))) < 20 {
		return nil, errors.New("管理员密码必须至少 20 字符")
	}
	s := &Server{Store: st, dir: dir, password: sha256.Sum256([]byte(strings.TrimSpace(string(b)))), sessions: map[string]time.Time{}, failures: map[string][]time.Time{}, Client: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if b, e := os.ReadFile(filepath.Join(dir, "lark.json")); e == nil {
		if e = json.Unmarshal(b, &s.config); e != nil {
			return nil, e
		}
		if e = validConfig(s.config); e != nil {
			return nil, e
		}
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	s.Verify = s.verify
	return s, nil
}
func validConfig(c Config) error {
	if c.Webhook == "" && c.Secret == "" {
		return nil
	}
	u, e := url.Parse(c.Webhook)
	if e != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Host != "open.larksuite.com" && u.Host != "open.feishu.cn") || !strings.HasPrefix(u.Path, "/open-apis/bot/v2/hook/") || len(u.Path) < 30 {
		return errors.New("请输入官方 Lark/飞书机器人 Webhook")
	}
	return nil
}
func (s *Server) verify(ctx context.Context, token string) (int64, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://fastaiapi.cloud/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, e := s.Client.Do(req)
	if e != nil {
		return 0, errors.New("账户验证暂不可用")
	}
	defer resp.Body.Close()
	var v struct {
		Code int `json:"code"`
		Data struct {
			ID int64 `json:"id"`
		} `json:"data"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(io.LimitReader(resp.Body, 65536)).Decode(&v) != nil || v.Code != 0 || v.Data.ID < 1 {
		return 0, errors.New("请重新登录 FastAiApi")
	}
	return v.Data.ID, nil
}
func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	reply(w, status, map[string]any{"code": status, "message": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 5*1024*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return errors.New("invalid body")
	}
	return nil
}
func (s *Server) authorized(r *http.Request) bool {
	c, e := r.Cookie("fast_feedback_admin")
	if e != nil {
		return false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	expiry, ok := s.sessions[c.Value]
	return ok && expiry.After(time.Now())
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 独立管理前缀可与官方平台 /admin 共存，不加入普通客户端导航。
	if r.URL.Path == "/feedback-admin" || strings.HasPrefix(r.URL.Path, "/feedback-admin/") {
		r = r.Clone(r.Context())
		u := *r.URL
		u.Path = "/admin" + strings.TrimPrefix(r.URL.Path, "/feedback-admin")
		r.URL = &u
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	if r.URL.Path == "/healthz" && r.Method == "GET" {
		reply(w, 200, map[string]bool{"ok": true})
		return
	}
	if r.URL.Path == "/fastaiapi/api/feedback" && r.Method == "POST" {
		s.submit(w, r)
		return
	}
	if r.URL.Path == "/admin" && r.Method == "GET" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(adminHTML)
		return
	}
	if (r.URL.Path == "/admin.js" || r.URL.Path == "/admin/admin.js") && r.Method == "GET" {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Write(adminJS)
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/admin/api/") {
		http.NotFound(w, r)
		return
	}
	// 自定义请求头 + 同源校验，禁止跨站表单或跨站脚本发起后台写操作。
	if r.Method != "GET" {
		origin := r.Header.Get("Origin")
		u, e := url.Parse(origin)
		if r.Header.Get("X-Feedback-Admin") != "1" || (origin != "" && (e != nil || u.Host != r.Host)) {
			fail(w, 403, "请求来源无效")
			return
		}
	}
	if r.URL.Path == "/admin/api/login" && r.Method == "POST" {
		s.login(w, r)
		return
	}
	if !s.authorized(r) {
		fail(w, 401, "请先登录管理员账号")
		return
	}
	switch {
	case r.URL.Path == "/admin/api/logout" && r.Method == "POST":
		c, _ := r.Cookie("fast_feedback_admin")
		s.mu.Lock()
		delete(s.sessions, c.Value)
		s.mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: "fast_feedback_admin", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
		reply(w, 200, map[string]bool{"ok": true})
	case r.URL.Path == "/admin/api/feedback" && r.Method == "GET":
		reply(w, 200, s.Store.List())
	case strings.HasPrefix(r.URL.Path, "/admin/api/feedback/") && r.Method == "GET":
		record, ok := s.Store.Get(strings.TrimPrefix(r.URL.Path, "/admin/api/feedback/"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		reply(w, 200, record)
	case r.URL.Path == "/admin/api/config" && r.Method == "GET":
		s.mu.Lock()
		configured := s.config.Webhook != ""
		s.mu.Unlock()
		reply(w, 200, map[string]bool{"configured": configured})
	case r.URL.Path == "/admin/api/config" && r.Method == "POST":
		var c Config
		if decode(w, r, &c) != nil {
			fail(w, 400, "配置格式无效")
			return
		}
		if e := validConfig(c); e != nil {
			fail(w, 400, e.Error())
			return
		}
		s.mu.Lock()
		e := atomicJSON(filepath.Join(s.dir, "lark.json"), c)
		if e == nil {
			s.config = c
		}
		s.mu.Unlock()
		if e != nil {
			fail(w, 500, "配置保存失败")
			return
		}
		reply(w, 200, map[string]bool{"ok": true})
	case r.URL.Path == "/admin/api/test" && r.Method == "POST":
		s.mu.Lock()
		c := s.config
		s.mu.Unlock()
		if c.Webhook == "" {
			fail(w, 400, "请先配置通知")
			return
		}
		notifier := feedback.Service{Webhook: c.Webhook, Secret: c.Secret, Client: s.Client}
		e := notifier.Notify(r.Context(), 0, feedback.Input{RequestID: "notification-test", Category: "系统测试", Title: "反馈通知连接测试", Content: "FastAiApi 反馈后台通知通道已连接。", Contact: "管理员"})
		if e != nil {
			fail(w, 502, e.Error())
			return
		}
		reply(w, 200, map[string]bool{"ok": true})
	default:
		http.NotFound(w, r)
	}
}
func (s *Server) submit(w http.ResponseWriter, r *http.Request) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") || len(auth) > 16384 {
		fail(w, 401, "请先登录 FastAiApi")
		return
	}
	uid, e := s.Verify(r.Context(), strings.TrimPrefix(auth, "Bearer "))
	if e != nil {
		fail(w, 401, e.Error())
		return
	}
	var v feedback.Input
	if decode(w, r, &v) != nil {
		fail(w, 400, "反馈格式无效或截图过大")
		return
	}
	if e = feedback.Validate(&v); e != nil {
		fail(w, 400, e.Error())
		return
	}
	id, e := s.Store.Submit(uid, v)
	if e != nil {
		if errors.Is(e, feedback.ErrRateLimit) {
			fail(w, 429, e.Error())
		} else {
			fail(w, 500, "反馈保存失败，请重试")
		}
		return
	}
	reply(w, 200, map[string]any{"code": 0, "data": map[string]string{"id": id}})
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	now := time.Now()
	recent := []time.Time{}
	for _, t := range s.failures["login"] {
		if now.Sub(t) < time.Minute {
			recent = append(recent, t)
		}
	}
	s.failures["login"] = append(recent, now)
	s.mu.Unlock()
	if len(recent) >= 10 {
		fail(w, 429, "登录过于频繁，请稍后重试")
		return
	}
	var v struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if decode(w, r, &v) != nil {
		fail(w, 400, "登录信息无效")
		return
	}
	hash := sha256.Sum256([]byte(v.Password))
	if v.Username != "admin" || subtle.ConstantTimeCompare(hash[:], s.password[:]) != 1 {
		fail(w, 401, "账号或密码错误")
		return
	}
	token := randomToken()
	s.mu.Lock()
	for k, t := range s.sessions {
		if t.Before(now) {
			delete(s.sessions, k)
		}
	}
	s.sessions[token] = now.Add(8 * time.Hour)
	s.mu.Unlock()
	secure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{Name: "fast_feedback_admin", Value: token, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteStrictMode, MaxAge: 28800})
	reply(w, 200, map[string]bool{"ok": true})
}
func (s *Server) Run(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			c := s.config
			s.mu.Unlock()
			if c.Webhook == "" {
				continue
			}
			r, ok := s.Store.Pending()
			if !ok {
				continue
			}
			n := feedback.Service{Webhook: c.Webhook, Secret: c.Secret, Client: s.Client}
			err := n.Notify(ctx, r.UserID, r.Input)
			_ = s.Store.Delivered(r, err)
		}
	}
}
