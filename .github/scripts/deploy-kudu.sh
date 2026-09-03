#!/usr/bin/env bash
#
# Deploy de um build standalone do Next.js para Azure App Service via Kudu.
#
# Usa `PUT /api/zip/` em vez de azure/webapps-deploy porque o build do Oryx quebra
# neste projeto (ver comentário no topo de main_cockpitmanutencao.yml). Antes de
# extrair, remove os artefatos que o Oryx deixa no wwwroot — sem isso o
# `node_modules` do wwwroot é um symlink para `/node_modules`, que não persiste
# entre containers e faz o app subir sem dependências.
#
# Entrada:
#   PUBLISH_PROFILE  — XML do publish profile do App Service (secret)
#   DEPLOY_ZIP       — caminho do zip (default: deploy.zip)

set -euo pipefail

ZIP="${DEPLOY_ZIP:-deploy.zip}"

[[ -n "${PUBLISH_PROFILE:-}" ]] || { echo "::error::PUBLISH_PROFILE não definido"; exit 1; }
[[ -f "$ZIP" ]] || { echo "::error::zip não encontrado: $ZIP"; exit 1; }

# O perfil MSDeploy carrega o host do SCM e as credenciais de publicação.
SCM_HOST=$(grep -oP 'publishUrl="\K[^"]+' <<<"$PUBLISH_PROFILE" | grep -m1 '\.scm\.' | sed 's/:443$//')
SCM_USER=$(grep -oP 'userName="\K[^"]+' <<<"$PUBLISH_PROFILE" | head -1)
SCM_PASS=$(grep -oP 'userPWD="\K[^"]+' <<<"$PUBLISH_PROFILE" | head -1)

[[ -n "$SCM_HOST" && -n "$SCM_USER" && -n "$SCM_PASS" ]] \
  || { echo "::error::não foi possível extrair credenciais SCM do publish profile"; exit 1; }

echo "::add-mask::$SCM_PASS"
echo "SCM host: $SCM_HOST"

kudu() {
  local method="$1" path="$2"; shift 2
  curl -sS --fail-with-body -u "$SCM_USER:$SCM_PASS" -X "$method" "https://$SCM_HOST$path" "$@"
}

# Roda um comando no container e devolve o stdout.
#
# O /api/command do Kudu não passa o comando por um shell: ele faz o próprio split
# por espaços. Então é obrigatório envolver em `sh -c "..."` — e com aspas DUPLAS,
# porque aspas simples e newlines quebram esse parsing. Consequência: o comando tem
# de ser uma única linha e não pode conter aspas duplas.
kudu_run() {
  local cmd="$1" payload response
  [[ "$cmd" != *'"'* ]] || { echo "::error::comando não pode conter aspas duplas: $cmd"; exit 1; }
  [[ "$cmd" != *$'\n'* ]] || { echo "::error::comando tem de ser uma única linha: $cmd"; exit 1; }

  payload=$(jq -cn --arg cmd "$cmd" '{command: ("sh -c \"" + $cmd + "\""), dir: "/home/site/wwwroot"}')
  response=$(kudu POST /api/command -H "Content-Type: application/json" -d "$payload")

  local exit_code err
  exit_code=$(jq -r '.ExitCode' <<<"$response")
  err=$(jq -r '.Error' <<<"$response")
  if [[ "$exit_code" != "0" ]]; then
    echo "::error::comando remoto falhou (exit $exit_code): $cmd"
    [[ -n "$err" ]] && echo "::error::$err"
    exit 1
  fi
  jq -r '.Output' <<<"$response"
}

echo "==> Removendo artefatos do Oryx e symlinks de node_modules"
kudu_run 'rm -rf node_modules _del_node_modules oryx-manifest.toml node_modules.tar.gz .next; echo cleaned'

echo "==> Extraindo build ($(du -h "$ZIP" | cut -f1)) no wwwroot"
kudu PUT /api/zip/site/wwwroot/ \
  --data-binary "@$ZIP" \
  -H "Content-Type: application/octet-stream" \
  --max-time 900 >/dev/null

# node_modules tem de ser diretório real: `test -d` passa também em symlink, `-L` separa.
echo "==> Verificando o deploy"
check=$(kudu_run 'test -f server.js && test -d .next && test ! -L node_modules && test -f node_modules/next/package.json && echo DEPLOY_VERIFIED')
[[ "$check" == *DEPLOY_VERIFIED* ]] || { echo "::error::verificação pós-deploy falhou"; exit 1; }
echo "wwwroot ok — $(kudu_run 'ls node_modules | wc -l' | tr -d '[:space:]') pacotes em node_modules"

# O /api/zip/ troca os arquivos em disco mas não recicla o processo.
# (DELETE /api/processes/0 responde 400 neste App Service; /api/app/restart devolve 202.)
echo "==> Reiniciando o container"
kudu POST /api/app/restart >/dev/null

echo "==> Aguardando o app responder"
APP_HOST="${SCM_HOST/.scm./.}"
for attempt in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$APP_HOST/api/health" || true)
  if [[ "$code" == "200" ]]; then
    echo "app no ar (HTTP 200 em /api/health na ${attempt}ª tentativa)"
    exit 0
  fi
  echo "  tentativa $attempt: HTTP ${code:-timeout}"
  sleep 10
done

echo "::error::app não respondeu 200 em /api/health após 30 tentativas"
exit 1
