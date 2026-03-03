#!/bin/bash

set -euo pipefail

SECRET_NAME="remote-kubeconfig"
NAMESPACE="hspc-replication-operator-system" # "hspc-dr-operator-system"  # Change if needed

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <cluster-name> <kubeconfig-file>"
  exit 1
fi

CLUSTER_NAME="$1"
KUBECONFIG_FILE="$2"

if [ ! -f "$KUBECONFIG_FILE" ]; then
  echo "Error: File '$KUBECONFIG_FILE' not found."
  exit 1
fi

# Base64 encode the kubeconfig (no line breaks)
ENCODED_KUBECONFIG=$(base64 -w 0 "$KUBECONFIG_FILE")

# Check if secret exists
if ! kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
  echo "Secret $SECRET_NAME does not exist. Creating with cluster: $CLUSTER_NAME"
  kubectl create secret generic "$SECRET_NAME" \
    --from-file="$CLUSTER_NAME=$KUBECONFIG_FILE" \
    -n "$NAMESPACE"
  exit 0
fi

# Fetch secret data
SECRET_JSON=$(kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" -o json)

# Check for existing kubeconfig (value match)
MATCHING_KEY=$(echo "$SECRET_JSON" | jq -r --arg val "$ENCODED_KUBECONFIG" '
  .data | to_entries[] | select(.value == $val) | .key
')

if [ -n "$MATCHING_KEY" ]; then
  echo "❌ This kubeconfig has already been registered under cluster name: '$MATCHING_KEY'"
  exit 1
fi

# Check if key (cluster name) already exists
if echo "$SECRET_JSON" | jq -e --arg key "$CLUSTER_NAME" '.data | has($key)' >/dev/null; then
  echo "❌ Cluster name '$CLUSTER_NAME' is already in use. Please choose a different name."
  exit 1
fi

# Safe to append
echo "✅ Appending new cluster '$CLUSTER_NAME' to secret."
kubectl patch secret "$SECRET_NAME" -n "$NAMESPACE" \
  --type='merge' \
  -p "{\"data\":{\"$CLUSTER_NAME\":\"$ENCODED_KUBECONFIG\"}}"
