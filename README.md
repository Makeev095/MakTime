# MakTime — Мессенджер с видеозвонками

PWA-мессенджер с реальным временем: чаты, видеозвонки (WebRTC), голосовые сообщения, истории, отправка файлов.

## Стек

- **Frontend**: React 18, TypeScript, Vite, Socket.IO Client, Lucide React
- **Backend**: Node.js, Express, Socket.IO, SQLite (better-sqlite3), JWT, bcrypt
- **Видеозвонки**: WebRTC
- **Деплой**: Docker + Nginx

## Возможности

- Регистрация и авторизация (JWT, сессия сохраняется)
- Поиск пользователей, контакты
- Чаты в реальном времени (текст, голосовые, фото, видео, файлы)
- Ответ на сообщения, удаление
- Видеозвонки с фильтрами и переключением камеры
- Истории (24ч) с реакциями и ответами
- Индикатор набора текста, статус онлайн
- Tab-бар: Все / Непрочитанные / Контакты
- PWA — установка на телефон

---

## Быстрый старт (разработка)

```bash
# 1. Клонировать
git clone <repo-url> && cd MakTime

# 2. Установить зависимости
cd server && npm install && cd ../client && npm install && cd ..

# 3. Запустить (два терминала)
cd server && npm run dev     # Бэкенд → localhost:3001
cd client && npm run dev     # Фронтенд → localhost:5173
```

Открыть http://localhost:5173

---

## Деплой

### Вариант 1: Docker (рекомендуется)

**Требования**: Docker и Docker Compose на сервере.

```bash
# 1. Загрузить проект на сервер
scp -r MakTime/ user@your-server:/opt/maktime
# или git clone

# 2. Подключиться к серверу
ssh user@your-server
cd /opt/maktime

# 3. Создать .env
cp .env.example .env
nano .env
# Обязательно: задать JWT_SECRET (см. ниже)

# 4. Собрать и запустить
docker compose up -d --build

# 5. Проверить
docker compose logs -f maktime
curl http://localhost
```

Приложение доступно на порту 80 (Nginx проксирует на 3001).

**Обновление:**
```bash
git pull
docker compose up -d --build
```

**SSL (HTTPS):**
1. Получить сертификат (Let's Encrypt):
```bash
apt install certbot
certbot certonly --standalone -d your-domain.com
```
2. В `nginx.conf` раскомментировать блок SSL, заменить `your-domain.com`
3. В `docker-compose.yml` раскомментировать volume для SSL:
```yaml
- /etc/letsencrypt/live/your-domain.com:/etc/nginx/ssl:ro
```
4. Перезапустить: `docker compose up -d`

---

### Вариант 2: Без Docker (VPS)

**Требования**: Node.js 20+, Nginx.

```bash
# 1. Установить Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Загрузить проект
cd /opt
git clone <repo-url> maktime && cd maktime

# 3. Создать .env
cp .env.example .env
nano .env

# 4. Собрать клиент
cd client && npm ci && npm run build && cd ..

# 5. Собрать и запустить сервер
cd server && npm ci && npx tsc && cd ..

# 6. Запустить через PM2
npm install -g pm2
cd server
NODE_ENV=production JWT_SECRET="ваш-секрет" pm2 start dist/index.js --name maktime
pm2 save && pm2 startup
```

**Nginx (файл `/etc/nginx/sites-available/maktime`):**
```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 50M;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/maktime /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**SSL:**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## Файл .env

Создайте файл `.env` в корне проекта:

```env
# ОБЯЗАТЕЛЬНО — секретный ключ для JWT (сгенерируйте случайный)
# Команда: openssl rand -hex 32
JWT_SECRET=тут-ваш-случайный-ключ-64-символа

# Порт (менять не нужно, если используете Docker)
PORT=3001

# Окружение
NODE_ENV=production
```

**Как сгенерировать JWT_SECRET:**
```bash
openssl rand -hex 32
# Пример результата: a1b2c3d4e5f6...
```

---

## .gitignore

Уже создан. Исключает:
- `node_modules/` — зависимости
- `server/data/` — база данных SQLite
- `server/uploads/` — загруженные файлы
- `client/dist/`, `server/dist/` — сборки
- `.env` — секреты
- `.DS_Store`, IDE-файлы

---

## Структура

```
MakTime/
├── client/          # React-приложение
│   ├── src/
│   │   ├── components/    # UI-компоненты
│   │   ├── context/       # Auth и Socket контексты
│   │   ├── types.ts       # TypeScript-типы
│   │   ├── App.tsx        # Главный компонент
│   │   └── index.css      # Стили
│   └── vite.config.ts
├── server/          # Express-сервер
│   └── src/
│       └── index.ts       # Сервер, API, Socket.IO, БД
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── .env.example
└── .gitignore
```
