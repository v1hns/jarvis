pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()

        // Meta Wearables DAT — requires a GitHub personal access token
        // with read:packages scope.
        //
        // Create one at: https://github.com/settings/tokens
        // Then add to ~/.gradle/gradle.properties:
        //   GITHUB_TOKEN=ghp_your_token_here
        //
        maven {
            url = uri("https://maven.pkg.github.com/facebook/meta-wearables-dat-android")
            credentials {
                username = ""
                password = providers.gradleProperty("GITHUB_TOKEN")
                    .orElse(providers.environmentVariable("GITHUB_TOKEN"))
                    .get()
            }
        }
    }
}

rootProject.name = "Jarvis"
include(":app")
