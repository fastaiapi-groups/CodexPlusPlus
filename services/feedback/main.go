package main

import (
	"context"
	"fastaiapi/feedback/internal/server"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:6099", "监听地址")
	state := flag.String("state", "", "持久数据目录（必填）")
	flag.Parse()
	if *state == "" {
		log.Fatal("请使用 -state 指定私有数据目录")
	}
	s, e := server.New(*state)
	if e != nil {
		log.Fatal("反馈服务初始化失败：", e)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	go s.Run(ctx)
	h := &http.Server{Addr: *listen, Handler: s, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32768}
	go func() {
		<-ctx.Done()
		stop, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = h.Shutdown(stop)
	}()
	log.Printf("反馈后台：http://%s/admin；管理员账号：admin；密码文件：%s", *listen, filepath.Join(*state, "admin-password"))
	if e = h.ListenAndServe(); e != nil && e != http.ErrServerClosed {
		log.Fatal(e)
	}
}
