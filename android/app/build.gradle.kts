plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val secrets = java.util.Properties().apply {
    val f = rootProject.file("app/secrets.properties")
    if (f.exists()) load(f.inputStream())
}

android {
    namespace = "com.jarvis"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.jarvis.app"
        minSdk = 29   // Android 10 — Meta DAT minimum
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        manifestPlaceholders["metaAppId"] = secrets.getProperty("META_APP_ID", "")
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
    kotlinOptions { jvmTarget = "17" }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // React Native
    implementation("com.facebook.react:react-android")
    implementation("com.facebook.react:hermes-android")

    // Meta Wearables Device Access Toolkit
    val mwdatVersion = "0.6.0"
    implementation("com.meta.wearable:mwdat-core:$mwdatVersion")
    implementation("com.meta.wearable:mwdat-camera:$mwdatVersion")
    // Uncomment for testing without physical glasses:
    // implementation("com.meta.wearable:mwdat-mockdevice:$mwdatVersion")
}
