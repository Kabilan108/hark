# Updating the Nix dependency lock

Regenerate `pnpm-lock.yaml` after changing dependencies in `packages/harkctl/package.json`:

```sh
temp_dir=$(mktemp -d)
cp packages/harkctl/package.json "$temp_dir/package.json"
pnpm --dir "$temp_dir" install --lockfile-only --ignore-scripts
cp "$temp_dir/pnpm-lock.yaml" nix/harkctl/pnpm-lock.yaml
```

Set the `pnpmDeps` hash in `nix/harkctl.nix` to an empty string, build `.#harkctl`, and replace the
hash with the value from Nix's mismatch report.
