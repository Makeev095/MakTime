# MakTime — Деплой через Docker на VPS

## Что нужно

- VPS с Ubuntu 22+ (любой провайдер: Timeweb Cloud, Selectel, Hetzner, и т.д.)
- Минимум 1 ГБ RAM, 10 ГБ диск
- Доступ по SSH (root или sudo)

---

## Шаг 1. Подключиться к серверу

```bash
ssh root@ВАШ_IP
```

---

## Шаг 2. Установить Docker

```bash
# Установка Docker
curl -fsSL https://get.docker.com | sh

# Проверить
docker --version
docker compose version
```

---

## Шаг 3. Загрузить проект на сервер

**Через Git:**
```bash
cd /opt
git clone https://github.com/ВАШЕ_ИМЯ/maktime.git maktime
cd /opt/maktime
```

**Или через SCP (с вашего компьютера):**
```bash
scp -r MakTime/ root@ВАШ_IP:/opt/maktime
```

---

## Шаг 4. Создать .env

```bash
cd /opt/maktime

# Сгенерировать секретный ключ
openssl rand -hex 32
```

Скопируйте результат и создайте файл:

```bash
nano .env
```

Вставьте:
```
JWT_SECRET=сюда_вставить_сгенерированный_ключ
PORT=3001
NODE_ENV=production
TURN_USER=maktime
TURN_PASS=MakTimeT0rn2026!
TURN_REALM=ваш-домен.com
```

Сохранить: `Ctrl+O` → Enter → `Ctrl+X`

---

## Шаг 5. Запустить

```bash
cd /opt/maktime
docker compose up -d --build
```

Первый запуск займёт 2-3 минуты (скачивание образов + сборка).

Проверить что всё запустилось:
```bash
docker compose ps
```

Должно быть три контейнера со статусом `Up`:
```
maktime        Up
maktime-nginx  Up
maktime-turn   Up
```

Посмотреть логи:
```bash
docker compose logs -f maktime
```

Должно быть: `MakTime server running on http://localhost:3001`

---

## Шаг 6. Открыть в браузере

Перейдите по адресу:

```
http://ВАШ_IP
```

Например, если IP сервера `185.22.33.44`, то открываете:

```
http://185.22.33.44
```

Вы увидите страницу входа MakTime. Зарегистрируйтесь и пользуйтесь.

---

## Шаг 7. Привязать домен (по желанию)

1. Купите домен (например, на Timeweb, REG.RU, Namecheap)
2. В DNS-настройках домена добавьте **A-запись**:
   - Тип: `A`
   - Имя: `@`
   - Значение: `ВАШ_IP`
3. В файле `nginx.conf` замените `server_name _;` на `server_name ваш-домен.com;`
4. Перезапустите:
```bash
docker compose restart nginx
```

Теперь приложение доступно по `http://ваш-домен.com`

---

## Шаг 8. Открыть порты для видеозвонков (TURN)

Для работы видеозвонков через NAT необходимо открыть UDP-порты TURN-сервера:

```bash
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49152:49252/udp
ufw reload
```

Если `ufw` не активен, включите его (убедитесь, что SSH-порт 22 открыт!):
```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 49152:49252/udp
ufw enable
```

---

## Шаг 9. Включить HTTPS (обязательно)

HTTPS нужен для видеозвонков (WebRTC работает только через HTTPS).

```bash
# Установить Certbot
apt install -y certbot

# Остановить Nginx (чтобы освободить порт 80)
docker compose stop nginx

# Получить сертификат
certbot certonly --standalone -d ваш-домен.com

# Запустить обратно
docker compose start nginx
```

Затем обновите `docker-compose.yml` — раскомментируйте строку SSL:
```bash
nano docker-compose.yml
```

В секции `nginx` → `volumes` добавьте:
```yaml
- /etc/letsencrypt/live/ваш-домен.com:/etc/nginx/ssl:ro
```

В `nginx.conf` раскомментируйте блок `listen 443 ssl` и замените `your-domain.com` на ваш домен.

Перезапустите:
```bash
docker compose up -d
```

Теперь приложение доступно по `https://ваш-домен.com`

---

## Обновление

```bash
cd /opt/maktime
git pull
docker compose up -d --build
```

---

## Полезные команды

```bash
docker compose ps                # Статус контейнеров
docker compose logs -f maktime   # Логи приложения
docker compose restart           # Перезапуск всего
docker compose down              # Остановить всё
docker compose up -d             # Запустить заново
```

---

## Итого

| Шаг | Что делаем | Время |
|-----|-----------|-------|
| 1 | SSH на сервер | 1 мин |
| 2 | Установка Docker | 2 мин |
| 3 | Загрузка проекта | 1 мин |
| 4 | Создание .env | 1 мин |
| 5 | `docker compose up -d --build` | 3 мин |
| 6 | Открыть `http://ВАШ_IP` | готово |

**Общее время: ~8 минут от чистого сервера до работающего мессенджера.**
