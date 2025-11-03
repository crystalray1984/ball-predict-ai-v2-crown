FROM node:22-bookworm

RUN apt-get update && \
    apt-get upgrade -y

RUN npm i -g pm2
RUN pm2 install pm2-logrotate

RUN pm2 set pm2-logrotate:max_size 100G && \
    pm2 set pm2-logrotate:retain 365 && \
    pm2 set pm2-logrotate:dateFormat YYYY-MM-DD

VOLUME /app
WORKDIR /app

CMD ["npm", "run", "start"]
