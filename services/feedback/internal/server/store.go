package server

import (
	"encoding/json"
	"errors"
	"fastaiapi/feedback/internal/feedback"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

type Record struct {
	ID                string         `json:"id"`
	UserID            int64          `json:"user_id"`
	Input             feedback.Input `json:"input"`
	Created           time.Time      `json:"created"`
	Notified          bool           `json:"notified"`
	Attempts          int            `json:"attempts"`
	NextAttempt       time.Time      `json:"next_attempt"`
	NotificationError string         `json:"notification_error,omitempty"`
}
type Store struct {
	mu      sync.Mutex
	dir     string
	records map[string]Record
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, records: map[string]Record{}}
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil {
		return nil, err
	}
	for _, p := range files {
		b, e := os.ReadFile(p)
		if e != nil {
			return nil, e
		}
		var r Record
		if e = json.Unmarshal(b, &r); e != nil {
			return nil, e
		}
		s.records[r.ID] = r
	}
	return s, nil
}
func atomicJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".pending-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}
func (s *Store) save(r Record) error {
	if err := atomicJSON(filepath.Join(s.dir, r.ID+".json"), r); err != nil {
		return err
	}
	s.records[r.ID] = r
	return nil
}
func (s *Store) Submit(uid int64, v feedback.Input) (string, error) {
	if err := feedback.Validate(&v); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if r, ok := s.records[v.RequestID]; ok {
		if r.UserID != uid {
			return "", errors.New("反馈编号已使用")
		}
		return r.ID, nil
	}
	count := 0
	for _, r := range s.records {
		if r.UserID == uid && time.Since(r.Created) < time.Hour {
			count++
		}
	}
	if count >= 10 {
		return "", feedback.ErrRateLimit
	}
	r := Record{ID: v.RequestID, UserID: uid, Input: v, Created: time.Now()}
	return r.ID, s.save(r)
}
func (s *Store) List() []Record {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Record, 0, len(s.records))
	for _, r := range s.records {
		r.Input.Screenshots = nil
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created.After(out[j].Created) })
	return out
}
func (s *Store) Get(id string) (Record, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.records[id]
	return r, ok
}
func (s *Store) Pending() (Record, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.records {
		if !r.Notified && !r.NextAttempt.After(time.Now()) {
			return r, true
		}
	}
	return Record{}, false
}
func (s *Store) Delivered(r Record, err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r.Attempts++
	r.Notified = err == nil
	r.NextAttempt = time.Now().Add(5 * time.Minute)
	r.NotificationError = ""
	if err != nil {
		r.NotificationError = "通知失败，将自动重试"
	}
	return s.save(r)
}
