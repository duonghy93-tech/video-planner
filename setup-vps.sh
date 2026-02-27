#!/bin/bash
# === VIDEO PLANNER VPS SETUP ===
echo "🚀 Bắt đầu setup Video Planner..."

# 1. Update system
apt-get update -y && apt-get upgrade -y

# 2. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# 3. Install PM2
npm install -g pm2

# 4. Clone repo
cd /root
git clone https://github.com/duonghy93-tech/video-planner.git
cd video-planner

# 5. Install dependencies
npm install

# 6. Set environment variables
export GEMINI_API_KEY="your_gemini_key_here"
export NODE_ENV=production
export PORT=3000

# 7. Start with PM2
pm2 start server.js --name video-planner
pm2 save
pm2 startup

# 8. Install nginx for reverse proxy
apt-get install -y nginx
cat > /etc/nginx/sites-available/video-planner << 'EOF'
server {
    listen 80;
    server_name _;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        client_max_body_size 50M;
    }
}
EOF

ln -sf /etc/nginx/sites-available/video-planner /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "✅ SETUP XONG!"
echo "🌐 Truy cập: http://103.216.117.32"
echo "📋 PM2 status: pm2 status"
echo "📋 PM2 logs: pm2 logs"
