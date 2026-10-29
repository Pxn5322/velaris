#!/usr/bin/env bash
# Live check: knowledge-sources endpoints (T3.02/T3.04/T3.05) against the
# real Supabase project. Runs the API locally on LIVECHECK_PORT with the
# live DATABASE_URL and calls every route with real Supabase tokens.
set -u
cd "$(git rev-parse --show-toplevel)"
set -a; source .env.livecheck; set +a

B="http://127.0.0.1:${LIVECHECK_PORT}"
T="55555555-5555-4555-8555-555555555501"   # tenants.slug = livecheck
FOREIGN="ffa140c5-29ec-45cd-8bbe-e0236d4e7d1c"  # tenants.slug = livegov-20261028
if [ "${#T}" -ne 36 ]; then echo "BAD TENANT ID LENGTH ${#T}"; exit 1; fi

mint() { # email password -> access_token
  curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $SB_ANON_KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" |
    node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const t=JSON.parse(d);if(!t.access_token){console.error('MINT_FAILED '+JSON.stringify(t).slice(0,200));process.exit(1)}console.log(t.access_token)})"
}

TA_TOKEN=$(mint "$TENANT_ADMIN_EMAIL" "$TENANT_ADMIN_PASSWORD") || exit 1
AGENT_TOKEN=$(mint "$TEST_USER_EMAIL" "$TEST_USER_PASSWORD") || exit 1
echo "tokens minted: tenant-admin=${#TA_TOKEN} chars, agent=${#AGENT_TOKEN} chars"

st() { curl -s -o /tmp/lc_body -w "%{http_code}" "$@"; }

echo "--- 1) GET list, no credential -> expect 401"
echo "code=$(st "$B/knowledge-sources?tenantId=$T")"

echo "--- 2) GET list, agent1 (no knowledge.manage) -> expect 403"
echo "code=$(st -H "Authorization: Bearer $AGENT_TOKEN" "$B/knowledge-sources?tenantId=$T") body=$(head -c 160 /tmp/lc_body)"

echo "--- 3) GET list, tenant admin targeting a foreign tenant -> expect 403"
echo "code=$(st -H "Authorization: Bearer $TA_TOKEN" "$B/knowledge-sources?tenantId=$FOREIGN") body=$(head -c 160 /tmp/lc_body)"

echo "--- 4) GET list, malformed tenantId -> expect 403 (F-G3-1 was 500)"
echo "code=$(st -H "Authorization: Bearer $TA_TOKEN" "$B/knowledge-sources?tenantId=not-a-uuid")"

echo "--- 5) POST create MARKDOWN source as R-tenant-admin -> expect 201"
CREATE=$(curl -s -w "\n%{http_code}" -X POST "$B/knowledge-sources?tenantId=$T" \
  -H "Authorization: Bearer $TA_TOKEN" -H "Content-Type: application/json" \
  -d '{"sourceType":"MARKDOWN","content":"# Rate limits\n\nEnterprise tenants get 1000 requests per minute.\n"}')
echo "$CREATE"
BODY=$(echo "$CREATE" | sed '$d')
SRC_ID=$(echo "$BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id||''))")
echo "sourceId=$SRC_ID"

echo "--- 6) GET list -> contains the new source"
curl -s -H "Authorization: Bearer $TA_TOKEN" "$B/knowledge-sources?tenantId=$T" |
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log('count='+a.length);console.log(JSON.stringify(a.map(s=>({id:s.id,type:s.sourceType,status:s.status,error:s.errorCode}))))})"

echo "--- 7) GET detail -> provenance + status"
curl -s -w "\nHTTP=%{http_code}\n" -H "Authorization: Bearer $TA_TOKEN" "$B/knowledge-sources/$SRC_ID?tenantId=$T"

echo "--- 8) POST identical content again -> expect 201, same id (retry)"
RETRY=$(curl -s -w "\n%{http_code}" -X POST "$B/knowledge-sources?tenantId=$T" \
  -H "Authorization: Bearer $TA_TOKEN" -H "Content-Type: application/json" \
  -d '{"sourceType":"MARKDOWN","content":"# Rate limits\n\nEnterprise tenants get 1000 requests per minute.\n"}')
echo "$RETRY"
RBODY=$(echo "$RETRY" | sed '$d')
echo "sameId=$( [ "$(echo "$RBODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id||''))")" = "$SRC_ID" ] && echo yes || echo no)"

echo "--- 9) ingestion outcome after the queue runs"
sleep 4
curl -s -H "Authorization: Bearer $TA_TOKEN" "$B/knowledge-sources?tenantId=$T" |
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d);console.log(JSON.stringify(a.map(s=>({id:s.id,status:s.status,error:s.errorCode}))))})"
echo "SRC_ID=$SRC_ID"
