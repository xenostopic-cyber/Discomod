#!/usr/bin/env zsh
# update_env — upgrade project Python env + math sources + AI SDK/API sources

set -e
set -o pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR}"

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

LOCKFILE="/tmp/advik_pip_lock_$$.txt"
ROLLED_BACK=0
SUCCESS=0

# ── Rollback ──────────────────────────────────────────────────────────────────
_rollback() {
    if [[ $SUCCESS -eq 0 && $ROLLED_BACK -eq 0 && -f "$LOCKFILE" ]]; then
        ROLLED_BACK=1

        printf '\n💥 Failure detected — rolling back...\n'

        if python -m pip install -q -r "$LOCKFILE" --force-reinstall 2>/dev/null; then
            printf '   Rollback complete.\n'
        else
            printf '   Rollback may be incomplete — check %s\n' "$LOCKFILE"
        fi
    fi
}

trap '_rollback' ERR

# ── 0. Optional system upgrade ────────────────────────────────────────────────
if [[ "${RUN_SYSTEM_UPGRADE:-0}" == "1" ]]; then
    info "Checking system package manager for upgrades..."

    if command -v apt-get &>/dev/null; then
        export DEBIAN_FRONTEND=noninteractive

        APT_OPTS='-o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"'

        sudo -E apt-get update -qq > /dev/null
        sudo -E apt-get upgrade -y -qq $APT_OPTS > /dev/null

        success "System packages upgraded."
    else
        warn "apt package manager not found. Skipping system-level upgrade."
    fi
else
    info "Skipping system-level package upgrade (set RUN_SYSTEM_UPGRADE=1 to enable)."
fi

# ── 1. Resolve module directories ─────────────────────────────────────────────
MATH_MODULES_DIR="${REPO_ROOT}/math_modules"
AI_MODULES_DIR="${REPO_ROOT}/ai_modules/core"

mkdir -p "$MATH_MODULES_DIR" "$AI_MODULES_DIR"

# ── 2. Optional latest Qalculate! vendor ──────────────────────────────────────
info "Detecting latest Qalculate! release from GitHub (best-effort)..."

(
    cd /tmp

    API_JSON=$(wget -qO- \
        "https://api.github.com/repos/Qalculate/libqalculate/releases/latest" \
        2>/dev/null) || true

    if [[ -z "$API_JSON" ]]; then
        warn "Couldn't reach the GitHub API — skipping Qalculate! update."
        exit 0
    fi

    QALC_TAG=$(printf '%s\n' "$API_JSON" |
        grep -m1 '"tag_name"' |
        sed -E 's/.*"tag_name": *"([^"]+)".*/\1/') || true

    if [[ -z "$QALC_TAG" ]]; then
        warn "Qalculate! release tag was not found — skipping."
        exit 0
    fi

    QALC_VERSION="${QALC_TAG#v}"
    QALC_ARCHIVE="qalculate-${QALC_VERSION}-x86_64.tar.xz"
    QALC_URL="https://github.com/Qalculate/libqalculate/releases/download/${QALC_TAG}/${QALC_ARCHIVE}"

    if wget -q --show-progress "$QALC_URL"; then
        tar -xf "$QALC_ARCHIVE"

        if [[ -x "./qalculate-${QALC_VERSION}/qalculate" ]]; then
            cp "./qalculate-${QALC_VERSION}/qalculate" "$MATH_MODULES_DIR/qalc"
            chmod +x "$MATH_MODULES_DIR/qalc"

            success "Qalculate! ${QALC_TAG} deployed → $MATH_MODULES_DIR/qalc"
        else
            warn "Downloaded Qalculate archive but expected binary was missing."
        fi

        rm -rf "qalculate-${QALC_VERSION}" "$QALC_ARCHIVE"
    else
        rm -f "$QALC_ARCHIVE"
        warn "Qalculate! download failed for ${QALC_TAG}."
    fi
) || warn "Continuing without a Qalculate! update this run."

# ── 3. Activate venv ──────────────────────────────────────────────────────────
VENV_ACTIVATED=0

_try_activate() {
    local venv_path="$1"
    local label="$2"

    if [[ -f "$venv_path/bin/activate" ]]; then
        info "Activating $label..."

        source "$venv_path/bin/activate"

        VENV_ACTIVATED=1
        return 0
    fi

    return 1
}

[[ -n "${1:-}" ]] && _try_activate "$1" "venv from arg" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate "$HOME/venvs/advikmathlib_env" "advikmathlib_env" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate "$REPO_ROOT/.venv" ".venv (project)" || true
[[ $VENV_ACTIVATED -eq 0 ]] && _try_activate ".venv" ".venv (cwd)" || true
[[ $VENV_ACTIVATED -eq 0 ]] && fail "No venv found"

printf '   Using: %s  (%s)\n' "$(which python)" "$(python --version)"

# ── 4. Save rollback snapshot ─────────────────────────────────────────────────
info "Saving rollback snapshot..."

python -m pip freeze > "$LOCKFILE"

success "Saved $(wc -l < "$LOCKFILE" | tr -d ' ') packages"

# ── 5. Pre-flight dependency check ───────────────────────────────────────────
info "Checking dependencies..."

PRECHECK_OUTPUT="$(python -m pip check 2>&1)" || PRECHECK_STATUS=$?
PRECHECK_STATUS="${PRECHECK_STATUS:-0}"

if [[ "$PRECHECK_STATUS" -eq 0 ]]; then
    success "No pre-existing dependency conflicts found."
else
    warn "Pre-existing dependency conflicts detected:"
    printf '%s\n' "$PRECHECK_OUTPUT"

    printf '\n'
    info "Attempting automatic dependency repair..."

    # Known strict compatibility set for this environment.
    python -m pip install -q \
        "pydantic==2.13.5" \
        "pydantic-core==2.46.5" \
        "pyee>=13,<14" \
        "mpmath>=1.1.0,<1.4" || {
            warn "Automatic repair command failed."
        }

    printf '\n'
    info "Dependency check after automatic repair..."

    POSTREPAIR_OUTPUT="$(python -m pip check 2>&1)" || POSTREPAIR_STATUS=$?
    POSTREPAIR_STATUS="${POSTREPAIR_STATUS:-0}"

    if [[ "$POSTREPAIR_STATUS" -eq 0 ]]; then
        success "All previously detected dependency conflicts were repaired."
    else
        warn "Conflicts still remain after automatic repair:"
        printf '%s\n' "$POSTREPAIR_OUTPUT"

        warn "The environment will be rolled back rather than continuing with a broken dependency tree."
        _rollback
        exit 1
    fi
fi

# ── 6. Upgrade pip + packaging ────────────────────────────────────────────────
info "Upgrading pip + packaging..."

python -m pip install --upgrade pip packaging -q

success "pip $(python -m pip --version | cut -d' ' -f2) ready"

# ── 7. Upgrade packages while preserving constraints ─────────────────────────
info "Upgrading Python packages (dependency-safe)..."

# Packages with strict compatibility requirements are excluded from
# the bulk upgrade. They are restored explicitly below.
OUTDATED=$(python -c "
import json

excluded = {
    'mpmath',
    'pyee',
    'pydantic',
    'pydantic-core',
}

packages = json.load(open('/dev/stdin'))

print('\n'.join(
    p['name']
    for p in packages
    if p['name'].lower() not in excluded
))
" 2>/dev/null <<< "$(python -m pip list --outdated --format=json)")

if [[ -z "$OUTDATED" ]]; then
    success "Nothing to upgrade in bulk"
else
    print -l $OUTDATED |
        xargs python -m pip install -U --upgrade-strategy only-if-needed

    success "Bulk upgrade complete"
fi

# ── 7b. Restore compatible dependency versions ───────────────────────────────
info "Restoring compatible dependency versions..."

python -m pip install -q \
    "pydantic==2.13.5" \
    "pydantic-core==2.46.5" \
    "pyee>=13,<14"

python -m pip install -q \
    "mpmath>=1.1.0,<1.4"

success "Compatible dependency versions restored"

# ── 8. Verify environment ─────────────────────────────────────────────────────
info "Verifying environment..."

FINAL_CHECK="$(python -m pip check 2>&1)" || FINAL_STATUS=$?
FINAL_STATUS="${FINAL_STATUS:-0}"

if [[ "$FINAL_STATUS" -ne 0 ]]; then
    warn "Dependency conflicts detected after package upgrades:"
    printf '%s\n' "$FINAL_CHECK"

    printf '\n'
    info "Attempting final automatic repair..."

    python -m pip install -q \
        "pydantic==2.13.5" \
        "pydantic-core==2.46.5" \
        "pyee>=13,<14" \
        "mpmath>=1.1.0,<1.4" || true

    printf '\n'
    info "Running final dependency check..."

    FINAL_RECHECK="$(python -m pip check 2>&1)" || FINAL_RECHECK_STATUS=$?
    FINAL_RECHECK_STATUS="${FINAL_RECHECK_STATUS:-0}"

    if [[ "$FINAL_RECHECK_STATUS" -ne 0 ]]; then
        warn "Conflicts still remain:"
        printf '%s\n' "$FINAL_RECHECK"

        _rollback
        exit 1
    fi

    success "Final dependency repair succeeded."
else
    success "Dependency verification passed — no broken requirements found."
fi

# ── 9. Vendor independent latest mpmath ───────────────────────────────────────
VENDOR_DIR="$REPO_ROOT/_vendor_mpmath"

info "Vendoring latest mpmath → $VENDOR_DIR..."

rm -rf "$VENDOR_DIR"

python -m pip install mpmath \
    --target="$VENDOR_DIR" \
    --no-deps \
    -q

if [[ -d "$VENDOR_DIR/mpmath" ]]; then
    mv "$VENDOR_DIR/mpmath" "$VENDOR_DIR/mpmath14"
    success "Vendored mpmath copy created"
else
    warn "Could not create vendored mpmath copy"
fi

# ── 10. Optional math source repositories ─────────────────────────────────────
printf '\n📦  Download/update math library source repos?\n'
printf '   This mirrors the original update_env behavior: shallow clone, then remove VCS/readme files.\n'
printf '\n   Clone math repos now? [y/N] → '

read -r _DLREPOS </dev/tty

if [[ "${_DLREPOS:l}" == "y" ]]; then
    if ! command -v git &>/dev/null; then
        warn "git not found — skipping math source sync"
    else
        typeset -A _REPOS

        _REPOS=(
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

        for _name _url in "${(@kv)_REPOS[@]}"; do
            _dest="$MATH_MODULES_DIR/$_name"

            rm -rf "$_dest"

            printf '   ↓  %s  %s\n' "$_name" "$_url"

            if git clone \
                --depth=1 \
                --single-branch \
                -q \
                "$_url" \
                "$_dest" 2>/dev/null
            then
                rm -rf "$_dest/.git"

                find "$_dest" \
                    -type f \
                    -name ".gitignore" \
                    -delete \
                    2>/dev/null || true

                find "$_dest" \
                    -type f \
                    -iname "readme*" \
                    -delete \
                    2>/dev/null || true

                success "$_name synced"
            else
                rm -rf "$_dest" 2>/dev/null || true
                warn "Failed: $_name"
            fi
        done
    fi
else
    printf 'Skipped math source sync.\n'
fi

# ── 11. AI API/SDK source repositories ────────────────────────────────────────
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

read -r _DLAI </dev/tty

AI_SYNC_STATUS="$AI_MODULES_DIR/.sync-status.json"

if [[ "${_DLAI:l}" == "y" ]]; then
    if ! command -v git &>/dev/null; then
        warn "git not found — skipping AI source sync"
    else
        typeset -A _AI_REPOS

        _AI_REPOS=(
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

        typeset -A _AI_RESULTS

        for _name _url in "${(@kv)_AI_REPOS[@]}"; do
            _dest="$AI_MODULES_DIR/$_name"

            rm -rf "$_dest"

            printf '   ↓  %s  %s\n' "$_name" "$_url"

            if git clone \
                --depth=1 \
                --single-branch \
                -q \
                "$_url" \
                "$_dest" 2>/dev/null
            then
                rm -rf "$_dest/.git"

                find "$_dest" \
                    -type f \
                    -name ".gitignore" \
                    -delete \
                    2>/dev/null || true

                find "$_dest" \
                    -type f \
                    -iname "readme*" \
                    -delete \
                    2>/dev/null || true

                _AI_RESULTS[$_name]="ok"

                success "$_name synced"
            else
                rm -rf "$_dest" 2>/dev/null || true

                _AI_RESULTS[$_name]="failed"

                warn "Failed: $_name  ($_url)"
            fi
        done

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
    fi
else
    printf 'Skipped AI source sync.\n'
fi

# ── 12. Sanity check ──────────────────────────────────────────────────────────
info "Sanity check..."

python - <<'PYEOF'
import sys

mods = [
    ("sympy", "sympy"),
    ("mpmath", "mpmath"),
]

failed = False

for label, mod in mods:
    try:
        m = __import__(mod)
        print(
            f"    {label:8} "
            f"{getattr(m, '__version__', '?')} ✅"
        )
    except Exception as e:
        print(f"    {label:8} ❌ {e}")
        failed = True

if failed:
    sys.exit(1)
PYEOF

# ── 13. Final dependency report ───────────────────────────────────────────────
info "Final dependency report..."

FINAL_REPORT="$(python -m pip check 2>&1)" || FINAL_REPORT_STATUS=$?
FINAL_REPORT_STATUS="${FINAL_REPORT_STATUS:-0}"

if [[ "$FINAL_REPORT_STATUS" -eq 0 ]]; then
    success "pip check: No broken requirements found."
else
    warn "pip check found remaining problems:"
    printf '%s\n' "$FINAL_REPORT"

    _rollback
    exit 1
fi

# ── 14. Finish ────────────────────────────────────────────────────────────────
rm -f "$LOCKFILE"

SUCCESS=1

printf '\n✅ update_env finished — environment + optional source sync complete.\n'
