#!/usr/bin/env node
/**
 * Free Apple Personal Teams cannot provision apps with Push Notifications.
 * Cap sync re-adds @capacitor/push-notifications to iOS SPM — strip it after sync.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'ios/App/CapApp-SPM/Package.swift');
const cfgPath = path.join(root, 'ios/App/App/capacitor.config.json');
const entitlementsPath = path.join(root, 'ios/App/App/App.entitlements');
const infoPath = path.join(root, 'ios/App/App/Info.plist');

if (fs.existsSync(pkgPath)) {
  let pkg = fs.readFileSync(pkgPath, 'utf8');
  pkg = pkg
    .replace(/\n\s*\.package\(name: "CapacitorPushNotifications"[^\n]*\n/g, '\n')
    .replace(/\n\s*\.product\(name: "CapacitorPushNotifications"[^\n]*\n/g, '\n');
  fs.writeFileSync(pkgPath, pkg);
  console.log('[strip-ios-push] Removed CapacitorPushNotifications from Package.swift');
}

if (fs.existsSync(cfgPath)) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  if (Array.isArray(cfg.packageClassList)) {
    cfg.packageClassList = cfg.packageClassList.filter((x) => x !== 'PushNotificationsPlugin');
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, '\t')}\n`);
    console.log('[strip-ios-push] Removed PushNotificationsPlugin from capacitor.config.json');
  }
}

if (fs.existsSync(entitlementsPath)) {
  fs.writeFileSync(
    entitlementsPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`
  );
  console.log('[strip-ios-push] Cleared App.entitlements (no aps-environment)');
}

if (fs.existsSync(infoPath)) {
  let info = fs.readFileSync(infoPath, 'utf8');
  // Keep audio only for WebRTC; remove voip/remote-notification for free teams.
  info = info.replace(
    /<key>UIBackgroundModes<\/key>\s*<array>[\s\S]*?<\/array>/,
    `<key>UIBackgroundModes</key>
	<array>
		<string>audio</string>
	</array>`
  );
  fs.writeFileSync(infoPath, info);
  console.log('[strip-ios-push] UIBackgroundModes = audio only');
}
