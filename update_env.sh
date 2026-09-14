#!/bin/sh
# update_env.sh — upgrade project Python env + math sources + AI SDK/API sources
#
# AI providers covered:
#   OpenAI, Anthropic/Claude, Google Gemini, Groq, Mistral, xAI/Grok,
#   DeepSeek, roastedbyai and Wolfram.
#
# Source sync is opt-in.
# System package upgrades are opt-in with RUN_SYSTEM_UPGRADE=1.
#
# This script is POSIX /bin/sh compatible.
#
# IMPORTANT:
# The script may be installed as /usr/local/bin/update_env.
# Therefore the script's own directory is NOT assumed to be the repository root.

set -eu

# ─────────────────────────────────────────────────────────────────────────────
# 0. Resolve repository root
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -n "${REPO_ROOT:-}" ]; then
    REPO_ROOT=$(CDPATH= cd -- "$REPO_ROOT" && pwd)
elif REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
    :
else
    REPO_ROOT=$(pwd)
fi

# ─────────────────────────────────────────────────────────────────────────────
# Output helpers
# ─────────────────────────────────────────────────────────────────────────────

info() {
    printf '\n🔹 %s\n' "$1"
}

success() {
    printf '   ✅ %s\n' "$1"
}

warn() {
    printf '   ⚠️  %s\n' "$1"
}

fail() {
    printf '   ❌ %s\n' "$1"
    exit 1
}

# ─────────────────────────────────────────────────────────────────────────────
# Temporary files / rollback
# ─────────────────────────────────────────────────────────────────────────────

LOCKFILE="/tmp/advik_pip_lock_$$.txt"
CONSTRAINTS_FILE="/tmp/advik_pip_constraints_$$.txt"
OUTDATED_FILE="/tmp/advik_outdated_$$.txt"
PRECHECK_FILE="/tmp/advik_pip_precheck_$$.txt"
POSTCHECK_FILE="/tmp/advik_pip_postcheck_$$.txt"

SUCCESS=0
ROLLING_BACK=0

cleanup() {
    rm -f \
        "$LOCKFILE" \
        "$CONSTRAINTS_FILE" \
        "$OUTDATED_FILE" \
        "$PRECHECK_FILE" \
        "$POSTCHECK_FILE" \
        "/tmp/qalc_api_error_$$" \
        2>/dev/null || true
}

rollback_if_needed() {
    STATUS=$?

    if [ "$STATUS" -ne 0 ] &&
       [ "$SUCCESS" -eq 0 ] &&
       [ "$ROLLING_BACK" -eq 0 ] &&
       [ -f "$LOCKFILE" ]; then

        ROLLING_BACK=1

        printf '\n💥 Failure detected — rolling back environment...\n'

        set +e

        python -m pip install \
            -q \
            -r "$LOCKFILE" \
            --force-reinstall \
            2>/dev/null

        ROLLBACK_STATUS=$?

        if [ "$ROLLBACK_STATUS" -eq 0 ]; then
            printf '   ✅ Rollback complete.\n'
        else
            printf '   ⚠️  Rollback may be incomplete — check %s\n' "$LOCKFILE"
        fi

        set -e
    fi

    cleanup

    if [ "$STATUS" -ne 0 ]; then
        exit "$STATUS"
    fi
}

trap 'rollback_if_needed' EXIT
trap 'exit 130' INT TERM

# ─────────────────────────────────────────────────────────────────────────────
# 1. Check basic tools
# ─────────────────────────────────────────────────────────────────────────────

info "Checking required tools..."

command -v python >/dev/null 2>&1 || fail "python was not found."
command -v git >/dev/null 2>&1 || warn "git was not found. Repository syncing will be unavailable."

success "Required runtime detected"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Optional system upgrade
# ─────────────────────────────────────────────────────────────────────────────

if [ "${RUN_SYSTEM_UPGRADE:-0}" = "1" ]; then
    info "Checking system package manager for upgrades..."

    if command -v apt-get >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive

        APT_OPTS='-o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"'

        sudo -E apt-get update -qq >/dev/null
        sudo -E apt-get upgrade -y -qq $APT_OPTS >/dev/null

        success "System packages upgraded."
    else
        warn "apt package manager not found. Skipping system-level upgrade."
    fi
else
    info "Skipping system-level package upgrade (set RUN_SYSTEM_UPGRADE=1 to enable)."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Resolve directories
# ─────────────────────────────────────────────────────────────────────────────

MATH_MODULES_DIR="$REPO_ROOT/math_modules"
AI_MODULES_DIR="$REPO_ROOT/ai_modules/core"

mkdir -p "$MATH_MODULES_DIR" "$AI_MODULES_DIR"

printf '   Repository root: %s\n' "$REPO_ROOT"
printf '   Math modules:    %s\n' "$MATH_MODULES_DIR"
printf '   AI modules:      %s\n' "$AI_MODULES_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Locate the virtual environment WITHOUT sourcing activate
# ─────────────────────────────────────────────────────────────────────────────

VENV_PATH=""

if [ -n "${1:-}" ] && [ -x "$1/bin/python" ]; then
    VENV_PATH=$(CDPATH= cd -- "$1" && pwd)
elif [ -x "$REPO_ROOT/.venv/bin/python" ]; then
    VENV_PATH="$REPO_ROOT/.venv"
elif [ -x "$HOME/venvs/advikmathlib_env/bin/python" ]; then
    VENV_PATH="$HOME/venvs/advikmathlib_env"
elif [ -x ".venv/bin/python" ]; then
    VENV_PATH=$(CDPATH= cd -- ".venv" && pwd)
fi

if [ -z "$VENV_PATH" ]; then
    fail "No usable virtual environment found."
fi

PYTHON="$VENV_PATH/bin/python"

printf '\n'
printf '   Virtual environment: %s\n' "$VENV_PATH"
printf '   Python executable:    %s\n' "$PYTHON"
printf '   Python version:      '
"$PYTHON" --version

# From this point onward EVERY pip operation uses this exact Python.
pip_cmd() {
    "$PYTHON" -m pip "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
# 5. Save rollback snapshot
# ─────────────────────────────────────────────────────────────────────────────

info "Saving rollback snapshot..."

pip_cmd freeze > "$LOCKFILE"

PACKAGE_COUNT=$(wc -l < "$LOCKFILE" | tr -d ' ')

success "Saved $PACKAGE_COUNT packages"

# ─────────────────────────────────────────────────────────────────────────────
# 6. Build compatibility constraints
# ─────────────────────────────────────────────────────────────────────────────
#
# The known problems were:
#
#   pydantic        → requires an exact pydantic-core version
#   playwright      → requires pyee < 14
#   sympy           → requires a compatible mpmath range
#
# We obtain installed package metadata where possible instead of allowing
# generic pip upgrades to destroy an already-working dependency tree.
# ─────────────────────────────────────────────────────────────────────────────

info "Building dependency compatibility constraints..."

"$PYTHON" > "$CONSTRAINTS_FILE" <<'PYEOF'
import importlib.metadata
import re

def installed_version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None

def dependencies(name):
    try:
        return importlib.metadata.requires(name) or []
    except importlib.metadata.PackageNotFoundError:
        return []

# Preserve the currently installed Pydantic version if present.
pydantic_version = installed_version("pydantic")
if pydantic_version:
    print(f"pydantic=={pydantic_version}")

# Pydantic declares the exact compatible pydantic-core version.
for req in dependencies("pydantic"):
    if req.lower().startswith("pydantic-core"):
        req = req.split(";", 1)[0].strip()
        print(req)

# Playwright's pyee requirement is intentionally preserved.
for req in dependencies("playwright"):
    if req.lower().startswith("pyee"):
        req = req.split(";", 1)[0].strip()
        print(req)

# Preserve SymPy's declared mpmath requirement where available.
for req in dependencies("sympy"):
    if req.lower().startswith("mpmath"):
        req = req.split(";", 1)[0].strip()
        print(req)

# Fallbacks for the environment that originally produced the conflict.
print("pyee>=13,<14")
print("mpmath>=1.1.0,<1.4")
PYEOF

# Remove duplicate blank lines while preserving valid constraints.
awk 'NF && !seen[$0]++' "$CONSTRAINTS_FILE" > "${CONSTRAINTS_FILE}.tmp"
mv "${CONSTRAINTS_FILE}.tmp" "$CONSTRAINTS_FILE"

printf '   Active compatibility constraints:\n'
sed 's/^/      • /' "$CONSTRAINTS_FILE"

success "Dependency constraints prepared"

# ─────────────────────────────────────────────────────────────────────────────
# 7. Pre-flight dependency check — PRINT THE ACTUAL ERRORS
# ─────────────────────────────────────────────────────────────────────────────

info "Checking dependencies..."

set +e
pip_cmd check > "$PRECHECK_FILE" 2>&1
PRECHECK_STATUS=$?
set -e

if [ "$PRECHECK_STATUS" -eq 0 ]; then
    success "No pre-existing dependency conflicts found."
else
    warn "Pre-existing dependency conflicts detected:"
    printf '%s\n' "────────────────────────────────────────────────────────"
    cat "$PRECHECK_FILE"
    printf '%s\n' "────────────────────────────────────────────────────────"

    printf '\n'
    info "Attempting automatic dependency repair..."

    set +e

    pip_cmd install \
        "pydantic" \
        "pydantic-core" \
        "pyee>=13,<14" \
        "mpmath>=1.1.0,<1.4"

    REPAIR_STATUS=$?

    set -e

    if [ "$REPAIR_STATUS" -ne 0 ]; then
        warn "Automatic dependency repair returned an error."
    fi

    printf '\n'
    info "Checking dependencies after repair..."

    set +e
    pip_cmd check
    POSTREPAIR_STATUS=$?
    set -e

    if [ "$POSTREPAIR_STATUS" -ne 0 ]; then
        warn "Dependency conflicts still remain after repair."
        exit 1
    fi

    success "Pre-existing dependency conflicts repaired."
fi

rm -f "$PRECHECK_FILE"

# ─────────────────────────────────────────────────────────────────────────────
# 8. Upgrade pip + packaging
# ─────────────────────────────────────────────────────────────────────────────

info "Upgrading pip + packaging..."

pip_cmd install \
    --upgrade \
    pip \
    packaging

PIP_VERSION=$(pip_cmd --version | awk '{print $2}')

success "pip $PIP_VERSION ready"

# ─────────────────────────────────────────────────────────────────────────────
# 9. Get outdated packages
# ─────────────────────────────────────────────────────────────────────────────

info "Checking for outdated Python packages..."

pip_cmd list --outdated --format=json |
"$PYTHON" -c '
import json
import sys

excluded = {
    "mpmath",
    "pyee",
    "pydantic",
    "pydantic-core",
}

packages = json.load(sys.stdin)

for package in packages:
    name = package["name"]

    if name.lower() not in excluded:
        print(name)
' > "$OUTDATED_FILE"

if [ ! -s "$OUTDATED_FILE" ]; then
    success "Nothing to upgrade in bulk"
else
    info "Upgrading Python packages with dependency constraints..."

    printf '   Packages selected for bulk upgrade:\n'

    while IFS= read -r PACKAGE_NAME; do
        [ -z "$PACKAGE_NAME" ] && continue
        printf '      • %s\n' "$PACKAGE_NAME"
    done < "$OUTDATED_FILE"

    printf '\n'

    BULK_SKIPPED=0

    # Upgrade packages one at a time.
    #
    # This is deliberate: if one package has incompatible dependency
    # requirements, it gets skipped instead of poisoning the entire env.
    while IFS= read -r PACKAGE_NAME; do
        [ -z "$PACKAGE_NAME" ] && continue

        printf '   Updating %s...\n' "$PACKAGE_NAME"

        if pip_cmd install \
            --upgrade \
            --upgrade-strategy only-if-needed \
            --constraint "$CONSTRAINTS_FILE" \
            "$PACKAGE_NAME"
        then
            success "$PACKAGE_NAME updated"
        else
            warn "$PACKAGE_NAME could not be upgraded safely — keeping its current version."
            BULK_SKIPPED=$((BULK_SKIPPED + 1))
        fi

    done < "$OUTDATED_FILE"

    if [ "$BULK_SKIPPED" -eq 0 ]; then
        success "Bulk upgrade complete"
    else
        warn "$BULK_SKIPPED package(s) were skipped because of dependency constraints."
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 10. Re-assert strict dependency versions
# ─────────────────────────────────────────────────────────────────────────────

info "Ensuring protected dependency versions..."

# Read the exact pydantic-core constraint generated above.
PYDANTIC_CORE_CONSTRAINT=$(
    sed -n '/^pydantic-core[<>=!~]/p' "$CONSTRAINTS_FILE" |
    head -n 1
)

if [ -z "$PYDANTIC_CORE_CONSTRAINT" ]; then
    PYDANTIC_CORE_CONSTRAINT="pydantic-core==2.46.5"
fi

# Prefer the installed pydantic version rather than blindly changing it.
PYDANTIC_VERSION=$(
    "$PYTHON" -c '
import importlib.metadata

try:
    print(importlib.metadata.version("pydantic"))
except importlib.metadata.PackageNotFoundError:
    pass
'
)

if [ -n "$PYDANTIC_VERSION" ]; then
    PIPDANTIC_SPEC="pydantic==$PYDANTIC_VERSION"
else
    PIPDANTIC_SPEC="pydantic>=2.0"
fi

pip_cmd install \
    -q \
    "$PIPDANTIC_SPEC" \
    "$PYDANTIC_CORE_CONSTRAINT" \
    "pyee>=13,<14" \
    "mpmath>=1.1.0,<1.4"

success "Protected dependency versions confirmed"

# ─────────────────────────────────────────────────────────────────────────────
# 11. Verify dependency tree AFTER upgrades
# ─────────────────────────────────────────────────────────────────────────────

info "Verifying environment..."

set +e
pip_cmd check > "$POSTCHECK_FILE" 2>&1
FINAL_STATUS=$?
set -e

if [ "$FINAL_STATUS" -ne 0 ]; then
    warn "Dependency conflicts detected after upgrades:"
    printf '%s\n' "────────────────────────────────────────────────────────"
    cat "$POSTCHECK_FILE"
    printf '%s\n' "────────────────────────────────────────────────────────"

    printf '\n'
    info "Attempting final dependency repair..."

    pip_cmd install \
        -q \
        "$PIPDANTIC_SPEC" \
        "$PYDANTIC_CORE_CONSTRAINT" \
        "pyee>=13,<14" \
        "mpmath>=1.1.0,<1.4"

    printf '\n'
    info "Running dependency check again..."

    set +e
    pip_cmd check
    FINAL_RECHECK_STATUS=$?
    set -e

    if [ "$FINAL_RECHECK_STATUS" -ne 0 ]; then
        warn "Dependencies are still broken."
        exit 1
    fi

    success "Final dependency repair succeeded."
else
    success "Dependency verification passed — no broken requirements found."
fi

rm -f "$POSTCHECK_FILE"

# ─────────────────────────────────────────────────────────────────────────────
# 12. Vendor independent latest mpmath
# ─────────────────────────────────────────────────────────────────────────────

VENDOR_DIR="$REPO_ROOT/_vendor_mpmath"

info "Vendoring latest mpmath → $VENDOR_DIR..."

rm -rf "$VENDOR_DIR"

pip_cmd install \
    mpmath \
    --target="$VENDOR_DIR" \
    --no-deps \
    -q

if [ -d "$VENDOR_DIR/mpmath" ]; then
    rm -rf "$VENDOR_DIR/mpmath14"

    mv \
        "$VENDOR_DIR/mpmath" \
        "$VENDOR_DIR/mpmath14"

    success "Vendored mpmath copy created"
else
    warn "Could not create vendored mpmath copy"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 13. Optional math source repositories
# ─────────────────────────────────────────────────────────────────────────────

printf '\n📦  Download/update math library source repos?\n'
printf '   Shallow clones are used and .git/readme files are removed afterwards.\n'
printf '\n   Clone math repos now? [y/N] → '

read -r DLREPOS </dev/tty || DLREPOS=""

case "$DLREPOS" in
    y|Y)
        if ! command -v git >/dev/null 2>&1; then
            warn "git not found — skipping math source sync"
        else
            while IFS='|' read -r NAME URL; do
                [ -z "$NAME" ] && continue

                DEST="$MATH_MODULES_DIR/$NAME"

                rm -rf "$DEST"

                printf '   ↓  %s  %s\n' "$NAME" "$URL"

                if git clone \
                    --depth=1 \
                    --single-branch \
                    -q \
                    "$URL" \
                    "$DEST" 2>/dev/null
                then
                    rm -rf "$DEST/.git"

                    find "$DEST" \
                        -type f \
                        -name ".gitignore" \
                        -delete \
                        2>/dev/null || true

                    find "$DEST" \
                        -type f \
                        -iname "readme*" \
                        -delete \
                        2>/dev/null || true

                    success "$NAME synced"
                else
                    rm -rf "$DEST" 2>/dev/null || true
                    warn "Failed: $NAME"
                fi

            done <<'MATH_REPOS'
precision|https://github.com/fredrik-johansson/arb
algebra|https://codeberg.org/ginac/cln
symbolic|https://github.com/fricas/fricas
geometry|https://codeberg.org/ginac/ginac
integers|https://github.com/asheplyakov/gmp
matrices|https://github.com/linbox-team/linbox
floats|https://gitlab.inria.fr/mpfr/mpfr.git
analysis|https://github.com/mpmath/mpmath
arrays|https://github.com/numpy/numpy
theory|https://pari.math.u-bordeaux.fr/git/pari.git
advanced|https://github.com/sagemath/sage
scientific|https://github.com/scipy/scipy
gaypy|https://github.com/sympy/sympy
MATH_REPOS
        fi
        ;;
    *)
        printf 'Skipped math source sync.\n'
        ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
# 14. Optional AI API / SDK source repositories
# ─────────────────────────────────────────────────────────────────────────────

printf '\n🤖  Download/update AI API/SDK source repos?\n'
printf '   Provider map:\n'
printf '     openai      → OpenAI Python SDK\n'
printf '     anthropic   → Anthropic Claude Python SDK\n'
printf '     gemini      → Google Gen AI Python SDK\n'
printf '     groq        → Groq Python SDK\n'
printf '     mistral     → Mistral AI Python SDK\n'
printf '     xai         → xAI Python SDK (Grok)\n'
printf '     deepseek    → DeepSeek official harness/SDK source\n'
printf '     roastedbyai → roastedbyai source used by roast features\n'
printf '     wolfram     → Wolfram Python client source\n'
printf '\n   Clone/update AI repos now? [y/N] → '

read -r DLAI </dev/tty || DLAI=""

case "$DLAI" in
    y|Y)
        if ! command -v git >/dev/null 2>&1; then
            warn "git not found — skipping AI source sync"
        else
            while IFS='|' read -r NAME URL; do
                [ -z "$NAME" ] && continue

                DEST="$AI_MODULES_DIR/$NAME"

                rm -rf "$DEST"

                printf '   ↓  %s  %s\n' "$NAME" "$URL"

                if git clone \
                    --depth=1 \
                    --single-branch \
                    -q \
                    "$URL" \
                    "$DEST" 2>/dev/null
                then
                    rm -rf "$DEST/.git"

                    find "$DEST" \
                        -type f \
                        -name ".gitignore" \
                        -delete \
                        2>/dev/null || true

                    find "$DEST" \
                        -type f \
                        -iname "readme*" \
                        -delete \
                        2>/dev/null || true

                    success "$NAME synced"
                else
                    rm -rf "$DEST" 2>/dev/null || true
                    warn "Failed: $NAME  ($URL)"
                fi

            done <<'AI_REPOS'
openai|https://github.com/openai/openai-python
anthropic|https://github.com/anthropics/anthropic-sdk-python
gemini|https://github.com/googleapis/python-genai
groq|https://github.com/groq/groq-python
mistral|https://github.com/mistralai/client-python
xai|https://github.com/xai-org/xai-sdk-python
deepseek|https://github.com/deepseek-ai/deepseek-harness
roastedbyai|https://github.com/jvherck/roastedbyai
wolfram|https://github.com/WolframResearch/WolframClientForPython
AI_REPOS
        fi

        cat > "$AI_MODULES_DIR/provider-manifest.json" <<'JSON'
{
  "providers": {
    "openai":   { "source": "openai", "api_style": "native" },
    "claude":   { "source": "anthropic", "api_style": "native" },
    "gemini":   { "source": "gemini", "api_style": "native" },
    "groq":     { "source": "groq", "api_style": "native" },
    "mistral":  { "source": "mistral", "api_style": "native" },
    "grok":     { "source": "xai", "api_style": "native" },
    "deepseek": { "source": "deepseek", "api_style": "openai-compatible" }
  }
}
JSON

        success "AI provider manifest written → $AI_MODULES_DIR/provider-manifest.json"
        ;;
    *)
        printf 'Skipped AI source sync.\n'
        ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
# 15. Sanity check
# ─────────────────────────────────────────────────────────────────────────────

info "Sanity check..."

"$PYTHON" - <<'PYEOF'
import sys

mods = [
    ("sympy", "sympy"),
    ("mpmath", "mpmath"),
]

failed = False

for label, mod in mods:
    try:
        module = __import__(mod)
        version = getattr(module, "__version__", "?")
        print(f"    {label:8} {version} ✅")
    except Exception as exc:
        print(f"    {label:8} ❌ {exc}")
        failed = True

if failed:
    sys.exit(1)
PYEOF

# ─────────────────────────────────────────────────────────────────────────────
# 16. Final dependency report
# ─────────────────────────────────────────────────────────────────────────────

info "Final dependency report..."

set +e
FINAL_REPORT=$(pip_cmd check 2>&1)
FINAL_REPORT_STATUS=$?
set -e

if [ "$FINAL_REPORT_STATUS" -eq 0 ]; then
    success "pip check: No broken requirements found."
else
    warn "pip check found remaining problems:"
    printf '%s\n' "────────────────────────────────────────────────────────"
    printf '%s\n' "$FINAL_REPORT"
    printf '%s\n' "────────────────────────────────────────────────────────"
    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 17. Finish
# ─────────────────────────────────────────────────────────────────────────────

SUCCESS=1

printf '\n✅ update_env finished — environment + optional source sync complete.\n'
printf '   Repository: %s\n' "$REPO_ROOT"
printf '   Python:     %s\n' "$PYTHON"
