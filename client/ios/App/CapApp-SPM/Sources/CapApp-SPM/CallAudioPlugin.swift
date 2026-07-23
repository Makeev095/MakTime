import Foundation
import AVFoundation
import Capacitor

@objc(CallAudioPlugin)
public class CallAudioPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CallAudioPlugin"
    public let jsName = "CallAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startCallAudio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSpeaker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopCallAudio", returnType: CAPPluginReturnPromise),
    ]

    private var speakerEnabled = true

    @objc func startCallAudio(_ call: CAPPluginCall) {
        speakerEnabled = call.getBool("speaker", true)
        do {
            try configureSession(speaker: speakerEnabled)
            call.resolve(["route": speakerEnabled ? "speaker" : "earpiece"])
        } catch {
            call.reject("Failed to start call audio: \(error.localizedDescription)")
        }
    }

    @objc func setSpeaker(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("enabled is required")
            return
        }
        speakerEnabled = enabled
        do {
            try configureSession(speaker: speakerEnabled)
            call.resolve(["route": speakerEnabled ? "speaker" : "earpiece"])
        } catch {
            call.reject("Failed to set speaker: \(error.localizedDescription)")
        }
    }

    @objc func stopCallAudio(_ call: CAPPluginCall) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
        } catch {
            // Best-effort cleanup; call UI should still close.
        }
        call.resolve()
    }

    private func configureSession(speaker: Bool) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .videoChat,
            options: [
                .allowBluetooth,
                .allowBluetoothA2DP,
                .defaultToSpeaker,
                .mixWithOthers,
            ]
        )
        try session.setActive(true, options: [])
        try session.overrideOutputAudioPort(speaker ? .speaker : .none)
    }
}
