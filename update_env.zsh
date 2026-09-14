#!/usr/bin/env zsh
# update_env.zsh — upgrade project Python env + math sources + AI SDK/API sources
#
# AI providers covered:
#   OpenAI, Anthropic/Claude, Google Gemini, Groq, Mistral, xAI/Grok,
#   DeepSeek, roastedbyai and Wolfram.
#
# Source sync is opt-in.
# System package upgrades are opt-in with RUN_SYSTEM_UPGRADE=1.
#
# Zsh version.
#
# IMPORTANT:
# The script may be installed in /usr/local/bin.
# Therefore the script's own directory is NOT assumed to be the repository root.

set -e
set -o pipefail

# ─────────────────────────────────────────────────────────────────────────────
# 0. Resolve repository root
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="${0:A:h}"

if [[ -n "${REPO_ROOT:-}" ]]; then
    REPO_ROOT="${REPO_ROOT:A}"
elif REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
    :
else
    REPO_ROOT="${PWD:A}"
fi

# ─────────────────────────────────────────────────────────────────────────────
# Output helpers
# ─────────────────────────────────────────────────────────────────────────────

info() {
    print -P "\n%F{cyan}🔹 %f$1"
}

success() {
    print -P "%F{green}   ✅ %f$1"
}

warn() {
    print -P "%F{yellow}   ⚠️  %f$1"
}

fail() {
    print -P "%F{red}   ❌ %f$1"
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
    local STATUS=$?

    if [[ $STATUS -ne 0 &&
          $SUCCESS -eq 0 &&
          $ROLLING_BACK -eq 0 &&
          -f "$LOCKFILE" ]]; then

        ROLLING_BACK=1

        print -P "\n%F{red}%B💥 Failure detected — rolling back environment...%b%f"

        set +e

        python -m pip install \
            -q \
            -r "$LOCKFILE" \
            --force-reinstall \
            2>/dev/null

        local ROLLBACK_STATUS=$?

        if [[ $ROLLBACK_STATUS -eq 0 ]]; then
            print -P "%F{green}   ✅ Rollback complete.%f"
        else
            print -P "%F{yellow}   ⚠️  Rollback may be incomplete — check $LOCKFILE%f"
        fi

        set -e
    fi

    cleanup

    if [[ $STATUS -ne 0 ]]; then
        exit "$STATUS"
    fi
}

trap '_rollback_status=$?; rollback_if_needed' EXIT
trap 'exit 130' INT TERM

# ─────────────────────────────────────────────────────────────────────────────
# 1. Check basic tools
# ─────────────────────────────────────────────────────────────────────────────

info "Checking required tools..."

command -v python >/dev/null 2>&1 ||
    fail "python was not found."

if ! command -v git >/dev/null 2>&1; then
    warn "git was not found. Repository syncing will be unavailable."
fi

if ! command -v curl >/dev/null 2>&1; then
    warn "curl was not found. Qalculate! release detection will be unavailable."
fi

success "Required runtime detected"

# ─────────────────────────────────────────────────────────────────────────────
# 2. Optional system upgrade
# ─────────────────────────────────────────────────────────────────────────────

if [[ "${RUN_SYSTEM_UPGRADE:-0}" == "1" ]]; then

    info "Checking system package manager for upgrades..."

    if command -v apt-get >/dev/null 2>&1; then

        export DEBIAN_FRONTEND=noninteractive

        APT_OPTS=(
            '-o'
            'Dpkg::Options::=--force-confdef'
            '-o'
            'Dpkg::Options::=--force-confold'
        )

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

print "   Repository root: $REPO_ROOT"
print "   Math modules:    $MATH_MODULES_DIR"
print "   AI modules:      $AI_MODULES_DIR"

# ─────────────────────────────────────────────────────────────────────────────
# 4. Locate virtual environment
#
# Do NOT source activate.
# We directly invoke the exact Python executable.
# This avoids OSTYPE / shell compatibility problems.
# ─────────────────────────────────────────────────────────────────────────────

VENV_PATH=""

if [[ -n "${1:-}" && -x "$1/bin/python" ]]; then
    VENV_PATH="${1:A}"
elif [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    VENV_PATH="$REPO_ROOT/.venv"
elif [[ -x "$HOME/venvs/advikmathlib_env/bin/python" ]]; then
    VENV_PATH="$HOME/venvs/advikmathlib_env"
elif [[ -x "$PWD/.venv/bin/python" ]]; then
    VENV_PATH="$PWD/.venv"
fi

if [[ -z "$VENV_PATH" ]]; then
    fail "No usable virtual environment found."
fi

PYTHON="$VENV_PATH/bin/python"

print
print "   Virtual environment: $VENV_PATH"
print "   Python executable:    $PYTHON"
printf "   Python version:      "
"$PYTHON" --version

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
# 6. Build dependency compatibility constraints
# ─────────────────────────────────────────────────────────────────────────────

info "Building dependency compatibility constraints..."

"$PYTHON" > "$CONSTRAINTS_FILE" <<'PYEOF'
import importlib.metadata


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


# Preserve currently installed Pydantic.
pydantic_version = installed_version("pydantic")

if pydantic_version:
    print(f"pydantic=={pydantic_version}")


# Preserve the exact pydantic-core requirement declared by Pydantic.
for requirement in dependencies("pydantic"):
    if requirement.lower().startswith("pydantic-core"):
        requirement = requirement.split(";", 1)[0].strip()
        print(requirement)


# Preserve Playwright's pyee requirement.
for requirement in dependencies("playwright"):
    if requirement.lower().startswith("pyee"):
        requirement = requirement.split(";", 1)[0].strip()
        print(requirement)


# Preserve SymPy's mpmath requirement.
for requirement in dependencies("sympy"):
    if requirement.lower().startswith("mpmath"):
        requirement = requirement.split(";", 1)[0].strip()
        print(requirement)


# Safe fallbacks for this environment.
print("pyee>=13,<14")
print("mpmath>=1.1.0,<1.4")
PYEOF

awk 'NF && !seen[$0]++' "$CONSTRAINTS_FILE" > "${CONSTRAINTS_FILE}.tmp"
mv "${CONSTRAINTS_FILE}.tmp" "$CONSTRAINTS_FILE"

print "   Active compatibility constraints:"

while IFS= read -r constraint; do
    print "      • $constraint"
done < "$CONSTRAINTS_FILE"

success "Dependency constraints prepared"

# ─────────────────────────────────────────────────────────────────────────────
# 7. Pre-flight dependency check
# ─────────────────────────────────────────────────────────────────────────────

info "Checking dependencies..."

set +e
pip_cmd check > "$PRECHECK_FILE" 2>&1
PRECHECK_STATUS=$?
set -e

if [[ $PRECHECK_STATUS -eq 0 ]]; then

    success "No pre-existing dependency conflicts found."

else

    warn "Pre-existing dependency conflicts detected:"

    print "────────────────────────────────────────────────────────"
    cat "$PRECHECK_FILE"
    print "────────────────────────────────────────────────────────"

    print
    info "Attempting automatic dependency repair..."

    set +e

    pip_cmd install \
        "pydantic" \
        "pydantic-core" \
        "pyee>=13,<14" \
        "mpmath>=1.1.0,<1.4"

    REPAIR_STATUS=$?

    set -e

    if [[ $REPAIR_STATUS -ne 0 ]]; then
        warn "Automatic dependency repair returned an error."
    fi

    print
    info "Checking dependencies after repair..."

    set +e
    pip_cmd check
    POSTREPAIR_STATUS=$?
    set -e

    if [[ $POSTREPAIR_STATUS -ne 0 ]]; then
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
    packaging \
    -q

PIP_VERSION=$(pip_cmd --version | awk '{print $2}')

success "pip $PIP_VERSION ready"

# ─────────────────────────────────────────────────────────────────────────────
# 9. Find outdated packages
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

# ─────────────────────────────────────────────────────────────────────────────
# 10. Upgrade packages with constraints
# ─────────────────────────────────────────────────────────────────────────────

if [[ ! -s "$OUTDATED_FILE" ]]; then

    success "Nothing to upgrade in bulk"

else

    info "Upgrading Python packages with dependency constraints..."

    print "   Packages selected for bulk upgrade:"

    while IFS= read -r PACKAGE_NAME; do
        [[ -z "$PACKAGE_NAME" ]] && continue
        print "      • $PACKAGE_NAME"
    done < "$OUTDATED_FILE"

    print

    BULK_SKIPPED=0

    while IFS= read -r PACKAGE_NAME; do
        [[ -z "$PACKAGE_NAME" ]] && continue

        print "   Updating $PACKAGE_NAME..."

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

    if [[ $BULK_SKIPPED -eq 0 ]]; then
        success "Bulk upgrade complete"
    else
        warn "$BULK_SKIPPED package(s) were skipped because of dependency constraints."
    fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 11. Re-assert protected dependencies
# ─────────────────────────────────────────────────────────────────────────────

info "Ensuring protected dependency versions..."

PYDANTIC_CORE_CONSTRAINT=$(
    sed -n '/^pydantic-core[<>=!~]/p' "$CONSTRAINTS_FILE" |
    head -n 1
)

if [[ -z "$PYDANTIC_CORE_CONSTRAINT" ]]; then
    PYDANTIC_CORE_CONSTRAINT="pydantic-core==2.46.5"
fi

PYDANTIC_VERSION=$(
    "$PYTHON" -c '
import importlib.metadata

try:
    print(importlib.metadata.version("pydantic"))
except importlib.metadata.PackageNotFoundError:
    pass
'
)

if [[ -n "$PYDANTIC_VERSION" ]]; then
    PYDANTIC_SPEC="pydantic==$PYDANTIC_VERSION"
else
    PYDANTIC_SPEC="pydantic>=2.0"
fi

pip_cmd install \
    -q \
    "$PYDANTIC_SPEC" \
    "$PYDANTIC_CORE_CONSTRAINT" \
    "pyee>=13,<14" \
    "mpmath>=1.1.0,<1.4"

success "Protected dependency versions confirmed"

# ─────────────────────────────────────────────────────────────────────────────
# 12. Verify environment after upgrades
# ─────────────────────────────────────────────────────────────────────────────

info "Verifying environment..."

set +e
pip_cmd check > "$POSTCHECK_FILE" 2>&1
FINAL_STATUS=$?
set -e

if [[ $FINAL_STATUS -ne 0 ]]; then

    warn "Dependency conflicts detected after upgrades:"

    print "────────────────────────────────────────────────────────"
    cat "$POSTCHECK_FILE"
    print "────────────────────────────────────────────────────────"

    print
    info "Attempting final dependency repair..."

    pip_cmd install \
        -q \
        "$PYDANTIC_SPEC" \
        "$PYDANTIC_CORE_CONSTRAINT" \
        "pyee>=13,<14" \
        "mpmath>=1.1.0,<1.4"

    print
    info "Running dependency check again..."

    set +e
    pip_cmd check
    FINAL_RECHECK_STATUS=$?
    set -e

    if [[ $FINAL_RECHECK_STATUS -ne 0 ]]; then
        warn "Dependencies are still broken."
        exit 1
    fi

    success "Final dependency repair succeeded."

else

    success "Dependency verification passed — no broken requirements found."

fi

rm -f "$POSTCHECK_FILE"

# ─────────────────────────────────────────────────────────────────────────────
# 13. Vendor independent latest mpmath
# ─────────────────────────────────────────────────────────────────────────────

VENDOR_DIR="$REPO_ROOT/_vendor_mpmath"

info "Vendoring latest mpmath → $VENDOR_DIR..."

rm -rf "$VENDOR_DIR"

pip_cmd install \
    mpmath \
    --target="$VENDOR_DIR" \
    --no-deps \
    -q

if [[ -d "$VENDOR_DIR/mpmath" ]]; then

    rm -rf "$VENDOR_DIR/mpmath14"

    mv \
        "$VENDOR_DIR/mpmath" \
        "$VENDOR_DIR/mpmath14"

    success "Vendored mpmath copy created"

else

    warn "Could not create vendored mpmath copy"

fi

# ─────────────────────────────────────────────────────────────────────────────
# 14. Optional math source repositories
# ─────────────────────────────────────────────────────────────────────────────

print -P "\n%F{cyan}%B📦  Download/update math library source repos?%b%f"
print "   Shallow clones are used and .git/readme files are removed afterwards."
print -n "\n   Clone math repos now? [y/N] → "

read -r DLREPOS </dev/tty || DLREPOS=""

if [[ "${DLREPOS:l}" == "y" ]]; then

    if ! command -v git >/dev/null 2>&1; then

        warn "git not found — skipping math source sync"

    else

        typeset -A MATH_REPOS

        MATH_REPOS=(
            precision   "https://github.com/fredrik-johansson/arb"
            algebra     "https://codeberg.org/ginac/cln"
            symbolic    "https://github.com/fricas/fricas"
            geometry    "https://codeberg.org/ginac/ginac"
            integers    "https://github.com/asheplyakov/gmp"
            matrices    "https://github.com/linbox-team/linbox"
            floats      "https://gitlab.inria.fr/mpfr/mpfr.git"
            analysis    "https://github.com/mpmath/mpmath"
            arrays      "https://github.com/numpy/numpy"
            theory      "https://pari.math.u-bordeaux.fr/git/pari.git"
            advanced    "https://github.com/sagemath/sage"
            scientific  "https://github.com/scipy/scipy"
            gaypy       "https://github.com/sympy/sympy"
        )

        for NAME URL in ${(kv)MATH_REPOS}; do

            DEST="$MATH_MODULES_DIR/$NAME"

            rm -rf "$DEST"

            print "   ↓  $NAME  $URL"

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

        done

    fi

else

    print "Skipped math source sync."

fi

# ─────────────────────────────────────────────────────────────────────────────
# 15. AI API / SDK source repositories
# ─────────────────────────────────────────────────────────────────────────────

print -P "\n%F{cyan}%B🤖  Download/update AI API/SDK source repos?%b%f"

print "   Provider map:"
print "     openai      → OpenAI Python SDK"
print "     anthropic   → Anthropic Claude Python SDK"
print "     gemini      → Google Gen AI Python SDK"
print "     groq        → Groq Python SDK"
print "     mistral     → Mistral AI Python SDK"
print "     xai         → xAI Python SDK (Grok)"
print "     deepseek    → DeepSeek official harness/SDK source"
print "     roastedbyai → roastedbyai source used by roast features"
print "     wolfram     → Wolfram Python client source"

print -n "\n   Clone/update AI repos now? [y/N] → "

read -r DLAI </dev/tty || DLAI=""

if [[ "${DLAI:l}" == "y" ]]; then

    if ! command -v git >/dev/null 2>&1; then

        warn "git not found — skipping AI source sync"

    else

        typeset -A AI_REPOS

        AI_REPOS=(
            openai       "https://github.com/openai/openai-python"
            anthropic    "https://github.com/anthropics/anthropic-sdk-python"
            gemini       "https://github.com/googleapis/python-genai"
            groq         "https://github.com/groq/groq-python"
            mistral      "https://github.com/mistralai/client-python"
            xai          "https://github.com/xai-org/xai-sdk-python"
            deepseek     "https://github.com/deepseek-ai/deepseek-harness"
            roastedbyai  "https://github.com/jvherck/roastedbyai"
            wolfram      "https://github.com/WolframResearch/WolframClientForPython"
        )

        for NAME URL in ${(kv)AI_REPOS}; do

            DEST="$AI_MODULES_DIR/$NAME"

            rm -rf "$DEST"

            print "   ↓  $NAME  $URL"

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

        done
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

else

    print "Skipped AI source sync."

fi

# ─────────────────────────────────────────────────────────────────────────────
# 16. Sanity check
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
# 17. Final dependency report
# ─────────────────────────────────────────────────────────────────────────────

info "Final dependency report..."

set +e
FINAL_REPORT=$(pip_cmd check 2>&1)
FINAL_REPORT_STATUS=$?
set -e

if [[ $FINAL_REPORT_STATUS -eq 0 ]]; then

    success "pip check: No broken requirements found."

else

    warn "pip check found remaining problems:"

    print "────────────────────────────────────────────────────────"
    print -r -- "$FINAL_REPORT"
    print "────────────────────────────────────────────────────────"

    exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# 18. Finish
# ─────────────────────────────────────────────────────────────────────────────

SUCCESS=1

rm -f \
    "$LOCKFILE" \
    "$CONSTRAINTS_FILE" \
    "$OUTDATED_FILE"

print -P "\n%F{green}%B✅ update_env finished — environment + optional source sync complete.%b%f"
print "   Repository: $REPO_ROOT"
print "   Python:     $PYTHON"
