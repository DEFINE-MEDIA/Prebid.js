#!/bin/bash

aws s3 cp ./gpt/definemedia_hello_world.html s3://conative-testpages/test.conative.de/prebid_js/definemedia_hello_world.html
aws s3 cp ../build/dev s3://conative-testpages/test.conative.de/prebid_js/build --recursive
