# MakTalk — iOS + Android из текущего PWA

Этот проект уже подготовлен под нативные оболочки через Capacitor:

- `client/android` — Android Studio проект
- `client/ios` — Xcode проект
- по умолчанию мобильные приложения открывают `https://maktalk.ru`

## Что уже настроено

- Capacitor (`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`)
- скрипты сборки/синхронизации в `client/package.json`
- права для звонков и медиа:
  - Android: `CAMERA`, `RECORD_AUDIO`, `INTERNET`
  - iOS: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryUsageDescription`

---

## Быстрый старт

```bash
cd client
npm install
npm run mobile:sync
```

Команда `mobile:sync`:
1. собирает веб-часть (`vite build`)
2. копирует и синхронизирует ассеты в `android/` и `ios/`

---

## Android (установка напрямую APK, без Google Play)

### Открыть проект в Android Studio

```bash
cd client
npm run mobile:android:open
```

### Собрать APK из терминала

```bash
cd client
npm run mobile:android:debug
```

APK будет в:

`client/android/app/build/outputs/apk/debug/app-debug.apk`

### Установить на телефон

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
npm run mobile:sync
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
Раз в неделю просто повторяй:

1. подключить iPhone к Mac
2. открыть проект в Xcode
3. снова `Product -> Run`

---

## IPA установка с компьютера (Sideloadly, 7 дней)

Если хочешь именно поток с IPA:

1. собери/экспортируй IPA из Xcode (Development)
2. открой Sideloadly
3. выбери IPA, Apple ID и устройство
4. Install

Подпись тоже живет 7 дней, затем нужно переустановить заново.  
Если Xcode не дает экспорт IPA на бесплатном аккаунте, используй вариант выше через `Product -> Run`.

---

## Смена URL для staging/другого домена

По умолчанию мобильные оболочки грузят `https://maktalk.ru`.

Для другого URL можно переопределить переменной окружения:

```bash
cd client
CAP_SERVER_URL=https://staging.maktalk.ru npm run mobile:sync
```

После этого пересобери и переустанови приложение.

