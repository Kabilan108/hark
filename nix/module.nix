{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.hark;
  credentialName = "fcm-service-account.json";
in
{
  options.services.hark = {
    enable = lib.mkEnableOption "the Hark backend";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.hark-server;
      defaultText = lib.literalExpression "pkgs.hark-server";
      description = "Hark server package. The default needs this flake's overlay.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "hark";
      description = "System user that runs the backend. The default user is created by this module.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "hark";
      description = "Group that runs the backend. The default group is created by this module.";
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/hark";
      description = "Directory holding hark.sqlite and its WAL files. The only path the service can write.";
    };

    requireExistingDatabase = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Refuse to start unless dataDir/hark.sqlite exists. Set this on hosts with an
        established database so an unmounted volume fails loudly instead of starting
        with an empty one.
      '';
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/agenix/hark-env";
      description = ''
        Secrets and deployment settings: BETTER_AUTH_SECRET, OWNER_EMAIL, APP_URL,
        Google OAuth and FCM_PROJECT_ID. Keep it out of the Nix store. Values here
        override the unit's own environment, so leave HOST, PORT, DATABASE_URL,
        NODE_ENV and FCM_SERVICE_ACCOUNT_FILE to this module.
      '';
    };

    fcmServiceAccountFile = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/run/agenix/hark-fcm-service-account";
      description = "Firebase service-account JSON, passed to the service as a systemd credential.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address the backend listens on.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8787;
      description = "Port the backend listens on.";
    };

    downloadsDir = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/srv/hark-downloads";
      description = ''
        Directory of published APKs served read-only at /downloads, with
        /downloads/latest redirecting to the newest release. It must be readable
        by the service user.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    users.users = lib.mkIf (cfg.user == "hark") {
      hark = {
        isSystemUser = true;
        inherit (cfg) group;
      };
    };
    users.groups = lib.mkIf (cfg.group == "hark") { hark = { }; };

    systemd.tmpfiles.rules = [ "d ${cfg.dataDir} 0700 ${cfg.user} ${cfg.group} -" ];

    systemd.services.hark = {
      description = "Hark backend";
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];

      unitConfig.AssertPathExists = lib.mkIf cfg.requireExistingDatabase [
        "${cfg.dataDir}/hark.sqlite"
      ];

      environment = {
        HOST = cfg.host;
        PORT = toString cfg.port;
        DATABASE_URL = "${cfg.dataDir}/hark.sqlite";
        NODE_ENV = "production";
      }
      // lib.optionalAttrs (cfg.fcmServiceAccountFile != null) {
        FCM_SERVICE_ACCOUNT_FILE = "/run/credentials/hark.service/${credentialName}";
      }
      // lib.optionalAttrs (cfg.downloadsDir != null) {
        HARK_DOWNLOADS_DIR = cfg.downloadsDir;
      };

      serviceConfig = {
        User = cfg.user;
        Group = cfg.group;
        ExecStart = lib.getExe cfg.package;
        EnvironmentFile = lib.mkIf (cfg.environmentFile != null) cfg.environmentFile;
        LoadCredential = lib.mkIf (
          cfg.fcmServiceAccountFile != null
        ) "${credentialName}:${cfg.fcmServiceAccountFile}";
        Restart = "on-failure";
        RestartSec = 5;
        # The server checkpoints SQLite's WAL on SIGTERM before exiting.
        TimeoutStopSec = 30;
        UMask = "0077";

        ReadWritePaths = [ cfg.dataDir ];
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        PrivateUsers = true;
        ProtectProc = "invisible";
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectKernelLogs = true;
        ProtectControlGroups = true;
        ProtectClock = true;
        ProtectHostname = true;
        NoNewPrivileges = true;
        RestrictSUIDSGID = true;
        RestrictRealtime = true;
        RestrictNamespaces = true;
        LockPersonality = true;
        RemoveIPC = true;
        CapabilityBoundingSet = "";
        SystemCallArchitectures = "native";
        SystemCallFilter = [ "@system-service" ];
        # Outbound access stays open for Google OAuth, FCM and webhook callbacks.
        # MemoryDenyWriteExecute stays off because V8's JIT needs writable code pages.
        RestrictAddressFamilies = [
          "AF_UNIX"
          "AF_INET"
          "AF_INET6"
        ];
      };
    };
  };
}
