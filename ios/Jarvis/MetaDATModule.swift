import Foundation
import MetaWearablesDAT   // from github.com/facebook/meta-wearables-dat-ios via SPM

@objc(MetaDATModule)
class MetaDATModule: RCTEventEmitter {

  private var session: StreamSession?
  private var hasListeners = false

  // MARK: - RCTEventEmitter

  override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! {
    ["onSessionStateChange", "onVideoFrame", "onAudioChunk", "onError"]
  }

  override func startObserving() { hasListeners = true }
  override func stopObserving()  { hasListeners = false }

  private func emit(_ name: String, body: Any?) {
    guard hasListeners else { return }
    sendEvent(withName: name, body: body)
  }

  // MARK: - Registration

  @objc func register(_ applicationId: String,
                       resolver resolve: @escaping RCTPromiseResolveBlock,
                       rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      try MetaWearablesDAT.shared.register(applicationId: applicationId)
      resolve(nil)
    } catch {
      reject("REGISTER_ERROR", error.localizedDescription, error)
    }
  }

  // MARK: - Permissions

  @objc func requestPermissions(_ resolve: @escaping RCTPromiseResolveBlock,
                                 rejecter reject: @escaping RCTPromiseRejectBlock) {
    MetaWearablesDAT.shared.requestPermissions { camera, microphone in
      resolve(["camera": camera, "microphone": microphone])
    }
  }

  // MARK: - Device discovery

  @objc func getAvailableDevices(_ resolve: @escaping RCTPromiseResolveBlock,
                                  rejecter reject: @escaping RCTPromiseRejectBlock) {
    let devices = MetaWearablesDAT.shared.availableDevices.map { d -> [String: Any] in
      [
        "id": d.identifier,
        "name": d.displayName,
        "firmwareVersion": d.firmwareVersion,
        "model": d.modelIdentifier,
      ]
    }
    resolve(devices)
  }

  // MARK: - Session lifecycle

  @objc func connect(_ deviceId: String,
                     resolver resolve: @escaping RCTPromiseResolveBlock,
                     rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let device = MetaWearablesDAT.shared.availableDevices.first(where: { $0.identifier == deviceId })
    else {
      reject("DEVICE_NOT_FOUND", "No device with id \(deviceId)", nil)
      return
    }

    let s = StreamSession(device: device)
    s.delegate = self
    s.connect { [weak self] result in
      switch result {
      case .success:
        self?.session = s
        resolve(nil)
      case .failure(let error):
        reject("CONNECT_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc func startStream(_ config: [String: Any],
                          resolver resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session else {
      reject("NO_SESSION", "Call connect() first", nil)
      return
    }

    var streamConfig = StreamConfig()
    if let video = config["video"] as? [String: Any], video["enabled"] as? Bool == true {
      streamConfig.video = VideoConfig(
        width:  (video["width"]  as? Int) ?? 1280,
        height: (video["height"] as? Int) ?? 720,
        fps:    (video["fps"]    as? Int) ?? 30
      )
    }
    if let audio = config["audio"] as? [String: Any], audio["enabled"] as? Bool == true {
      streamConfig.audio = AudioConfig(
        sampleRate: (audio["sampleRate"] as? Int) ?? 16000
      )
    }

    session.startStream(config: streamConfig) { result in
      switch result {
      case .success: resolve(nil)
      case .failure(let error): reject("STREAM_ERROR", error.localizedDescription, error)
      }
    }
  }

  @objc func pauseStream(_ resolve: @escaping RCTPromiseResolveBlock,
                          rejecter reject: @escaping RCTPromiseRejectBlock) {
    session?.pause()
    resolve(nil)
  }

  @objc func resumeStream(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    session?.resume()
    resolve(nil)
  }

  @objc func disconnect(_ resolve: @escaping RCTPromiseResolveBlock,
                         rejecter reject: @escaping RCTPromiseRejectBlock) {
    session?.disconnect()
    session = nil
    resolve(nil)
  }

  // MARK: - Photo capture

  @objc func capturePhoto(_ resolve: @escaping RCTPromiseResolveBlock,
                           rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let session else {
      reject("NO_SESSION", "Call connect() first", nil)
      return
    }
    session.capturePhoto { result in
      switch result {
      case .success(let jpeg):
        resolve(jpeg.base64EncodedString())
      case .failure(let error):
        reject("PHOTO_ERROR", error.localizedDescription, error)
      }
    }
  }
}

// MARK: - StreamSessionDelegate

extension MetaDATModule: StreamSessionDelegate {
  func session(_ session: StreamSession, didChangeState state: SessionState) {
    emit("onSessionStateChange", body: state.rawValue)
  }

  func session(_ session: StreamSession, didReceiveVideoFrame frame: VideoFrame) {
    emit("onVideoFrame", body: [
      "width": frame.width,
      "height": frame.height,
      "data": frame.jpegData.base64EncodedString(),
      "timestampMs": frame.timestamp * 1000,
    ])
  }

  func session(_ session: StreamSession, didReceiveAudioChunk chunk: AudioChunk) {
    emit("onAudioChunk", body: [
      "samples": chunk.pcmFloat32Samples,
      "timestampMs": chunk.timestamp * 1000,
    ])
  }

  func session(_ session: StreamSession, didEncounterError error: Error) {
    emit("onError", body: ["code": "STREAM_ERROR", "message": error.localizedDescription])
  }
}
