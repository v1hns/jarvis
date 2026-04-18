import Foundation
import Combine
import AVFoundation
import MWDATCore   // Wearables, PermissionStatus, RegistrationState
import MWDATCamera // StreamSession, StreamSessionState, StreamSessionConfig,
                   // AutoDeviceSelector, SpecificDeviceSelector

@objc(MetaDATModule)
class MetaDATModule: RCTEventEmitter {

  private var session: StreamSession?
  private var cancellables = Set<AnyCancellable>()
  private var audioEngine: AVAudioEngine?
  private var hasListeners = false

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["onSessionStateChange", "onVideoFrame", "onAudioChunk", "onError", "onDevicesChanged"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving()  { hasListeners = false }

  private func emit(_ name: String, body: Any?) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  // MARK: - SDK setup

  /// Call once at launch — reads MWDAT dict from Info.plist.
  @objc func configure(_ resolve: @escaping RCTPromiseResolveBlock,
                        rejecter reject: @escaping RCTPromiseRejectBlock) {
    Wearables.configure()

    Wearables.shared.devicesStream()
      .sink { [weak self] devices in
        let arr = devices.map { d -> [String: Any] in
          ["id": d.identifier, "name": d.displayName, "model": d.modelIdentifier]
        }
        self?.emit("onDevicesChanged", body: arr)
      }
      .store(in: &cancellables)

    resolve(nil)
  }

  /// Opens Meta AI app pairing flow. User approves once.
  @objc func startRegistration(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    Wearables.shared.registrationStateStream()
      .first()
      .sink { state in resolve(state.rawValue) }
      .store(in: &cancellables)

    Wearables.shared.startRegistration()
  }

  // MARK: - Permissions

  @objc func checkPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                              rejecter reject: @escaping RCTPromiseRejectBlock) {
    let status = Wearables.shared.checkPermissionStatus(.camera)
    resolve(status == .granted ? "granted" : "denied")
  }

  /// Deep-links to Meta AI app for user to grant camera permission.
  @objc func requestPermission(_ resolve: @escaping RCTPromiseResolveBlock,
                                rejecter reject: @escaping RCTPromiseRejectBlock) {
    Task {
      let status = await Wearables.shared.requestPermission(.camera)
      resolve(status == .granted ? "granted" : "denied")
    }
  }

  // MARK: - Session

  /// SDK auto-selects the paired glasses (preferred).
  @objc func startAutoSession(_ resolve: @escaping RCTPromiseResolveBlock,
                               rejecter reject: @escaping RCTPromiseRejectBlock) {
    let s = StreamSession(streamSessionConfig: StreamSessionConfig(),
                          deviceSelector: AutoDeviceSelector())
    attachPublishers(to: s)
    session = s
    s.start()
    resolve(nil)
  }

  /// Connect to a specific device by identifier.
  @objc func startSession(_ deviceId: String,
                           resolver resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let device = Wearables.shared.devicesStream().value?.first(where: { $0.identifier == deviceId }) else {
      reject("DEVICE_NOT_FOUND", "No device with id \(deviceId)", nil)
      return
    }
    let s = StreamSession(streamSessionConfig: StreamSessionConfig(),
                          deviceSelector: SpecificDeviceSelector(device: device))
    attachPublishers(to: s)
    session = s
    s.start()
    resolve(nil)
  }

  @objc func stopSession(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    session?.stop()
    session = nil
    stopAudioEngine()
    resolve(nil)
  }

  // MARK: - Photo

  @objc func capturePhoto(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session else {
      reject("NO_SESSION", "Call startAutoSession() first", nil)
      return
    }
    session.photoDataPublisher
      .first()
      .sink { data in resolve(data.base64EncodedString()) }
      .store(in: &cancellables)
    session.capturePhoto(format: .jpeg)
  }

  // MARK: - Audio (Bluetooth HFP — standard iOS AVAudio, not a DAT API)

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

  private func attachPublishers(to s: StreamSession) {
    s.statePublisher
      .sink { [weak self] state in
        self?.emit("onSessionStateChange", body: state.rawValue)
        switch state {
        case .streaming:
          self?.startAudio({ _ in }, rejecter: { code, msg, _ in
            print("[Jarvis Audio] \(code ?? ""): \(msg ?? "")")
          })
        case .stopped, .stopping:
          self?.stopAudioEngine()
        default: break
        }
      }
      .store(in: &cancellables)

    s.videoFramePublisher
      .sink { [weak self] frame in
        guard let jpg = frame.jpegData else { return }
        self?.emit("onVideoFrame", body: [
          "width": frame.width,
          "height": frame.height,
          "data": jpg.base64EncodedString(),
          "timestampMs": frame.timestamp * 1000,
        ])
      }
      .store(in: &cancellables)

    s.errorPublisher
      .sink { [weak self] error in
        self?.emit("onError", body: ["code": "STREAM_ERROR", "message": error.localizedDescription])
      }
      .store(in: &cancellables)
  }

  @objc func addListener(_ eventName: String) {}
  @objc func removeListeners(_ count: Double) {}
}
