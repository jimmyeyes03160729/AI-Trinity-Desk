#!/bin/bash
# Run the web server as a macOS LaunchAgent: starts at login, restarts on
# crash. TRINITY_* variables set when installing are written into the agent.
#   scripts/macos-web-service.sh install | uninstall | restart | status | logs
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LABEL="desk.ai.trinity.web"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGS="$HOME/Library/Logs/AI Trinity Desk Web"
DOMAIN="gui/$(id -u)"
escape() { local s="${1//&/&amp;}"; s="${s//</&lt;}"; s="${s//>/&gt;}"; printf '%s' "$s"; }

case "${1:-}" in
  install)
    NODE="$(command -v node || true)"
    [ -n "$NODE" ] || { echo "找不到 node，請先安裝 Node.js 22.12 以上版本。"; exit 1; }
    [ -f "$ROOT/dist-server/server.cjs" ] || { echo "請先執行 npm run web:build。"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$LOGS"
    VARS=""
    for name in TRINITY_WEB_HOST TRINITY_WEB_PORT TRINITY_DATA_DIR TRINITY_PROJECT_ROOTS TRINITY_ALLOWED_ORIGINS TRINITY_TRUST_PROXY TRINITY_TLS_CERT TRINITY_TLS_KEY; do
      if [ -n "${!name:-}" ]; then VARS="$VARS<key>$name</key><string>$(escape "${!name}")</string>"; fi
    done
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$(escape "$NODE")</string><string>--enable-source-maps</string><string>$(escape "$ROOT/dist-server/server.cjs")</string></array>
  <key>WorkingDirectory</key><string>$(escape "$ROOT")</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$(escape "$HOME")</string><key>SHELL</key><string>$(escape "${SHELL:-/bin/zsh}")</string>$VARS</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$(escape "$LOGS/server.log")</string>
  <key>StandardErrorPath</key><string>$(escape "$LOGS/server.log")</string>
</dict></plist>
EOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "已安裝並啟動。記錄檔：$LOGS/server.log"
    echo "第一次啟動的設定碼可用以下指令查看：scripts/macos-web-service.sh logs"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"; echo "已停止並移除常駐服務。"
    ;;
  restart) launchctl kickstart -k "$DOMAIN/$LABEL"; echo "已重新啟動。" ;;
  status) launchctl print "$DOMAIN/$LABEL" | grep -E "state|pid|last exit" || echo "尚未安裝。" ;;
  logs) tail -n 60 "$LOGS/server.log" ;;
  *) echo "用法：$0 install | uninstall | restart | status | logs"; exit 1 ;;
esac
