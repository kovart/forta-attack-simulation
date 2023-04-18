#!/bin/bash

echo "Building targeted version of the bot..."

cp -f package.json package.json.temp
cp -f forta.config.json forta.config.json.temp
cp -f Dockerfile Dockerfile.temp

echo "Modifying package.json, forta.config.json, Dockerfile..."

npm pkg set 'name'='attack-simulation-bot-targeted'
npm pkg set 'description'='This is a customized version of the attack-simulation-bot that scans exclusively for suspicious contracts flagged by other bots, resulting in faster detection of exploit functions.'
npm pkg delete "chainSettings"
npm pkg set 'chainSettings.default.shards'=5 --json
npm pkg set 'chainSettings.default.target'=2 --json

SOURCE_KEY="agentId2"
DESTINATION_KEY="agentId"
JSON=$(cat forta.config.json)
SOURCE_VALUE=$(echo "$JSON" | jq -r ".$SOURCE_KEY")
# Use jq to insert the source value into the destination key
JSON=$(echo "$JSON" | jq --arg key "$DESTINATION_KEY" --arg value "$SOURCE_VALUE" '. + { ($key): $value }')
# Write the updated JSON back to the file
echo "$JSON" >forta.config.json

# Use sed to replace the environment variable value in the Dockerfile
DOCKER_FILE="Dockerfile"
ENV_NAME="TARGET_MODE"
NEW_VALUE="1"
sed -i '' "s/\($ENV_NAME\s*=\s*\).*\$/\1$NEW_VALUE/" "$DOCKER_FILE"

npm run publish

echo "Restoring original configs..."

mv package.json.temp package.json
mv forta.config.json.temp forta.config.json
mv Dockerfile.temp Dockerfile
