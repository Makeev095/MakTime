# MakTime — Деплой на Timeweb

## Важно: какой тариф нужен

MakTime — это **Node.js-сервер** с WebSocket (Socket.IO) для реального времени. На **обычном виртуальном хостинге Timeweb** (где есть только файловый менеджер) такое приложение **запустить нельзя** — там можно размещать только PHP-сайты и статику, а Node.js запрещено запускать как сервер.

Для MakTime нужен **Timeweb Cloud** (облачный сервер / VPS). Это полноценный виртуальный сервер с SSH, где можно запускать что угодно.

**Минимальный тариф**: Cloud MSK 15 — **~477 ₽/мес** (1 CPU, 1 ГБ RAM, 15 ГБ NVMe). Для мессенджера хватит с запасом.

Ссылка: https://timeweb.cloud/services/cloud-servers

---

## Пошаговая инструкция

### Шаг 1. Создать облачный сервер

1. Зарегистрируйтесь на https://timeweb.cloud
2. Перейдите в **Облачные серверы** → **Создать**
3. Выберите:
   - **ОС**: Ubuntu 22.04 или 24.04
   - **Тариф**: Cloud MSK 15 (или выше)
   - **Регион**: Москва (или ближайший)
4. Задайте **пароль root** или загрузите SSH-ключ
5. Нажмите **Создать**

Через 1-2 минуты сервер будет готов. Запишите **IP-адрес** из панели управления.

---

### Шаг 2. Подключиться к серверу

На вашем компьютере откройте терминал:

```bash
ssh root@ВАШ_IP_АДРЕС
```

Введите пароль, который задали при создании.

**Если у вас Windows** — используйте PowerShell, CMD, или скачайте [PuTTY](https://www.putty.org/).

---

### Шаг 3. Установить всё необходимое

Выполните эти команды по очереди:

```bash
# Обновить систему
apt update && apt upgrade -y

# Установить Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Установить Nginx
apt install -y nginx

# Установить PM2 (менеджер процессов)
npm install -g pm2

# Установить Git
apt install -y git

# Проверить
node -v   # должно быть v20.x.x
npm -v
nginx -v
pm2 -v
```

---

### Шаг 4. Загрузить проект

**Вариант А — через Git (рекомендуется):**

Если проект на GitHub/GitLab:
```bash
cd /opt
git clone https://github.com/ВАШЕ_ИМЯ/maktime.git maktime
cd /opt/maktime
```

**Вариант Б — через SCP (с вашего компьютера):**

На ВАШЕМ компьютере (не на сервере) выполните:
```bash
scp -r /Users/makey/Desktop/Проекты/MakTime/ root@ВАШ_IP:/opt/maktime
```

Потом на сервере:
```bash
cd /opt/maktime
```

**Вариант В — через файловый менеджер Timeweb:**

1. В панели Timeweb Cloud нажмите на сервер → **Файловый менеджер**
2. Перейдите в `/opt/`
3. Создайте папку `maktime`
4. Загрузите **ZIP-архив** всего проекта (без `node_modules`!)
5. Распакуйте через терминал:
```bash
cd /opt/maktime
unzip maktime.zip
```

---

### Шаг 5. Создать файл .env

```bash
cd /opt/maktime

# Сгенерировать секретный ключ
openssl rand -hex 32
# Скопируйте результат

# Создать .env
nano .env
```

Вставьте:
```env
JWT_SECRET=ВСТАВЬТЕ_СЮДА_СГЕНЕРИРОВАННЫЙ_КЛЮЧ
PORT=3001
NODE_ENV=production
```

Сохранить: `Ctrl+O` → `Enter` → `Ctrl+X`

---

### Шаг 6. Собрать проект

```bash
cd /opt/maktime

# Собрать клиент
cd client
npm ci
npm run build
cd ..

# Собрать сервер
cd server
npm ci
npx tsc
cd ..
```

Если ошибка при `npm ci` в server (нужен C++ компилятор для SQLite):
```bash
apt install -y build-essential python3
cd /opt/maktime/server
npm ci
npx tsc
```

---

### Шаг 7. Запустить приложение

```bash
cd /opt/maktime/server

# Запустить через PM2
JWT_SECRET="ваш-ключ-из-env" PORT=3001 NODE_ENV=production \
  pm2 start dist/index.js --name maktime

# Проверить что работает
pm2 status
curl http://localhost:3001   # должен вернуть HTML

# Сохранить для автозапуска
pm2 save
pm2 startup
# PM2 выведет команду — скопируйте и выполните её
```

---

### Шаг 8. Настроить Nginx

```bash
nano /etc/nginx/sites-available/maktime
```

Вставьте (замените `ВАШ_ДОМЕН` на домен или `_` если без домена):

```nginx
server {
    listen 80;
    server_name ВАШ_ДОМЕН;

    client_max_body_size 50M;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:3001;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

Сохранить: `Ctrl+O` → `Enter` → `Ctrl+X`

Активировать:
```bash
ln -s /etc/nginx/sites-available/maktime /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

---

### Шаг 9. Проверить

Откройте в браузере:
```
http://ВАШ_IP_АДРЕС
```

Должна открыться страница входа MakTime.

---

### Шаг 10. Привязать домен (необязательно)

1. В панели Timeweb Cloud → **Домены** → купите или привяжите домен
2. Настройте DNS: добавьте **A-запись** с IP вашего сервера
3. В файле `/etc/nginx/sites-available/maktime` замените `server_name` на ваш домен
4. Перезагрузите Nginx:
```bash
nginx -t && systemctl reload nginx
```

---

### Шаг 11. Установить SSL (HTTPS)

Это обязательно для видеозвонков (WebRTC требует HTTPS)!

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.com
```

Certbot всё сделает автоматически. Автопродление уже включено.

---

## Как обновить приложение

```bash
cd /opt/maktime
git pull                              # если используете Git

cd client && npm ci && npm run build && cd ..
cd server && npm ci && npx tsc && cd ..

pm2 restart maktime
```

---

## Полезные команды

```bash
pm2 status              # Статус приложения
pm2 logs maktime        # Логи в реальном времени
pm2 restart maktime     # Перезапуск
pm2 stop maktime        # Остановить
pm2 monit               # Мониторинг CPU/RAM

systemctl status nginx  # Статус Nginx
nginx -t                # Проверить конфиг Nginx
systemctl reload nginx  # Перезагрузить Nginx
```

---

## Если что-то не работает

**Приложение не запускается:**
```bash
pm2 logs maktime --lines 50    # Посмотреть ошибки
```

**Сайт не открывается в браузере:**
```bash
# Проверить что приложение работает
curl http://localhost:3001

# Проверить Nginx
nginx -t
systemctl status nginx

# Проверить firewall (открыть порты)
ufw allow 80
ufw allow 443
ufw allow 22
ufw enable
```

**Видеозвонки не работают:**
- WebRTC требует HTTPS — установите SSL-сертификат (шаг 11)
- Если за NAT — может потребоваться TURN-сервер (для базового использования не нужен)

---

## Стоимость

| Тариф | CPU | RAM | Диск | Цена |
|---|---|---|---|---|
| Cloud MSK 15 | 1 ядро | 1 ГБ | 15 ГБ | ~477 ₽/мес |
| Cloud MSK 30 | 1 ядро | 2 ГБ | 30 ГБ | ~657 ₽/мес |

Для мессенджера до ~100 пользователей хватит минимального тарифа.
