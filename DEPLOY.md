# 🚀 Hướng Dẫn Deploy Video Planner

## Cách 1: Render.com (MIỄN PHÍ)

### Bước 1: Tạo GitHub repo
1. Vào [github.com](https://github.com) → **New repository** → đặt tên `video-planner`
2. Đẩy code lên:
```bash
cd video-planner
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/video-planner.git
git push -u origin main
```

### Bước 2: Deploy trên Render.com
1. Vào [render.com](https://render.com) → **Sign up** (dùng GitHub)
2. Click **New** → **Web Service**
3. Chọn repo `video-planner`
4. Cấu hình:
   - **Name**: `video-planner`
   - **Runtime**: `Docker`
   - **Plan**: `Free`
5. Thêm **Environment Variable**:
   - Key: `GEMINI_API_KEY`
   - Value: `your_api_key_here`
6. Click **Create Web Service**

### Xong!
- URL sẽ là: `https://video-planner.onrender.com`
- Chia sẻ URL này cho nhân viên

### Lưu ý Render Free:
- Tự tắt sau 15 phút không dùng → khởi động lại mất ~30s
- RAM 512MB (đủ cho tool này)
- Muốn nhanh hơn: nâng lên Starter ($7/tháng)

---

## Cách 2: VPS + Tên miền (CHUYÊN NGHIỆP)

### Hosting gợi ý:
| Nhà cung cấp | Giá/tháng | RAM | Ghi chú |
|---|---|---|---|
| **DigitalOcean** | $4-6 | 512MB-1GB | Phổ biến nhất |
| **Vultr** | $3.5-6 | 512MB-1GB | Rẻ |
| **Hetzner** | €3.5 | 2GB | Giá tốt nhất |
| **Google Cloud Run** | $0-5 | Tự scale | Tính theo request |

### Bước 1: Mua VPS
Chọn 1 nhà cung cấp, mua VPS Ubuntu 22.04

### Bước 2: Cài đặt trên VPS
```bash
# SSH vào VPS
ssh root@your-vps-ip

# Cài Docker
curl -fsSL https://get.docker.com | sh

# Clone code
git clone https://github.com/YOUR_USERNAME/video-planner.git
cd video-planner

# Tạo .env
echo "GEMINI_API_KEY=your_key_here" > .env

# Build & chạy
docker build -t video-planner .
docker run -d -p 80:3000 --env-file .env --name video-planner video-planner
```

### Bước 3: Trỏ tên miền
1. Mua domain (Namecheap, GoDaddy, hoặc Tên Miền Việt Nam)
2. Vào DNS → thêm record `A` → trỏ về IP VPS
3. (Optional) Cài SSL miễn phí với Certbot

### Xong!
- Nhân viên truy cập: `https://yourdomain.com`

---

## Cách 3: Chạy trên mạng nội bộ (0 ĐỒNG)

Máy bạn chạy server, nhân viên cùng WiFi truy cập:

```bash
# Tìm IP máy bạn (Windows)
ipconfig

# Nhân viên truy cập
http://192.168.x.x:3000
```
