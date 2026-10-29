{
  lib,
  stdenv,
  fetchPnpmDeps,
  pnpm_11,
  pnpmConfigHook,
  makeWrapper,
  nodejs_24,
  python3,
  curl,
}:

let
  packageJson = builtins.fromJSON (builtins.readFile ../apps/website/package.json);
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../patches
      ../packages/contracts
      ../packages/website-runtime
      ../apps/website
    ];
  };
  # Mirrors the Dockerfile: Expo and harkctl stay out of the server's dependency set.
  pnpmWorkspaces = [
    "hark"
    "@hark/website"
    "@hark/contracts"
    "@hark/website-runtime"
  ];
  nodeGyp = "${nodejs_24}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js";
  serverRoot = "lib/hark-server";
in
stdenv.mkDerivation (finalAttrs: {
  pname = "hark-server";
  inherit (packageJson) version;

  inherit src pnpmWorkspaces;

  # Same pnpm pin as harkctl: the hash depends on the pnpm major, and consumers
  # such as dotfiles build this with their own nixpkgs.
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      src
      pnpmWorkspaces
      ;
    pnpm = pnpm_11;
    fetcherVersion = 4;
    hash = "sha256-j0zJe39eOnmTXEUgj1kKubUEakESSLa4MSw5hhP5/JA=";
  };

  nativeBuildInputs = [
    makeWrapper
    nodejs_24
    pnpm_11
    pnpmConfigHook
    python3
  ];

  nativeInstallCheckInputs = [ curl ];

  # better-sqlite3 ships prebuilt addons and loads them ahead of build/Release.
  # They are removed so the addon is compiled from source against this
  # toolchain, once, and reused by tests and the production tree.
  buildPhase = ''
    runHook preBuild

    pnpm --filter @hark/website build

    pushd "$(realpath apps/website/node_modules/better-sqlite3)"
    rm -rf prebuilds
    node ${nodeGyp} rebuild --release --nodedir=${nodejs_24}
    popd

    runHook postBuild
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    pnpm --filter @hark/website test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    # `pnpm deploy --legacy` re-resolves versions, which needs registry metadata
    # an offline build lacks. A frozen install of only the runtime package reads
    # the lockfile instead. The hoisted linker would ignore --filter, so the
    # isolated layout is hoisted to the top-level node_modules for resolution
    # from dist/server.
    runtime="$TMPDIR/runtime"
    mkdir -p "$runtime/packages/website-runtime"
    cp -r package.json pnpm-lock.yaml pnpm-workspace.yaml patches "$runtime/"
    cp packages/website-runtime/package.json "$runtime/packages/website-runtime/"
    pnpm --dir "$runtime" install --offline --frozen-lockfile --prod --ignore-scripts \
      --filter @hark/website-runtime --config.shamefully-hoist=true

    addon=build/Release/better_sqlite3.node
    built="$(realpath apps/website/node_modules/better-sqlite3)"
    deployed="$(realpath "$runtime/node_modules/better-sqlite3")"
    install -Dm0555 "$built/$addon" "$deployed/$addon"
    rm -rf "$deployed/deps" "$deployed/src" "$deployed/prebuilds"

    root="$out/${serverRoot}"
    mkdir -p "$root/dist"
    cp packages/website-runtime/package.json "$root/"
    cp -r "$runtime/node_modules" "$root/"
    rm "$root/node_modules/@hark/website-runtime"
    rmdir "$root/node_modules/@hark"
    cp -r apps/website/dist/server apps/website/dist/client "$root/dist/"
    cp -r apps/website/drizzle "$root/"

    makeWrapper ${lib.getExe nodejs_24} "$out/bin/hark-server" \
      --add-flags "$root/dist/server/index.js" \
      --set-default NODE_ENV production \
      --set-default HARK_MIGRATIONS_DIR "$root/drizzle" \
      --set-default HARK_CLIENT_DIR "$root/dist/client"

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck

    export HOST=127.0.0.1 PORT=18787
    export DATABASE_URL="$TMPDIR/install-check/hark.sqlite"
    export BETTER_AUTH_SECRET=install-check-secret-0123456789
    export OWNER_EMAIL=owner@example.test
    export SELF_HOSTED_MODE=true
    "$out/bin/hark-server" &
    server=$!
    for _ in $(seq 100); do
      curl -fsS "http://$HOST:$PORT/api/health" && break
      sleep 0.1
    done
    [[ "$(curl -fsS "http://$HOST:$PORT/api/health")" == '{"ok":true}' ]]
    curl -fsS "http://$HOST:$PORT/" > "$TMPDIR/index.html"
    grep -qi '<!doctype html>' "$TMPDIR/index.html"
    kill -TERM "$server"
    wait "$server"

    runHook postInstallCheck
  '';

  meta = {
    description = "Hark backend: API, SQLite storage and the static website";
    homepage = "https://github.com/Kabilan108/hark";
    license = {
      fullName = "PolyForm Noncommercial License 1.0.0";
      url = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
      free = false;
      redistributable = true;
    };
    mainProgram = "hark-server";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
})
