FROM node:18-slim

# Install yt-dlp + ffmpeg
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg && \
    pip3 install --break-system-packages yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm ci --production

# Copy app
COPY . .

# Create data directory
RUN mkdir -p data output

EXPOSE 3000

CMD ["node", "server.js"]
