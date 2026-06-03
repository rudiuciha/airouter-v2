#!/bin/bash
set -e
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log(){ echo -e "${CYAN}[AIRouter]${NC} $1"; }; ok(){ echo -e "${GREEN}✓${NC} $1"; }; warn(){ echo -e "${YELLOW}⚠${NC} $1"; }; err(){ echo -e "${RED}✗${NC} $1"; exit 1; }

echo -e "\n${CYAN}⚡ AIRouter v2 Installer${NC}\n────────────────────────────────"

# Node.js
if ! command -v node &>/dev/null; then
  log "Installing Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 18 ] && err "Node.js 18+ required"
ok "Node.js $(node -v)"

npm install --production && ok "Dependencies installed"

if [ ! -f .env ]; then
  cp .env.example .env
  JWT=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i "s/change-this-to-a-long-random-string/$JWT/" .env
  read -p "  Dashboard password (default: admin123): " PASS
  [ -n "$PASS" ] && sed -i "s/admin123/$PASS/" .env
  ok ".env created"
  warn "Add your free API keys → nano .env"
else
  ok ".env exists"
fi

mkdir -p data
! command -v pm2 &>/dev/null && { log "Installing PM2…"; sudo npm install -g pm2; }
ok "PM2 ready"

pm2 start ecosystem.config.js 2>/dev/null || pm2 restart airouter
pm2 save

# Nginx
read -p "  Setup Nginx? [y/N]: " NG
if [[ "$NG" =~ ^[Yy]$ ]]; then
  ! command -v nginx &>/dev/null && sudo apt-get install -y nginx
  read -p "  Domain (e.g. router.example.com): " DOM
  sudo cp nginx.conf /etc/nginx/sites-available/airouter
  sudo sed -i "s/router.yourdomain.com/$DOM/g" /etc/nginx/sites-available/airouter
  sudo ln -sf /etc/nginx/sites-available/airouter /etc/nginx/sites-enabled/airouter
  sudo nginx -t && sudo systemctl reload nginx && ok "Nginx → $DOM"
  read -p "  SSL with Certbot? [y/N]: " SSL
  [[ "$SSL" =~ ^[Yy]$ ]] && { sudo apt-get install -y certbot python3-certbot-nginx; sudo certbot --nginx -d "$DOM"; ok "SSL installed"; }
fi

pm2 startup 2>/dev/null | tail -1 | bash 2>/dev/null || true
pm2 save

PORT=$(grep "^PORT=" .env 2>/dev/null | cut -d= -f2 || echo 20128)
IP=$(hostname -I | awk '{print $1}')
echo -e "\n${GREEN}────────────────────────────────${NC}"
echo -e "${GREEN}✓ AIRouter running!${NC}"
echo -e "  Dashboard : ${CYAN}http://${IP}:${PORT}${NC}"
echo -e "  Proxy     : ${CYAN}http://${IP}:${PORT}/v1${NC}"
echo -e "\n  Free API keys to add (nano .env):"
echo -e "  • Groq      : ${YELLOW}https://console.groq.com${NC}"
echo -e "  • Gemini    : ${YELLOW}https://aistudio.google.com${NC}"
echo -e "  • OpenRouter: ${YELLOW}https://openrouter.ai${NC}"
echo -e "  • GitHub    : ${YELLOW}https://github.com/marketplace/models${NC}"
echo -e "  • Cerebras  : ${YELLOW}https://cloud.cerebras.ai${NC}"
echo -e "${GREEN}────────────────────────────────${NC}\n"
