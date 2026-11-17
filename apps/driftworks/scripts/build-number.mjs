// The build number the stores need: Android's versionCode and iOS's
// CFBundleVersion. Both must grow with every upload, so it comes from the
// release version:
//
//   X.Y.Z        → (X*10000 + Y*100 + Z) * 100 + 99     1.4.2 → 1040299
//   X.Y.Z-rc.N   → (X*10000 + Y*100 + Z) * 100 + N      1.4.2-rc.3 → 1040203
//
// so a release candidate always sorts below its release. Y, Z < 100 and
// N < 99. Builds that are not releases (0.0.0-dev) use the CI run number.
//
//   node scripts/build-number.mjs <version> <run number>

import { fileURLToPath } from 'node:url';

export function buildNumber(version, runNumber = 1) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version);
  if (!m) throw new Error(`Not a version: ${version}`);
  const [major, minor, patch] = m.slice(1, 4).map(Number);
  if (major === 0 && minor === 0 && patch === 0) return Math.max(1, Number(runNumber) || 1);
  if (minor > 99 || patch > 99) throw new Error(`Minor and patch must be below 100 for a build number: ${version}`);
  let last = 99;
  if (m[4]) {
    const n = /(\d+)(?!.*\d)/.exec(m[4]);
    last = n ? Math.min(Number(n[1]), 98) : 0;
  }
  return (major * 10000 + minor * 100 + patch) * 100 + last;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(buildNumber(process.argv[2] ?? '', process.argv[3]));
}
