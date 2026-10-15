#!/bin/bash
cd "$(dirname "$0")" || exit 1
if bash scripts/update-local-macos.sh; then
  printf '\nGüncelleme tamamlandı. Bu pencereyi kapatabilirsin.\n'
else
  printf '\nGüncelleme tamamlanamadı. Yukarıdaki hata mesajını paylaşabilirsin.\n'
fi
read -r -p "Pencereyi kapatmak için Enter: "
