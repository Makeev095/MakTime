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

**Важно:** пункта **Push Notifications** в `+ Capability` **нет**, если аккаунт — бесплатный Personal Team.
Push работает только с платным [Apple Developer Program](https://developer.apple.com/programs/) (~$99/год).

Без платного аккаунта:
- чат и звонки работают, пока приложение открыто / онлайн;
- офлайн-пуши на iPhone недоступны — это ограничение Apple, не баг MakTalk.

С платным аккаунтом:

1. Xcode → target **App** → **Signing & Capabilities**
2. Team = ваш **Organization / Paid** team (не Personal Team)
3. **+ Capability** → **Push Notifications** (после смены Team пункт появляется)
4. Либо открой `App/App.entitlements` — там уже есть `aps-environment = development`
5. На [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list) у App ID `ru.maktalk.app` включи Push Notifications
6. Product → Clean Build Folder → Run на устройстве

Логи `AppleAVD`, `xpc_user_sessions`, `AudioSession::beginInterruption`, Auto Layout keyboard — системный шум iOS/симулятора, на работу чата не влияют.

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

### Debug APK

```bash
cd client
npm run mobile:android:debug
```

Файл:

`client/android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (подписанный)

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

