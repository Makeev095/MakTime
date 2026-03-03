# MakTime — Мессенджер с видеозвонками

PWA-мессенджер: чаты в реальном времени, видеозвонки (WebRTC), голосовые сообщения, истории, отправка фото/видео/файлов.

## Стек

- **Frontend**: React 18, TypeScript, Vite, Socket.IO Client, Lucide React
- **Backend**: Node.js, Express, Socket.IO, SQLite, JWT, bcrypt
- **Видеозвонки**: WebRTC
- **Деплой**: Docker + Nginx или VPS без Docker

---

## Быстрый старт (разработка)

```bash
# Установить зависимости
cd server && npm install && cd ../client && npm install && cd ..

# Запустить (два терминала)
cd server && npm run dev       # → localhost:3001
cd client && npm run dev       # → localhost:5173
```

---

## Деплой на хостинг / VPS

### Что нужно

- VPS с Ubuntu 22+ (или любой Linux)
- Node.js 20+
- Nginx
- Доменное имя (необязательно, можно по IP)

---

### Шаг 1. Подготовить сервер

```bash
# Обновить систему
sudo apt update && sudo apt upgrade -y

# Установить Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Установить Nginx и PM2
sudo apt install -y nginx
sudo npm install -g pm2

# Проверить
node -v    # v20.x.x
npm -v
pm2 -v
nginx -v
```

---

### Шаг 2. Загрузить проект на сервер

**Вариант А — через Git:**
```bash
cd /opt
sudo git clone <ваш-repo-url> maktime
sudo chown -R $USER:$USER /opt/maktime
cd /opt/maktime
```

**Вариант Б — через SCP (со своего компьютера):**
```bash
# На ВАШЕМ компьютере:
scp -r MakTime/ user@ваш-сервер:/opt/maktime
```

---

### Шаг 3. Создать .env

```bash
cd /opt/maktime
cp .env.example .env
nano .env
```

Содержимое `.env`:
```env
JWT_SECRET=ваш-секретный-ключ
PORT=3001
NODE_ENV=production
```

Сгенерировать `JWT_SECRET`:
```bash
openssl rand -hex 32
```
Скопировать результат в `JWT_SECRET=`.

---

### Шаг 4. Собрать проект

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

---

### Шаг 5. Запустить через PM2

```bash
cd /opt/maktime/server

# Загрузить переменные из .env и запустить
pm2 start dist/index.js --name maktime --env production \
  --node-args="--env-file=../.env"

# Или если --env-file не поддерживается (Node < 20.6):
JWT_SECRET="ваш-секрет" PORT=3001 NODE_ENV=production \
  pm2 start dist/index.js --name maktime

# Сохранить для автозапуска после перезагрузки
pm2 save
pm2 startup
# PM2 выведет команду — выполните её (начинается с sudo)
```

Проверить:
```bash
pm2 status
curl http://localhost:3001    # должен вернуть HTML
```

---

### Шаг 6. Настроить Nginx

```bash
sudo nano /etc/nginx/sites-available/maktime
```

Вставить:
```nginx
server {
    listen 80;
    server_name ваш-домен.com;
    # Если без домена: server_name _;

    client_max_body_size 50M;

    # WebSocket
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

    # Всё остальное
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Кэш статики
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        proxy_pass http://127.0.0.1:3001;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

Активировать:
```bash
sudo ln -s /etc/nginx/sites-available/maktime /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Теперь приложение доступно по `http://ваш-домен.com` или `http://ip-адрес`.

---

### Шаг 7. SSL (HTTPS) — рекомендуется

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ваш-домен.com
```

Certbot автоматически настроит HTTPS. Автопродление уже включено.

---

### Обновление

```bash
cd /opt/maktime
git pull

cd client && npm ci && npm run build && cd ..
cd server && npm ci && npx tsc && cd ..

pm2 restart maktime
```

---

### Мониторинг

```bash
pm2 status          # Статус процесса
pm2 logs maktime    # Логи в реальном времени
pm2 monit           # CPU/RAM мониторинг
```

---

## Деплой через Docker (альтернатива)

```bash
cp .env.example .env
nano .env              # задать JWT_SECRET

docker compose up -d --build

# Обновление:
git pull && docker compose up -d --build
```

---

## Файл .env

| Переменная | Описание | Пример |
|---|---|---|
| `JWT_SECRET` | Секретный ключ для токенов (обязательно!) | `openssl rand -hex 32` |
| `PORT` | Порт сервера | `3001` |
| `NODE_ENV` | Окружение | `production` |

---

## .gitignore

Исключены из git:
- `node_modules/` — зависимости
- `server/maktime.db` — база данных
- `server/uploads/` — загруженные файлы пользователей
- `client/dist/`, `server/dist/` — сборки
- `.env` — секреты
- `.DS_Store`, IDE-файлы

---

## Структура проекта

```
MakTime/
├── client/              # React-приложение
│   ├── src/
│   │   ├── components/  # Sidebar, ChatWindow, VideoCall, Stories...
│   │   ├── context/     # AuthContext, SocketContext
│   │   ├── types.ts
│   │   ├── App.tsx
│   │   └── index.css
│   ├── dist/            # Сборка (после npm run build)
│   └── vite.config.ts
├── server/              # Express + Socket.IO
│   ├── src/index.ts     # Весь бэкенд
│   ├── dist/            # Сборка (после npx tsc)
│   └── uploads/         # Загруженные файлы
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── .env.example
├── .gitignore
└── README.md
```
