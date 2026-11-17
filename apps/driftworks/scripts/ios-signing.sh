#!/usr/bin/env bash
# CI only: switches the App target to manual signing with the distribution
# certificate and provisioning profile that the workflow installed. Only the
# App target is changed; the Capacitor Swift packages build unsigned as usual.
#
# Usage: ios-signing.sh <team id> <provisioning profile name>
set -euo pipefail

team="${1:?Apple team id}"
profile="${2:?provisioning profile name}"
project="$(dirname "$0")/../ios/App/App.xcodeproj/project.pbxproj"

# The App target's build settings are the only ones with a bundle id.
perl -0pi -e "s/CODE_SIGN_STYLE = Automatic;(\s+CURRENT_PROJECT_VERSION)/CODE_SIGN_STYLE = Manual;\n\t\t\t\tCODE_SIGN_IDENTITY = \"Apple Distribution\";\n\t\t\t\tDEVELOPMENT_TEAM = ${team};\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = \"${profile}\";\1/g" "$project"

count=$(grep -c 'PROVISIONING_PROFILE_SPECIFIER' "$project" || true)
if [ "$count" -ne 2 ]; then
  echo "::error::Expected to set signing on the App target's 2 build configurations, set $count" >&2
  exit 1
fi
