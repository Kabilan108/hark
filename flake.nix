{
  description = "Hark Android development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/2c423e03bbafcff28bfadc6781a4a8257f205cb5";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        config = {
          allowUnfree = true;
          android_sdk.accept_license = true;
        };
      };

      androidRepository = builtins.fromJSON (
        builtins.readFile "${nixpkgs}/pkgs/development/mobile/androidenv/repo.json"
      );

      # Keep the build platforms in one SDK, but retain only the Android 17
      # emulator image. composeAndroidPackages otherwise installs an image for
      # every requested platform.
      androidRepositoryWithApi37Image = androidRepository // {
        images = {
          "37.0" = androidRepository.images."37.0";
        };
      };

      android = pkgs.androidenv.composeAndroidPackages {
        repo = androidRepositoryWithApi37Image;
        platformVersions = [
          "36"
          "36.1"
          "37.0"
        ];
        buildToolsVersions = [
          "35.0.0"
          "36.0.0"
        ];
        includeNDK = true;
        ndkVersions = [ "27.1.12297006" ];
        includeCmake = true;
        cmakeVersions = [
          "3.22.1"
          "3.30.5"
        ];
        includeEmulator = true;
        includeSystemImages = true;
        systemImageTypes = [ "google_apis" ];
        abiVersions = [ "x86_64" ];
      };

      androidSdk = android.androidsdk;
      jdk = pkgs.jdk17;
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_24
          pkgs.corepack
          jdk
          pkgs.watchman
          androidSdk
        ];

        ANDROID_HOME = "${androidSdk}/libexec/android-sdk";
        ANDROID_SDK_ROOT = "${androidSdk}/libexec/android-sdk";
        ANDROID_NDK_ROOT = "${androidSdk}/libexec/android-sdk/ndk-bundle";
        ANDROID_USER_HOME = "/vault/userdata/android";
        ANDROID_AVD_HOME = "/vault/userdata/android/avd";
        GRADLE_USER_HOME = "/vault/userdata/android/gradle/hark";
        JAVA_HOME = jdk.home;
        GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidSdk}/libexec/android-sdk/build-tools/36.0.0/aapt2";

        shellHook = ''
          mkdir -p "$ANDROID_USER_HOME" "$ANDROID_AVD_HOME" "$GRADLE_USER_HOME"
        '';
      };
    };
}
