FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libudev1 \
    libuuid1 \
    libx11-6 \
    libx11-xcb1 \
    libxcb-dri3-0 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxkbcommon0 \
    libxrandr2 \
    libxrender1 \
    libxshmfence1 \
    libxss1 \
    libxtst6

RUN npm config -g set registry=https://registry.npmmirror.com
RUN npm i -g pm2
RUN pm2 install pm2-logrotate

RUN pm2 set pm2-logrotate:max_size 100G && \
    pm2 set pm2-logrotate:retain 365 && \
    pm2 set pm2-logrotate:dateFormat YYYY-MM-DD

VOLUME /app
WORKDIR /app

CMD ["npm", "run", "start"]
