{ pkgs, module }:

pkgs.testers.runNixOSTest {
  name = "hark-server";

  nodes.machine = {
    imports = [ module ];

    services.hark = {
      enable = true;
      package = pkgs.hark-server;
      environmentFile = "/etc/hark/backend.env";
      fcmServiceAccountFile = "/etc/hark/fcm-service-account.json";
      downloadsDir = "/srv/hark-downloads";
    };

    environment.etc."hark/backend.env".text = ''
      BETTER_AUTH_SECRET=vm-test-secret-0123456789
      OWNER_EMAIL=owner@example.test
      SELF_HOSTED_MODE=true
    '';
    environment.etc."hark/fcm-service-account.json".text = "{}";

    systemd.tmpfiles.rules = [
      "d /srv/hark-downloads 0755 root root -"
      "f /srv/hark-downloads/hark-android-1.2.2.apk 0644 root root - old"
      "f /srv/hark-downloads/hark-android-1.3.0.apk 0644 root root - new"
    ];
  };

  testScript = ''
    base = "http://127.0.0.1:8787"

    machine.wait_for_unit("hark.service")
    machine.wait_until_succeeds(f"curl -fsS {base}/api/health")

    with subtest("serves the prerendered site and published APKs"):
        assert "<!doctype html>" in machine.succeed(f"curl -fsS {base}/").lower()
        location = machine.succeed(
            f"curl -fsS -o /dev/null -w '%{{redirect_url}}' {base}/downloads/latest"
        )
        assert location.endswith("/downloads/hark-android-1.3.0.apk"), location
        assert machine.succeed(f"curl -fsS {base}/downloads/hark-android-1.2.2.apk") == "old"

    with subtest("keeps state in dataDir, owned by the service user"):
        machine.succeed("test \"$(stat -c %U /var/lib/hark/hark.sqlite)\" = hark")
        machine.succeed("test -e /run/credentials/hark.service/fcm-service-account.json")

    with subtest("restarts cleanly against the existing database"):
        machine.succeed("systemctl restart hark.service")
        machine.wait_until_succeeds(f"curl -fsS {base}/api/health")
        machine.fail("journalctl -u hark.service | grep -i 'migration.*fail'")

    with subtest("runs with the expected hardening"):
        machine.succeed("systemctl show hark.service -p ProtectHome | grep -qx 'ProtectHome=yes'")
        machine.succeed("systemctl show hark.service -p User | grep -qx 'User=hark'")
        print(machine.succeed("systemd-analyze security hark.service --no-pager | tail -1"))
  '';
}
