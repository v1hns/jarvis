package com.jarvis

import android.util.Base64
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.meta.wearable.mwdat.core.MetaWearablesDAT
import com.meta.wearable.mwdat.core.SessionState
import com.meta.wearable.mwdat.camera.StreamSession
import com.meta.wearable.mwdat.camera.StreamConfig
import com.meta.wearable.mwdat.camera.VideoConfig
import com.meta.wearable.mwdat.camera.AudioConfig
import com.meta.wearable.mwdat.camera.StreamSessionListener

class MetaDATModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MetaDATModule"

    private var session: StreamSession? = null

    // ── Helpers ────────────────────────────────────────────────────────────

    private fun emit(event: String, payload: Any?) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, payload)
    }

    // ── Registration ───────────────────────────────────────────────────────

    @ReactMethod
    fun register(applicationId: String, promise: Promise) {
        try {
            MetaWearablesDAT.getInstance(reactContext).register(applicationId)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("REGISTER_ERROR", e.message, e)
        }
    }

    // ── Permissions ────────────────────────────────────────────────────────

    @ReactMethod
    fun requestPermissions(promise: Promise) {
        MetaWearablesDAT.getInstance(reactContext).requestPermissions(
            currentActivity!!
        ) { camera, microphone ->
            val map = Arguments.createMap().apply {
                putBoolean("camera", camera)
                putBoolean("microphone", microphone)
            }
            promise.resolve(map)
        }
    }

    // ── Device discovery ───────────────────────────────────────────────────

    @ReactMethod
    fun getAvailableDevices(promise: Promise) {
        val devices = MetaWearablesDAT.getInstance(reactContext).availableDevices
        val array = Arguments.createArray()
        devices.forEach { d ->
            Arguments.createMap().apply {
                putString("id", d.identifier)
                putString("name", d.displayName)
                putString("firmwareVersion", d.firmwareVersion)
                putString("model", d.modelIdentifier)
                array.pushMap(this)
            }
        }
        promise.resolve(array)
    }

    // ── Session lifecycle ─────────────────────────────────────────────────

    @ReactMethod
    fun connect(deviceId: String, promise: Promise) {
        val dat = MetaWearablesDAT.getInstance(reactContext)
        val device = dat.availableDevices.firstOrNull { it.identifier == deviceId }
            ?: return promise.reject("DEVICE_NOT_FOUND", "No device with id $deviceId")

        val s = StreamSession(reactContext, device)
        s.addListener(object : StreamSessionListener {
            override fun onStateChanged(state: SessionState) {
                emit("onSessionStateChange", state.name.lowercase())
            }
            override fun onVideoFrame(width: Int, height: Int, jpegData: ByteArray, timestampMs: Long) {
                val map = Arguments.createMap().apply {
                    putInt("width", width)
                    putInt("height", height)
                    putString("data", Base64.encodeToString(jpegData, Base64.NO_WRAP))
                    putDouble("timestampMs", timestampMs.toDouble())
                }
                emit("onVideoFrame", map)
            }
            override fun onAudioChunk(samples: FloatArray, timestampMs: Long) {
                val arr = Arguments.createArray().apply { samples.forEach { pushDouble(it.toDouble()) } }
                val map = Arguments.createMap().apply {
                    putArray("samples", arr)
                    putDouble("timestampMs", timestampMs.toDouble())
                }
                emit("onAudioChunk", map)
            }
            override fun onError(code: String, message: String) {
                val map = Arguments.createMap().apply {
                    putString("code", code)
                    putString("message", message)
                }
                emit("onError", map)
            }
        })

        s.connect { success, error ->
            if (success) {
                session = s
                promise.resolve(null)
            } else {
                promise.reject("CONNECT_ERROR", error ?: "Unknown error")
            }
        }
    }

    @ReactMethod
    fun startStream(config: ReadableMap, promise: Promise) {
        val s = session ?: return promise.reject("NO_SESSION", "Call connect() first")

        val streamConfig = StreamConfig().apply {
            config.getMap("video")?.let { v ->
                if (v.getBoolean("enabled")) {
                    video = VideoConfig(
                        width  = if (v.hasKey("width"))  v.getInt("width")  else 1280,
                        height = if (v.hasKey("height")) v.getInt("height") else 720,
                        fps    = if (v.hasKey("fps"))    v.getInt("fps")    else 30
                    )
                }
            }
            config.getMap("audio")?.let { a ->
                if (a.getBoolean("enabled")) {
                    audio = AudioConfig(
                        sampleRate = if (a.hasKey("sampleRate")) a.getInt("sampleRate") else 16000
                    )
                }
            }
        }

        s.startStream(streamConfig) { success, error ->
            if (success) promise.resolve(null)
            else promise.reject("STREAM_ERROR", error ?: "Unknown error")
        }
    }

    @ReactMethod
    fun pauseStream(promise: Promise) {
        session?.pause()
        promise.resolve(null)
    }

    @ReactMethod
    fun resumeStream(promise: Promise) {
        session?.resume()
        promise.resolve(null)
    }

    @ReactMethod
    fun disconnect(promise: Promise) {
        session?.disconnect()
        session = null
        promise.resolve(null)
    }

    // ── Photo capture ──────────────────────────────────────────────────────

    @ReactMethod
    fun capturePhoto(promise: Promise) {
        val s = session ?: return promise.reject("NO_SESSION", "Call connect() first")
        s.capturePhoto { jpegData, error ->
            if (jpegData != null) {
                promise.resolve(Base64.encodeToString(jpegData, Base64.NO_WRAP))
            } else {
                promise.reject("PHOTO_ERROR", error ?: "Capture failed")
            }
        }
    }

    // Required for addListener / removeListeners (React Native event emitter protocol)
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}
}
