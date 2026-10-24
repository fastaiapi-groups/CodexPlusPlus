// 发布签名工具：私钥只留在本机或隔离的 CI 环境，不上传管理后台。
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "用法：client-release.go keygen|sign --key <私钥路径> --public <公钥路径> | --manifest <清单> --out <签名清单>")
		os.Exit(1)
	}
	flags := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	keyPath := flags.String("key", "", "私钥文件")
	publicPath := flags.String("public", "", "公钥文件")
	manifestPath := flags.String("manifest", "", "后台导出的清单")
	out := flags.String("out", "", "签名清单输出")
	must(flags.Parse(os.Args[2:]))
	if *keyPath == "" {
		must(fmt.Errorf("必须指定私钥路径"))
	}
	switch os.Args[1] {
	case "keygen":
		if *publicPath == "" {
			must(fmt.Errorf("必须指定公钥路径"))
		}
		public, private, e := ed25519.GenerateKey(rand.Reader)
		must(e)
		der, e := x509.MarshalPKCS8PrivateKey(private)
		must(e)
		must(os.MkdirAll(filepath.Dir(*keyPath), 0700))
		f, e := os.OpenFile(*keyPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		must(e)
		must(pem.Encode(f, &pem.Block{Type: "PRIVATE KEY", Bytes: der}))
		must(f.Close())
		must(os.MkdirAll(filepath.Dir(*publicPath), 0755))
		f, e = os.OpenFile(*publicPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		must(e)
		_, e = f.WriteString(base64.StdEncoding.EncodeToString(public) + "\n")
		must(e)
		must(f.Close())
		fmt.Println("签名密钥已创建，私钥未输出。")
	case "sign":
		if *manifestPath == "" || *out == "" {
			must(fmt.Errorf("必须指定 manifest 和 out"))
		}
		data, e := os.ReadFile(*manifestPath)
		must(e)
		if len(data) > 128*1024 || !json.Valid(data) {
			must(fmt.Errorf("清单格式无效"))
		}
		raw, e := os.ReadFile(*keyPath)
		must(e)
		block, _ := pem.Decode(raw)
		if block == nil {
			must(fmt.Errorf("私钥格式无效"))
		}
		parsed, e := x509.ParsePKCS8PrivateKey(block.Bytes)
		must(e)
		private, ok := parsed.(ed25519.PrivateKey)
		if !ok {
			must(fmt.Errorf("需要 Ed25519 私钥"))
		}
		env := map[string]string{"manifest_base64": base64.StdEncoding.EncodeToString(data), "signature": base64.StdEncoding.EncodeToString(ed25519.Sign(private, data)), "key_id": "fastaiapi-release-v1"}
		signed, e := json.MarshalIndent(env, "", "  ")
		must(e)
		must(os.WriteFile(*out, append(signed, '\n'), 0644))
		fmt.Println("签名清单已生成，请上传后台校验。")
	default:
		must(fmt.Errorf("未知命令"))
	}
}
