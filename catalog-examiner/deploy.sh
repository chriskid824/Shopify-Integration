#! /usr/bin/env bash

DEV=kscw-shopify-intg-jda8-stg
EEVEE=kscw-shopify-intg-djl9-stg
PROD=kscw-shopify-intg-4jwk-prd

# Start deploy
target=$1;
error=0
if [ "$1" == "dev" ]; then
    echo "Deploying dev...";
    gcloud run deploy catalog-examiner --project=$DEV --source=. --region=asia-east1;
    error=$?;
elif [ "$1" == "eevee" ]; then
    echo "Deploying staging shard Eevee...";
    gcloud run deploy catalog-examiner --project=$EEVEE --source=. --region=asia-east1;
    error=$?;
elif [ "$1" == "prod" ]; then
    echo "Deploying production...";
    gcloud run deploy catalog-examiner --project=$PROD --source=. --region=asia-east1;
    error=$?;
else
    echo "Unknown target: " $1;
    error=1;
fi;


if [ "$error" != 0 ]; then
    exit 1;
fi
