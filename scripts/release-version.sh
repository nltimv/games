#!/usr/bin/env bash
# Works out the release version for a CI run and prints `key=value` lines
# for $GITHUB_OUTPUT.
#
#   release=true   only for a vX.Y.Z (or vX.Y.Z-pre) tag whose commit is on main
#   version=X.Y.Z  the tag without its leading "v"; 0.0.0-dev otherwise
#   prerelease=true|false
#
# Usage: release-version.sh <git ref> <commit sha> [main ref, default origin/main]
set -euo pipefail

ref="${1:?git ref, e.g. refs/tags/v1.2.3}"
sha="${2:?commit sha}"
main_ref="${3:-origin/main}"

semver='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'

if [[ "$ref" != refs/tags/* ]]; then
  echo "release=false"
  echo "version=0.0.0-dev"
  echo "prerelease=false"
  exit 0
fi

tag="${ref#refs/tags/}"
if [[ ! "$tag" =~ $semver ]]; then
  echo "::error::Tag '$tag' is not a release tag; use vMAJOR.MINOR.PATCH, e.g. v1.7.0" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$sha" "$main_ref"; then
  echo "::error::Tag '$tag' points at $sha, which is not on main. Tag a commit on main." >&2
  exit 1
fi

version="${tag#v}"
echo "release=true"
echo "version=${version}"
if [[ "$version" == *-* ]]; then
  echo "prerelease=true"
else
  echo "prerelease=false"
fi
