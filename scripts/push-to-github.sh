#!/usr/bin/env bash
set -euo pipefail

# Bu script, projeyi GitHub'daki uzak depoya gönderir.
# Varsayılan branch: main
# Kullanım: ./scripts/push-to-github.sh [branch-name]

BRANCH="${1:-main}"

# Renkli çıktı için yardımcı fonksiyon
print_info() {
  echo -e "\033[1;34m==>\033[0m $1"
}

print_success() {
  echo -e "\033[1;32m==>\033[0m $1"
}

print_error() {
  echo -e "\033[1;31m!!\033[0m $1" >&2
}

print_info "GitHub'a gönderiliyor: '$BRANCH' branch'i"

# Git deposu kontrolü
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  print_error "Bu dizin bir Git deposu değil."
  exit 1
fi

# Uzak depo kontrolü
if ! git remote get-url origin >/dev/null 2>&1; then
  print_error "'origin' uzak deposu tanımlı değil."
  print_error "Önce şu komutla ekleyin: git remote add origin <repo-url>"
  exit 1
fi

# Branch kontrolü
if ! git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  print_error "'$BRANCH' branch'i bulunamadı."
  print_error "Mevcut branch'ler:"
  git branch --list
  exit 1
fi

# Commit edilmemiş değişiklik kontrolü
if [[ -n "$(git status --porcelain)" ]]; then
  print_error "Commit edilmemiş değişiklikler var."
  git status --short
  print_error "Lütfen önce değişiklikleri commit edin."
  exit 1
fi

# Uzak depodan son durumu al (opsiyonel, sessizce dene)
if git ls-remote --heads origin "$BRANCH" >/dev/null 2>&1; then
  print_info "Uzak depodaki '$BRANCH' branch'i ile senkronize ediliyor..."
  git pull --rebase origin "$BRANCH" || {
    print_error "Pull işlemi başarısız oldu. Çakışmaları çözüp tekrar deneyin."
    exit 1
  }
fi

# Push et
print_info "Commit'ler GitHub'a yükleniyor..."
git push -u origin "$BRANCH"

print_success "Proje başarıyla GitHub'a gönderildi: origin/$BRANCH"
