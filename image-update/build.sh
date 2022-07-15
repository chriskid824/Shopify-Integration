#! /usr/bin/env bash

DEV=kscw-shopify-intg-jda8-stg
EEVEE=kscw-shopify-intg-djl9-stg
PROD=kscw-shopify-intg-4jwk-prd

# Start build
target=$1;
error=0
if [ "$1" == "dev" ]; then
    echo "Building dev...";
    gcloud builds submit --project $DEV --tag gcr.io/$DEV/image-update;
    error=$?;
elif [ "$1" == "eevee" ]; then
    echo "Building staging shard Eevee...";
    gcloud builds submit --project $EEVEE --tag gcr.io/$EEVEE/image-update;
    error=$?;
elif [ "$1" == "prod" ]; then
    echo "Building production...";
    gcloud builds submit --project $PROD --tag gcr.io/$PROD/image-update;
    error=$?;
else
    echo "Unknown target: " $1;
    error=1;
fi;


if [ "$error" != 0 ]; then
    exit 1;
fi
