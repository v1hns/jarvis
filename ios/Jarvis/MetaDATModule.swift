import Foundation
import AVFoundation
import MWDATCore
import MWDATCamera

// Called from AppDelegate before JS starts, so handleUrl works even on cold launch
@objc class WearablesURLHandler: NSObject {
  @objc static func configureEarly() {
    try? Wearables.configure()
  }
  @objc static func handle(_ url: URL) {
    Task { try? await Wearables.shared.handleUrl(url) }
  }
}

@objc(MetaDATModule)
class MetaDATModule: RCTEventEmitter {

  private var deviceSession: DeviceSession?
  private var streamSession: StreamSession?
  private var listenerTokens: [any AnyListenerToken] = []
  private var audioEngine: AVAudioEngine?
  private var hasListeners = false
  private var devicesTask: Task<Void, Never>?

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["onSessionStateChange", "onVideoFrame", "onAudioChunk", "onError", "onDevicesChanged"]
  }

  override func invalidate() {
    devicesTask?.cancel()
    devicesTask = nil
    Task {
      for token in listenerTokens { await token.cancel() }
      listenerTokens.removeAll()
      if let s = streamSession { await s.stop() }
      streamSession = nil
      deviceSession = nil
    }
    stopAudioEngine()
    super.invalidate()
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving()  { hasListeners = false }

  @objc override func addListener(_ eventName: String) { super.addListener(eventName) }
  @objc override func removeListeners(_ count: Double) { super.removeListeners(count) }

  private func emit(_ name: String, body: Any?) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  // MARK: - SDK setup

  @objc func configure(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      try Wearables.configure()
    } catch WearablesError.alreadyConfigured {
      // fine — called twice due to React StrictMode
    } catch {
      reject("CONFIGURE_ERROR", error.localizedDescription, error)
      return
    }

    devicesTask = Task { [weak self] in
      for await deviceIds in Wearables.shared.devicesStream() {
        guard !Task.isCancelled else { break }
        let arr = deviceIds.map { id -> [String: Any] in
          let device = Wearables.shared.deviceForIdentifier(id)
          return [
            "id": id,
            "name": device?.name ?? id,
            "model": device?.deviceType().rawValue ?? "unknown",
          ]
        }
        self?.emit("onDevicesChanged", body: arr)
      }
    }

    resolve(nil)
  }

  // MARK: - Registration

  @objc func startRegistration(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        try await Wearables.shared.startRegistration()
        resolve("registered")
      } catch {
        reject("REGISTRATION_ERROR", error.localizedDescription, error)
      }
    }
  }

  // MARK: - Permissions

  @objc func checkPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        let status = try await Wearables.shared.checkPermissionStatus(.camera)
        resolve(status == .granted ? "granted" : "denied")
      } catch {
        resolve("denied")
      }
    }
  }

  @objc func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        let status = try await Wearables.shared.requestPermission(.camera)
        resolve(status == .granted ? "granted" : "denied")
      } catch {
        reject("PERMISSION_ERROR", error.localizedDescription, error)
      }
    }
  }

  // MARK: - Session

  @objc func startAutoSession(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        let selector = AutoDeviceSelector(wearables: Wearables.shared)
        let dSession = try Wearables.shared.createSession(deviceSelector: selector)
        try dSession.start()
        guard let sSession = try dSession.addStream() else {
          reject("SESSION_ERROR", "Failed to create stream session", nil)
          return
        }
        self.deviceSession = dSession
        self.streamSession = sSession
        self.attachListeners(to: sSession)
        await sSession.start()
        resolve(nil)
      } catch {
        reject("SESSION_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc func startSession(_ deviceId: String,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      do {
        let selector = SpecificDeviceSelector(device: deviceId)
        let dSession = try Wearables.shared.createSession(deviceSelector: selector)
        try dSession.start()
        guard let sSession = try dSession.addStream() else {
          reject("SESSION_ERROR", "Failed to create stream session", nil)
          return
        }
        self.deviceSession = dSession
        self.streamSession = sSession
        self.attachListeners(to: sSession)
        await sSession.start()
        resolve(nil)
      } catch {
        reject("SESSION_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc func stopSession(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      for token in listenerTokens { await token.cancel() }
      listenerTokens.removeAll()
      if let s = streamSession { await s.stop() }
      streamSession = nil
      deviceSession = nil
      stopAudioEngine()
      resolve(nil)
    }
  }

  // MARK: - Photo

  @objc func capturePhoto(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session = streamSession else {
      reject("NO_SESSION", "Call startAutoSession() first", nil)
      return
    }
    let token = session.photoDataPublisher.listen { [weak self] photoData in
      resolve(photoData.data.base64EncodedString())
      Task { [weak self] in
        if let t = self?.listenerTokens.last { await t.cancel() }
      }
    }
    listenerTokens.append(token)
    _ = session.capturePhoto(format: .jpeg)
  }

  // MARK: - Audio (Bluetooth HFP via AVAudioEngine)

  @objc func startAudio(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      let avSession = AVAudioSession.sharedInstance()
      try avSession.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .defaultToSpeaker])
      try avSession.setPreferredSampleRate(16_000)
      try avSession.setActive(true)

      let engine = AVAudioEngine()
      let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                              sampleRate: 16_000, channels: 1, interleaved: false)!
      engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak self] buffer, time in
        guard let data = buffer.floatChannelData?[0] else { return }
        let samples = Array(UnsafeBufferPointer(start: data, count: Int(buffer.frameLength)))
        self?.emit("onAudioChunk", body: [
          "samples": samples,
          "timestampMs": time.hostTime / 1_000_000,
        ])
      }
      try engine.start()
      self.audioEngine = engine
      resolve(nil)
    } catch {
      reject("AUDIO_ERROR", error.localizedDescription, error)
    }
  }

  // MARK: - Private

  private func stopAudioEngine() {
    audioEngine?.inputNode.removeTap(onBus: 0)
    audioEngine?.stop()
    audioEngine = nil
  }

  private func attachListeners(to s: StreamSession) {
    let stateToken = s.statePublisher.listen { [weak self] state in
      let stateStr: String
      switch state {
      case .stopped:          stateStr = "stopped"
      case .stopping:         stateStr = "stopping"
      case .waitingForDevice: stateStr = "waitingForDevice"
      case .starting:         stateStr = "starting"
      case .streaming:        stateStr = "streaming"
      case .paused:           stateStr = "paused"
      }
      self?.emit("onSessionStateChange", body: stateStr)
      if state == .stopped || state == .stopping {
        self?.stopAudioEngine()
      }
    }

    let videoToken = s.videoFramePublisher.listen { [weak self] frame in
      if let jpg = frame.makeUIImage()?.jpegData(compressionQuality: 0.7) {
        let size = frame.sampleBuffer.imageBuffer.map {
          (CVPixelBufferGetWidth($0), CVPixelBufferGetHeight($0))
        } ?? (0, 0)
        self?.emit("onVideoFrame", body: [
          "width": size.0,
          "height": size.1,
          "data": jpg.base64EncodedString(),
          "timestampMs": Int64(CMSampleBufferGetPresentationTimeStamp(frame.sampleBuffer).seconds * 1000),
        ])
      }
    }

    let errorToken = s.errorPublisher.listen { [weak self] error in
      self?.emit("onError", body: ["code": "STREAM_ERROR", "message": error.localizedDescription])
    }

    listenerTokens.append(contentsOf: [stateToken, videoToken, errorToken])
  }

  // MARK: - Test Harness

  private var testHarnessURL: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("jarvis_test_harness.json")
  }

  @objc func saveTestCasesJSON(_ json: String,
                                resolver resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      try json.write(to: testHarnessURL, atomically: true, encoding: .utf8)
      resolve(nil)
    } catch {
      reject("FILE_ERROR", error.localizedDescription, error)
    }
  }

  @objc func loadTestCasesJSON(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard FileManager.default.fileExists(atPath: testHarnessURL.path) else {
      resolve("[]")
      return
    }
    do {
      let json = try String(contentsOf: testHarnessURL, encoding: .utf8)
      resolve(json)
    } catch {
      reject("FILE_ERROR", error.localizedDescription, error)
    }
  }
}
