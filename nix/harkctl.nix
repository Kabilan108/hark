{ pkgs }:

let
  inherit (pkgs)
    fetchPnpmDeps
    lib
    makeWrapper
    nodejs_24
    pnpm
    pnpmConfigHook
    stdenvNoCC
    ;

  root = ../.;
  packageJson = builtins.fromJSON (builtins.readFile ../packages/harkctl/package.json);
  packageSrc = lib.fileset.toSource {
    root = ../packages/harkctl;
    fileset = ../packages/harkctl;
  };
  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      ../packages/harkctl
      ../skills/hark/SKILL.md
    ];
  };
in
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "harkctl";
  inherit (packageJson) version;

  inherit src;

  pnpmRoot = "packages/harkctl";
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      version
      ;
    src = packageSrc;
    inherit pnpm;
    fetcherVersion = 4;
    postPatch = ''
      cp ${./harkctl/pnpm-lock.yaml} pnpm-lock.yaml
    '';
    hash = "sha256-km1bYAAbc/RMzQM4lFEM3oQ51T4qMIehWZI1lR9J2QE=";
  };

  postPatch = ''
    cp ${./harkctl/pnpm-lock.yaml} packages/harkctl/pnpm-lock.yaml
  '';

  nativeBuildInputs = [
    makeWrapper
    nodejs_24
    pnpm
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild
    pnpm --dir packages/harkctl build
    runHook postBuild
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    pnpm --dir packages/harkctl test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/lib"
    cp -r packages/harkctl "$out/lib/harkctl"
    makeWrapper ${lib.getExe nodejs_24} "$out/bin/harkctl" \
      --add-flags "$out/lib/harkctl/bin/harkctl.mjs"

    runHook postInstall
  '';

  meta = {
    description = "CLI for Hark agent approvals and replies";
    homepage = "https://github.com/Kabilan108/hark";
    license = {
      fullName = "PolyForm Noncommercial License 1.0.0";
      url = "https://polyformproject.org/licenses/noncommercial/1.0.0/";
      free = false;
      redistributable = true;
    };
    mainProgram = "harkctl";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
})
