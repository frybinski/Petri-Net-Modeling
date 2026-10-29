#!/bin/sh
# Checks a running Petri Net Modeling server with curl: the health check, the web app, the tool
# API, the project store and, if a language model is connected, the proxy. It leaves one project
# behind in the trash (it creates one and removes it again).
#
#   deploy/smoke-test.sh http://127.0.0.1:8080
#   deploy/smoke-test.sh https://pnm.example.org --user alice     (asks for the password)
#
# Used by the CI job that builds the image, and by whoever sets the server up, after the ingress
# entry is made: the same call against the public address shows that the ingress passes everything
# on (the upload size, the long timeout of the language model, the headers).
#
# Needs: curl. Exit status 0 if every check passed.

set -u

base=""
user=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user) user="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) base="$1"; shift ;;
  esac
done
if [ -z "$base" ]; then
  echo "Usage: $0 <base url> [--user <name>]" >&2
  exit 2
fi
base="${base%/}"

auth=""
if [ -n "$user" ]; then
  printf 'Password for %s: ' "$user" >&2
  stty -echo 2>/dev/null; read -r password; stty echo 2>/dev/null; echo >&2
  auth="-u $user:$password"
fi

failures=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass() { printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# request <label> <expected status> <curl arguments...>: the body goes to $tmp/body. With
# anonymous=1 the call is made without the password (for the share link).
anonymous=0
request() {
  label="$1"; expected="$2"; shift 2
  credentials="$auth"
  [ "$anonymous" = 1 ] && credentials=""
  # shellcheck disable=SC2086
  status="$(curl -sS -o "$tmp/body" -w '%{http_code}' --max-time 120 $credentials "$@" 2>"$tmp/err")" || status="000"
  if [ "$status" = "$expected" ]; then pass "$label"; else
    fail "$label (expected $expected, got $status) $(head -c 200 "$tmp/err") $(head -c 200 "$tmp/body")"
  fi
}

contains() {
  if grep -q "$2" "$tmp/body"; then pass "$1"; else fail "$1 (no \"$2\" in the answer)"; fi
}

json='Content-Type: application/json'
net='{"version":"1.0","profile":"pt-net","name":"Smoke test","types":{},"places":[{"id":"p1","name":"in","position":{"x":0,"y":0}},{"id":"p2","name":"out","position":{"x":200,"y":0}}],"transitions":[{"id":"t1","name":"go","position":{"x":100,"y":0}}],"arcs":[{"id":"a1","source":"p1","target":"t1","weight":1},{"id":"a2","source":"t1","target":"p2","weight":1}],"marking":{"p1":[1]}}'

echo "Checking $base"

request "health check" 200 "$base/api/health"
contains "health check names the app" '"app":"petri-net-modeling"'
version="$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$tmp/body")"
llm=false
grep -q '"llm":true' "$tmp/body" && llm=true

request "web app (index.html)" 200 "$base/"
contains "web app is the editor" 'Petri Net Modeler'
asset="$(sed -n 's/.*src="\(\/assets\/[^"]*\.js\)".*/\1/p' "$tmp/body" | head -n 1)"
if [ -n "$asset" ]; then
  request "script of the web app" 200 "$base$asset"
else
  fail "index.html names no script"
fi
request "path of the app falls back to index.html" 200 "$base/some/page"
request "share page" 200 "$base/s/smoke-test-token"

# Headers
curl -sSI $auth "$base/" -o "$tmp/headers" 2>/dev/null
if grep -qi '^content-security-policy:' "$tmp/headers" && grep -qi '^x-content-type-options: nosniff' "$tmp/headers"; then
  pass "security headers"
else
  fail "security headers missing"
fi

request "OpenAPI description" 200 "$base/api/v1/openapi.json"
request "validate a net" 200 -X POST -H "$json" -d "$net" "$base/api/v1/validate"
contains "validate says ok" '"ok":true'
request "simulate" 200 -X POST -H "$json" -d "{\"net\":$net,\"seconds\":60}" "$base/api/v1/simulate"
request "analyze" 200 -X POST -H "$json" -d "{\"net\":$net}" "$base/api/v1/analyze"
contains "analyze finds the state space" '"stateSpace"'
request "convert to SVG" 200 -X POST -H "$json" -d "{\"net\":$net,\"format\":\"svg\"}" "$base/api/v1/convert"
contains "SVG is an SVG" '<svg'
request "a net with errors is refused" 422 -X POST -H "$json" -d '{"net":{"version":"1.0","profile":"pt-net","name":"x","types":{},"places":[],"transitions":[{"id":"t","name":"t","position":{"x":0,"y":0}}],"arcs":[{"id":"a","source":"nowhere","target":"t","weight":1}],"marking":{}}}' "$base/api/v1/analyze"
request "a request that is not JSON is refused" 415 -X POST -H 'Content-Type: text/plain' -d "$net" "$base/api/v1/validate"

# Projects
request "create a project" 201 -X POST -H "$json" -d "{\"net\":$net}" "$base/api/v1/projects"
id="$(sed -n 's/.*"project":{"id":"\([^"]*\)".*/\1/p' "$tmp/body")"
if [ -n "$id" ]; then
  request "read the project" 200 "$base/api/v1/projects/$id"
  request "save without If-Match is refused" 428 -X PUT -H "$json" -d "{\"net\":$net}" "$base/api/v1/projects/$id"
  request "save a second version" 200 -X PUT -H "$json" -H 'If-Match: "1"' -d "{\"net\":$net}" "$base/api/v1/projects/$id"
  request "an old version conflicts" 409 -X PUT -H "$json" -H 'If-Match: "1"' -d "{\"net\":$net}" "$base/api/v1/projects/$id"
  request "versions" 200 "$base/api/v1/projects/$id/versions"
  request "make a share link" 201 -X POST -H "$json" -d '{"mode":"read"}' "$base/api/v1/projects/$id/share"
  token="$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' "$tmp/body")"
  if [ -n "$token" ]; then
    # The link needs no password.
    anonymous=1
    request "open the project through the link" 200 "$base/api/v1/shared/$token"
    request "a read link does not save" 403 -X PUT -H "$json" -H 'If-Match: "2"' -d "{\"net\":$net}" "$base/api/v1/shared/$token"
    request "the share page opens" 200 "$base/s/$token"
    anonymous=0
  else
    fail "the share link has no token"
  fi
  request "move the project to the trash" 204 -X DELETE "$base/api/v1/projects/$id"
  request "the project is gone" 404 "$base/api/v1/projects/$id"
else
  fail "the new project has no id"
fi

# Language model
if [ "$llm" = true ]; then
  request "model list" 200 "$base/llm/v1/models"
  model="$(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' "$tmp/body" | head -n 1)"
  if [ -n "$model" ]; then
    request "chat completion ($model)" 200 -X POST -H "$json" -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Say OK.\"}],\"max_tokens\":8}" "$base/llm/v1/chat/completions"
  else
    fail "the model list is empty"
  fi
  request "other paths of the model server are closed" 404 "$base/llm/v1/embeddings"
else
  echo "skip  language model (not connected)"
fi

echo
echo "Version $version: $failures check(s) failed"
[ "$failures" -eq 0 ]
