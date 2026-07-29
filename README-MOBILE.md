# MakTalk — iOS + Android из текущего PWA

Этот проект уже подготовлен под нативные оболочки через Capacitor:

- `client/android` — Android Studio проект
- `client/ios` — Xcode проект
- мобильные окружения:
  - `production` -> `https://maktalk.ru`
  - `staging` -> `https://staging.maktalk.ru`

> Важно: так как приложение загружает веб-часть с `https://maktalk.ru`, большинство UI/функциональных правок на сервере подтягиваются в установленные iOS/Android приложения автоматически (без переустановки). Пересборка нужна только при изменениях нативного кода/плагинов.

## Что уже настроено

- Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`)
- генерация брендовых иконок и splash (`@capacitor/assets`)
- скрипты сборки/синхронизации в `client/package.json`
- права для звонков и медиа:
  - Android: `CAMERA`, `RECORD_AUDIO`, `INTERNET`
  - iOS: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryUsageDescription`
- Android release-подпись через `client/android/keystore.properties`

---

## Быстрый старт (актуальная ветка)

Если `git pull` ругается на локальные правки iOS (`project.pbxproj` / `Info.plist`):

```bash
cd ~/MakTime
git fetch origin
git checkout cursor/fix-chat-layout-calls-22a7
# сохранить локальные Xcode-правки и подтянуть сервер
git stash push -u -m "local-ios" -- client/ios/App/App.xcodeproj/project.pbxproj client/ios/App/App/Info.plist
git pull origin cursor/fix-chat-layout-calls-22a7
# если свои правки ещё нужны: git stash pop
# обычно для MakTalk достаточно серверной версии:
# git stash drop
cd client
npm install
npm run mobile:sync:prod
npm run mobile:ios:open
```

Если локальный `~/MakTime` устарел и нет скрипта `mobile:sync:prod`:

```bash
cd ~/MakTime
git fetch origin
git checkout cursor/fix-chat-layout-calls-22a7
git pull origin cursor/fix-chat-layout-calls-22a7
cd client
npm install
npm run mobile:sync:prod
npm run mobile:ios:open
```

### Push Notifications в Xcode

**Сейчас пуши на iOS отключены**, чтобы сборка работала на **бесплатном Personal Team**.

Если позже будет платный [Apple Developer Program](https://developer.apple.com/programs/):
1. Верни `aps-environment` в `App/App.entitlements`
2. Включи `IOS_PUSH_ENABLED = true` в `client/src/hooks/useNativePushRegistration.ts`
3. Xcode → App → Signing & Capabilities → Team = платный → **+ Capability → Push Notifications**
4. В Info.plist можно снова добавить `remote-notification` / `voip` в `UIBackgroundModes`

Логи `AppleAVD`, `xpc_user_sessions`, `AudioSession::beginInterruption` — системный шум iOS, на чат не влияют.

---

## Быстрый старт

```bash
cd client
npm install
npm run mobile:prepare:prod
```

Команда `mobile:prepare:prod`:
1. генерирует иконки/splash (`mobile:assets`)
2. собирает веб-часть (`vite build`)
3. копирует и синхронизирует ассеты в `android/` и `ios/`

---

## Бренд-иконка и splash

Исходники бренда:

- `client/assets/logo.svg`
- `client/assets/logo-dark.svg`

Перегенерировать ассеты:

```bash
cd client
npm run mobile:assets
```

После изменения логотипа/цветов синхронизируй платформы:

```bash
cd client
npm run mobile:sync:prod
```

---

## Окружения production/staging

Готовые команды:

```bash
cd client
npm run mobile:sync:prod
npm run mobile:sync:staging
```

Android debug сразу под staging:

```bash
cd client
npm run mobile:android:debug:staging
```

Полностью кастомный URL:

```bash
cd client
CAP_SERVER_URL=https://custom.example.com npm run mobile:sync
```

Приоритет выбора URL:
1. `CAP_SERVER_URL`
2. `CAP_ENV` (`production|staging`)
3. production fallback (`https://maktalk.ru`)

---

## Push-уведомления (сообщения и звонки офлайн)

В приложении уже есть регистрация нативных push-токенов:

- iOS -> `/api/devices/apns-token`
- Android -> `/api/devices/fcm-token`

Чтобы пуши реально приходили при закрытом приложении, на сервере должны быть заполнены переменные:

- APNS: `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`
- FCM: `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`

Для Android также добавь `google-services.json` в:

`client/android/app/google-services.json`

После добавления файла/переменных пересобери приложение:

```bash
cd client
npm run mobile:sync:prod
```

---

## Android (установка напрямую APK, без Google Play)

Самый надёжный способ установить «ту же» версию с `maktalk.ru` — **debug APK** (подписывается debug-ключом Android SDK, ставится почти всегда).

### 1) Debug APK (рекомендуется для теста)

На Mac:

```bash
cd ~/MakTime
git pull origin cursor/fix-chat-layout-calls-22a7
cd client
npm install
npm run mobile:android:debug
```

Готовый файл:

`client/android/app/build/outputs/apk/debug/app-debug.apk`

Скопируй APK на телефон (AirDrop / Telegram / кабель) и открой.

Если Android пишет «не установлено» / конфликт подписи:
1. Удали старое MakTalk с телефона
2. Настройки → безопасность → разреши установку из этого источника (файлы / Chrome)
3. Установи APK снова

Если Android пишет «приложение остановлено» / «обратитесь к разработчику» без текста ошибки — это системный диалог краша (детали в logcat, не на экране). Обычно помогает:

1. `git pull` актуальной ветки
2. Удалить старое MakTalk
3. Пересобрать debug APK: `npm run mobile:android:debug`
4. Установить заново

С Mac/ПК через USB посмотреть реальную ошибку:

```bash
adb logcat -d | grep -iE 'AndroidRuntime|FATAL|ru.maktalk'
```

Через USB (опционально):

```bash
adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk
```

### 2) Release APK (подписанный)

1) Создать keystore (один раз):

```bash
cd client/android
keytool -genkeypair -v -keystore release-keystore.jks -alias maktalk -keyalg RSA -keysize 2048 -validity 10000
```

2) Подготовить `keystore.properties`:

```bash
cd client/android
cp keystore.properties.example keystore.properties
```

3) Заполнить:

```properties
storeFile=release-keystore.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=maktalk
keyPassword=YOUR_KEY_PASSWORD
```

4) Собрать подписанный релиз:

```bash
cd client
npm run mobile:android:release
```

Файл:

`client/android/app/build/outputs/apk/release/app-release.apk`

> Debug и Release подписаны разными ключами — их нельзя обновлять друг поверх друга. Перед сменой типа APK удали старое приложение.

### Открыть Android Studio проект

```bash
cd client
npm run mobile:android:open
```

### Установка на устройство

Через ADB:

```bash
adb install -r client/android/app/build/outputs/apk/debug/app-debug.apk
```

Или вручную отправить APK на телефон и разрешить установку из неизвестного источника.

---

## iOS (бесплатный Apple ID, продление каждые 7 дней)

> Для iOS нужен Mac с Xcode.

### 1) Открыть iOS проект

```bash
cd client
npm run mobile:sync:prod
npm run mobile:ios:open
```

### 2) Подписать в Xcode

1. Открой target `App`.
2. `Signing & Capabilities` -> выбери свой `Team` (личный Apple ID).
3. Подключи iPhone кабелем.
4. `Product -> Run` (или кнопка Play) для установки.

После установки на iPhone:

`Настройки -> Основные -> VPN и управление устройством -> Доверять профилю разработчика`

### 3) Продление каждые 7 дней

Для бесплатного Apple ID сертификат живет 7 дней.  
Раз в неделю повторяй:

1. подключить iPhone к Mac
2. открыть проект в Xcode
3. снова `Product -> Run`

---

## IPA установка с компьютера (Sideloadly, 7 дней)

1. собери/экспортируй IPA из Xcode (Development)
2. открой Sideloadly
3. выбери IPA, Apple ID и устройство
4. нажми Install

Подпись тоже живет 7 дней, затем нужно переустановить/переподписать.

---

## Безопасность release-ключей

- Не коммить `client/android/keystore.properties` и `*.jks` в git.
- Сделай резервную копию keystore в безопасном месте (например, encrypted vault).
- Потеря keystore = невозможность обновлять уже установленное Android-приложение тем же package id.

